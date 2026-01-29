const buildBearer = (token: string) => token.startsWith('Bearer ') ? token : `Bearer ${token}`;

// Acción real: consulta de mercado/inversión usando Backend
export async function queryMarketInfo(payload: { activo?: string; period?: string; tipo?: string }) {
  const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
  let tickers: string[] = [];

  const activo = normalize(payload.activo);

  if (activo.includes('cedear') || activo.includes('accion')) {
    tickers = ['AAPL', 'MELI', 'TSLA', 'GGAL', 'YPF'];
  } else if (activo.includes('cripto')) {
    tickers = ['BTC', 'ETH']; // Backend handles crypto via dedicated service or mapping
    // Note: If backend doesn't support bare "BTC", we might need to adjust. 
    // Assuming backend investment controller handles standard tickers.
  } else {
    // Default mixed
    tickers = ['AAPL', 'BTC', 'MELI'];
  }

  try {
    const promises = tickers.map(async t => {
      try {
        const res = await fetch(`${backendUrl}/api/investments/quote/${t}`);
        if (res.ok) return await res.json();
        return null;
      } catch (e) { return null; }
    });

    const results = (await Promise.all(promises)).filter(Boolean);

    // Map backend format to AI response expectation
    const activos = results.map((r: any) => ({
      nombre: r.symbol || r.name, // Adjust based on actual backend response
      variacion: r.changePercent ? `${r.changePercent.toFixed(2)}%` : '0%',
      precio: r.price || 0
    }));

    return {
      ok: true,
      activos,
      periodo: payload.period || 'hoy',
      tipo: payload.tipo || 'cotización'
    };

  } catch (error) {
    console.error('Error fetching market info:', error);
    return { ok: false, error: 'Failed to fetch market data', activos: [] };
  }
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

// Acción real: obtener mayores gastos desde Backend
export async function queryTopExpenses(payload: { year?: number; month?: number; token?: string }) {
  const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
  const { token, year, month } = payload;

  if (!token) {
    return { ok: false, error: 'Authentication required for Top Expenses', topExpenses: [] };
  }

  try {
    // Construct date range for the month
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || (now.getMonth() + 1);

    // Start of month
    const fromDate = new Date(y, m - 1, 1);
    // End of month
    const toDate = new Date(y, m, 0, 23, 59, 59);

    const params = new URLSearchParams({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      transactionType: 'egreso'
    });

    const res = await fetch(`${backendUrl}/api/transactions?${params.toString()}`, {
      headers: { 'Authorization': buildBearer(token) as string }
    });

    if (!res.ok) {
      console.error('[queryTopExpenses] Backend error:', res.status);
      return { ok: false, error: 'Failed to fetch transactions', topExpenses: [] };
    }

    const transactions: any[] = await res.json();

    // Filter and Sort (Backend returns list, we need top 3 by amount)
    // Filter out internal transfers if any remain (backend usually handles this but safety check)
    // And sort desc by amount
    const top = transactions
      .filter(t => t.transactionType === 'egreso' && !t.isInternalTransfer)
      .sort((a: any, b: any) => b.amount - a.amount)
      .slice(0, 3);

    return {
      ok: true,
      topExpenses: top,
      count: top.length,
      filtro: { year, month }
    };

  } catch (error: any) {
    console.error('[queryTopExpenses] Error:', error.message);
    return { ok: false, error: error.message, topExpenses: [] };
  }
}

// Acción real: obtener resumen de gastos desde Backend
export async function querySummary(payload: { items?: any[]; classifyMissing?: boolean; currency?: string; periodLabel?: string; category?: string; merchant?: string; year?: number; month?: number; token?: string }) {
  const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
  const { token, category, merchant, year, month } = payload;

  if (!token) {
    return { ok: false, error: 'Authentication required for Summary', totals: { income: 0, expense: 0, net: 0 } };
  }

  try {
    // Construct date range
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || (now.getMonth() + 1);
    const fromDate = new Date(y, m - 1, 1);
    const toDate = new Date(y, m, 0, 23, 59, 59);

    const params = new URLSearchParams({
      from: fromDate.toISOString(),
      to: toDate.toISOString()
    });

    if (category) params.append('category', category);
    if (merchant) params.append('q', merchant); // Use q for merchant search as approx

    // Fetch transactions to calculate totals
    // Ideally we would use a summary endpoint, but /api/dashboard/summary logic might be different or fixed to specific views.
    // Calculating from raw list ensures consistency with the previous "mock" logic which filtered the raw list.
    const res = await fetch(`${backendUrl}/api/transactions?${params.toString()}`, {
      headers: { 'Authorization': buildBearer(token) as string }
    });

    if (!res.ok) {
      console.error('[querySummary] Backend error:', res.status);
      return { ok: false, error: 'Failed to fetch data for summary' };
    }

    const transactions: any[] = await res.json();

    let totalIncome = 0, totalExpense = 0;

    // Logic: 
    // If category is 'transferencia', sum all as expense? or split?
    // Previous logic: if cat==transferencia, sum as expense.
    const isTransferCat = category && normalize(category) === 'transferencia';

    if (isTransferCat) {
      totalExpense = transactions
        .filter(t => normalize((t.category || {}).name || t.category || '') === 'transferencia')
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    } else {
      for (const t of transactions) {
        // Exclude internal transfers 
        if (t.isInternalTransfer === true) continue;

        const val = Number(t.amount) || 0;
        const type = t.transactionType; // 'ingreso', 'egreso'

        if (type === 'ingreso' || (val < 0 && !type)) {
          totalIncome += Math.abs(val);
        } else if (type === 'egreso' || (val > 0 && !type)) {
          totalExpense += Math.abs(val);
        }
      }
    }

    return {
      ok: true,
      totals: { income: totalIncome, expense: totalExpense, net: totalIncome - totalExpense }, // Net logic: Income - Expense? Or Income + Expense (if expense neg)? Usually Income - Expense.
      count: transactions.length,
      filtro: { categoria: category, merchant, year, month }
    };

  } catch (error: any) {
    console.error('[querySummary] Error:', error.message);
    return { ok: false, error: error.message };
  }
}
