import { getOpenAIClient } from './openai-service';
import { config } from '../config';
import { parseRelativeDate, getArgentinaDate } from '../utils/date-parser';

// Definir un tipo más estricto para las entidades
export type Entities = {
  category?: 'transferencia' | 'supermercado' | 'restaurante' | 'ahorro' | 'vacaciones' | 'recurrente' | 'otros' | string;
  amount?: number;
  merchant?: string;
  currency?: 'ARS' | 'USD' | 'EUR' | 'PESOS' | 'DOLARES' | 'EUROS' | string;
  month?: number; // 1-12
  year?: number;
  period?: 'mes' | 'mes_actual' | 'año' | 'semana' | 'hoy' | 'trimestre' | string;
  tipo?: 'mejores' | 'subiendo' | 'recomendación' | 'inusual' | 'reducible' | 'conveniencia' | 'recurrente' | string;
  activo?: 'cedear' | 'criptomoneda' | 'acción' | 'fondo común de inversión' | string;
  items?: any[];
  // extensible: puedes agregar más campos según lo que devuelva OpenAI
};

// Actualizar el tipo de NLUResult para usar Entities
type NLUResult = {
  intent: string;
  confidence: number;
  entities: Entities;
};

// Reglas simples y deterministas para intents comunes
const INTENT_RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'query_top_expenses', re: /gastos? (altos|mayores|de m[aá]s|inusuales|importantes|más altos|más grandes|más importantes)/i },
  { name: 'add_expense', re: /\b(gast[oó]|pagu[eé]|registrar gasto|agrega un gasto|añadir gasto)\b/i },
  { name: 'query_summary', re: /\b(cu[aá]nto|mostrame|mu[eé]strame|resumen|gastos|balance|¿en qu[eé])\b/i },
  { name: 'create_goal', re: /\b(meta|ahorrar|guardar|objetivo)\b/i },
  { name: 'categorize', re: /\b(categor[ií]a|¿en qu[eé] categor|en qu[eé] entra)\b/i },
];

