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
  period?: 'mes' | 'mes_actual' | 'año' | 'semana' | 'hoy' | 'trimestre' | 'all_time' | string;
  all_time?: boolean; // Indica "desde que abrió la cuenta"
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

/**
 * Logger helper para NLU
 */
function logNLU(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] [NLU] ${msg}`;
  if (level === 'error') {
    console.error(logMsg, data || '');
  } else if (level === 'warn') {
    console.warn(logMsg, data || '');
  } else {
    console.log(logMsg, data || '');
  }
}

// Reglas simples y deterministas para intents comunes
// Ordenadas por especificidad (más específicas primero)
const INTENT_RULES: Array<{ name: string; re: RegExp }> = [
  // Análisis de perfil
  { name: 'analyze_financial_profile', re: /\b(mi perfil|perfil financiero|analiza mi comportamiento|cómo gasto|cómo es mi gasto|mis hábitos de gasto|mi salud financiera|qué tipo de gastador|mi situación financiera|análisis de mis|estudia mi patrón)\b/i },
  
  // Comparación entre períodos
  { name: 'query_comparison', re: /(comparar|comparada?|comparado|en comparaci[óo]n\s+a|versus|vs\.|frente a).*(año|mes|periodo|trimestre|mes pasado|año pasado)/i },
  { name: 'query_comparison', re: /gastos?.*comparaci[óo]n.*(año|mes|periodo)/i },
  
  // Top gastos/ingresos
  { name: 'query_top_expenses', re: /\b(gastos? (altos|mayores|de m[aá]s|inusuales|importantes|más altos|más grandes|top|principales)|mayores gastos|gastos principales)\b/i },
  { name: 'query_top_expenses', re: /\b(mis mayores|top 5|ranking de).*gasto/i },
  
  // Resumen/balance
  { name: 'query_summary', re: /\b(cuánto gasté?|cuánto gasto|resumen|balance|total de gastos|mis gastos|cuál fue|en el (mes|año|trimestre))\b/i },
  { name: 'query_summary', re: /\b(desde que|en los últimos|últimos \d+ (días|meses)).*gast/i },
  
  // Gastos/ingresos
  { name: 'add_expense', re: /\b(gasté|gaste|gastó|pagué|pague|pagó|compré|compre|compró|saqué|saque|sacó|retiré|retire|retiró|extraje|me cobraron|me cobró|me descontaron|salió|salieron|gasto|pago|compro|saco|retiro|registrar gasto|agregar gasto|anotar gasto)\b/i },
  { name: 'add_income', re: /\b(gané|gane|ganó|cobré|cobre|cobró|recibí|recibe|recibió|me pagaron|me pagó|me ingresó|me ingresaron|me acreditaron|me acreditó|me depositaron|me depositó|ingreso|ingresos|percibí|percibe|percibió|sueldo|salario|cargué|cargue|cargó|cargar|deposité|deposite|depositó|depositar|transferí a mi|me transfirieron|me transferí)\b/i },
  
  // Presupuestos
  { name: 'create_budget', re: /\b(presupuesto|presupuesto de|gastar máximo|quiero gastar|asigno|asignar|límite de gasto)\b/i },
  { name: 'create_budget', re: /\b(en.*no gastar más de|un máximo de.*para)\b/i },
  
  // Metas/objetivos
  { name: 'create_goal', re: /\b(meta|ahorrar|ahorro|guardar|objetivo|juntar|poner aparte para)\b/i },
  { name: 'create_goal', re: /\b(quiero juntar|quiero ahorrar|mi meta es|objetivo de)\b/i },
  { name: 'add_contribution', re: /\b(ahorré|ahorre|ahorró|guardé|guarde|guardó|aparté|aparte|apartó|separé|separe|separó|puse aparte|puse|agregué|agregue|agregó|deposité|deposite|depositó|destiné|destine|destinó)\b.*\b(meta|ahorro|objetivo)\b/i },
  
  // Categorización
  { name: 'categorize', re: /\b(categoría|¿en qué categor|en qué entra|¿a qué categor)\b/i },
  { name: 'categorize', re: /\b(categorizar|clasificar)\b/i },
  
  // Educación financiera
  { name: 'general_knowledge', re: /\b(cómo|cómo hago|cómo puedo|qué es|cuál es|enseña|explica|tips?|consejos?|aprende?|estrategia)\b.*\b(ahorr|presupuest|deud|inversi[óo]n|ahorro|cripto|finanz|dinero|gasto)\b/i },
  
  // Análisis de perfil (alto peso)
  { name: 'analyze_financial_profile', re: /analizar.*perfil/i },
  
  // Consulta de dólar
  { name: 'query_dollar_rate', re: /\b(d[oó]lar|cotizaci[oó]n|precio del d[oó]lar|blue|mep|ccl|contado con liquidaci[oó]n|tipo de cambio|cu[aá]nto est[aá] el d[oó]lar|valor del d[oó]lar|d[oó]lar hoy|d[oó]lar actual)\b/i },
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
  
  // PRIMERO: Detectar "desde que abrí la cuenta" - debe ser ANTES de extraer años/meses
  // Esto evita que se asigne año/mes cuando el usuario pregunta sin periodo específico
  if (/desde que\s+(abr[ií]|abierta?|tens|tengo|cuenta|inicio)/i.test(message) || /desde que abr/i.test(message)) {
    entities.all_time = true;
    entities.period = 'all_time';
    logNLU('info', 'Detected all_time period: "desde que abrí la cuenta"');
  }

  // FECHAS RELATIVAS: ayer, anteayer, hace X días, el viernes, etc. (solo si no es all_time)
  if (!entities.all_time) {
    const relativeDate = parseRelativeDate(message);
    if (relativeDate) {
      entities.day = relativeDate.date.getDate();
      entities.month = relativeDate.date.getMonth() + 1;
      entities.year = relativeDate.date.getFullYear();
      entities._dateDescription = relativeDate.description;
      logNLU('info', `Fecha relativa detectada: ${relativeDate.description} -> ${entities.day}/${entities.month}/${entities.year}`);
    }
  }
  
  // Si pregunta por "este mes", extraer el mes actual (solo si no es all_time)
  if (!entities.all_time && /este mes/i.test(message)) {
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
  // Comercio (merchant) vs Categoría
  // IMPORTANTE: Distinguir entre "en transporte" (categoría) vs "en Carrefour" (merchant)
  // Categorías comunes que el usuario menciona
  const knownCategories = [
    'transporte', 'comida', 'restaurante', 'supermercado', 'farmacia', 'gasolina',
    'servicios', 'agua', 'luz', 'gas', 'internet', 'teléfono', 'cine', 'entretenimiento',
    'ropa', 'zapatos', 'ropa deportiva', 'deportes', 'fitness', 'salud', 'médico',
    'educación', 'cursos', 'libros', 'tecnología', 'electrónica', 'casa', 'muebles',
    'limpieza', 'higiene', 'belleza', 'peluquería', 'masajes', 'viajes', 'hotel', 'vuelos',
    'seguros', 'impuestos', 'suscripciones', 'streaming', 'música', 'juegos', 'mascotas'
  ];
  
  let merchant = '';
  let category = '';
  
  // Buscar en el mensaje patrones como "en [CATEGORIA]" o "en [MERCHANT]"
  const enPattern = message.match(/en\s+([A-Za-z0-9áéíóúüñ\-]+)(?:\s|,|\?|$)/i);
  if (enPattern) {
    const candidato = enPattern[1].toLowerCase();
    // Si es una categoría conocida, guardar como category
    if (knownCategories.some(c => candidato.includes(c) || c.includes(candidato))) {
      category = candidato;
    } else {
      // Si no, es un merchant
      merchant = candidato;
    }
  }
  
  // Buscar "transferí a [nombre]" - siempre merchant
  if (!merchant && !category) {
    const merchantMatchTransfer = message.match(/transfer[ií]\s+a\s+([A-Za-z0-9áéíóúüñ\-]+)/i);
    if (merchantMatchTransfer) merchant = merchantMatchTransfer[1].trim();
  }
  
  // Buscar "a [nombre]", "para [nombre]" - generalmente merchant
  if (!merchant && !category) {
    const merchantMatchGeneral = message.match(/(?:a|para)\s+([A-Za-z0-9áéíóúüñ\-]+)(?=\s|\?|\.|,|$)/i);
    if (merchantMatchGeneral) merchant = merchantMatchGeneral[1].trim();
  }
  
  // Buscar explícita mención de categoría: "categoría [PALABRA]"
  if (!category) {
    const categoryMatch = message.match(/categor[ií]a\s+([A-Za-z0-9\sáéíóúüñ\-]+)/i);
    if (categoryMatch) category = categoryMatch[1].trim();
  }
  
  if (merchant) entities.merchant = merchant;
  if (category) entities.category = category;
  
  // Año (solo si no es all_time y NO fue detectado por parseRelativeDate)
  if (!entities.all_time && !entities.year) {
    const yearMatch = message.match(/(20\d{2})/);
    if (yearMatch) entities.year = Number(yearMatch[1]);
  }
  
  // Mes (solo si no es all_time y NO fue detectado por parseRelativeDate)
  if (!entities.all_time && !entities.month) {
    const monthMatch = message.match(/enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i);
    if (monthMatch) {
      const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      entities.month = months.findIndex(m => m === monthMatch[0].toLowerCase()) + 1;
    }
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
      logNLU('info', `Intent matched by rule: ${r.name}`);
      break;
    }
  }
  // intent detection via rules

  // Para intents de "acción directa" que no necesitan OpenAI, retornar inmediatamente
  const DIRECT_ACTION_INTENTS = ['query_dollar_rate'];
  if (matchedIntent && DIRECT_ACTION_INTENTS.includes(matchedIntent)) {
    logNLU('info', `Direct action intent detected, skipping OpenAI: ${matchedIntent}`);
    return { intent: matchedIntent, confidence: 0.95, entities: normalizeEntities(entities) };
  }

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
- Para presupuestos: category, month, year, amount
- Para metas: amount, currency, description, category, deadline (fecha límite si se menciona), year, month
- Para cuentas: name (IMPORTANTE: extraer el nombre específico del banco o institución mencionada, NO "nueva cuenta" ni palabras genéricas. Ej: "banco nacion", "Galicia", "BBVA", "Efectivo"), type ("cash", "bank", "card", "investment"), currency, primary, reconciled, archived
- Para categorías: name, type ("income" o "expense"), icon, color, budgetLimit

IMPORTANTE - Montos y formato argentino:
- Extraer solo el número del monto, sin puntos ni comas
- "1.000" o "1,000" → amount: 1000
- "50.000" → amount: 50000
- "2.5" o "2,5" → amount: 2.5 (para decimales)
- "1k" → amount: 1000
- Si no se especifica moneda explícitamente, asumir ARS (pesos argentinos) por defecto
- Detectar moneda: "dólares", "USD", "verdes", "palos verdes" → USD
- Detectar moneda: "pesos", "ARS", "$", "pe" → ARS
- CONTEXTO ARGENTINO: "$" sin aclaración significa ARS, no USD

IMPORTANTE - Referencias temporales:
- Si el usuario pregunta "desde que abrí la cuenta", "desde que tengo cuenta", "desde el inicio": NO extraer year ni month. En su lugar, poner: all_time: true
- Año actual: ${currentYear}
- Mes actual: ${currentMonth}
- Día actual: ${now.getDate()}
- Año pasado: ${lastYear}
- Año que viene / próximo año: ${nextYear}
- Si el usuario dice "el año pasado", usar year: ${lastYear}
- Si el usuario dice "este año", usar year: ${currentYear}
- Si el usuario dice "el año que viene" o "próximo año", usar year: ${nextYear}
- Si el usuario dice "este mes", usar month: ${currentMonth}, year: ${currentYear}
- CRÍTICO - Para add_expense e add_income:
  * Si el usuario usa tiempo pasado simple ("gasté", "pagué", "compré", "saqué", "retiré", "gané", "cobré", "cargué", "recibí", "me pagaron", "me acreditaron") SIN mencionar fecha explícita (ej: "ayer", "el lunes", "hace 3 días"), asumir que es HOY
  * Si el usuario dice explícitamente "hoy", usar day: ${now.getDate()}, month: ${currentMonth}, year: ${currentYear}
  * Si NO se menciona fecha específica en absoluto, usar day: ${now.getDate()}, month: ${currentMonth}, year: ${currentYear}
  * SIEMPRE incluir day, month y year en entities para add_expense y add_income (no dejar ninguno vacío)
- IMPORTANTE: Si all_time es true, NO incluir year ni month en entities

IMPORTANTE - Método de pago:
- Si menciona "tarjeta", "con tarjeta", "pagué con débito": paymentMethod: "debito"
- Si menciona "crédito", "en cuotas", "con visa": paymentMethod: "credito"
- Si menciona "efectivo", "cash", "en mano": paymentMethod: "efectivo"
- Si no se especifica: paymentMethod: "efectivo" (default)

IMPORTANTE - Cuenta:
- Si menciona nombre específico de banco o fintech: usar ese nombre exacto (ej: "Ualá", "Mercado Pago", "Brubank", "Naranja X", "Galicia", "Santander", "BBVA", "Macro", "Nación")
- Si menciona "banco", "cuenta bancaria" genérico: account: "Banco"
- Si menciona "efectivo", "cash", "en mano": account: "Efectivo"
- Si menciona "tarjeta" sin especificar: account: "Tarjeta"
- Si menciona "billetera virtual", "wallet": extraer nombre específico (ej: "Mercado Pago", "Personal Pay")
- Si no se especifica: account: "Efectivo" (default)
- CONTEXTO ARGENTINO: "Ualá", "Mercado Pago", "Brubank", "Naranja X" son cuentas/tarjetas prepagas comunes

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
- Si el usuario pregunta por su perfil financiero, comportamiento de gastos, hábitos, salud financiera, análisis personal (ej: "¿cuál es mi perfil?", "¿cómo gasto?", "analiza mi comportamiento", "mi situación financiera"), responde con intent "analyze_financial_profile" y extrae timeframeMonths (número de meses a analizar, default: 6).
- Si el usuario menciona INGRESOS, ganancias, cobros, salarios, carga de dinero a cuenta, acreditaciones, depósitos entrantes (ej: "gané", "cobré", "me pagaron", "recibí", "me acreditaron", "me depositaron", "me ingresaron", "me transfirieron", "cargué", "cargue", "cargar", "deposité en mi cuenta", "transferí a mi cuenta"), responde con intent "add_income" y extrae amount, currency, source (fuente del ingreso), category, year, month, day, account, paymentMethod. IMPORTANTE: Distinguir transferencias HACIA la cuenta del usuario (ingreso) de transferencias DESDE la cuenta (gasto).

Mensaje: "¿Cuál es mi perfil financiero?"
Respuesta: {"intent": "analyze_financial_profile", "confidence": 0.99, "entities": {}}

Mensaje: "Analiza mi comportamiento de gastos"
Respuesta: {"intent": "analyze_financial_profile", "confidence": 0.98, "entities": {}}

Mensaje: "¿Cómo está mi salud financiera?"
Respuesta: {"intent": "analyze_financial_profile", "confidence": 0.98, "entities": {}}

Mensaje: "¿Qué tipo de gastador soy?"
Respuesta: {"intent": "analyze_financial_profile", "confidence": 0.97, "entities": {}}
- Si el usuario menciona "quiero gastar", "gastar solo", "gastar máximo", "presupuesto", "no gastar más de", "asigno" (para presupuesto), responde con intent "create_budget" y extrae category, month, year, amount.
- Si el usuario expresa un deseo de COMPRAR o AHORRAR PARA algo específico (ej: "quiero ahorrar", "meta de", "objetivo de"), responde con intent "create_goal" y extrae amount, currency, description, category, deadline (si se menciona), year, month.
- Si el usuario menciona que YA AHORRÓ o AGREGÓ dinero a una meta existente (ej: "ahorré", "guardé", "puse", "agregué"), responde con intent "add_contribution" y extrae amount, goalName (nombre de la meta), description.
- Si el usuario menciona crear una cuenta bancaria o billetera, responde con intent "create_account" y extrae name, type, currency, primary (falso por defecto), reconciled (falso por defecto), archived (falso por defecto).
- Si el usuario menciona crear una categoría nueva, responde con intent "create_category" y extrae name, type ("income" o "expense"), icon, color, budgetLimit.
- Si el usuario menciona invertir, comprar activos CON monto específico, responde con intent "invest" y extrae activo, amount, currency, periodo, tipo.
- Si el usuario menciona GASTOS, pagos, compras, retiros, extracciones, transferencias a terceros (ej: "gasté", "pagué", "compré", "saqué plata", "retiré", "extraje", "me cobraron", "salió", "salieron", "compro", "pago", "transferí a [persona/comercio]"), responde con intent "add_expense" y extrae amount, currency ('ARS' o 'USD'), merchant, category, description, year, month, day, account, paymentMethod (usar referencias temporales de arriba). CONTEXTO ARGENTINO: "saqué" generalmente significa retiro de cajero o gasto, NO ingreso.
- Si el usuario pregunta por resumen, balance, gastos con comparación entre períodos (ej: "en comparación al año pasado"), responde con intent "query_comparison" y extrae month, year, compare_year (año de comparación).
- Si el usuario pregunta por resumen, balance, gastos altos, recurrentes SIN comparación, responde con intent "query_summary" o "query_top_expenses" según corresponda.
- Si el usuario pregunta por categorización, responde con intent "categorize".

Ejemplos:

Mensaje: "En marzo quiero gastar solo 25000 en transporte"
Respuesta: {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "transporte", "month": 3, "year": ${currentYear}, "amount": 25000, "currency": "ARS"}}

Mensaje: "Gaste 100 dolares en amazon"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 100, "currency": "USD", "merchant": "amazon", "account": "Tarjeta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pague 50 dolares en efectivo"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 50, "currency": "USD", "account": "Efectivo", "paymentMethod": "efectivo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Hoy gasté 20000 en la peluquería"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 20000, "currency": "ARS", "merchant": "peluquería", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Gasté 5000 en el supermercado"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "supermercado", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Cargué 1000 en la Ualá"
Respuesta: {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 1000, "currency": "ARS", "account": "Ualá", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Me acreditaron 50000 de sueldo"
Respuesta: {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 50000, "currency": "ARS", "source": "sueldo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré tornillos por 500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 500, "currency": "ARS", "category": "Tornillos", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Saqué 5000 del cajero"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "Retiro", "paymentMethod": "efectivo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué 2000 con Mercado Pago"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 2000, "currency": "ARS", "account": "Mercado Pago", "paymentMethod": "debito", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Me transfirieron 15000 al Brubank"
Respuesta: {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 15000, "currency": "ARS", "account": "Brubank", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Cobré el sueldo 120000"
Respuesta: {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 120000, "currency": "ARS", "source": "sueldo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué la luz 8500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 8500, "currency": "ARS", "category": "luz", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Fui al supermercado y gasté 2.300"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 2300, "currency": "ARS", "category": "supermercado", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Deposité 5000 dólares en el banco"
Respuesta: {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 5000, "currency": "USD", "account": "Banco", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré en la verduleria 1200"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 1200, "currency": "ARS", "category": "verduleria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué Netflix 4500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 4500, "currency": "ARS", "category": "netflix", "merchant": "Netflix", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Transferí 10000 a mi hermana"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 10000, "currency": "ARS", "category": "transferencia", "description": "hermana", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el alquiler 180000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 180000, "currency": "ARS", "category": "alquiler", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Fui al cine y gasté 3500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3500, "currency": "ARS", "category": "cine", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué la tarjeta 45000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 45000, "currency": "ARS", "account": "Tarjeta", "category": "pago de tarjeta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré en la carnicería 7800"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 7800, "currency": "ARS", "category": "carniceria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el gimnasio 15000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 15000, "currency": "ARS", "category": "gimnasio", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Puse nafta 12000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 12000, "currency": "ARS", "category": "nafta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué la prepaga 28000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 28000, "currency": "ARS", "category": "prepaga", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré ropa 25000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 25000, "currency": "ARS", "category": "ropa", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué Spotify 1200"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 1200, "currency": "ARS", "category": "spotify", "merchant": "Spotify", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pedí Rappi 8500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 8500, "currency": "ARS", "category": "delivery", "merchant": "Rappi", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Tomé un Uber 3200"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3200, "currency": "ARS", "category": "uber", "merchant": "Uber", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Cargué la SUBE 5000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "sube", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el internet 9800"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 9800, "currency": "ARS", "category": "internet", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré en la farmacia 6400"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 6400, "currency": "ARS", "category": "farmacia", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué las expensas 32000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 32000, "currency": "ARS", "category": "expensa", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Fui al dentista 18000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 18000, "currency": "ARS", "category": "dentista", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré libros 14500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 14500, "currency": "ARS", "category": "libro", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el veterinario 9000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 9000, "currency": "ARS", "category": "veterinario", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el celular 7500"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 7500, "currency": "ARS", "category": "celular", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Compré en la ferretería 3400"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3400, "currency": "ARS", "category": "ferreteria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Pagué el impuesto 22000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 22000, "currency": "ARS", "category": "impuesto", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "Hice un curso 35000"
Respuesta: {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 35000, "currency": "ARS", "category": "curso", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "¿Cuánto gasté este mes?"
Respuesta: {"intent": "query_summary", "confidence": 0.99, "entities": {"month": ${currentMonth}, "year": ${currentYear}}}

Mensaje: "¿Cuáles fueron mis mayores gastos?"
Respuesta: {"intent": "query_top_expenses", "confidence": 0.99, "entities": {}}

Mensaje: "Quiero ahorrar 100000 para vacaciones"
Respuesta: {"intent": "create_goal", "confidence": 0.99, "entities": {"amount": 100000, "currency": "ARS", "description": "vacaciones"}}

Mensaje: "Nueva cuenta de efectivo en dolares"
Respuesta: {"intent": "create_account", "confidence": 0.99, "entities": {"name": "Efectivo USD", "type": "cash", "currency": "USD"}}

Mensaje: "${message}"`;

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
    
    // Validar que OpenAI retornó algo
    if (!content || content.trim().length === 0) {
      logNLU('warn', 'OpenAI returned empty content, using rule-based fallback');
      return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities: normalizeEntities(entities) };
    }
    
    // Extraer JSON de la respuesta (puede estar embebido en texto)
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');
    
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonText = content.slice(jsonStart, jsonEnd + 1);
      try {
        const parsed = JSON.parse(jsonText);
        logNLU('info', `OpenAI parsed intent: ${parsed.intent}, confidence: ${parsed.confidence}`);
        
        // Validar que al menos tenemos intent
        if (!parsed.intent) {
          logNLU('warn', 'OpenAI response missing intent field');
          return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities: normalizeEntities(entities) };
        }
        
        return {
          intent: parsed.intent || matchedIntent || 'unknown',
          confidence: Math.min(1.0, Math.max(0, parsed.confidence || (matchedIntent ? 0.95 : 0.5))),
          entities: normalizeEntities({ ...entities, ...(parsed.entities || {}) })
        };
      } catch (e) {
        logNLU('warn', `JSON parse error: ${(e as any)?.message}`, { jsonText: jsonText.substring(0, 100) });
        return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities: normalizeEntities(entities) };
      }
    } else {
      logNLU('warn', 'OpenAI response does not contain JSON, using rule fallback');
      return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities: normalizeEntities(entities) };
    }
  } catch (err) {
    const errMsg = (err as any)?.message || String(err);
    logNLU('error', `OpenAI API error: ${errMsg}`);
    
    // Fallback final: usar intent rule-based
    if (matchedIntent) {
      logNLU('info', `Using rule-based fallback intent: ${matchedIntent}`);
      return { intent: matchedIntent, confidence: 0.8, entities: normalizeEntities(entities) };
    }
    
    // Si ni siquiera hay rule match, retornar unknown
    return { intent: 'unknown', confidence: 0.2, entities: normalizeEntities(entities) };
  }
}
