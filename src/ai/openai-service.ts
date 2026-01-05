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

  // Prompt optimized for GPT-4o-mini
  let prompt = `Actúa como un analista de datos financieros experto en el mercado argentino.
Tu tarea es categorizar la siguiente transacción bancaria con alta precisión.

**TRANSACCIÓN A ANALIZAR:**
- Descripción: "${description}"
- Comercio Detectado: "${merchant || 'No especificado'}"
- Monto: ${formattedAmount} (${amountType})
- Moneda: ${currency}

**CATEGORÍAS DISPONIBLES:**
${CATEGORIES.map(cat => `- ${cat}`).join('\n')}

**DIRECTRICES EXCLUSIVAS:**
1. **Contexto Local:** Reconoce marcas, abreviaturas y servicios de Argentina (ej. "MP", "Coto", "Afip", "Sube").
2. **Coherencia de Monto:** Un gasto negativo NO puede ser "Ingresos" ni "Salarios".
3. **Ingresos:** Solo clasifica como "Ingresos", "Salarios", "Transferencias" o "Inversiones" si el monto es positivo.
4. **Confianza:** Asigna un score (0.0 - 1.0). Sé conservador si la descripción es ambigua (ej. "Transferencia").
5. **Razonamiento:** Breve y conciso.`;

  // Context Injection
  if (context?.recentTransactions && context.recentTransactions.length > 0) {
    const history = context.recentTransactions.slice(0, 15); // Use up to 15 items
    prompt += `\n\n**HISTORIAL RECIENTE (Contexto de Aprendizaje Few-Shot):**
La siguiente es una lista de transacciones pasadas de este usuario. Úsala para detectar patrones (ej. si siempre clasifica "Carrefour" como "Supermercado").
${history.map(t => `- "${t.description}" (${t.amount}) -> ${t.category || '?'}`).join('\n')}`;
  }

  if (context?.userProfile?.commonMerchants) {
    prompt += `\n\n**COMERCIOS FRECUENTES:** ${context.userProfile.commonMerchants.join(', ')}`;
  }

  prompt += `\n\n**FORMATO DE SALIDA (JSON Puro):**
{
  "category": "Nombre Exacto de la Categoría",
  "confidence": 0.95,
  "reasoning": "Por qué elegiste esta categoría",
  "suggestedSubcategory": "Subcategoría opcional"
}`;

  return prompt;
}

export async function categorizeWithOpenAI(input: OpenAICategorizationInput): Promise<OpenAICategorizationOutput> {
  const openai = getOpenAIClient();

  const prompt = createPrompt(input);
  // Prefer gpt-4o-mini for speed/cost/quality balance
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const VALID_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4'];
  if (!VALID_MODELS.includes(model)) {
    console.warn(`Modelo ${model} no está en lista whitelist, pero intentaremos usarlo.`);
  }

  try {
    const makeRequest = () => openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'Eres un experto analista financiero argentino. Tu trabajo es categorizar transacciones bancarias con precisión. Responde SIEMPRE en formato JSON válido.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2, // Baja temperatura para consistencia
      max_tokens: 500,
      response_format: { type: "json_object" } // Enforce JSON mode
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
      // Si no puede parsear el JSON, intentar extraer inforamción básica
      throw new Error(`Failed to parse OpenAI response: ${responseContent}`);
    }

    // Normalizar respuesta si openai devuelve algo anidado o ligeramente diferente
    const category = parsedResponse.category || 'Sin clasificar';

    // Validar que la categoría esté en la lista permitida con una búsqueda fuzzy simple si falla exact match
    let finalCategory = category;
    if (!CATEGORIES.includes(category)) {
      // Intento de recuperación simple
      const match = CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase());
      if (match) {
        finalCategory = match;
      } else {
        console.warn(`AI returned invalid category: "${category}". Fallbacking to "Sin clasificar" or keeping simple.`);
        // Si no existe, podríamos aceptarla o forzar 'Sin clasificar'. 
        // Para ser estrictos con el sistema:
        finalCategory = 'Sin clasificar';
      }
    }

    // Validar confidence
    const confidence = Math.max(0.1, Math.min(1.0, parsedResponse.confidence || 0.7));

    return {
      category: finalCategory,
      confidence,
      reasoning: parsedResponse.reasoning || 'Categorización basada en IA',
      suggestedSubcategory: parsedResponse.suggestedSubcategory
    };

  } catch (error: any) {
    console.error('Error en OpenAI:', {
      message: error.message,
      model,
      inputDescription: input.description
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

export async function agentChatCompletion(params: {
  messages: any[];
  tools?: any[];
  model?: string;
}) {
  const openai = getOpenAIClient();
  const model = params.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  try {
    const completion = await callWithTimeoutAndRetries(() => openai.chat.completions.create({
      model,
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.tools ? 'auto' : undefined,
      temperature: 0.1, // Precision needed for tools
    }), { timeoutMs: 30000, retries: 2 });

    return completion.choices[0].message;
  } catch (error: any) {
    console.error('Error en Agent Chat Completion:', error.message);
    throw new Error(`OpenAI Agent API error: ${error.message}`);
  }
}