export async function parseMessage(message: string): Promise<NLUResult> {
  // Normalización de entidades para downstream
  function normalizeEntities(e: Entities): Entities {
    const out: Entities = { ...e };
    // period: 'mes_actual' → period: 'mes', month/year actual
    if (out.period === 'mes_actual') {
      const now = new Date();
      out.period = 'mes';
      out.month = now.getMonth() + 1;
      out.year = now.getFullYear();
    }
    // currency normalización
    if (out.currency) {
      const c = out.currency.toUpperCase();
      if (['PESOS', 'ARS'].includes(c)) out.currency = 'ARS';
      else if (['DOLARES', 'USD'].includes(c)) out.currency = 'USD';
      else if (['EUROS', 'EUR'].includes(c)) out.currency = 'EUR';
    }
    // tipo normalización
    if (out.tipo) {
      if (out.tipo === 'recomendame') out.tipo = 'recomendación';
      if (out.tipo === 'mejor') out.tipo = 'mejores';
    }
    // category normalización
    if (out.category) {
      if (out.category === 'transferencias') out.category = 'transferencia';
      if (out.category === 'supermercados') out.category = 'supermercado';
      if (out.category === 'restaurantes') out.category = 'restaurante';
    }
    // activo normalización
    if (out.activo) {
      if (out.activo === 'acciones') out.activo = 'acción';
      if (out.activo === 'criptomonedas') out.activo = 'criptomoneda';
      if (out.activo === 'cedears') out.activo = 'cedear';
    }
    return out;
  }
  // Extracción de entidades mejorada
  let entities: Record<string, any> = {};
  
  // FECHAS RELATIVAS: ayer, anteayer, hace X días, el viernes, etc.
  const relativeDate = parseRelativeDate(message);
  if (relativeDate) {
    entities.day = relativeDate.date.getDate();
    entities.month = relativeDate.date.getMonth() + 1;
    entities.year = relativeDate.date.getFullYear();
    entities._dateDescription = relativeDate.description;
    console.log('[NLU] Fecha relativa detectada:', relativeDate.description, '→', relativeDate.date.toISOString().split('T')[0]);
  }
  
  // Si pregunta por "este mes", extraer el mes actual
  if (/este mes/i.test(message)) {
    const now = getArgentinaDate();
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

  // Detectar montos (puede haber múltiples montos en un solo mensaje)
  const amountMatches = Array.from(message.matchAll(/([+-]?\d+[\d,.]*)/g));
  // Filtrar años (números de 4 dígitos >= 2000) para no confundirlos con montos
  const realAmounts = amountMatches.filter(m => {
    const num = Number(m[1].replace(/,/g, ''));
    return !(num >= 2000 && num <= 2100 && m[1].length === 4);
  });
  // Si hay múltiples montos y NO menciona "presupuesto", pedir a OpenAI que devuelva un array estructurado de items
  if (realAmounts && realAmounts.length > 1 && !/presupuesto/i.test(message)) {
    const apiKey2 = config.OPENAI_API_KEY;
    if (!apiKey2) {
      // Fallback heurístico si no hay OpenAI key
      const parts = message.split(/,|\band\b|\by\b|\+|;/i).map(p => p.trim()).filter(Boolean);
      const items: any[] = [];
      for (const m of realAmounts) {
        const raw = m[1];
        const amt = Number(raw.replace(/,/g, ''));
        const part = parts.find(p => p.includes(raw) || p.match(new RegExp(`\\b${raw}\\b`)));
        let desc = '';
        let merchant = '';
        let currency: any = entities.currency || undefined;
        if (part) {
          desc = part.replace(raw, '').replace(/\b(ars|usd|euros|d[oó]lares|pesos)\b/ig, '').trim();
          const mMatch = part.match(/(?:en|a|para)\s+([A-Za-z0-9áéíóúüñ\-\s]+)/i);
          if (mMatch) merchant = mMatch[1].trim();
          const curMatch = part.match(/\b(ARS|USD|EUR|pesos?|d[oó]lares?|euros?)\b/i);
          if (curMatch) currency = curMatch[1].toUpperCase();
        }
        items.push({ description: desc || undefined, amount: amt, currency, merchant: merchant || undefined });
      }
      return { intent: 'add_expense_list', confidence: 0.6, entities: normalizeEntities({ ...entities, items }) };
    }

    // Construir prompt especializado para extraer múltiples items
    try {
      const openai = getOpenAIClient();
      const userPrompt = `Extrae TODAS las transacciones del siguiente texto. Responde SOLO JSON con la forma: {"intent":"add_expense_list","confidence":<num> , "entities": {"items": [ {"description": "...", "amount": 1234, "currency": "ARS|USD|EUR", "merchant": "..."}, ... ] } } .
Texto: "${message}"
Notas: - Normaliza la moneda a ARS/USD/EUR cuando sea posible. - Si falta descripción, usa el texto alrededor del monto como description. - No agregues texto fuera del JSON.`;

      const completion = await openai.chat.completions.create({
        model: config.OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Eres un parser de transacciones que responde SOLO JSON. Siempre en español.' },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0,
        max_tokens: 400
      });

      const content = completion.choices?.[0]?.message?.content || '';
      const jsonStart = content.indexOf('{');
      if (jsonStart >= 0) {
        const jsonText = content.slice(jsonStart);
        try {
          const parsed = JSON.parse(jsonText);
          // Normalizar items' currencies si es necesario
          const parsedEntities = parsed.entities || {};
          if (Array.isArray(parsedEntities.items)) {
            parsedEntities.items = parsedEntities.items.map((it: any) => {
              if (it.currency) {
                const c = String(it.currency).toUpperCase();
                if (['PESOS','ARS'].includes(c)) it.currency = 'ARS';
                else if (['DOLARES','USD'].includes(c)) it.currency = 'USD';
                else if (['EUROS','EUR'].includes(c)) it.currency = 'EUR';
              }
              return it;
            });
          }
          return {
            intent: parsed.intent || 'add_expense_list',
            confidence: parsed.confidence || 0.95,
            entities: normalizeEntities({ ...entities, ...(parsedEntities || {}) })
          };
        } catch (e) {
          console.warn('[NLU] Error parseando JSON OpenAI para multi-items:', e);
          // fallback heurístico
        }
      }
    } catch (err) {
      console.warn('[NLU] OpenAI multi-item failed:', (err as any)?.message || err);
      // continuar a fallback heurístico
    }
    // Fallback heurístico si OpenAI falla
    const parts2 = message.split(/,|\band\b|\by\b|\+|;/i).map(p => p.trim()).filter(Boolean);
    const items2: any[] = [];
    for (const m of realAmounts) {
      const raw = m[1];
      const amt = Number(raw.replace(/,/g, ''));
      const part = parts2.find(p => p.includes(raw) || p.match(new RegExp(`\\b${raw}\\b`)));
      let desc = '';
      let merchant = '';
      let currency: any = entities.currency || undefined;
      if (part) {
        desc = part.replace(raw, '').replace(/\b(ars|usd|euros|d[oó]lares|pesos)\b/ig, '').trim();
        const mMatch = part.match(/(?:en|a|para)\s+([A-Za-z0-9áéíóúüñ\-\s]+)/i);
        if (mMatch) merchant = mMatch[1].trim();
        const curMatch = part.match(/\b(ARS|USD|EUR|pesos?|d[oó]lares?|euros?)\b/i);
        if (curMatch) currency = curMatch[1].toUpperCase();
      }
      items2.push({ description: desc || undefined, amount: amt, currency, merchant: merchant || undefined });
    }
    return { intent: 'add_expense_list', confidence: 0.6, entities: normalizeEntities({ ...entities, items: items2 }) };
  }

  // Rule-based first, pero si no hay match exacto, priorizar fallback a OpenAI
  let matchedIntent = null;
  for (const r of INTENT_RULES) {
    if (r.re.test(message)) {
      matchedIntent = r.name;
      break;
    }
  }
  // intent detection via rules

  // Si no hay match, o la confianza es baja, usar OpenAI
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };
  }

  try {
    const openai = getOpenAIClient();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const lastYear = currentYear - 1;
    const nextYear = currentYear + 1;
    
    const prompt = `Eres un parser de intención financiera experto. Tu tarea es identificar el intent y extraer entidades relevantes del mensaje del usuario. Responde SOLO JSON con las keys: intent, confidence, entities. Siempre responde en español.

ENTIDADES A EXTRAER según el intent:
- Para gastos/ingresos: amount, currency, merchant, category, description, year, month, day, account (ej: "Efectivo", "Banco", "Tarjeta"), paymentMethod ("efectivo", "debito", "credito")
  IMPORTANTE para category: Si el usuario menciona un lugar específico (restaurante, supermercado, farmacia, etc.), usar ESE lugar como category, NO categorizar genéricamente. Ej: "gasté en restaurante" → category: "restaurante" (NO "alimentación")
- Para presupuestos: category, month, year, amount
- Para metas: amount, currency, description, category, deadline (fecha límite si se menciona), year, month
- Para cuentas: name (IMPORTANTE: extraer el nombre específico del banco o institución mencionada, NO "nueva cuenta" ni palabras genéricas. Ej: "banco nacion", "Galicia", "BBVA", "Efectivo"), type ("cash", "bank", "card", "investment"), currency, primary, reconciled, archived
- Para categorías: name, type ("income" o "expense"), icon, color, budgetLimit

IMPORTANTE - Referencias temporales:
- Año actual: ${currentYear}
- Mes actual: ${currentMonth}
- Día actual: ${now.getDate()}
- Año pasado: ${lastYear}
- Año que viene / próximo año: ${nextYear}
- Si el usuario dice "el año pasado", usar year: ${lastYear}
- Si el usuario dice "este año", usar year: ${currentYear}
- Si el usuario dice "el año que viene" o "próximo año", usar year: ${nextYear}
- Si el usuario dice "este mes", usar month: ${currentMonth}, year: ${currentYear}
- Si no se menciona mes, usar month: ${currentMonth}
- Si no se menciona año, usar year: ${currentYear}

IMPORTANTE - Método de pago:
- Si menciona "tarjeta", "con tarjeta", "pagué con débito": paymentMethod: "debito"
- Si menciona "crédito", "en cuotas", "con visa": paymentMethod: "credito"
- Si menciona "efectivo", "cash", "en mano": paymentMethod: "efectivo"
- Si no se especifica: paymentMethod: "efectivo" (default)

IMPORTANTE - Cuenta:
- Si menciona "banco", "cuenta bancaria", "transferencia": account: "Banco"
- Si menciona "efectivo", "cash": account: "Efectivo"
- Si menciona "tarjeta" sin especificar: account: "Tarjeta"
- Si no se especifica: account: "Efectivo" (default)

IMPORTANTE - Nombre de cuenta (para create_account):
- Extraer el nombre ESPECÍFICO del banco o institución mencionada
- Si dice "banco nacion", "banco de la nacion", "nacion": name: "banco nacion"
- Si dice "galicia", "banco galicia": name: "Galicia"
- Si dice "santander", "banco santander": name: "Santander"
- Si dice "efectivo": name: "Efectivo"
- Si dice "BBVA": name: "BBVA"
- NO usar palabras genéricas como "nueva cuenta", "cuenta", "banco" solas
- El name debe ser el nombre del banco/institución específica

IMPORTANTE - Deadlines para metas:
- Si dice "para diciembre": deadline con fecha de diciembre del año actual
- Si dice "en 6 meses": calcular deadline sumando 6 meses a la fecha actual
- Si dice "para el año que viene": deadline con fecha de fin del año próximo
- Si no se especifica deadline: no incluir el campo

Reglas:
- Si el usuario hace preguntas generales sobre cómo ahorrar, invertir, comprar activos, consejos financieros, educación financiera, SIN mencionar montos específicos, responde con intent "general_knowledge" y extrae topic (ej: ahorro, inversión, presupuesto, deudas, criptomonedas, etc).
- Si el usuario menciona INGRESOS, ganancias, cobros, salarios (ej: "gané", "cobré", "me pagaron", "recibí dinero"), responde con intent "add_income" y extrae amount, currency, source (fuente del ingreso), category, year, month, day, account, paymentMethod.
- Si el usuario menciona "quiero gastar", "gastar solo", "gastar máximo", "presupuesto", "no gastar más de", "asigno" (para presupuesto), responde con intent "create_budget" y extrae category, month, year, amount.
- Si el usuario expresa un deseo de COMPRAR o AHORRAR PARA algo específico (ej: "quiero ahorrar", "meta de", "objetivo de"), responde con intent "create_goal" y extrae amount, currency, description, category, deadline (si se menciona), year, month.
- Si el usuario menciona que YA AHORRÓ o AGREGÓ dinero a una meta existente (ej: "ahorré", "guardé", "puse", "agregué"), responde con intent "add_contribution" y extrae amount, goalName (nombre de la meta), description.
- Si el usuario menciona crear una cuenta bancaria o billetera, responde con intent "create_account" y extrae name, type, currency, primary (falso por defecto), reconciled (falso por defecto), archived (falso por defecto).
- Si el usuario menciona crear una categoría nueva, responde con intent "create_category" y extrae name, type ("income" o "expense"), icon, color, budgetLimit.
- Si el usuario menciona invertir, comprar activos CON monto específico, responde con intent "invest" y extrae activo, amount, currency, periodo, tipo.
- Si el usuario menciona gastos realizados, pagos, compras, transferencias, responde con intent "add_expense" y extrae amount, currency, merchant, category, description, year, month, day, account, paymentMethod (usar referencias temporales de arriba).
- Si el usuario pregunta por resumen, balance, gastos con comparación entre períodos (ej: "en comparación al año pasado"), responde con intent "query_comparison" y extrae month, year, compare_year (año de comparación).
- Si el usuario pregunta por resumen, balance, gastos altos, recurrentes SIN comparación, responde con intent "query_summary" o "query_top_expenses" según corresponda.
- Si el usuario pregunta por categorización, responde con intent "categorize".\n\nEjemplos:\n\nMensaje: "En marzo quiero gastar solo 25000 en transporte"\nRespuesta: {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "transporte", "month": 3, "year": ${currentYear}, "amount": 25000}}\n\nMensaje: "Presupuesto de 30000 para supermercado en noviembre"\nRespuesta: {"intent": "create_budget", "confidence": 0.98, "entities": {"category": "supermercado", "month": 11, "year": ${currentYear}, "amount": 30000}}\n\nMensaje: "Presupuesto mensual de 50000 para restaurantes"\nRespuesta: {"intent": "create_budget", "confidence": 0.98, "entities": {"category": "restaurante", "month": ${currentMonth}, "year": ${currentYear}, "amount": 50000}}\n\nMensaje: "Este año asigno 300k a educación"\nRespuesta: {"intent": "create_budget", "confidence": 0.98, "entities": {"category": "educación", "year": ${currentYear}, "amount": 300000}}\n\nMensaje: "Para enero 2026 quiero un presupuesto de 100k en comida"\nRespuesta: {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "comida", "month": 1, "year": 2026, "amount": 100000}}\n\nMensaje: "El año que viene en marzo me gustaría gastar solo 200000 en cenas afuera"\nRespuesta: {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "cenas", "month": 3, "year": ${nextYear}, "amount": 200000}}\n\nMensaje: "El año pasado gasté 2000 en comida"\nRespuesta: {"intent": "add_expense", "confidence": 0.95, "entities": {"amount": 2000, "currency": "ARS", "merchant": "comida", "category": "alimentación", "year": ${lastYear}}}\n\nMensaje: "¿Cómo hago para aprender a ahorrar?"\nRespuesta: {"intent": "general_knowledge", "confidence": 0.95, "entities": {"topic": "ahorro"}}\n\nMensaje: "¿Qué es un fondo común de inversión?"\nRespuesta: {"intent": "general_knowledge", "confidence": 0.95, "entities": {"topic": "inversión"}}\n\nMensaje: "¿Cómo puedo reducir mis deudas?"\nRespuesta: {"intent": "general_knowledge", "confidence": 0.95, "entities": {"topic": "deudas"}}\n\nMensaje: "¿Cómo hago para comprar dólar crypto?"\nRespuesta: {"intent": "general_knowledge", "confidence": 0.95, "entities": {"topic": "criptomonedas"}}\n\nMensaje: "Quiero invertir 50000 en Bitcoin"\nRespuesta: {"intent": "invest", "confidence": 0.98, "entities": {"activo": "Bitcoin", "amount": 50000, "currency": "ARS"}}\n\nMensaje: "¿Cuánto gasté en marzo en comparación al año pasado?"\nRespuesta: {"intent": "query_comparison", "confidence": 0.95, "entities": {"month": 3, "year": ${currentYear}, "compare_year": ${lastYear}}}\n\nMensaje: "¿Cuánto gasté en marzo?"\nRespuesta: {"intent": "query_summary", "confidence": 0.95, "entities": {"month": 3, "year": ${currentYear}}}\n\nMensaje: "Gané 2000 en el trabajo ayer"\nRespuesta: {"intent": "add_income", "confidence": 0.95, "entities": {"amount": 2000, "currency": "ARS", "source": "trabajo", "category": "salario", "year": ${currentYear}}}\n\nMensaje: "Me pagaron 50000 de sueldo"\nRespuesta: {"intent": "add_income", "confidence": 0.95, "entities": {"amount": 50000, "currency": "ARS", "source": "sueldo", "category": "salario", "year": ${currentYear}}}\n\nMensaje: "Cobré 15000 por un freelance"\nRespuesta: {"intent": "add_income", "confidence": 0.95, "entities": {"amount": 15000, "currency": "ARS", "source": "freelance", "category": "ingreso extra", "year": ${currentYear}}}\n\nMensaje: "Pagué 5000 con tarjeta de débito en el supermercado"\nRespuesta: {"intent": "add_expense", "confidence": 0.98, "entities": {"amount": 5000, "currency": "ARS", "merchant": "supermercado", "category": "alimentación", "year": ${currentYear}, "month": ${currentMonth}, "paymentMethod": "debito", "account": "Tarjeta"}}\n\nMensaje: "Gasté 3000 en efectivo en el kiosco"\nRespuesta: {"intent": "add_expense", "confidence": 0.95, "entities": {"amount": 3000, "currency": "ARS", "merchant": "kiosco", "category": "kiosco", "year": ${currentYear}, "month": ${currentMonth}, "paymentMethod": "efectivo", "account": "Efectivo"}}\n\nMensaje: "Gasté 10000 en restaurante"\nRespuesta: {"intent": "add_expense", "confidence": 0.98, "entities": {"amount": 10000, "currency": "ARS", "merchant": "restaurante", "category": "restaurante", "year": ${currentYear}, "month": ${currentMonth}, "paymentMethod": "efectivo", "account": "Efectivo"}}\n\nMensaje: "Quiero juntar 100000 para un viaje a Europa para diciembre"\nRespuesta: {"intent": "create_goal", "confidence": 0.99, "entities": {"amount": 100000, "currency": "ARS", "description": "viaje a Europa", "category": "viajes", "deadline": "${currentYear}-12-31"}}\n\nMensaje: "Meta de 50000 pesos para comprar una notebook"\nRespuesta: {"intent": "create_goal", "confidence": 0.98, "entities": {"amount": 50000, "currency": "ARS", "description": "comprar una notebook", "category": "tecnología"}}\n\nMensaje: "Ahorré 200 para irme de mi abuela"\nRespuesta: {"intent": "add_contribution", "confidence": 0.98, "entities": {"amount": 200, "goalName": "irme de mi abuela"}}\n\nMensaje: "Guardé 5000 para el viaje a Europa"\nRespuesta: {"intent": "add_contribution", "confidence": 0.98, "entities": {"amount": 5000, "goalName": "viaje a Europa"}}\n\nMensaje: "Puse 10000 en la meta de la notebook"\nRespuesta: {"intent": "add_contribution", "confidence": 0.98, "entities": {"amount": 10000, "goalName": "notebook"}}\n\nMensaje: "Crear categoría de gastos de mascotas con color verde"\nRespuesta: {"intent": "create_category", "confidence": 0.99, "entities": {"name": "mascotas", "type": "expense", "color": "#10B981"}}\n\nMensaje: "Cree una nueva cuenta en pesos en el banco nacion"\nRespuesta: {"intent": "create_account", "confidence": 0.99, "entities": {"name": "banco nacion", "type": "bank", "currency": "ARS"}}\n\nMensaje: "Crear cuenta en dólares en Galicia"\nRespuesta: {"intent": "create_account", "confidence": 0.99, "entities": {"name": "Galicia", "type": "bank", "currency": "USD"}}\n\nMensaje: "Nueva cuenta de efectivo en pesos"\nRespuesta: {"intent": "create_account", "confidence": 0.99, "entities": {"name": "Efectivo", "type": "cash", "currency": "ARS"}}\n\nMensaje: "Agregar cuenta del BBVA en dólares"\nRespuesta: {"intent": "create_account", "confidence": 0.99, "entities": {"name": "BBVA", "type": "bank", "currency": "USD"}}\n\nMensaje: "${message}"`;

    const completion = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
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
          return {
            intent: parsed.intent || matchedIntent || 'unknown',
            confidence: parsed.confidence || (matchedIntent ? 0.95 : 0.5),
            entities: normalizeEntities({ ...entities, ...(parsed.entities || {}) })
          };
        } catch (e) {
          console.warn('[NLU] Error parseando JSON OpenAI:', e);
          return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities };
        }
    }

    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities: normalizeEntities(entities) };
  } catch (err) {
    console.warn('[NLU] OpenAI fallback failed:', (err as any)?.message || err);
    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };
  }
}
