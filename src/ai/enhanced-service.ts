import { normalizeMerchant } from './merchant-normalizer';
import { rulesCategory } from './rule-engine';
import { createHash } from 'crypto';
import { getCachedCategorization, setCachedCategorization } from './cache';
import { categorizeWithOpenAI } from './openai-service';
import { consultMemory } from './learning-service';
import { config } from '../config';

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

  // Verificar aprendizaje del usuario (Feedback Loop)
  // Esto tiene precedencia sobre Regex y OpenAI porque es lo que el usuario quiere explícitamente
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
      dedupHash: '', // Se generará abajo si se necesita
      aiEnhanced: false // No es IA generativa, es memoria
    };
    // Calcular hash para consistencia
    const merchant_clean = normalizeMerchant(input.merchant || '');
    result.dedupHash = dedupHash({
      amount: input.amount,
      when: input.when,
      merchant_clean,
      accountLast4: input.accountLast4,
      bankMessageId: input.bankMessageId
    });

    // Guardar en cache para futuro inmediato
    await setCachedCategorization(cacheKey, result);
    return result;
  }



  const merchant_clean = normalizeMerchant(input.merchant || '');
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

  // Si se requiere IA específicamente o si no hay match de reglas
  const rule = rulesCategory(bag);
  // Validar configuración de AI_MIN_CONFIDENCE
  const minConf = config.AI_MIN_CONFIDENCE;
  if (isNaN(minConf) || minConf <= 0 || minConf > 1) {
    console.warn('AI_MIN_CONFIDENCE no está configurado correctamente. Usando valor por defecto: 0.6');
  }

  // Intentar OpenAI si:
  // 1. useAI es true
  // 2. No hay match de reglas regex
  // 3. La confianza de reglas es baja
  if (input.useAI || !rule.hit || (rule as any).strength < minConf) {
    try {
      // Verificar si OpenAI está disponible
      if (config.OPENAI_API_KEY) {
        const key = common.dedupHash;

        if (inFlightRequests.has(key)) {
          // Reutilizar la petición en curso
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

            // Guardar en cache
            try {
              await setCachedCategorization(cacheKey, res);
            } catch (cacheErr) {
              console.warn('Failed to set cache for categorization:', cacheErr);
            }

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
          // Si falla, continuar con reglas como fallback
          console.warn('OpenAI categorization failed, falling back to rules:', (err as any)?.message || err);
        }
      }
    } catch (error) {
      console.warn('OpenAI categorization failed, falling back to rules:', (error as any)?.message || error);
      // Continuar con reglas como fallback
    }
  }

  // Aplicar reglas regex
  let result: CategorizeOutput;

  if ((rule as any).hit) {
    const conf = Math.min(1, (rule as any).strength);
    let category: string;
    if (conf >= minConf) {
      category = (rule as any).category;
    } else {
      // Si la regla tuvo hit pero la confianza es baja, usar fallback basado en el tipo
      const isExpense = input.transactionType === 'egreso' || (Number(input.amount) < 0 && !input.transactionType);
      // Nota: Si no hay transactionType, asumimos egreso por defecto para montos positivos (comportamiento estándar)
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

    console.log('DEBUG: Categorize Input:', JSON.stringify(input, null, 2));
    console.log('DEBUG: Rule Match:', JSON.stringify(rule, null, 2));
    console.log('DEBUG: AI Confidence Threshold:', minConf);
    // Fallback inteligente
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