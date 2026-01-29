
import { Router } from 'express';
import { ItemSchema, FeedbackSchema, SummarizeSchema, ForecastRequestSchema, AnomalyRequestSchema } from '../ai/schema';
import { categorize } from '../ai/service';
import { SUSCRIPCIONES } from '../utils/ai-constants';
import { appendJsonl } from '../utils/jsonl';
import { parseMessage } from '../ai/nlu';
import { analyzeFinancialProfile } from '../ai/profile-analyzer';
import { AnomalyService } from '../ai/anomaly';
import { notifyAnomaly, notifyRecurringSubscription } from '../utils/notification-client';

const r = Router();

/** POST /ai/parse - Procesa mensajes en lenguaje natural (NLU) */
r.post('/parse', async (req, res) => {
  const { message, userId } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ ok: false, error: 'message requerido' });
  }

  try {
    console.log(`[AI Parse] Processing message: "${message.substring(0, 50)}..."`);
    const result = await parseMessage(message);

    // Log resultado
    console.log(`[AI Parse]Result - Intent: ${result.intent}, Confidence: ${result.confidence} `);

    return res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[AI Parse] Error:', error);

    // Fallback: retornar unknown intent pero no fallar
    return res.status(500).json({
      ok: false,
      error: 'Error procesando mensaje',
      fallback: {
        intent: 'unknown',
        confidence: 0.1,
        entities: {}
      }
    });
  }
});

/** POST /ai/categorize (single) */
r.post('/categorize', async (req, res) => {
  const parse = ItemSchema.safeParse(req.body || {});
  if (!parse.success) {
    return res.status(400).json({ ok: false, error: 'Bad request', details: parse.error.issues });
  }
  const out = await categorize(parse.data);
  return res.json({ ok: true, ...out });
});

/** POST /ai/categorize/batch (array o {items:[]}) */
r.post('/categorize/batch', async (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(arr)) {
    return res.status(400).json({ ok: false, error: 'Se espera un array en el body o { items: [...] }' });
  }
  const out: any[] = [];
  for (const it of arr) {
    const p = ItemSchema.safeParse(it || {});
    if (!p.success) {
      out.push({ ok: false, error: 'Bad item', details: p.error.issues, echo: it });
      continue;
    }
    const pred = await categorize(p.data);
    out.push({ ok: true, ...pred });
  }
  return res.json({ ok: true, items: out });
});

/** POST /ai/feedback  -> guarda una línea en data/feedback.jsonl */
r.post('/feedback', async (req, res) => {
  const parsed = FeedbackSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Bad request', details: parsed.error.issues });
  }
  const payload = {
    ...parsed.data,
    ts: new Date().toISOString()
  };
  await appendJsonl('feedback.jsonl', payload);
  return res.json({ ok: true, saved: 1 });
});

