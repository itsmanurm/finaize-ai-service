import { Router } from 'express';
import { ItemSchema, FeedbackSchema, SummarizeSchema } from '../ai/schema';
import { categorizeBatch } from '../ai/enhanced-service';
import { appendJsonl } from '../utils/jsonl';

const r = Router();

/** POST /ai/categorize (single) - Con soporte IA */
r.post('/categorize', async (req, res) => {
  const parse = ItemSchema.safeParse(req.body || {});
  if (!parse.success) {
    return res.status(400).json({ ok:false, error:'Bad request', details: parse.error.issues });
  }
  
  try {
    const out = await categorizeBatch([parse.data], { 
      useAI: req.body.useAI || false,
      maxConcurrency: 1
    });
    return res.json({ ok:true, ...out[0] });
  } catch (error: any) {
    return res.status(500).json({ 
      ok:false, 
      error:'categorization_failed', 
      message: error.message 
    });
  }
});

/** POST /ai/categorize/batch (array o {items:[]}) - Con soporte IA */
r.post('/categorize/batch', async (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : req.body?.items;
  const useAI = req.body?.useAI || false;
  
  if (!Array.isArray(arr)) {
    return res.status(400).json({ ok:false, error:'Se espera un array en el body o { items: [...] }' });
  }
  
  if (arr.length > 100) {
    return res.status(400).json({ ok:false, error:'Máximo 100 transacciones por lote' });
  }
  
  try {
    const out = await categorizeBatch(arr, { 
      useAI,
      maxConcurrency: useAI ? 2 : 5 
    });
    return res.json({ ok:true, items: out });
  } catch (error: any) {
    return res.status(500).json({ 
      ok:false, 
      error:'batch_categorization_failed', 
      message: error.message 
    });
  }
});

/** POST /ai/categorize/ai (solo OpenAI) */
r.post('/categorize/ai', async (req, res) => {
  const parse = ItemSchema.safeParse(req.body || {});
  if (!parse.success) {
    return res.status(400).json({ ok:false, error:'Bad request', details: parse.error.issues });
  }
  
  try {
    const out = await categorizeBatch([parse.data], { 
      useAI: true,
      maxConcurrency: 1
    });
    const result = out[0];
    return res.json({ 
      ok:true, 
      ...result,
      aiMode: 'forced'
    });
  } catch (error: any) {
    return res.status(500).json({ 
      ok:false, 
      error:'ai_categorization_failed', 
      message: error.message,
      aiMode: 'failed'
    });
  }
});

/** POST /ai/feedback - Mejorado con IA analysis */
r.post('/feedback', async (req, res) => {
  const parsed = FeedbackSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok:false, error:'Bad request', details: parsed.error.issues });
  }
  
  const payload = {
    ...parsed.data,
    ts: new Date().toISOString(),
    aiAnalyzed: !!req.body.aiAnalyzed,
    originalCategory: req.body.originalCategory,
    aiConfidence: req.body.aiConfidence
  };
  
  await appendJsonl('feedback.jsonl', payload);
  return res.json({ ok:true, saved: 1 });
});

