import { normalizeMerchant } from './merchant-normalizer';
import { rulesCategory } from './rule-engine';
import { getCachedCategorization, setCachedCategorization } from './cache';
import { categorizeWithOpenAI } from './openai-service';
import { consultMemory } from './learning-service';
import { config } from '../config';
import { dedupHash } from '../utils/hash';

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

export async function categorize(input: CategorizeInput): Promise<CategorizeOutput> {
  // Normalizar merchant una sola vez
  const merchant_clean = normalizeMerchant(input.merchant || '');
  
  // Calcular dedupHash una sola vez
  const hash = dedupHash({
    amount: input.amount,
    when: input.when,
    merchant_clean,
    accountLast4: input.accountLast4,
    bankMessageId: input.bankMessageId
  });

  // Verificar cache primero (con merchant normalizado)
  const cacheKey = {
    description: input.description,
    merchant: merchant_clean,
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
      merchant_clean,
      dedupHash: hash,
      aiEnhanced: false // No es IA generativa, es memoria
    };

    // Guardar en cache para futuro inmediato
    await setCachedCategorization(cacheKey, result);
    return result;
  }



  const bag = [merchant_clean, input.description].filter(Boolean).join(' ').trim();

  // Si se requiere IA específicamente o si no hay match de reglas
  const rule = rulesCategory(bag);
  
  // Validar y resolver AI_MIN_CONFIDENCE efectivo
  const effectiveMinConfidence = 
    isNaN(config.AI_MIN_CONFIDENCE) || config.AI_MIN_CONFIDENCE <= 0 || config.AI_MIN_CONFIDENCE > 1
      ? 0.6
      : config.AI_MIN_CONFIDENCE;
  
  if (effectiveMinConfidence === 0.6) {
    console.warn('AI_MIN_CONFIDENCE no está configurado correctamente. Usando valor por defecto: 0.6');
  }

  // Intentar OpenAI si:
  // 1. useAI es true
  // 2. No hay match de reglas regex
  // 3. La confianza de reglas es baja
  if (input.useAI || !rule.hit || (rule as any).strength < effectiveMinConfidence) {
    try {
      // Verificar si OpenAI está disponible
      if (config.OPENAI_API_KEY) {
        const key = hash;

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
              dedupHash: hash,
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

  // Constantes internas para fallback
  const FALLBACK_EXPENSE = 'Sin clasificar';
  const FALLBACK_INCOME = 'Ingresos';
  
  // Determinar tipo sin inferir de amount (solo usar transactionType explícito)
  const isExpense = input.transactionType !== 'ingreso';
  
  // Aplicar reglas regex
  let result: CategorizeOutput;

  if ((rule as any).hit) {
    const conf = Math.min(1, (rule as any).strength);
    let category: string;
    if (conf >= effectiveMinConfidence) {
      category = (rule as any).category;
    } else {
      // Si la regla tuvo hit pero la confianza es baja, usar fallback
      category = isExpense ? FALLBACK_EXPENSE : FALLBACK_INCOME;
    }
    result = {
      category,
      confidence: conf,
      reasons: [(rule as any).reason],
      merchant_clean,
      dedupHash: hash,
      aiEnhanced: false
    };
  } else {
    // Logs DEBUG protegidos
    if (config.NODE_ENV !== 'production') {
      console.log('DEBUG: Categorize Input:', JSON.stringify(input, null, 2));
      console.log('DEBUG: Rule Match:', JSON.stringify(rule, null, 2));
      console.log('DEBUG: AI Confidence Threshold:', effectiveMinConfidence);
    }
    
    // Fallback heurístico
    const fallbackCategory = isExpense ? FALLBACK_EXPENSE : FALLBACK_INCOME;
    result = {
      category: fallbackCategory,
      confidence: 0.4,
      reasons: ['fallback:heuristic'],
      merchant_clean,
      dedupHash: hash,
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
        const merchantClean = normalizeMerchant(input.merchant || '');
        const errorHash = dedupHash({
          amount: input.amount,
          when: input.when,
          merchant_clean: merchantClean,
          accountLast4: input.accountLast4,
          bankMessageId: input.bankMessageId
        });
        return {
          category: 'Sin clasificar',
          confidence: 0.1,
          reasons: ['error:processing'],
          merchant_clean: merchantClean,
          dedupHash: errorHash,
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