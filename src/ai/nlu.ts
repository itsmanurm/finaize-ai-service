import { getOpenAIClient } from './openai-service';
import { config } from '../config';
import { parseRelativeDate, getArgentinaDate } from '../utils/date-parser';

// Definir un tipo más estricto para las entidades
export type Entities = {
  category?: 'transferencia' | 'supermercado' | 'restaurante' | 'ahorro' | 'vacaciones' | 'recurrente' | 'otros' | string;
  categories?: string[]; // For multi-category budgets
  amount?: number;
  merchant?: string;
  currency?: 'ARS' | 'USD' | 'EUR' | 'PESOS' | 'DOLARES' | 'EUROS' | string;
  month?: number; // 1-12
  year?: number;
  day?: number; // 1-31
  compare_month?: number; // 1-12 for comparison
  compare_year?: number; // for comparison
  period?: 'mes' | 'mes_actual' | 'año' | 'semana' | 'hoy' | 'trimestre' | 'all_time' | string;
  all_time?: boolean; // Indica "desde que abrió la cuenta"
  tipo?: 'mejores' | 'subiendo' | 'recomendación' | 'inusual' | 'reducible' | 'conveniencia' | 'recurrente' | string;
  activo?: 'cedear' | 'criptomoneda' | 'acción' | 'fondo común de inversión' | string;
  account?: string;
  paymentMethod?: 'credito' | 'debito' | 'efectivo' | 'transferencia' | string;
  creditDetails?: {
    installments: number;
    interestRate?: number;
    firstInstallmentDate?: string;
    cardName?: string;
  };
  source?: string;
  goalName?: string;
  items?: any[];
  description?: string;
  // Purchase Advice
  item?: string;
  installments?: number;
  interest_free?: boolean;
  interest_rate?: number;
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
  // Info de mercado (CEDEARs, Cripto, Acciones) - Prioridad alta
  // { name: 'query_market_info', re: /\b(cedear|criptomonedas?|btc|bitcoin|eth|ethereum|acciones|invertir en|mejores inveri|qué activo|qué recomiend|bolsa de valore)\b/i },

  // Cotización dólar
  // { name: 'query_dollar_rate', re: /\b(d[oó]lar|cotizaci[oó]n|precio del d[oó]lar|blue|mep|ccl|contado con liquidaci[oó]n|tipo de cambio|cu[aá]nto est[aá] el d[oó]lar|valor del d[oó]lar|d[oó]lar hoy|d[oó]lar actual)\b/i },

  // Asesoría de compra (Purchase Advice)
  { name: 'purchase_advice', re: /(puedo|conviene|vale la pena|idea|querr[ií]a|gustar[ií]a).*(comprar|comprarme)/i },
  { name: 'purchase_advice', re: /(comprar|comprarme).*(conviene|alcanza|puedo|pena|pensas)/i },

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

  // Corrección de transacciones
  { name: 'correct_transaction', re: /\b(correg[ií]|cambi[aá]|modific[aá]|edit[aá]|actualiz[aá]|arregl[aá])\b.*\b(monto|cantidad|cuenta|categor[ií]a|precio|valor|importe)\b/i },
  { name: 'correct_transaction', re: /\b(no (era|fueron|fue)|en realidad (era|fueron|fue)|mejor dicho|quise decir|me equivoqu[eé]|le err[eé])\b/i },
  { name: 'correct_transaction', re: /\b(era|fue|fueron|son)\s+(\d+(?:[.,]\d+)?)/i }, // "era 1200" (sin asterisco necesario si tiene palabra clave)
  { name: 'correct_transaction', re: /^\s*\*+\d+(?:[.,]\d+)?\s*$/ }, // "*1200" obligatorio asterisco inicio (si es solo numero)
  { name: 'correct_transaction', re: /^\s*\d+(?:[.,]\d+)?\*+\s*$/ }, // "1200*" obligatorio asterisco fin (si es solo numero)
  { name: 'correct_transaction', re: /\*\s*(\d+(?:[.,]\d+)?)/ }, // *1200 en texto
  { name: 'correct_transaction', re: /\b([A-Za-zñÑáéíóúÁÉÍÓÚ]+\*)/ }, // Palabra con asterisco: "Comida*"

  // Gastos/ingresos
  { name: 'add_expense', re: /\b(gasté|gaste|gastó|pagué|pague|pagó|compré|compre|compró|saqué|saque|sacó|retiré|retire|retiró|extraje|extrajo|me cobraron|me cobró|me descontaron|salió|salio|salieron|gasto|pago|compro|saco|retiro|registrar gasto|agregar gasto|anotar gasto|transferí(?! a mi)|transferi(?! a mi)|comí|comi|bebí|bebi|tomé|tome|mande|mandé|envie|envié|perdí|perdi|presté|preste|devolví|devolvi|debitaron)\b/i },
  { name: 'add_income', re: /\b(gané|gane|ganó|cobré|cobre|cobró|recibí|recibe|recibió|recibi|me pagaron|me pagó|me ingresó|me ingreso|me ingresaron|me acreditaron|me acreditó|me acredite|me depositaron|me depositó|ingreso|ingresos|percibí|percibe|percibió|percibi|sueldo|salario|cargué|cargue|cargó|cargar|deposité|deposite|depositó|depositar|transferí a mi|me transfirieron|me transferí|transferi a mi|me transferi|entro|entró|llegó|llego plata|mandaron)\b/i },

  // Presupuestos
  { name: 'check_budget', re: /\b(puedo gastar|me alcanza|tengo presupuesto|presupuesto disponible|cuánto me queda|cómo voy con|estado de|situación de).*(presupuesto|gasto|categoría|para)\b/i },
  { name: 'check_budget', re: /\b(puedo comprar|me da el cuero|llego a fin de mes)\b/i },

  // Creación/Asignación
  { name: 'create_budget', re: /\b(presupuesto|presupuesto de|gastar máximo|quiero gastar|asigno|asignar|límite de gasto|aumentar presupuesto|subir presupuesto|agregar.*presupuesto)\b/i },
  { name: 'create_budget', re: /\b(en.*no gastar más de|un máximo de.*para)\b/i },

  // Metas/objetivos
  { name: 'create_goal', re: /\b(meta|ahorrar|ahorro|guardar|objetivo|juntar|poner aparte para)\b/i },
  { name: 'create_goal', re: /\b(quiero juntar|quiero ahorrar|mi meta es|objetivo de)\b/i },
  { name: 'add_contribution', re: /\b(ahorré|ahorre|ahorró|guardé|guarde|guardó|aparté|aparte|apartó|separé|separe|separó|puse aparte|puse|agregué|agregue|agregó|deposité|deposite|depositó|destiné|destine|destinó)\b.*\b(meta|ahorro|objetivo)\b/i },

  // Consultar Metas
  { name: 'check_goals', re: /\b(cómo (voy|van|vienen) mis metas|cómo voy con el ahorro|cuánto (llevo|tengo) ahorrado|estado de mis objetivos|mis metas)\b/i },

  // Categorización
  { name: 'categorize', re: /\b(categoría|¿en qué categor|en qué entra|¿a qué categor)\b/i },
  { name: 'categorize', re: /\b(categorizar|clasificar)\b/i },

  // Suscripciones y duplicados
  { name: 'check_subscriptions', re: /\b(suscripciones?|duplicadas?|pagos recurrentes?|doble cobro|netflix|spotify|disney|hbo|prime)\b/i },
  { name: 'check_subscriptions', re: /\b(estoy pagando dos veces|tengo repetid|servicio duplicado)\b/i },

  // Ayuda y Capacidades
  { name: 'help', re: /\b(ayuda|qué podés hacer|qué sabes hacer|sos|eres|hola|buen día)\b/i },
  { name: 'help', re: /\b(para qué servís|funciones|explicame qué hacés)\b/i },

  // Educación financiera
  { name: 'general_knowledge', re: /\b(cómo|cómo hago|cómo puedo|qué es|enseña|explica|tips?|consejos?|aprende?|estrategia)\b.*\b(ahorr|presupuest|deud|finanz|dinero|gasto)\b/i },
];

