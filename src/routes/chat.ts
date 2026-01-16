import { Router } from 'express';
import { ensureSession, appendMessage } from '../ai/session';
import { parseMessage } from '../ai/nlu';
import { actionAddExpense, actionQuerySummary, actionQueryDollar } from '../ai/actions';

const r = Router();

/** POST /ai/chat */
r.post('/chat', async (req, res) => {
  // Auth handled globally by `apiKeyAuth` middleware mounted in `src/index.ts`.

  const { sessionId, message, options } = req.body || {};
  if (!message || typeof message !== 'string' || message.length < 2) {
    console.warn(`[payload] Mensaje inválido: ${JSON.stringify(message)}`);
    return res.status(400).json({ ok: false, error: 'El mensaje debe ser un string no vacío.' });
  }

  const session = ensureSession(sessionId);
  appendMessage(session.id, 'user', message);

  let nlu;
  try {
    nlu = await parseMessage(message);
    console.error('[NLU entidades extraídas]', JSON.stringify(nlu.entities));
  } catch (err: any) {
    console.error('[nlu] Error al procesar mensaje:', err?.message || err);
    return res.status(502).json({ ok: false, error: 'Error de NLU o red', details: err?.message || err });
  }

  // Acciones dinámicas según intent detectado
  let reply = '';
  let actionResult: any = null;

  try {
    // Mapear intent a función de acción si existe
    // Mapeo flexible: cualquier intent con palabras clave financieras/mercado activa consulta de mercado
    const marketKeywords = [
      'cedear', 'mercado', 'acción', 'acciones', 'criptomoneda', 'cripto', 'financiero', 'información', 'mejores', 'buscar', 'recomendación', 'subiendo', 'invertir'
    ];
    const actionsMap: Record<string, Function> = {
      add_expense: actionAddExpense,
      query_summary: actionQuerySummary,
      query_top_expenses: actionQuerySummary,
      query_dollar_rate: actionQueryDollar,
      create_goal: async () => ({ ok: true }),
      categorize: async () => ({ ok: true })
    };

    let actionFn: Function | undefined = actionsMap[nlu.intent];
    // Si el intent contiene alguna palabra clave de mercado, usar queryMarketInfo
    if (!actionFn && marketKeywords.some(k => nlu.intent?.toLowerCase().includes(k))) {
      actionFn = require('../ai/actions').queryMarketInfo;
    }

    if (nlu.intent === 'add_expense_list') {
      // Crear múltiples gastos a partir de items extraídos por NLU
      const items = (nlu.entities as any)?.items || [];
      const created: any[] = [];
      for (const it of items) {
        try {
          const r = await actionAddExpense(it, true);
          if (r && r.record) created.push(r.record);
        } catch (e: any) {
          console.warn('[chat] Error creando gasto item:', it, e?.message || e);
        }
      }
      actionResult = { ok: true, created };
      if (created.length) reply = `Registrados ${created.length} gastos.`;
      else reply = 'No se pudieron registrar los gastos.';
    } else if (nlu.intent && actionFn) {
      // Pasar entidades extraídas como opciones de filtrado
      const opts = { ...options, ...nlu.entities, intent: nlu.intent };
      actionResult = await actionFn(opts);
      // Respuesta adaptada según intent
      if (nlu.intent === 'add_expense') {
        reply = `Gasto registrado: ${actionResult.record.category} ${actionResult.record.amount} ${actionResult.record.currency}`;
      } else if (nlu.intent === 'query_summary') {
        reply = `Resumen: ingreso ${actionResult.totals.income}, gasto ${actionResult.totals.expense}, neto ${actionResult.totals.net}`;
      } else if (nlu.intent === 'query_top_expenses') {
        if (actionResult.topExpenses && actionResult.topExpenses.length) {
              reply = 'Tus gastos más altos este mes fueron: ' + actionResult.topExpenses.map((e: any) => `${e.description} (${e.amount} ${e.currency})`).join(', ');
        } else {
          reply = 'No se encontraron gastos altos este mes.';
        }
      } else if (nlu.intent === 'create_goal') {
        reply = 'Entendido — puedo crear una meta. ¿Cuál es el nombre y el monto objetivo?';
      } else if (nlu.intent === 'categorize') {
        reply = 'Puedes enviarme la transacción y la categorizo.';
      } else if (actionFn === require('../ai/actions').queryMarketInfo) {
        if (actionResult.ok && actionResult.activos?.length) {
              reply = `Los mejores ${actionResult.activos[0].nombre.includes('Apple') ? 'CEDEARs' : 'activos'} ${actionResult.periodo} son: ` + actionResult.activos.map((a: any) => `${a.nombre} (${a.variacion}, $${a.precio})`).join(', ');
        } else {
          reply = 'No se encontraron activos destacados para tu consulta.';
        }
      } else if (nlu.intent === 'query_dollar_rate') {
        if (actionResult.ok && actionResult.rates?.length) {
          const ratesText = actionResult.rates.map((r: any) => 
            `${r.nombre}: Compra $${r.compra?.toLocaleString('es-AR') || 'N/A'}, Venta $${r.venta?.toLocaleString('es-AR') || 'N/A'}`
          ).join(' | ');
          reply = `💵 Cotizaciones del dólar:\n${ratesText}`;
        } else {
          reply = 'No pude obtener las cotizaciones del dólar en este momento. Intentá de nuevo en unos minutos.';
        }
      } else if (nlu.intent === 'help' || message.toLowerCase().includes('ayudar')|| message.toLowerCase().includes('podes hacer') || message.toLowerCase().includes('puedes hacer')) {
        reply = `¡Hola! Soy tu **Asistente Financiero con IA** 🤖✨

**Puedo ayudarte con:**

📊 **Análisis de tus finanzas personales**
• Analizar tus gastos por categoría y período
• Comparar meses y detectar tendencias
• Identificar gastos inusuales o anómalos
• Revisar el uso de tus presupuestos
• Detectar suscripciones duplicadas

💡 **Recomendaciones personalizadas**
• Sugerencias para ahorrar dinero
• Optimización de gastos recurrentes
• Identificación de oportunidades de mejora
• Estrategias adaptadas a tu perfil financiero

💬 **Consultas sobre economía y finanzas**
• Conceptos de ahorro e inversión
• Consejos de presupuesto personal
• Información sobre herramientas financieras
• Educación financiera en general

**Ejemplos de preguntas que podés hacer:**

*Sobre tus datos:*
• "¿Cuánto gasté en comida este mes?"
• "¿Cómo vienen mis gastos de transporte?"
• "Compará este mes vs. el anterior"
• "¿En qué categoría gasto más?"
• "¿Cómo van mis presupuestos?"
• "¿Tengo suscripciones duplicadas?"

*Sobre economía en general:*
• "¿Cómo puedo armar un presupuesto?"
• "¿Qué es el ahorro automático?"
• "¿Cuál es la regla del 50/30/20?"
• "¿Cómo empezar a invertir?"
• "Consejos para reducir gastos"

¡Preguntame lo que necesites! 🚀`;
      }
    } else {
      // Logging avanzado de intents no cubiertos
      console.warn(`[NLU][NO_CUBIERTO] Intent no reconocido: '${nlu.intent}' para mensaje: '${message}' | entidades:`, nlu.entities);
      reply = 'No entendí exactamente. ¿Podés reformular?';
    }
  } catch (err: any) {
    console.error('[action] Error en acción:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno en acción', details: err?.message || err });
  }

  appendMessage(session.id, 'bot', reply);

  return res.json({ ok: true, sessionId: session.id, intent: nlu.intent, confidence: nlu.confidence, reply, actionResult });
});

export default r;
