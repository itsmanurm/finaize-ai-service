import { normalizeMerchant } from './merchant-normalizer';
import { rulesCategory } from './rule-engine';
import { createHash } from 'crypto';
import { getCachedCategorization, setCachedCategorization } from './cache';
import { categorizeWithOpenAI } from './openai-service';
import { consultMemory } from './learning-service';
import { config } from '../config';
import { SUSCRIPCIONES } from '../utils/ai-constants';

type Currency = 'ARS' | 'USD';

export interface CategorizeInput {
  description: string;
  merchant?: string;
  amount: number;
  currency: Currency;
  when?: string;
  accountLast4?: string;
  bankMessageId?: string;
  transactionType?: 'ingreso' | 'egreso' | 'transferencia';
  useAI?: boolean;

  // Contexto para IA
  previousTransactions?: Array<{
    description: string;
    amount: number;
    category?: string;
  }>;
  userProfile?: {
    commonMerchants?: string[];
  };
}

export interface CategorizeOutput {
  category: string;
  confidence: number;
  reasons: string[];
  merchant_clean: string;
  dedupHash: string;
  aiEnhanced?: boolean;
  aiReasoning?: string;
}

// Map para evitar llamadas concurrentes duplicadas para la misma transacción
const inFlightRequests = new Map<string, Promise<CategorizeOutput>>();

function dedupHash(v: {
  amount: number;
  when?: string;
  merchant_clean?: string;
  accountLast4?: string;
  bankMessageId?: string;
}) {
  const parts = [
    Math.abs(Number(v.amount)).toFixed(2),
    (v.when ?? '').slice(0, 10),
    (v.merchant_clean ?? '').toLowerCase(),
    (v.accountLast4 ?? '').trim(),
    (v.bankMessageId ?? '').trim()
  ];
  return createHash('sha1').update(parts.join('|')).digest('hex');
}



