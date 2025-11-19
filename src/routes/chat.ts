import { Router } from 'express';
import { ensureSession, appendMessage } from '../ai/session';
import { parseMessage } from '../ai/nlu';
import { actionAddExpense, actionQuerySummary } from '../ai/actions';

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
