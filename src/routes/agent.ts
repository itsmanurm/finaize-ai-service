
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
    console.error('[Agent Chat] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

r.post('/forecast', async (req, res) => {
  try {
    const { category, horizonDays } = req.body;

    // NEW LOGIC: Default to Intra-Month projection if no horizon or small horizon
    // Or explicit param? Let's assume default is now this robust view.

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysElapsed = now.getDate();

    // Mock Real Data for Current Month (Day 1 to Today)
    const currentMonthData: { date: Date, value: number }[] = [];
    let accum = 0;
    for (let i = 1; i <= daysElapsed; i++) {
      // Random daily expense with some "salary spike" or irregular pattern
      let daily = Math.random() * 5000 + 1000;
      if (i === 5 || i === 20) daily += 10000; // Big expenses
      accum += daily;
      currentMonthData.push({
        date: new Date(currentYear, currentMonth, i),
        value: daily
      });
    }

    // Usar el nuevo servicio de proyección intra-mensual
    // Pasamos historia vacía [] para que confíe en los datos actuales
    const result = ForecastingService.predictAdaptive([], currentMonthData, daysInMonth, daysElapsed);

    // Map to API response structure
    // historySmoothed -> Real Cumulative
    // forecast -> Prediction (which is also cumulative)

    res.json({
      ok: true,
      historySmoothed: currentMonthData, // Using the real data we generated
      forecast: result
    });

  } catch (error) {
    console.error('Forecast error:', error);
    res.status(500).json({ ok: false, error: 'Failed to generate forecast' });
  }
});

export default r;