export async function categorize(input: CategorizeInput): Promise<CategorizeOutput> {
  // Verificar cache primero
  const cacheKey = {
    description: input.description,
    merchant: input.merchant,
    amount: input.amount,
    currency: input.currency
  };

  const cached = await getCachedCategorization(cacheKey);
  if (cached) {
    return cached;
  }

  // LAYER 1: Memory (User Feedback) - Existing
  const userLearned = await consultMemory({
    merchant: input.merchant,
    description: input.description
  });

  if (userLearned) {
    const result: CategorizeOutput = {
      category: userLearned.category,
      confidence: userLearned.confidence,
      reasons: [`learned:${userLearned.source} (${userLearned.count} votes)`],
      merchant_clean: normalizeMerchant(input.merchant || ''),
      dedupHash: '',
      aiEnhanced: false
    };
    const merchant_clean = normalizeMerchant(input.merchant || '');
    result.dedupHash = dedupHash({
      amount: input.amount,
      when: input.when,
      merchant_clean,
      accountLast4: input.accountLast4,
      bankMessageId: input.bankMessageId
    });
    await setCachedCategorization(cacheKey, result);
    return result;
  }

  // Common normalization
  const merchant_clean = normalizeMerchant(input.merchant || '');

  // LAYER 2: Strict Subscriptions (New)
  const fullText = (merchant_clean + ' ' + input.description).toLowerCase();
  // Import dynamically to avoid top-level optional import issues if file was just created, though standard import is better. 
  // We will add import at top, but for now assuming it's available or we add it.
  const isSubscription = SUSCRIPCIONES.some(sub => fullText.includes(sub.toLowerCase()));

  if (isSubscription) {
    const result: CategorizeOutput = {
      category: 'Suscripciones',
      confidence: 0.95,
      reasons: ['whitelist:subscription'],
      merchant_clean,
      dedupHash: dedupHash({ amount: input.amount, when: input.when, merchant_clean, accountLast4: input.accountLast4, bankMessageId: input.bankMessageId }),
      aiEnhanced: false
    };
    await setCachedCategorization(cacheKey, result);
    return result;
  }

  // LAYER 3: Recurring Patterns (Contextual Intelligence) (New)
  // If we have history, check if this EXACT merchant + amount combo appeared before.
  if (input.previousTransactions && input.previousTransactions.length > 0) {
    // Look for exact match on merchant and amount (margin of error small for currency fluctuation? No, strict for now)
    const match = input.previousTransactions.find(t =>
      t.amount === input.amount &&
      t.category &&
      t.category !== 'Sin clasificar' &&
      normalizeMerchant(t.description || '').includes(merchant_clean) // Fuzzy matching merchant against historical description
    );

    if (match && match.category) {
      const result: CategorizeOutput = {
        category: match.category,
        confidence: 0.85,
        reasons: ['pattern:recurring_amount'],
        merchant_clean,
        dedupHash: dedupHash({ amount: input.amount, when: input.when, merchant_clean, accountLast4: input.accountLast4, bankMessageId: input.bankMessageId }),
        aiEnhanced: false
      };
      await setCachedCategorization(cacheKey, result);
      return result;
    }
  }

  // LAYER 4: Smart Heuristics (Keyword Intelligence) (New)
  const lowerDesc = input.description.toLowerCase();

  // 4.1 Loans / Installments
  if (lowerDesc.includes('cuota') || lowerDesc.match(/\d{1,2}\/\d{1,2}/)) {
    // "Cuota 3/12" or just "Cuota" often implies Debt/Loan or Credit Card Payment (if large)
    // But simple heuristics: Préstamos if it looks like a loan, or generic expense.
    // Let's go with 'Préstamos' if explicit.
    if (lowerDesc.includes('prestamo') || lowerDesc.includes('préstamo')) {
      const result: CategorizeOutput = {
        category: 'Préstamos',
        confidence: 0.9,
        reasons: ['heuristic:keyword_loan'],
        merchant_clean,
        dedupHash: dedupHash({ amount: input.amount, when: input.when, merchant_clean, accountLast4: input.accountLast4, bankMessageId: input.bankMessageId }),
        aiEnhanced: false
      };
      await setCachedCategorization(cacheKey, result);
      return result;
    }
  }

  // NOTE: Internal transfers (transactionType: 'transferencia') should never reach this service
  // They are filtered at the route level. This service only categorizes normal transactions.
  // If a transaction has paymentMethod: 'transferencia', that's fine - it's a payment method, not a transfer type.

  // LAYER 5: Rules (Existing Regex)
  const bag = [merchant_clean, input.description].filter(Boolean).join(' ').trim();

  const common = {
    merchant_clean,
    dedupHash: dedupHash({
      amount: input.amount,
      when: input.when,
      merchant_clean,
      accountLast4: input.accountLast4,
      bankMessageId: input.bankMessageId
    })
  };

  // LAYER 5: Rules (Existing Regex)
  const rule = rulesCategory(bag);
  // Validar configuración de AI_MIN_CONFIDENCE
  const minConf = config.AI_MIN_CONFIDENCE;
  if (isNaN(minConf) || minConf <= 0 || minConf > 1) {
    console.warn('AI_MIN_CONFIDENCE no está configurado correctamente. Usando valor por defecto: 0.6');
  }

  // LAYER 6: AI (OpenAI) - Generative Fallback
  // Intentar OpenAI si useAI es true O no hay rule hit O rule strength es bajo
  if (input.useAI || !rule.hit || (rule as any).strength < minConf) {
    try {
      // Verificar si OpenAI está disponible
      if (config.OPENAI_API_KEY) {
        const key = common.dedupHash;

        if (inFlightRequests.has(key)) {
          return await inFlightRequests.get(key)!;
        }

        const p = (async (): Promise<CategorizeOutput> => {
          try {
            const openAIResult = await categorizeWithOpenAI({
              description: input.description,
              merchant: input.merchant,
              amount: input.amount,
              currency: input.currency,
              context: {
                recentTransactions: input.previousTransactions || [],
                userProfile: input.userProfile
              }
            });

            const res: CategorizeOutput = {
              category: openAIResult.category,
              confidence: openAIResult.confidence,
              reasons: [`ai:${openAIResult.reasoning}`],
              merchant_clean,
              dedupHash: key,
              aiEnhanced: true,
              aiReasoning: openAIResult.reasoning
            };

            await setCachedCategorization(cacheKey, res);

            return res;
          } catch (err: any) {
            console.error('OpenAI categorization error (detailed):', {
              message: err?.message,
              status: err?.status || err?.response?.status,
              stack: err?.stack
            });
            throw err;
          } finally {
            inFlightRequests.delete(key);
          }
        })();

        inFlightRequests.set(key, p);
        try {
          return await p;
        } catch (err) {
          console.warn('OpenAI categorization failed, falling back to rules:', (err as any)?.message || err);
        }
      }
    } catch (error) {
      console.warn('OpenAI categorization failed, falling back to rules:', (error as any)?.message || error);
    }
  }

  // Fallback to Rule Result (even if weak) or Default
  let result: CategorizeOutput;

  if ((rule as any).hit) {
    const conf = Math.min(1, (rule as any).strength);
    let category: string;
    if (conf >= minConf) {
      category = (rule as any).category;
    } else {
      const isExpense = input.transactionType === 'egreso' || (Number(input.amount) < 0 && !input.transactionType);
      category = isExpense ? 'Sin clasificar' : 'Ingresos';
    }
    result = {
      category,
      confidence: conf,
      reasons: [(rule as any).reason],
      merchant_clean,
      dedupHash: common.dedupHash,
      aiEnhanced: false
    };
  } else {
    const isExpense = input.transactionType === 'egreso' || (Number(input.amount) < 0 && !input.transactionType);
    const fallbackCategory = isExpense ? 'Sin clasificar' : 'Ingresos';
    result = {
      category: fallbackCategory,
      confidence: 0.4,
      reasons: ['fallback:heuristic'],
      merchant_clean,
      dedupHash: common.dedupHash,
      aiEnhanced: false
    };
  }

  // Guardar en cache
  await setCachedCategorization(cacheKey, result);
  return result;
}

export async function categorizeBatch(
  inputs: CategorizeInput[],
  options?: {
    useAI?: boolean;
    maxConcurrency?: number;
  }
): Promise<CategorizeOutput[]> {
  const { useAI = false, maxConcurrency = 3 } = options || {};
  const results: CategorizeOutput[] = [];

  // Procesar en lotes para evitar sobrecarga
  for (let i = 0; i < inputs.length; i += maxConcurrency) {
    const batch = inputs.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (input) => {
      try {
        return await categorize({ ...input, useAI });
      } catch (error) {
        console.error(`Error categorizing transaction ${i}:`, error);
        // Retornar categorización por defecto en caso de error
        return {
          category: 'Sin clasificar',
          confidence: 0.1,
          reasons: ['error:processing'],
          merchant_clean: '',
          dedupHash: '',
          aiEnhanced: false
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Pequeño delay entre lotes
    if (i + maxConcurrency < inputs.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}