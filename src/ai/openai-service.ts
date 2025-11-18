import OpenAI from 'openai';

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('La variable de entorno OPENAI_API_KEY no está configurada.');
  }
  return new OpenAI({ apiKey });
}

async function callWithTimeoutAndRetries(fn: () => Promise<any>, opts?: { timeoutMs?: number; retries?: number }) {
  const { timeoutMs = 30000, retries = 2 } = opts || {};
  let attempt = 0;
  let lastError: any;

  while (attempt <= retries) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('OpenAI request timeout')), timeoutMs))
      ]);
      return result;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.response?.status;

      // If last attempt, break and throw
      if (attempt === retries) break;

      // Retry on rate limits or common transient network errors
      const shouldRetry = status === 429 || /rate limit|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(err?.message || '');
      if (!shouldRetry) break;

      const backoff = Math.pow(2, attempt) * 500;
      await new Promise(res => setTimeout(res, backoff));
      attempt++;
      continue;
    }
  }

  throw lastError;
}

interface OpenAICategorizationInput {
  description: string;
  merchant?: string;
  amount: number;
  currency: 'ARS' | 'USD';
  context?: {
    recentTransactions?: Array<{
      description: string;
      amount: number;
      category?: string;
    }>;
    userProfile?: {
      country?: string;
      commonMerchants?: string[];
    };
  };
}

interface OpenAICategorizationOutput {
  category: string;
  confidence: number;
  reasoning: string;
  suggestedSubcategory?: string;
}

const CATEGORIES = [
  'Alimentación',
  'Transporte',
  'Vivienda',
  'Servicios',
  'Salud',
  'Educación',
  'Entretenimiento',
  'Compras',
  'Inversiones',
  'Impuestos',
  'Transferencias',
  'Salarios',
  'Supermercado',
  'Combustible',
  'Bebidas',
  'Comidas',
  'Compras online',
  'Fintech',
  'Bancos',
  'Suscripciones',
  'Seguros',
  'Deportes',
  'Moda y ropa',
  'Calzado',
  'Tecnología',
  'Electrodomésticos',
  'Belleza',
  'Mascotas',
  'Flores',
  'Cultura',
  'Servicios de eventos',
  'Servicios automotrices',
  'Salud y fitness',
  'Servicios de entrega',
  'Efectivo',
  'Cargos bancarios',
  'Ferretería y hogar',
  'Tiendas departamentales',
  'Farmacias',
  'Clínicas',
  'Veterinarias',
  'Gimnasios',
  'Librerías',
  'Tiendas de conveniencia',
  'Sin clasificar',
  'Ingresos'
];

function createPrompt(input: OpenAICategorizationInput): string {
  const { description, merchant, amount, currency, context } = input;
  
  const amountType = amount < 0 ? 'expense' : 'income';
  const formattedAmount = `${currency} ${Math.abs(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  
  let prompt = `Eres un experto en categorización de transacciones financieras argentinas.

Analiza la siguiente transacción y clasifícala en una de las categorías disponibles:

**TRANSACCIÓN:**
- Descripción: "${description}"
- Comercio: "${merchant || 'No especificado'}"
- Monto: ${formattedAmount} (${amountType})
- Moneda: ${currency}

**CATEGORÍAS DISPONIBLES:**
${CATEGORIES.map(cat => `- ${cat}`).join('\n')}

**INSTRUCCIONES:**
1. Considera que esto es para el mercado argentino
2. Ten en cuenta el tipo de monto (gasto/ingreso)
3. Si es un gasto, no puede ser "Ingresos" o "Salarios"
4. Si es un ingreso, debe ser "Ingresos", "Salarios", "Transferencias" o "Inversiones"
5. Proporciona un confidence score del 0.1 al 1.0
6. Explica brevemente tu razonamiento

**CONTEXTO ADICIONAL:**`;

  if (context?.recentTransactions) {
    prompt += `\n- Transacciones recientes del usuario: ${context.recentTransactions.slice(-3).map(t => `"${t.description}" (${t.category || 'sin categoría'})`).join(', ')}`;
  }

  if (context?.userProfile?.commonMerchants) {
    prompt += `\n- Comercios frecuentes: ${context.userProfile.commonMerchants.join(', ')}`;
  }

  prompt += `\n\nResponde en formato JSON con la siguiente estructura:
{
  "category": "categoria_seleccionada",
  "confidence": 0.95,
  "reasoning": "explicación del razonamiento",
  "suggestedSubcategory": "subcategoria_opcional"
}`;

  return prompt;
}

export async function categorizeWithOpenAI(input: OpenAICategorizationInput): Promise<OpenAICategorizationOutput> {
  const openai = getOpenAIClient();

  const prompt = createPrompt(input);
  const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  
  const VALID_MODELS = ['gpt-3.5-turbo', 'gpt-4'];
  if (!VALID_MODELS.includes(model)) {
    throw new Error(`Modelo no válido: ${model}. Modelos permitidos: ${VALID_MODELS.join(', ')}`);
  }

  const DEFAULT_CATEGORY = process.env.DEFAULT_CATEGORY || 'Sin clasificar';
  const DEFAULT_CONFIDENCE = parseFloat(process.env.DEFAULT_CONFIDENCE || '0.3');

  try {
    const makeRequest = () => openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'Eres un experto en categorización de transacciones financieras. Responde siempre en JSON válido.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1, // Baja temperatura para consistencia
      max_tokens: 300,
    });

    const completion = await callWithTimeoutAndRetries(makeRequest, { timeoutMs: 30000, retries: 2 });

    const responseContent = completion.choices?.[0]?.message?.content;
    if (!responseContent) {
      throw new Error('No response from OpenAI');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseContent);
    } catch (parseError) {
      // Si no puede parsear el JSON, intentar extraer información básica
      throw new Error(`Failed to parse OpenAI response: ${responseContent}`);
    }

    // Validar que la categoría esté en la lista permitida
    if (!CATEGORIES.includes(parsedResponse.category)) {
      throw new Error(`Invalid category: ${parsedResponse.category}`);
    }

    // Validar confidence
    const confidence = Math.max(0.1, Math.min(1.0, parsedResponse.confidence || 0.7));

    return {
      category: parsedResponse.category,
      confidence,
      reasoning: parsedResponse.reasoning || 'Categorización basada en IA',
      suggestedSubcategory: parsedResponse.suggestedSubcategory
    };

  } catch (error: any) {
    console.error('Error en OpenAI:', {
      message: error.message,
      stack: error.stack,
      input: prompt
    });
    
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

export async function categorizeBatchOpenAI(
  inputs: OpenAICategorizationInput[],
  options?: {
    maxConcurrency?: number;
    delayBetweenRequests?: number;
  }
): Promise<OpenAICategorizationOutput[]> {
  const { maxConcurrency = 5, delayBetweenRequests = 100 } = options || {};
  const results: OpenAICategorizationOutput[] = [];
  
  // Procesar en lotes para evitar rate limits
  for (let i = 0; i < inputs.length; i += maxConcurrency) {
    const batch = inputs.slice(i, i + maxConcurrency);
    
    const batchPromises = batch.map(async (input) => {
      try {
        return await categorizeWithOpenAI(input);
      } catch (error) {
        console.error(`Error categorizing transaction ${i}:`, error);
        // Retornar categorización por defecto en caso de error
        return {
          category: 'Sin clasificar',
          confidence: 0.3,
          reasoning: 'Error en categorización automática',
          suggestedSubcategory: undefined
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Delay entre lotes para evitar rate limits
    if (i + maxConcurrency < inputs.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
  }
  
  return results;
}