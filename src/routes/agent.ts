
import { Router } from 'express';
import { agentChatCompletion } from '../ai/openai-service';
import { z } from 'zod';
import { ForecastingService } from '../ai/forecasting';

const r = Router();

// Validation Schema
const AgentChatSchema = z.object({
  messages: z.array(z.any()),
  tools: z.array(z.any()).optional(),
  model: z.string().optional()
});

/** POST /ai/agent/chat - Pure LLM Gateway for Agents */
r.post('/chat', async (req, res) => {
  const parse = AgentChatSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok: false, error: 'Bad request', details: parse.error.issues });
  }

  try {
    const message = await agentChatCompletion(parse.data);
    return res.json({ ok: true, reply: message });
  } catch (error: any) {
    console.error('[IA] ❌ Error en Chat de Agente:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

r.post('/forecast', async (req, res) => {
  try {
    const { category, horizonDays, transactions } = req.body;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysElapsed = now.getDate();

    // 1. Parse Real Data from Backend
    const validTransactions: { date: Date, value: number }[] = [];

    if (Array.isArray(transactions)) {
      // console.log(`[Sistema] Cantidad de transacciones entrantes: ${transactions.length}`);
      transactions.forEach((t, i) => {
        if (t.when && t.amount !== undefined) {
          const d = new Date(t.when);
          if (!isNaN(d.getTime())) {
            validTransactions.push({
              date: d,
              value: Number(t.amount)
            });
          }
        }
      });
    }

    console.log(`[IA] ✅ Se procesaron ${validTransactions.length} transacciones válidas.`);

    // 2. Split into Historical vs Current Month
    // USE UTC consistently to avoid timezone shifts
    const targetMonth = now.getUTCMonth();
    const targetYear = now.getUTCFullYear();
    // console.log(`[Sistema] Mes objetivo: ${targetMonth} (0-indexed), Año objetivo: ${targetYear}`);

    const historicalData: { date: Date, value: number }[] = [];
    const currentMonthData: { date: Date, value: number }[] = [];

    validTransactions.forEach((p, i) => {
      const pMonth = p.date.getUTCMonth();
      const pYear = p.date.getUTCFullYear();

      if (pMonth === targetMonth && pYear === targetYear) {
        currentMonthData.push(p);
      } else {
        historicalData.push(p);
      }
    });

    // console.log(`[Sistema] División: Histórica=${historicalData.length}, Mes Actual=${currentMonthData.length}`);
    const currentSum = currentMonthData.reduce((s, t) => s + t.value, 0);
    // console.log(`[Sistema] Acumulado Mes Actual: ${currentSum}`);
    if (currentMonthData.length > 0) {
      // console.log(`[Sistema] Primer dato del Mes Actual: ${JSON.stringify(currentMonthData[0])}`);
    }

    // 3. Generate Forecast with Real Data
    const result = ForecastingService.predictAdaptive(
      historicalData,
      currentMonthData,
      daysInMonth,
      daysElapsed
    );

    res.json({
      ok: true,
      historySmoothed: validTransactions, // Return full history for graphing
      forecast: result
    });

  } catch (error) {
    console.error('[Sistema] ❌ Error en pronóstico:', error);
    res.status(500).json({ ok: false, error: 'Error al generar pronóstico' });
  }
});

export default r;