export async function parseMessage(message: string): Promise<NLUResult> {
  // Normalización de entidades para downstream
  function normalizeEntities(e: Entities, intent: string): Entities {
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

      // Si es un ingreso, evitar categorías de gasto comunes mal detectadas
      const commonWallets = ['mercado pago', 'mercado', 'uala', 'brubank', 'personal pay', 'naranja', 'lemon'];
      if (intent === 'add_income' && commonWallets.includes(out.category.toLowerCase())) {
        out.category = 'Ingreso';
      }
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

  // CRÍTICO: Detectar comparaciones con "mes anterior" o "el anterior"
  // Esto debe procesarse ANTES de OpenAI para garantizar la correcta interpretación
  if (/(compar|vs\.?|versus|frente a).*(mes\s+)?anterior|anterior.*mes/i.test(message)) {
    const now = getArgentinaDate();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    // Establecer período actual (este mes)
    entities.month = currentMonth;
    entities.year = currentYear;

    // Calcular mes anterior cronológicamente
    if (currentMonth === 1) {
      // Si estamos en enero, el mes anterior es diciembre del año pasado
      entities.compare_month = 12;
      entities.compare_year = currentYear - 1;
    } else {
      // Para cualquier otro mes, es simplemente mes - 1 del mismo año
      entities.compare_month = currentMonth - 1;
      entities.compare_year = currentYear;
    }

    logNLU('info', `Comparación detectada: ${entities.month}/${entities.year} vs ${entities.compare_month}/${entities.compare_year}`);
  }

  // Si el mensaje contiene 'transferí', asignar categoría transferencia
  if (/transfer[ií]/i.test(message)) {
    entities.category = 'transferencia';
  }
  // Monto - Manejo de formato argentino (puntos como miles, comas opcionales)
  const amountMatch = message.match(/\b(\d+(?:\.\d{3})*(?:,\d+)?)\b/);
  if (amountMatch) {
    const raw = amountMatch[1];
    // Reemplazar puntos (miles) por nada, y comas (decimales) por puntos
    const normalized = raw.replace(/\./g, '').replace(/,/g, '.');
    entities.amount = parseFloat(normalized);
  }

  // installments (cuotas) - detección básica rule-based
  const installmentsMatch = message.match(/(\d+)\s+cuotas/i) || message.match(/en\s+(\d+)\s+(?:cuotas|pagos|meses)/i);
  if (installmentsMatch) {
    entities.installments = parseInt(installmentsMatch[1], 10);
  }

  // Moneda y Método de Pago
  const currencyMatch = message.match(/\b(ARS|USD|EUR|pesos?|d[oó]lares?|euros?|pesitos)\b/i);
  if (currencyMatch) entities.currency = currencyMatch[1].toUpperCase();

  const payMethodMatch = message.match(/\b(credito|crédito|debito|débito|efectivo|transferencia|tarjeta)\b/i);
  if (payMethodMatch) {
    const pm = payMethodMatch[1].toLowerCase();
    if (pm.includes('credito') || pm.includes('crédito')) entities.paymentMethod = 'credito';
    else if (pm.includes('debito') || pm.includes('débito')) entities.paymentMethod = 'debito';
    else if (pm === 'tarjeta') entities.paymentMethod = 'credito'; // default assumption or leave ambiguous? Let's assume generic means looking for card usage.
    else entities.paymentMethod = pm;
  }

  // Item para purchase_advice (heurística simple: lo que sigue a "comprar" o "comprarme")
  const itemMatch = message.match(/(?:comprar|comprarme)\s+(?:una?|el|la)?\s*([A-Za-záéíóúüñ\s]+?)(?:\s+de|\s+en|\s+por|\s+con|\s+\?|\s*\.|$)/i);
  if (itemMatch) {
    entities.item = itemMatch[1].trim();
  }
  // Comercio (merchant) vs Categoría
  // IMPORTANTE: Distinguir entre "en transporte" (categoría) vs "en Carrefour" (merchant)
  // Categorías comunes que el usuario menciona
  const knownCategories = [
    'transporte', 'comida', 'restaurante', 'supermercado', 'farmacia', 'gasolina',
    'servicios', 'agua', 'luz', 'gas', 'internet', 'teléfono', 'cine', 'entretenimiento',
    'ropa', 'zapatos', 'ropa deportiva', 'deportes', 'fitness', 'salud', 'médico',
    'educación', 'cursos', 'libros', 'tecnología', 'electrónica', 'casa', 'muebles',
    'limpieza', 'higiene', 'belleza', 'peluquería', 'masajes', 'viajes', 'hotel', 'vuelos',
    'seguros', 'impuestos', 'suscripciones', 'streaming', 'música', 'juegos', 'mascotas',
    'sueldo', 'ingreso', 'venta', 'honorarios', 'regalo', 'transferencia'
  ];

  const commonWallets = ['mercado pago', 'mercado', 'uala', 'brubank', 'lemon', 'naranja', 'personal pay', 'modo'];

  let merchant = '';
  let category = '';

  // Buscar en el mensaje patrones como "en [CATEGORIA]" o "en [MERCHANT]"
  // Mejorar regex para capturar hasta 2-3 palabras
  const enPattern = message.match(/en\s+([A-Za-z0-9áéíóúüñ\-]+(?:\s+[A-Za-z0-9áéíóúüñ\-]+)?)(?:\s|,|\?|$)/i);
  if (enPattern) {
    const candidato = enPattern[1].toLowerCase().trim();

    // Si el candidato es una billetera conocida, es MERCHANT o ACCOUNT, no categoría
    const isWallet = commonWallets.some(w => candidato.includes(w) || w.includes(candidato));

    // Si es una categoría conocida y NO es una billetera
    if (!isWallet && knownCategories.some(c => candidato === c || (candidato.length > 3 && c.startsWith(candidato)))) {
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

  // Extracción de entidades para información de mercado (CEDEARs, Cripto, Acciones)
  const marketActiveMatch = message.match(/\b(cedears?|criptomonedas?|btc|bitcoin|eth|ethereum|acciones?)\b/i);
  if (marketActiveMatch) {
    const a = marketActiveMatch[1].toLowerCase();
    entities.activo = a; // normalizeEntities se encarga de la normalización final
  }

  const marketTypeMatch = message.match(/\b(mejores|subiendo|recomendaci[óo]n|recomendame|suben|mejor|recomienda)\b/i);
  if (marketTypeMatch) {
    const t = marketTypeMatch[1].toLowerCase();
    entities.tipo = t;
  }

  const marketPeriodMatch = message.match(/\b(hoy|semana|mes|año)\b/i);
  if (marketPeriodMatch) {
    entities.period = marketPeriodMatch[1].toLowerCase();
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
      const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      entities.month = months.findIndex(m => m === monthMatch[0].toLowerCase()) + 1;
    }
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

  // Si el intent es "accion directa" o coincide con una regla específica de alta importancia (como purchase_advice)
  // DEBEMOS RETORNAR ANTES de que el heurístico de "múltiples montos" lo confunda con una lista de gastos.
  const HIGH_PRIORITY_INTENTS = ['purchase_advice', 'query_dollar_rate', 'query_market_info', 'analyze_financial_profile', 'query_top_expenses'];
  if (matchedIntent && HIGH_PRIORITY_INTENTS.includes(matchedIntent)) {
    logNLU('info', `High priority intent detected, skipping multi-item heuristic: ${matchedIntent}`);
    return { intent: matchedIntent, confidence: 0.95, entities: normalizeEntities(entities, matchedIntent) };
  }

  // Detectar montos (puede haber múltiples montos en un solo mensaje)
  // Usar una versión limpia del mensaje para evitar detectar la fecha "el 1" como monto 1
  let msgForAmounts = message;
  if (entities._dateDescription) {
    // Reemplazar la descripción de la fecha (ej "el 1") por espacios para no alterar índices o concatenar palabras
    msgForAmounts = msgForAmounts.replace(new RegExp(entities._dateDescription, 'i'), ' '.repeat(entities._dateDescription.length));
  }

  const amountMatches = Array.from(msgForAmounts.matchAll(/([+-]?\d+[\d,.]*)/g));
  // Filtrar años (números de 4 dígitos >= 2000) para no confundirlos con montos
  const realAmounts = amountMatches.filter(m => {
    const num = Number(m[1].replace(/,/g, ''));
    // Filtrar si es un año probable (2000-2100) Y tiene longitud 4
    if (num >= 2000 && num <= 2100 && m[1].length === 4) return false;
    // Filtrar si es muy pequeño (ej 1) y parece ser parte de una fecha que no se limpió bien? 
    // No, mejor confiar en la limpieza de _dateDescription.
    return true;
  });
  // Si hay múltiples montos y NO menciona "presupuesto", pedir a OpenAI que devuelva un array estructurado de items
  if (realAmounts && realAmounts.length > 1 && !/presupuesto|cuota|pago/i.test(message)) {
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
      return { intent: 'add_expense_list', confidence: 0.6, entities: normalizeEntities({ ...entities, items }, 'add_expense_list') };
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
        max_completion_tokens: 400
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
                if (['PESOS', 'ARS'].includes(c)) it.currency = 'ARS';
                else if (['DOLARES', 'USD'].includes(c)) it.currency = 'USD';
                else if (['EUROS', 'EUR'].includes(c)) it.currency = 'EUR';
              }
              return it;
            });
          }
          return {
            intent: parsed.intent || 'add_expense_list',
            confidence: parsed.confidence || 0.95,
            entities: normalizeEntities({ ...entities, ...(parsedEntities || {}) }, parsed.intent || 'add_expense_list')
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
    return { intent: 'add_expense_list', confidence: 0.6, entities: normalizeEntities({ ...entities, items: items2 }, 'add_expense_list') };
  }

  // Para intents de "acción directa" que no necesitan OpenAI, retornar inmediatamente
  const DIRECT_ACTION_INTENTS = ['query_dollar_rate', 'query_market_info', 'analyze_financial_profile', 'query_top_expenses'];
  if (matchedIntent && DIRECT_ACTION_INTENTS.includes(matchedIntent)) {
    logNLU('info', `Direct action intent detected, skipping OpenAI: ${matchedIntent}`);
    return { intent: matchedIntent, confidence: 0.95, entities: normalizeEntities(entities, matchedIntent) };
  }

  // Si no hay match, o la confianza es baja, usar OpenAI
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities };
  }

  try {
    const openai = getOpenAIClient();
    const now = getArgentinaDate();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const lastYear = currentYear - 1;
    const nextYear = currentYear + 1;

    const prompt = `Eres un parser de intención financiera experto. Tu tarea es identificar el intent y extraer entidades del mensaje. Responde SOLO JSON con las keys: intent, confidence, entities. Siempre responde en español.

ENTIDADES A EXTRAER SEGÚN EL INTENT:
- Para gastos/ingresos: amount, currency, merchant, category, description (UNA DESCRIPCION CORTA Y COHERENTE BASADA EN EL MENSAJE, ej: "Sueldo", "Venta de auto", "Pago luz"), year, month, day, account (ej: "Efectivo", "Banco", "Tarjeta"), paymentMethod ("efectivo", "debito", "credito", "transferencia"), creditDetails (solo para gastos: installments, interestRate)
- Para presupuestos - CREAR (create_budget): category, month, year, amount, currency, operation ("set" para fijar/crear, "add" para agregar/aumentar). (Ej: "QUIERO gastar 300" -> set, "AGREGAR 300 al presupuesto" -> add)
- Para presupuestos - CONSULTAR (check_budget): category, month, year, amount (si pregunta si puede gastar X). (Ej: "PUEDO gastar?", "Me alcanza?", "Cómo voy?")
- Para metas: amount, currency, description, goalName, categories (array de strings), deadline (fecha límite si se menciona), year, month
- Para cuentas: name (IMPORTANTE: extraer el nombre específico del banco o institución mencionada, NO "nueva cuenta" ni palabras genéricas. Ej: "banco nacion", "Galicia", "BBVA", "Efectivo"), type ("cash", "bank", "card", "investment"), currency, primary, reconciled, archived
- Para categorías: name, type ("income" o "expense"), icon, color
- Para asesoría de compra (purchase_advice): item (nombre del producto), amount (precio total), installments (número de cuotas), interest_free (boolean, true si explícitamente dice sin interés o s/i), interest_rate (número, porcentaje de interés anual o mensual especificado)

IMPORTANTE - MONTOS Y FORMATO ARGENTINO:
- Extraer solo el número del monto, sin puntos ni comas
- "1.000" o "1,000" → amount: 1000
- "50.000" → amount: 50000
- "2.5" o "2,5" → amount: 2.5 (para decimales)
- "1k" → amount: 1000
- Si no se especifica moneda explícitamente, asumir ARS (pesos argentinos) por defecto
- Detectar moneda: "dólares", "USD", "verdes", "palos verdes" → USD
- Detectar moneda: "pesos", "ARS", "$", "pe" → ARS
- CONTEXTO ARGENTINO: "$" sin aclaración significa ARS, no USD

    - CRÍTICO - DESCRIPCIONES INTELIGENTES (description):
      * NO DEJAR VACÍO el campo description, source o merchant.
      * Si el usuario dice "cobre 5000", description: "Cobro general" o "Ingreso vario".
      * Si dice "cobre el sueldo", description: "Sueldo".
      * Si dice "gane en el casino", description: "Casino" o "Apuestas".
      * Si dice "pague la luz", description: "Luz".
      * Generar una etiqueta corta y natural que describa la transacción.
    
    IMPORTANTE - REFERENCIAS TEMPORALES (HOY es ${now.getDate()}/${currentMonth}/${currentYear}):

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
- CRÍTICO - Para comparaciones con "mes anterior" o "el anterior":
  * Si el usuario dice "comparar con el mes anterior" o "vs el anterior": calcular el mes INMEDIATAMENTE ANTERIOR cronológicamente
  * Si estamos en enero (mes ${currentMonth}): mes anterior = diciembre del año pasado (compare_month: 12, compare_year: ${lastYear})
  * Si estamos en cualquier otro mes: mes anterior = mes actual - 1 del mismo año (compare_month: ${currentMonth - 1}, compare_year: ${currentYear})
  * "Mes anterior" NO significa el mismo mes del año pasado, significa el mes cronológicamente previo
  * Ejemplo: Si hoy es enero 2026 y dice "comparar con el anterior", debe ser diciembre 2025, NO enero 2025
- CRÍTICO - Para add_expense e add_income (MANEJO DE TIEMPOS Y TILDES):
  * EN LA COTIDIANIDAD EL USUARIO NO SIEMPRE USA TILDES. La conjugación del verbo define el tiempo.
  * REGLA GENERAL: Interpretar CUALQUIER verbo relacionado con movimiento de dinero conjugado en pasado (terminado en 'e', 'i', 'o' usualmente) COMO UNA ACCIÓN PASADA, aunque no tenga tilde.
  * INGRESOS (add_income): "cobre" (=cobré), "gane" (=gané), "recibi" (=recibí), "entro" (=entró), "ingreso" (=ingresó), "acredite" (=acredité), "llegó", "llego".
  * EGRESOS (add_expense): "pague" (=pagué), "gaste" (=gasté), "compre" (=compré), "comi", "bebi", "sali", "mande" (=mandé), "envie", "transferi", "saque" (=saqué), "retire", "perdi".
  * Si el usuario usa estos verbos (o cualquier similar de acción financiera) SIN mencionar fecha explícita, asumir que es HOY.
  * "el 1", "el 15", "el 30": es una FECHA explícita. "El [número]" se refiere al día [número] del mes actual (o mes anterior si el día es futuro respecto a hoy).
  * Si el usuario dice explícitamente "hoy", usar day: ${now.getDate()}, month: ${currentMonth}, year: ${currentYear}
  * Si NO se menciona fecha específica en absoluto, usar day: ${now.getDate()}, month: ${currentMonth}, year: ${currentYear}
  * SIEMPRE incluir day, month y year en entities para add_expense y add_income (no dejar ninguno vacío)
- IMPORTANTE: Si all_time es true, NO incluir year ni month en entities

IMPORTANTE - MÉTODO DE PAGO Y CUOTAS:
- Si menciona "tarjeta", "con tarjeta", "pagué con débito": paymentMethod: "debito"
- Si menciona "crédito", "en cuotas", "con visa", "con mastercard": paymentMethod: "credito"
- Si menciona "efectivo", "cash", "en mano": paymentMethod: "efectivo"
- Si menciona "transferencia", "transferí", "me transfirieron": paymentMethod: "transferencia"
- Si menciona "cuotas" o "pagos" (ej: "en 3 cuotas", "12 pagos"):
  * Establecer paymentMethod: "credito"
  * Dentro de creditDetails, extraer installments (el número de cuotas)
  * Si menciona interés (ej: "10% de interés"), extraer interestRate: 10
- Si no se especifica: NO incluir el campo paymentMethod en entities

IMPORTANTE - CUENTA:
- Si menciona nombre específico de banco o fintech: usar ese nombre exacto (ej: "Ualá", "Mercado Pago", "Brubank", "Naranja X", "Galicia", "Santander", "BBVA", "Macro", "Nación")
- Si menciona "banco", "cuenta bancaria" genérico: account: "Banco"
- Si menciona "efectivo", "cash", "en mano": account: "Efectivo"
- Si menciona "tarjeta" sin especificar: account: "Tarjeta"
- Si menciona "billetera virtual", "wallet": extraer nombre específico (ej: "Mercado Pago", "Personal Pay")
- Si no se especifica: NO incluir el campo account en entities
- CONTEXTO ARGENTINO: "Ualá", "Mercado Pago", "Brubank", "Naranja X" son cuentas/tarjetas prepagas comunes

IMPORTANTE - NOMBRE DE CUENTA (PARA create_account):
- Extraer el nombre ESPECÍFICO del banco o institución mencionada
- Si dice "banco nacion", "banco de la nacion", "nacion": name: "banco nacion"
- Si dice "galicia", "banco galicia": name: "Galicia"
- Si dice "santander", "banco santander": name: "Santander"
- Si dice "efectivo": name: "Efectivo"
- Si dice "BBVA": name: "BBVA"
- NO usar palabras genéricas como "nueva cuenta", "cuenta", "banco" solas
- El name debe ser el nombre del banco/institución específica

IMPORTANTE - DEADLINES PARA METAS:
- Si dice "para diciembre": deadline con fecha de diciembre del año actual
- Si dice "en 6 meses": calcular deadline sumando 6 meses a la fecha actual
- Si dice "para el año que viene": deadline con fecha de fin del año próximo
- Si no se especifica deadline: no incluir el campo

REGLAS ADICIONALES:
- Si el usuario pregunta por activos específicos de mercado (CEDEARs, Criptomonedas, Acciones, BTC, Bitcoin, Ethereum, etc) o recomendaciones de inversión en ellos (ej: "¿qué cedear comprar?", "¿mejores acciones?", "¿cuáles son los mejores cedear?", "¿qué cripto sube?"), responde con intent "query_market_info" y extrae activo (ej: "cedear", "criptomoneda", "acción"), period (ej: "hoy", "semana", "mes"), tipo (ej: "mejores", "subiendo", "recomendación").
- Si el usuario menciona gastos, compras, pagos o TRANSFERENCIAS HACIA TERCEROS (ej: "gasté", "pagué", "transferí 5000 a Juan"), responde con intent "add_expense" y extrae amount, currency, merchant, category, etc.
- Si el usuario hace preguntas de educación financiera general (ej: "¿cómo ahorrar?", "¿qué es un presupuesto?"), responde con intent "general_knowledge".
- Si el usuario menciona INGRESOS, ganancias, cobros o TRANSFERENCIAS HACIA SU PROPIA CUENTA (ej: "cobré", "cobre", "me pagaron", "transferí a mi cuenta", "me transferí"), responde con intent "add_income".
- Si el usuario menciona "quiero gastar", "gastar solo", "gastar máximo", "presupuesto", "no gastar más de", "asigno" (para CREAR presupuesto), responde con intent "create_budget" y extrae category, month, year, amount, operation: "set".
- Si el usuario dice "agregar al presupuesto", "aumentar presupuesto", "subir tope" (para MODIFICAR), responde con intent "create_budget" y extrae category, amount, operation: "add".
- Si el usuario pregunta "PUEDO gastar", "me alcanza", "cómo voy con el presupuesto", "tengo saldo para", responde con intent "check_budget" y extrae category (si hay), amount (si pregunta por un monto específico), month, year.
- Si el usuario expresa un deseo de COMPRAR o AHORRAR PARA algo específico ("quiero ahorrar", "meta de", "objetivo de"), responde con intent "create_goal" y extrae amount, currency, description, goalName, categories (array de categorías), deadline (si se menciona), year, month.
- Si el usuario menciona que YA AHORRÓ o AGREGÓ dinero a una meta existente (ej: "ahorré", "guardé", "puse", "agregué"), responde con intent "add_contribution" y extrae amount, goalName (nombre de la meta), description.
- Si el usuario menciona crear una cuenta bancaria o billetera, responde con intent "create_account" y extrae name, type, currency, primary (falso por defecto), reconciled (falso por defecto), archived (falso por defecto).
- Si el usuario menciona crear una categoría nueva, responde con intent "create_category" y extrae name, type ("income" o "expense"), icon, color.
- Si el usuario menciona invertir, comprar activos CON monto específico, responde con intent "invest" y extrae activo, amount, currency, periodo, tipo.
- Si el usuario pregunta si puede o le conviene comprar algo, o pide consejo sobre una compra grande (GENERALMENTE usa futuro o condicional: "¿puedo?", "¿conviene?", "¿podría?", "¿me alcanzaría?"), responde con intent "purchase_advice" y extrae item, amount, installments, interest_free e interest_rate.
- Si el usuario menciona GASTOS, pagos, compras, retiros, extracciones, transferencias a terceros (ej: "gasté", "pagué", "compré", "saqué plata", "retiré", "extraje", "me cobraron", "salió", "salieron", "compro", "pago", "transferí a [persona/comercio]"), responde con intent "add_expense" y extrae amount, currency ('ARS' o 'USD'), merchant, category, description, year, month, day, account, paymentMethod (usar referencias temporales de arriba). 
- REGLA CRÍTICA MERCHANT: NUNCA extraigas artículos ("un", "una", "el", "la", "unos", "unas") como merchant. Si el usuario dice "gasté 100 en un café", merchant debe ser "café" o estar vacío, NUNCA "un". 
- CONTEXTO ARGENTINO: "saqué" generalmente significa retiro de cajero o gasto, NO ingreso.
- Si el usuario pregunta por resumen, balance, gastos con comparación entre períodos (ej: "en comparación al año pasado", "comparar con el mes anterior", "vs el anterior"), responde con intent "query_comparison" y extrae month, year, compare_month, compare_year. IMPORTANTE: Si dice "mes anterior" o "el anterior", calcular correctamente el mes inmediatamente previo (ver reglas de REFERENCIAS TEMPORALES arriba). Si pregunta por categoría específica (ej: "en comida"), extraer category también.
- Si el usuario pregunta por resumen, balance, gastos altos, recurrentes SIN comparación, responde con intent "query_summary" o "query_top_expenses" según corresponda.
- Si el usuario pregunta por categorización, responde con intent "categorize".
- Si el usuario pregunta por "suscripciones", "duplicados", "pagos recurrentes" o menciona servicios como Netflix/Spotify sin monto (consulta), responde con intent "check_subscriptions".
- Si el usuario saluda o pide ayuda ("hola", "ayuda", "qué podés hacer"), responde con intent "help".
- Si el usuario quiere CORREGIR una transacción anterior (ej: "no, era 1500", "corrigi el monto", "era con tarjeta", "1200*", "Uala*"), responde con intent "correct_transaction" y extrae entities para lo que cambie: amount (si corrige monto), account (si corrige cuenta), category (si corrige categoría).

EJEMPLOS:
- "¿Puedo comprarme una heladera de 800000 en 12 cuotas?" → {"intent": "purchase_advice", "confidence": 0.99, "entities": {"item": "heladera", "amount": 800000, "installments": 12, "currency": "ARS"}}
- "¿Cuál es mi perfil financiero?" → {"intent": "analyze_financial_profile", "confidence": 0.99, "entities": {}}
- "Analiza mi comportamiento de gastos" → {"intent": "analyze_financial_profile", "confidence": 0.98, "entities": {}}
- "¿Cómo está mi salud financiera?" → {"intent": "analyze_financial_profile", "confidence": 0.98, "entities": {}}
- "¿Qué tipo de gastador soy?" → {"intent": "analyze_financial_profile", "confidence": 0.97, "entities": {}}
- "En marzo quiero gastar solo 25000 en transporte" → {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "transporte", "month": 3, "year": ${currentYear}, "amount": 25000, "currency": "ARS"}}
- "Presupuesto de 100 dolares para comida" → {"intent": "create_budget", "confidence": 0.99, "entities": {"category": "comida", "month": ${currentMonth}, "year": ${currentYear}, "amount": 100, "currency": "USD"}}
- "Gaste 100 dolares en amazon" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 100, "currency": "USD", "merchant": "amazon", "account": "Tarjeta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pague 50 dolares en efectivo" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 50, "currency": "USD", "account": "Efectivo", "paymentMethod": "efectivo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Hoy gasté 20000 en la peluquería" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 20000, "currency": "ARS", "merchant": "peluquería", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Gasté 5000 en el supermercado" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "supermercado", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Cargué 1000 en la Ualá" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 1000, "currency": "ARS", "account": "Ualá", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Me acreditaron 50000 de sueldo" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 50000, "currency": "ARS", "source": "sueldo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré tornillos por 500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 500, "currency": "ARS", "category": "Tornillos", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Saqué 5000 del cajero" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "Retiro", "paymentMethod": "efectivo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué 2000 con Mercado Pago" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 2000, "currency": "ARS", "account": "Mercado Pago", "paymentMethod": "debito", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Cobre 5000 en Mercado Pago" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "account": "Mercado Pago", "category": "Ingreso", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Me transfirieron 15000 al Brubank" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 15000, "currency": "ARS", "account": "Brubank", "category": "Ingreso", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Cobré el sueldo 120000" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 120000, "currency": "ARS", "source": "sueldo", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué la luz 8500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 8500, "currency": "ARS", "category": "luz", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Fui al supermercado y gasté 2.300" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 2300, "currency": "ARS", "category": "supermercado", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Deposité 5000 dólares en el banco" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 5000, "currency": "USD", "account": "Banco", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré en la verduleria 1200" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 1200, "currency": "ARS", "category": "verduleria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué Netflix 4500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 4500, "currency": "ARS", "category": "netflix", "merchant": "Netflix", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Transferí 10000 a mi hermana" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 10000, "currency": "ARS", "category": "transferencia", "description": "hermana", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el alquiler 180000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 180000, "currency": "ARS", "category": "alquiler", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Fui al cine y gasté 3500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3500, "currency": "ARS", "category": "cine", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué la tarjeta 45000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 45000, "currency": "ARS", "account": "Tarjeta", "category": "pago de tarjeta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré en la carnicería 7800" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 7800, "currency": "ARS", "category": "carniceria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el gimnasio 15000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 15000, "currency": "ARS", "category": "gimnasio", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Puse nafta 12000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 12000, "currency": "ARS", "category": "nafta", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué la prepaga 28000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 28000, "currency": "ARS", "category": "prepaga", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré ropa 25000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 25000, "currency": "ARS", "category": "ropa", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué Spotify 1200" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 1200, "currency": "ARS", "category": "spotify", "merchant": "Spotify", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pedí Rappi 8500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 8500, "currency": "ARS", "category": "delivery", "merchant": "Rappi", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Tomé un Uber 3200" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3200, "currency": "ARS", "category": "uber", "merchant": "Uber", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré una TV en 12 cuotas de 50000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 600000, "currency": "ARS", "category": "tecnologia", "merchant": "TV", "paymentMethod": "credito", "creditDetails": {"installments": 12}, "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Cargué la SUBE 5000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "category": "sube", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el internet 9800" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 9800, "currency": "ARS", "category": "internet", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré en la farmacia 6400" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 6400, "currency": "ARS", "category": "farmacia", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué las expensas 32000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 32000, "currency": "ARS", "category": "expensa", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Fui al dentista 18000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 18000, "currency": "ARS", "category": "dentista", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré libros 14500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 14500, "currency": "ARS", "category": "libro", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el veterinario 9000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 9000, "currency": "ARS", "category": "veterinario", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el celular 7500" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 7500, "currency": "ARS", "category": "celular", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Compré en la ferretería 3400" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 3400, "currency": "ARS", "category": "ferreteria", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pagué el impuesto 22000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 22000, "currency": "ARS", "category": "impuesto", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Hice un curso 35000" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": 35000, "currency": "ARS", "category": "curso", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "¿Cuánto gasté este mes?" → {"intent": "query_summary", "confidence": 0.99, "entities": {"month": ${currentMonth}, "year": ${currentYear}}}
- "¿Cuáles fueron mis mayores gastos?" → {"intent": "query_top_expenses", "confidence": 0.99, "entities": {}}
- "Quiero ahorrar 100000 para vacaciones" → {"intent": "create_goal", "confidence": 0.99, "entities": {"amount": 100000, "currency": "ARS", "goalName": "vacaciones", "categories": ["vacaciones", "viajes"]}}
- "Nueva cuenta de efectivo en dolares" → {"intent": "create_account", "confidence": 0.99, "entities": {"name": "Efectivo USD", "type": "cash", "currency": "USD"}}
- "Compará este mes vs el anterior" → {"intent": "query_comparison", "confidence": 0.99, "entities": {"month": ${currentMonth}, "year": ${currentYear}, "compare_month": ${currentMonth === 1 ? 12 : currentMonth - 1}, "compare_year": ${currentMonth === 1 ? lastYear : currentYear}}}
- "Compará este mes vs el anterior en comida" → {"intent": "query_comparison", "confidence": 0.99, "entities": {"month": ${currentMonth}, "year": ${currentYear}, "compare_month": ${currentMonth === 1 ? 12 : currentMonth - 1}, "compare_year": ${currentMonth === 1 ? lastYear : currentYear}, "category": "comida"}}
- "Gastos de enero vs diciembre" → {"intent": "query_comparison", "confidence": 0.99, "entities": {"month": 1, "year": ${currentYear}, "compare_month": 12, "compare_year": ${lastYear}}}
- "cuanto gaste en transporte en diciembre 2025" → {"intent": "query_summary", "confidence": 0.99, "entities": {"month": 12, "year": 2025, "category": "transporte"}}
- "resumen de gastos de mayo" → {"intent": "query_summary", "confidence": 0.99, "entities": {"month": 5, "year": ${currentYear}}}
- "no, era 5000" → {"intent": "correct_transaction", "confidence": 0.99, "entities": {"amount": 5000}}
- "5000*" → {"intent": "correct_transaction", "confidence": 0.99, "entities": {"amount": 5000}}
- "en realidad fue en efectivo" → {"intent": "correct_transaction", "confidence": 0.99, "entities": {"account": "Efectivo", "paymentMethod": "efectivo"}}
- "cambia la categoria a comida" → {"intent": "correct_transaction", "confidence": 0.99, "entities": {"category": "comida"}}
- "era con Uala" → {"intent": "correct_transaction", "confidence": 0.99, "entities": {"account": "Ualá"}}

EJEMPLO DE SALIDA JSON (FORMATO ESTRICTO):
- Input: "Cobre 5000"
- Output: { "intent": "add_income", "confidence": 0.99, "entities": { "amount": 5000, "currency": "ARS", "description": "Cobro general", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear} } }

- Input: "Transfiri 15000 a Juan Perez"
- Output: { "intent": "add_expense", "confidence": 0.99, "entities": { "amount": 15000, "currency": "ARS", "description": "Transferencia a Juan Perez", "category": "Transferencias", "merchant": "Juan Perez", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear} } }

- Input: "Me transfirio 20000 Maria Gomez"
- Output: { "intent": "add_income", "confidence": 0.99, "entities": { "amount": 20000, "currency": "ARS", "description": "Transferencia de Maria Gomez", "source": "Maria Gomez", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear} } }

- Input: "Transferi 50000 de mi banco a mi cuenta sueldo"
- Output: { "intent": "add_expense", "confidence": 0.99, "entities": { "amount": 50000, "currency": "ARS", "description": "Transferencia propia", "category": "Transferencias", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear} } }

EJEMPLOS DE GENERACIÓN DE DESCRIPCIÓN INDUCIDA:
- "Cobre 5000" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 5000, "currency": "ARS", "description": "Cobro general", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Pague la luz" → {"intent": "add_expense", "confidence": 0.99, "entities": {"amount": null, "description": "Pago de Luz", "category": "Servicios", "merchant": "Luz", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Gane 20000 en el casino" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": 20000, "currency": "ARS", "description": "Casino", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}
- "Cobre el sueldo" → {"intent": "add_income", "confidence": 0.99, "entities": {"amount": null, "currency": "ARS", "description": "Sueldo", "category": "Salario", "day": ${now.getDate()}, "month": ${currentMonth}, "year": ${currentYear}}}

CRÍTICO:
- Si el usuario menciona SOLO UN período (un mes, un año, "este mes", "diciembre 2025"), el intent DEBE ser "query_summary".
- El intent "query_comparison" SOLO debe usarse si hay palabras de comparación explícitas ("comparar", "vs", "versus", "en comparación a", "contra") O si menciona dos períodos claramente distintos para contrastar.
- NUNCA compares con el futuro. Si hoy es ${currentMonth}/${currentYear}, no inventes comparaciones con meses posteriores.

Mensaje: "${message}"`;

    const completion = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'Eres un parser de intención financiera que responde sólo JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.0,
      max_completion_tokens: 400
    });

    const content = completion.choices?.[0]?.message?.content || '';

    // Validar que OpenAI retornó algo
    if (!content || content.trim().length === 0) {
      logNLU('warn', 'OpenAI returned empty content, using rule-based fallback');
      return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities: normalizeEntities(entities, matchedIntent || 'unknown') };
    }

    // Extraer JSON de la respuesta (puede estar embebido en texto)
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonText = content.slice(jsonStart, jsonEnd + 1);
      try {
        const parsed = JSON.parse(jsonText);
        logNLU('info', `OpenAI parsed intent: ${parsed.intent}, confidence: ${parsed.confidence} `);

        // Validar que al menos tenemos intent
        if (!parsed.intent) {
          logNLU('warn', 'OpenAI response missing intent field');
          return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities: normalizeEntities(entities, matchedIntent || 'unknown') };
        }

        return {
          intent: parsed.intent || matchedIntent || 'unknown',
          confidence: Math.min(1.0, Math.max(0, parsed.confidence || (matchedIntent ? 0.95 : 0.5))),
          entities: normalizeEntities({ ...entities, ...(parsed.entities || {}) }, parsed.intent || matchedIntent || 'unknown')
        };
      } catch (e) {
        logNLU('warn', `JSON parse error: ${(e as any)?.message} `, { jsonText: jsonText.substring(0, 100) });
        return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.3, entities: normalizeEntities(entities, matchedIntent || 'unknown') };
      }
    } else {
      logNLU('warn', 'OpenAI response does not contain JSON, using rule fallback');
      return { intent: matchedIntent || 'unknown', confidence: matchedIntent ? 0.95 : 0.2, entities: normalizeEntities(entities, matchedIntent || 'unknown') };
    }
  } catch (err) {
    const errMsg = (err as any)?.message || String(err);
    logNLU('error', `OpenAI API error: ${errMsg} `);

    // Fallback final: usar intent rule-based
    if (matchedIntent) {
      logNLU('info', `Using rule - based fallback intent: ${matchedIntent} `);
      return { intent: matchedIntent, confidence: 0.8, entities: normalizeEntities(entities, matchedIntent) };
    }

    // Si ni siquiera hay rule match, retornar unknown
    return { intent: 'unknown', confidence: 0.2, entities: normalizeEntities(entities, 'unknown') };
  }
}