/** POST /ai/summarize -> mini informe con o sin clasificar faltantes */
r.post('/summarize', async (req, res) => {
  const parsed = SummarizeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Bad request', details: parsed.error.issues });
  }

  const { items, classifyMissing, currency, periodLabel } = parsed.data;

  // 1) Completar categorías faltantes (opcional)
  const enriched: Array<{ amount: number; category: string; merchant?: string }> = [];
  for (const it of items) {
    let cat = it.category;
    if (!cat && classifyMissing) {
      const pred = await categorize(it);
      cat = pred.category;
    }
    enriched.push({ amount: it.amount, category: cat ?? 'Sin clasificar', merchant: it.merchant });
  }

  // 2) Agregados
  let totalIncome = 0, totalExpense = 0;
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, number>();

  for (const it of enriched) {
    // Excluir transferencias internas
    if ((it as any).isInternalTransfer === true || (it as any).transactionType === 'transferencia') continue;

    const isIncome = (it as any).transactionType === 'ingreso' || (!(it as any).transactionType && it.amount >= 0);

    if (isIncome) totalIncome += it.amount;
    else totalExpense += it.amount;

    byCategory.set(it.category, (byCategory.get(it.category) ?? 0) + it.amount);
    if (it.merchant) {
      byMerchant.set(it.merchant, (byMerchant.get(it.merchant) ?? 0) + it.amount);
    }
  }

  const net = totalIncome + totalExpense;
  const catArr = Array.from(byCategory.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 8);

  const merchArr = Array.from(byMerchant.entries())
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 8);

  // 3) Sugerencias simples
  const totalAbs = Math.abs(totalExpense) + Math.abs(totalIncome);
  const tips: string[] = [];
  // Buscar todas las categorías que tengan "transporte"
  const transporteCats = catArr.filter(c =>
    c.category.toLowerCase().includes('transporte')
  );
  // Sumar el total de transporte
  const transporteTotal = transporteCats.reduce((acc, c) => acc + c.total, 0);
  // Si el transporte supera el 30% de los egresos, sugerencia
  if (Math.abs(transporteTotal) > 0.3 * Math.abs(totalExpense)) {
    tips.push('Tu gasto en Transporte es alto este período ( >30% de los egresos ). Considerá optimizar traslados.');
  }

  /* 
   * SUGGESTION LOGIC
   * Updated to use strict Subscription Whitelist from shared constants
   */
  const subCandidates = merchArr.filter(m => {
    // Check coverage against full whitelist
    const txt = m.merchant?.toLowerCase() || '';
    return SUSCRIPCIONES.some(s => txt.includes(s.toLowerCase()));
  });

  if (subCandidates.length >= 2) tips.push('Detectamos múltiples suscripciones. Revisá si las usás todas.');
  if (net < 0) tips.push('Cerraste el período con balance negativo. Evaluá reducir rubros con mayor peso.');

  return res.json({
    ok: true,
    period: periodLabel ?? null,
    currency,
    totals: {
      income: Number(totalIncome.toFixed(2)),
      expense: Number(totalExpense.toFixed(2)),
      net: Number(net.toFixed(2))
    },
    topCategories: catArr.map(x => ({ ...x, total: Number(x.total.toFixed(2)) })),
    topMerchants: merchArr.map(x => ({ ...x, total: Number(x.total.toFixed(2)) })),
    suggestions: tips
  });
});

/** POST /api/ai -> Redirige a /ai/categorize */
// Nota: el router se monta en `/ ai`, por lo que aquí la ruta raíz ` / ` redirige a ` / categorize`.
r.post('/', (req, res) => {
  res.redirect(307, '/categorize');
});

// Ruta para pruebas adicionales
r.post('/test-cases', async (req, res) => {
  const testCases = req.body;
  if (!Array.isArray(testCases)) {
    return res.status(400).json({ ok: false, error: 'Se espera un array de casos de prueba.' });
  }

  const results = await Promise.all(testCases.map(async (testCase) => {
    try {
      return await categorize(testCase);
    } catch (error) {
      return { error: (error as Error).message, input: testCase };
    }
  }));

  res.json({ ok: true, results });
});

/** POST /ai/analyze-profile - Analiza el perfil financiero del usuario */
r.post('/analyze-profile', async (req, res) => {
  const { transactions, budgets, goals, timeframeMonths, userId } = req.body || {};

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Se requiere un array de transacciones con al menos 1 elemento'
    });
  }

  try {
    console.log(`[AI Analyze Profile] Analizando ${transactions.length} transacciones, ${timeframeMonths || 6} meses`);

    const profile = analyzeFinancialProfile({
      transactions,
      budgets: budgets || [],
      goals: goals || [],
      timeframeMonths: timeframeMonths || 6
    });

    // Send notifications for detected recurring subscriptions
    if (userId && profile.patterns?.recurringExpenses) {
      // Filter for likely subscriptions (frequent + regular amount)
      const likelySubscriptions = profile.patterns.recurringExpenses.filter(
        expense => expense.frequency === 'Muy frecuente' || expense.frequency === 'Frecuente'
      );

      for (const subscription of likelySubscriptions.slice(0, 3)) { // Max 3 notifications per analysis
        // Calculate actual frequency count from frequency text
        const frequencyCount = subscription.frequency === 'Muy frecuente' ? 10 : 5;

        notifyRecurringSubscription(
          userId,
          subscription.merchant,
          subscription.avgAmount,
          frequencyCount
        ).catch(err => console.error('[Analyze Profile] Failed to send subscription notification:', err));
      }
    }

    return res.json({
      ok: true,
      ...profile
    });
  } catch (error: any) {
    console.error('[AI Analyze Profile] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error analizando perfil',
      details: error.message
    });
  }
});

