import { getOpenAIClient } from './openai-service';

type NLUResult = {
  intent: string;
  confidence: number;
  entities?: Record<string, any>;
};

// Reglas simples y deterministas para intents comunes
const INTENT_RULES: Array<{ name: string; re: RegExp }> = [
    { name: 'query_top_expenses', re: /gastos? (altos|mayores|de m[aá]s|inusuales|importantes|más altos|más grandes|más importantes)/i },
  { name: 'add_expense', re: /\b(gast[oó]|pagu[eé]|registrar gasto|agrega un gasto|añadir gasto)\b/i },
  { name: 'query_top_expenses', re: /gastos? (altos|mayores|de m[aá]s|inusuales|importantes|más altos|más grandes|más importantes)/i },
  { name: 'query_summary', re: /\b(cu[aá]nto|mostrame|mu[eé]strame|resumen|gastos|balance|¿en qu[eé])\b/i },
  { name: 'create_goal', re: /\b(meta|ahorrar|guardar|objetivo)\b/i },
  { name: 'categorize', re: /\b(categor[ií]a|¿en qu[eé] categor|en qu[eé] entra)\b/i },
];

export async function parseMessage(message: string): Promise<NLUResult> {
  // Extracción de entidades mejorada
  let entities: Record<string, any> = {};
  // Si pregunta por "este mes", extraer el mes actual
  if (/este mes/i.test(message)) {
    const now = new Date();
    entities.month = now.getMonth() + 1;
    entities.year = now.getFullYear();
  }
  // Si el mensaje contiene 'transferí', asignar categoría transferencia
  if (/transfer[ií]/i.test(message)) {
    entities.category = 'transferencia';
  }
  // Monto
  const amountMatch = message.match(/([+-]?\d+[\d,.]*)/);
  if (amountMatch) entities.amount = Number(amountMatch[1].replace(/,/g, ''));
  // Moneda
  const currencyMatch = message.match(/\b(ARS|USD|EUR|pesos?|d[oó]lares?|euros?)\b/i);
  if (currencyMatch) entities.currency = currencyMatch[1].toUpperCase();
  // Comercio (merchant)
  // Ej: "a Juan", "en Carrefour", "a Mercado Libre", "transferí a Juan"
  let merchant = '';
  // Buscar "transferí a [nombre]"
  const merchantMatchTransfer = message.match(/transfer[ií]\s+a\s+([A-Za-z0-9áéíóúüñ\-]+)/i);
  if (merchantMatchTransfer) merchant = merchantMatchTransfer[1].trim();
  // Buscar "a [nombre]", "en [nombre]", "para [nombre]" (permitir signos de puntuación, interrogación, etc.)
  if (!merchant) {
    const merchantMatchGeneral = message.match(/(?:a|en|para)\s+([A-Za-z0-9áéíóúüñ\-]+)(?=\s|\?|\.|,|$)/i);
    if (merchantMatchGeneral) merchant = merchantMatchGeneral[1].trim();
  }
  // Fallback: si el intent es transferencia o query_summary y hay "a [nombre]" en la pregunta
  if (!merchant) {
    const fallbackMatch = message.match(/a\s+([A-Za-z0-9áéíóúüñ\-]+)(?=\s|\?|\.|,|$)/i);
    if (fallbackMatch) merchant = fallbackMatch[1].trim();
  }
  if (merchant) entities.merchant = merchant;
  // Categoría
  const categoryMatch = message.match(/categor[ií]a\s+([A-Za-z0-9\sáéíóúüñ\-]+)/i);
  if (categoryMatch) entities.category = categoryMatch[1].trim();
  // Año
  const yearMatch = message.match(/(20\d{2})/);
  if (yearMatch) entities.year = Number(yearMatch[1]);
  // Mes
  const monthMatch = message.match(/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i);
  if (monthMatch) {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    entities.month = months.findIndex(m => m === monthMatch[0].toLowerCase()) + 1;
  }

  // Rule-based first, pero si no hay match exacto, priorizar fallback a OpenAI
  let matchedIntent = null;
  for (const r of INTENT_RULES) {
    if (r.re.test(message)) {
      matchedIntent = r.name;
      break;
    }
  }

  // Si no hay match, o la confianza es baja, usar OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };

  try {
    const openai = getOpenAIClient();
    const prompt = `Eres un parser de intención financiera. Tu tarea es identificar el intent y extraer entidades relevantes (cantidad, moneda, comercio, fecha, categoría, merchant, periodo, tipo de consulta, activo, mercado) del mensaje del usuario. Responde SOLO JSON con las keys: intent, confidence, entities. Siempre responde en español.\n\nEjemplos:\n\nMensaje: "¿Cuáles fueron mis gastos altos este mes?"\nRespuesta: {"intent": "query_top_expenses", "confidence": 0.98, "entities": {"period": "mes_actual"}}\n\nMensaje: "Sumame todos los gastos en supermercados en noviembre"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"category": "supermercado", "month": 11}}\n\nMensaje: "Transferí $5000 a Juan"\nRespuesta: {"intent": "add_expense", "confidence": 0.96, "entities": {"amount": 5000, "merchant": "Juan", "category": "transferencia"}}\n\nMensaje: "¿Cuánto gasté en restaurantes este año?"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"category": "restaurante", "year": 2025}}\n\nMensaje: "Quiero crear una meta de ahorro de $10000"\nRespuesta: {"intent": "create_goal", "confidence": 0.99, "entities": {"amount": 10000, "category": "ahorro"}}\n\nMensaje: "Categoriza esta transacción: Starbucks $1200"\nRespuesta: {"intent": "categorize", "confidence": 0.95, "entities": {"merchant": "Starbucks", "amount": 1200}}\n\nMensaje: "¿Cuáles son los mejores cedear hoy?"\nRespuesta: {"intent": "query_market_info", "confidence": 0.98, "entities": {"activo": "cedear", "period": "hoy", "tipo": "mejores"}}\n\nMensaje: "¿Qué criptomonedas están subiendo esta semana?"\nRespuesta: {"intent": "query_market_info", "confidence": 0.97, "entities": {"activo": "criptomoneda", "period": "semana", "tipo": "subiendo"}}\n\nMensaje: "Recomendame acciones para invertir este mes"\nRespuesta: {"intent": "query_market_info", "confidence": 0.97, "entities": {"activo": "acción", "period": "mes", "tipo": "recomendación"}}\n\nMensaje: "¿Qué fondos comunes de inversión me convienen este trimestre?"\nRespuesta: {"intent": "query_market_info", "confidence": 0.97, "entities": {"activo": "fondo común de inversión", "period": "trimestre", "tipo": "conveniencia"}}\n\nMensaje: "¿Cuánto gasté en transferencias a MercadoPago este mes?"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"category": "transferencia", "merchant": "MercadoPago", "month": 11}}\n\nMensaje: "¿Cuáles son mis gastos recurrentes?"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"tipo": "recurrente"}}\n\nMensaje: "¿Cuánto tengo ahorrado?"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"category": "ahorro"}}\n\nMensaje: "¿Qué gastos puedo reducir este mes?"\nRespuesta: {"intent": "query_top_expenses", "confidence": 0.97, "entities": {"period": "mes", "tipo": "reducible"}}\n\nMensaje: "¿Cuáles son los gastos más inusuales este año?"\nRespuesta: {"intent": "query_top_expenses", "confidence": 0.97, "entities": {"period": "año", "tipo": "inusual"}}\n\nMensaje: "¿Cuánto gasté en Uber en octubre?"\nRespuesta: {"intent": "query_summary", "confidence": 0.97, "entities": {"merchant": "Uber", "month": 10}}\n\nMensaje: "${message}"`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Eres un parser de intención que responde sólo JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0,
      max_tokens: 200
    });

    const content = completion.choices?.[0]?.message?.content || '';
    const jsonStart = content.indexOf('{');
    if (jsonStart >= 0) {
      const jsonText = content.slice(jsonStart);
      try {
        const parsed = JSON.parse(jsonText);
        // Merge entidades locales y OpenAI
        return {
          intent: parsed.intent || matchedIntent || 'unknown',
          confidence: parsed.confidence || (matchedIntent ? 0.95 : 0.5),
          entities: { ...entities, ...(parsed.entities || {}) }
        };
      } catch (e) {
        console.warn('[NLU] Error parseando JSON OpenAI:', e);
        return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities };
      }
    }

    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };
  } catch (err) {
    console.warn('[NLU] OpenAI fallback failed:', (err as any)?.message || err);
    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };
  }
}
