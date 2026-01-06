// Acción mock: consulta de mercado/inversión
export async function queryMarketInfo(payload: { activo?: string; period?: string; tipo?: string }) {
  // Simulación de respuesta para CEDEARs, acciones, criptos
  if (payload.activo === 'cedear') {
    return {
      ok: true,
      activos: [
        { nombre: 'Apple (AAPL)', variacion: '+2.1%', precio: 180 },
        { nombre: 'Mercado Libre (MELI)', variacion: '+1.8%', precio: 1450 },
        { nombre: 'Tesla (TSLA)', variacion: '+2.5%', precio: 240 }
      ],
      periodo: payload.period || 'hoy',
      tipo: payload.tipo || 'mejores'
    };
  }
  if (payload.activo === 'criptomoneda') {
    return {
      ok: true,
      activos: [
        { nombre: 'Bitcoin', variacion: '+5.2%', precio: 65000 },
        { nombre: 'Ethereum', variacion: '+3.8%', precio: 3400 }
      ],
      periodo: payload.period || 'semana',
      tipo: payload.tipo || 'subiendo'
    };
  }
  if (payload.activo === 'acción') {
    return {
      ok: true,
      activos: [
        { nombre: 'Globant', variacion: '+4.1%', precio: 210 },
        { nombre: 'YPF', variacion: '+2.9%', precio: 12 }
      ],
      periodo: payload.period || 'mes',
      tipo: payload.tipo || 'recomendación'
    };
  }
  return { ok: false, activos: [], periodo: payload.period, tipo: payload.tipo };
}

/**
 * Acción: Consultar cotizaciones del dólar
 * Llama al backend de Finaize que usa dolarapi.com
 */
export async function actionQueryDollar() {
  try {
    // URL del backend - usar variable de entorno o fallback
    const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
    const response = await fetch(`${backendUrl}/api/investments/market/exchange-rates`);
    
    if (!response.ok) {
      console.error('[actionQueryDollar] Backend error:', response.status);
      return { ok: false, error: 'Error al obtener cotizaciones', rates: [] };
    }
    
    const rates = await response.json();
    
    // Formatear las cotizaciones para respuesta amigable
    const formattedRates = rates.map((r: any) => ({
      nombre: r.nombre || r.casa || r.moneda,
      compra: r.compra,
      venta: r.venta,
      fechaActualizacion: r.fechaActualizacion
    }));
    
    return { 
      ok: true, 
      rates: formattedRates,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('[actionQueryDollar] Error:', error.message);
    return { ok: false, error: error.message, rates: [] };
  }
}
// Helper de normalización reutilizable
function normalize(str: string = '') {
  return String(str)
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/\s+/g, '');
}

// Acción: obtener los mayores gastos (extraída a función para evitar side-effects en top-level)
export async function queryTopExpenses(payload: { year?: number; month?: number } = {}) {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(process.cwd(), 'data', 'transactions.jsonl');
  let lines: any[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    lines = raw.split('\n').filter(Boolean).map((l: string) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { }

  // Filtrar por mes/año
  let filtered = lines as any[];
  if (payload?.year) {
    const yearStr = payload.year.toString();
    filtered = filtered.filter((it: any) => {
      const d = it.date || it.ts;
      return d && d.startsWith(yearStr);
    });
  }
  if (payload?.month) {
    const monthNum = payload.month;
    filtered = filtered.filter((it: any) => {
      const d = it.date || it.ts;
      const m = d ? Number(d.split('-')[1]) : null;
      return m === monthNum;
    });
  }

  // Solo gastos (monto positivo)
  filtered = filtered.filter((it: any) => Number(it.amount) > 0);
  // Ordenar por monto descendente y tomar top 3
  const top = filtered.sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0)).slice(0, 3);
  return {
    ok: true,
    topExpenses: top,
    count: top.length,
    filtro: { year: payload.year, month: payload.month }
  };
}
import { appendJsonl } from '../utils/jsonl';
import { categorize } from './enhanced-service';

export async function actionAddExpense(payload: { amount: number; currency?: string; merchant?: string; description?: string; when?: string; account?: string; paymentMethod?: string }, persist = true) {
  const { amount, currency = 'ARS', merchant, description, when, paymentMethod } = payload;
  
  // Resolve account based on currency
  let account = payload.account || 'Efectivo';
  if (currency === 'USD' && account.toLowerCase() === 'efectivo') {
    account = 'Efectivo USD';
  }

  const categorized = await categorize({ description: description || '', merchant, amount, currency: currency as any });

  const record = {
    ts: new Date().toISOString(),
    amount,
    currency,
    merchant: merchant || '',
    description: description || '',
    category: categorized.category,
    account: account, 
    paymentMethod: paymentMethod || 'efectivo',
    confidence: categorized.confidence,
    dedupHash: categorized.dedupHash
  };

  if (persist) {
    try {
      await appendJsonl('transactions.jsonl', record);
    } catch (err) {
      console.warn('Failed to persist transaction locally:', (err as any)?.message || err);
    }
  }

  return { ok: true, record };
}

export async function actionQuerySummary(payload: { items?: any[]; classifyMissing?: boolean; currency?: string; periodLabel?: string; category?: string; merchant?: string; year?: number; month?: number }) {
  // Leer historial de transacciones
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(process.cwd(), 'data', 'transactions.jsonl');
  let lines: any[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    lines = raw.split('\n').filter(Boolean).map((l: string) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { }

  // Filtrar por entidades
  let filtered: any[] = lines;
  if (payload.category) {
    const catNorm = (payload.category || '').toLowerCase().replace(/\s+/g, '');
    filtered = filtered.filter((it: any) => (it.category || '').toLowerCase().replace(/\s+/g, '').includes(catNorm));
  }
  if (payload.merchant) {
    console.log('[Filtro merchant] valor recibido:', payload.merchant);
    const merchNorm = normalize(payload.merchant || '');
    console.error('[Filtro merchant] buscando:', merchNorm);
    filtered = filtered.filter((it: any) => {
      const normHist = normalize(it.merchant || '');
      const match = normHist.includes(merchNorm);
      if (match) console.error('[Filtro merchant] match:', normHist, '<->', merchNorm);
      return match;
    });
  }
  if (payload.year) {
    const yearStr = payload.year.toString();
    filtered = filtered.filter((it: any) => {
      const d = it.date || it.ts;
      return d && d.startsWith(yearStr);
    });
  }
  if (payload.month) {
    const monthNum = payload.month;
    filtered = filtered.filter((it: any) => {
      const d = it.date || it.ts;
      const m = d ? Number(d.split('-')[1]) : null;
      return m === monthNum;
    });
  }

  let totalIncome = 0, totalExpense = 0;
  // Si la categoría es transferencia, sumar todos los montos filtrados por merchant y categoría
  if (payload.category && normalize(payload.category) === 'transferencia') {
    totalExpense = filtered
      .filter(it => normalize(it.category || '') === normalize('transferencia'))
      .reduce((acc, it) => acc + (Number(it.amount) || 0), 0);
  } else {
    for (const it of filtered) {
      if (it.amount >= 0) totalIncome += it.amount;
      else totalExpense += it.amount;
    }
  }
  return {
    ok: true,
    totals: { income: totalIncome, expense: totalExpense, net: totalIncome + totalExpense },
    count: filtered.length,
    filtro: { categoria: payload.category, merchant: payload.merchant, year: payload.year, month: payload.month }
  };
}