/** POST /ai/summarize - Con IA insights */
r.post('/summarize', async (req, res) => {
  const parsed = SummarizeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok:false, error:'Bad request', details: parsed.error.issues });
  }

  const { items, classifyMissing, currency, periodLabel, useAI = false } = parsed.data;

  // 1) Completar categorías faltantes (opcional)
  const enriched: Array<{ amount:number; category:string; merchant?:string; aiEnhanced?: boolean }> = [];
  
  if (classifyMissing) {
    const missingItems = items.filter(it => !it.category);
    if (missingItems.length > 0) {
      try {
        const classifiedItems = await categorizeBatch(missingItems, { 
          useAI,
          maxConcurrency: useAI ? 2 : 5 
        });
        
        // Combinar resultados
        let missingIndex = 0;
        for (const it of items) {
          if (!it.category) {
            const classification = classifiedItems[missingIndex++];
            enriched.push({ 
              amount: it.amount, 
              category: classification.category, 
              merchant: it.merchant,
              aiEnhanced: classification.aiEnhanced
            });
          } else {
            enriched.push({ 
              amount: it.amount, 
              category: it.category, 
              merchant: it.merchant,
              aiEnhanced: false
            });
          }
        }
      } catch (error) {
        console.error('Error in AI classification for summarize:', error);
        // Fallback: usar categorización básica
        for (const it of items) {
          enriched.push({ 
            amount: it.amount, 
            category: it.category || 'Sin clasificar', 
            merchant: it.merchant,
            aiEnhanced: false
          });
        }
      }
    } else {
      // No hay items faltantes
      for (const it of items) {
        enriched.push({ 
          amount: it.amount, 
          category: it.category || 'Sin clasificar', 
          merchant: it.merchant,
          aiEnhanced: false
        });
      }
    }
  } else {
    // No clasificar faltantes
    for (const it of items) {
      enriched.push({ 
        amount: it.amount, 
        category: it.category || 'Sin clasificar', 
        merchant: it.merchant,
        aiEnhanced: false
      });
    }
  }

  // 2) Agregados
  let totalIncome = 0, totalExpense = 0;
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  let aiEnhancedCount = 0;

  for (const it of enriched) {
    if (it.amount >= 0) totalIncome += it.amount;
    else totalExpense += it.amount;

    byCategory.set(it.category, (byCategory.get(it.category) ?? 0) + it.amount);
    if (it.merchant) {
      byMerchant.set(it.merchant, (byMerchant.get(it.merchant) ?? 0) + it.amount);
    }
    if (it.aiEnhanced) aiEnhancedCount++;
  }

  const net = totalIncome + totalExpense;
  const catArr = Array.from(byCategory.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a,b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 8);

  const merchArr = Array.from(byMerchant.entries())
    .map(([merchant, total]) => ({ merchant, total }))
    .sort((a,b) => Math.abs(b.total) - Math.abs(a.total))
    .slice(0, 8);

  // 3) Sugerencias inteligentes mejoradas
  const tips: string[] = [];
  const totalAbs = Math.abs(totalExpense) + Math.abs(totalIncome);

  // Análisis de transporte
  const transporteCats = catArr.filter(c =>
    c.category.toLowerCase().includes('transporte')
  );
  const transporteTotal = transporteCats.reduce((acc, c) => acc + c.total, 0);
  if (Math.abs(transporteTotal) > 0.3 * Math.abs(totalExpense)) {
    tips.push('Tu gasto en Transporte es alto este período (>30% de los egresos). Considerá optimizar traslados.');
  }

  // Análisis de suscripciones
  const subCandidates = merchArr.filter(m => /netflix|spotify|disney|youtube/i.test(m.merchant ?? ''));
  if (subCandidates.length >= 2) tips.push('Detectamos múltiples suscripciones. Revisá si las usás todas.');

  // Análisis de balance
  if (net < 0) {
    tips.push('Cerraste el período con balance negativo. Evaluá reducir rubros con mayor peso.');
  } else if (net > totalIncome * 0.3) {
    tips.push('Excelente gestión financiera! Tenés un ahorro considerable este período.');
  }

  // Análisis de IA enhancement
  if (aiEnhancedCount > items.length * 0.5) {
    tips.push(`Se usó IA para categorizar ${aiEnhancedCount} transacciones, mejorando la precisión del análisis.`);
  }

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
    suggestions: tips,
    aiEnhancement: {
      enabled: useAI,
      enhancedTransactions: aiEnhancedCount,
      enhancementRate: Number((aiEnhancedCount / items.length * 100).toFixed(1))
    }
  });
});

/** POST /ai/analyze-patterns - Análisis de patrones de gasto */
r.post('/analyze-patterns', async (req, res) => {
  const { items, timeframe = 'month' } = req.body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ ok:false, error:'Se requiere un array de transacciones' });
  }

  // Análisis básico de patrones
  const patterns = {
    spendingByDay: new Map<string, number>(),
    spendingByCategory: new Map<string, number>(),
    recurringMerchants: new Map<string, number>(),
    averageTransaction: 0,
    totalTransactions: items.length
  };

  let totalAmount = 0;
  
  for (const item of items) {
    if (item.amount < 0) { // Solo gastos
      totalAmount += Math.abs(item.amount);
      
      // Por día de la semana (simplificado)
      const day = item.when ? new Date(item.when).getDay() : 0;
      patterns.spendingByDay.set(String(day), (patterns.spendingByDay.get(String(day)) || 0) + Math.abs(item.amount));
      
      // Por categoría
      const category = item.category || 'Sin clasificar';
      patterns.spendingByCategory.set(category, (patterns.spendingByCategory.get(category) || 0) + Math.abs(item.amount));
      
      // Comercios recurrentes
      if (item.merchant) {
        patterns.recurringMerchants.set(item.merchant, (patterns.recurringMerchants.get(item.merchant) || 0) + 1);
      }
    }
  }

  patterns.averageTransaction = items.length > 0 ? totalAmount / items.length : 0;

  // Convertir Maps a arrays para respuesta
  const response = {
    ok: true,
    timeframe,
    analysis: {
      totalSpending: Number(totalAmount.toFixed(2)),
      averageTransaction: Number(patterns.averageTransaction.toFixed(2)),
      totalTransactions: patterns.totalTransactions,
      topSpendingDays: Array.from(patterns.spendingByDay.entries())
        .map(([day, amount]) => ({ day, amount: Number(amount.toFixed(2)) }))
        .sort((a, b) => b.amount - a.amount),
      topCategories: Array.from(patterns.spendingByCategory.entries())
        .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
        .sort((a, b) => b.amount - a.amount),
      recurringMerchants: Array.from(patterns.recurringMerchants.entries())
        .map(([merchant, count]) => ({ merchant, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    }
  };

  return res.json(response);
});

export default r;