/** POST /ai/forecast - Predicción de gastos futuros */
r.post('/forecast', async (req, res) => {
  const result = ForecastRequestSchema.safeParse(req.body || {});

  if (!result.success) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos', details: result.error.issues });
  }

  const { transactions, category, horizonDays } = result.data;

  try {
    // 1. Filtrar por categoría si se solicita
    let filtered = transactions;
    if (category && category !== 'all') {
      filtered = transactions.filter(t =>
        (t.category || '').toLowerCase() === category.toLowerCase()
      );
    }

    // 2. Separar datos: Históricos (meses anteriores) vs Actuales (mes en curso)
    const now = new Date();
    // Obtener string "YYYY-MM" local usando la fecha actual del sistema
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentMonthPrefix = `${currentYear} -${currentMonth.toString().padStart(2, '0')} `;

    console.log(`[AI - Service] Current Month Target: ${currentMonthPrefix} `);

    const historicalPointsMap = new Map<string, number>();
    const currentPointsMap = new Map<string, number>();

    for (const t of filtered) {
      const d = (t as any).date || t.when;
      if (!d) continue;

      // d es string "YYYY-MM-DD" del backend
      let dateStr = '';
      if (d instanceof Date) {
        dateStr = d.toISOString().split('T')[0];
      } else {
        dateStr = String(d).split('T')[0];
      }

      const val = Math.abs(Number(t.amount) || 0);

      // Comparación Estricta de String: Si empieza con "2026-01" es actual
      if (dateStr.startsWith(currentMonthPrefix)) {
        currentPointsMap.set(dateStr, (currentPointsMap.get(dateStr) || 0) + val);
      } else {
        // Todo lo demás es historia
        historicalPointsMap.set(dateStr, (historicalPointsMap.get(dateStr) || 0) + val);
      }
    }

    const historicalData = Array.from(historicalPointsMap.entries()).map(([d, v]) => ({ date: new Date(d), value: v }));
    const currentData = Array.from(currentPointsMap.entries()).map(([d, v]) => ({ date: new Date(d), value: v }));

    const { ForecastingService } = await import('../ai/forecasting');

    const totalDaysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const calendarDayOfMonth = now.getDate(); // 1...31

    // Pass calendarDayOfMonth CORRECTLY
    const forecast = ForecastingService.predictAdaptive(
      historicalData,
      currentData,
      totalDaysInMonth,
      calendarDayOfMonth
    );

    // El "historySmoothed" para el frontend será la data actual ordenada (Real Accumulate)
    const currentSorted = [...currentData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const cumulativeReal: { date: Date, value: number }[] = [];
    let sum = 0;
    currentSorted.forEach(p => {
      sum += p.value;
      cumulativeReal.push({ date: p.date, value: sum });
    });

    // Active Spending Days calculation (days with data)
    const activeSpendingDays = currentData.length;

    // Quality Rule: < 7 days of actual month elapsed OR very few data points
    let dataQuality = 'good';
    if (calendarDayOfMonth < 7) dataQuality = 'limited';
    else if ((currentData.length + historicalData.length) < 5) dataQuality = 'insufficient';

    return res.json({
      ok: true,
      category: category || 'all',
      forecast: {
        ...forecast,
        predictions: forecast.predictions
      },
      historySmoothed: cumulativeReal,
      meta: {
        calendarDayOfMonth,
        activeSpendingDays,
        daysInMonth: totalDaysInMonth,
        dataQuality
      }
    });

  } catch (error: any) {
    console.error('[AI Forecast] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/** POST /ai/anomalies - Detectar transacciones inusuales */
r.post('/anomalies', async (req, res) => {
  const result = AnomalyRequestSchema.safeParse(req.body || {});

  if (!result.success) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos', details: result.error.issues });
  }

  const { transactions, threshold, userId } = result.data;

  try {
    const anomalies = AnomalyService.detectOutliers(transactions, threshold);

    // Send notifications to backend for high severity anomalies
    if (userId && anomalies.length > 0) {
      // Only notify for medium/high severity anomalies to avoid spam
      const notifiableAnomalies = anomalies.filter(a => a.severity !== 'low');

      for (const anomaly of notifiableAnomalies) {
        if (anomaly.transactionId) {
          notifyAnomaly(
            userId,
            anomaly.transactionId,
            anomaly.amount,
            anomaly.category,
            anomaly.reason,
            anomaly.severity
          ).catch(err => console.error('[Anomalies] Failed to send notification:', err));
        }
      }
    }

    return res.json({
      ok: true,
      count: anomalies.length,
      anomalies
    });
  } catch (error: any) {
    console.error('[AI Anomalies] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

export default r;
