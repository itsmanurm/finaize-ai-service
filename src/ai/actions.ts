const buildBearer = (token: string) => token.startsWith('Bearer ') ? token : `Bearer ${token}`;

// Acción real: consulta de mercado/inversión usando Backend
/*
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
*/
export async function queryMarketInfo(payload: any) {
  return { ok: false, error: 'Module disabled' };
}

/**
 * Acción: Consultar cotizaciones del dólar
 * Llama al backend de Finaize que usa dolarapi.com
 */
/*
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
*/
export async function actionQueryDollar() {
  return { ok: false, error: 'Module disabled' };
}

// Acción real: registrar ingreso
export async function actionAddIncome(payload: {
  amount: number;
  account?: string;
  category?: string;
  token?: string;
  year?: number;
  month?: number;
  day?: number;
  date?: string; // ISO or YYYY-MM-DD
}) {
  const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
  const { amount, account, token, category, year, month, day, date } = payload;

  if (!token) return { ok: false, error: 'Auth required' };
  if (!amount) return { ok: false, error: 'Monto requerido' };

  try {
    // 1. Get Accounts to validate or specific account
    const accountsRes = await fetch(`${backendUrl}/api/accounts`, {
      headers: { 'Authorization': buildBearer(token) }
    });
    const accounts = await accountsRes.json();

    let targetAccount = null;
    if (account) {
      targetAccount = accounts.find((a: any) =>
        a.name.toLowerCase().includes(account.toLowerCase())
      );
    } else {
      // Default to primary or first
      targetAccount = accounts.find((a: any) => a.primary) || accounts[0];
    }

    if (!targetAccount) {
      // If no account found or ambiguous, arguably we could ask. 
      // For now, if we can't find *any*, error.
      return { ok: false, error: 'No se encontró una cuenta válida.' };
    }

    let when = new Date().toISOString();
    if (date) {
      when = date;
    } else if (year && month) {
      // Construct date. IMPORTANT: We send Y,M,D to backend if possible, or ISO.
      // Backend expects 'when' as ISO usually.
      // If we construct local here, it might be weird. 
      // Let's use the Date constructor but be careful.
      // Ideally, the backend AI controller should receive year/month/day and handle construction.
      // BUT `actions.ts` calls `POST /api/transactions` directly!
      // So we must pass `year`, `month`, `day` in the payload OR a correct `when`.
      // The `transaction.routes.ts` (standard API) expects `when` (usually ISO) or now `YYYY-MM-DD`.

      // Let's rely on the new `Date.UTC(y, m-1, d, 3, 0, 0)` logic we are adding to backend routes.
      // We will send standard ISO if possible, but correctly shifted?
      // Actually, if we pass `year`, `month`, `day`, the backend `POST /api/transactions` 
      // DOES NOT accept separate fields by default (unless we change it, which we plan to do in ai.controller but this is hitting routes!).
      // Wait, `actionAddIncome/Expense` hits `/api/transactions`.
      // The `ai.controller.ts` is ONLY for `/api/ai/chat` flow.
      // THESE actions are tools called by the Agent Runner likely?
      // Or by `enhanced-service`?
      // `enhanced-service` does NOT call these actions.
      // The Agent Runner calls these actions.

      // So:
      // If I call `/api/transactions`, I need to send `when`.
      // If I have Year/Month/Day, I should construct a valid Argentina Midnight ISO here.
      const d = day || 1;
      // Argentina Midnight = 03:00 UTC
      const dateObj = new Date(Date.UTC(year, month - 1, d, 3, 0, 0));
      when = dateObj.toISOString();
    }

    // 2. Create Transaction
    const txPayload = {
      amount: Math.abs(amount),
      description: 'Ingreso registrado por IA',
      category: category || 'Ingresos', // Default category
      account: targetAccount.name,
      transactionType: 'ingreso',
      paymentMethod: 'efectivo', // Default
      when: when, // Explicitly set
      confirmed: true
    };

    const res = await fetch(`${backendUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': buildBearer(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(txPayload)
    });

    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.message || 'Error creating transaction' };
    }

    const record = await res.json();
    return { ok: true, record };

  } catch (err: any) {
    console.error('[actionAddIncome] Error:', err);
    return { ok: false, error: err.message };
  }
}

// Acción real: registrar gasto
export async function actionAddExpense(payload: {
  amount: number;
  account?: string;
  category?: string;
  merchant?: string;
  token?: string;
  year?: number;
  month?: number;
  day?: number;
  date?: string;
}, forceCreation = false) {
  const backendUrl = process.env.FINAIZE_BACKEND_URL || 'http://localhost:3001';
  const { amount, account, token, category, merchant, year, month, day, date } = payload;

  if (!token) return { ok: false, error: 'Auth required' };
  if (!amount) return { ok: false, error: 'Monto requerido' };

  try {
    // 1. Validar cuentas disponibles
    const accountsRes = await fetch(`${backendUrl}/api/accounts`, {
      headers: { 'Authorization': buildBearer(token) }
    });

    if (!accountsRes.ok) return { ok: false, error: 'Error fetching accounts' };

    const accounts = await accountsRes.json();
    if (!accounts || accounts.length === 0) {
      return { ok: false, error: 'No tenés cuentas registradas para asignar el gasto.' };
    }

    // 2. Determinar cuenta
    let targetAccount;

    if (account) {
      // Si el usuario especificó cuenta, buscamos match
      targetAccount = accounts.find((a: any) =>
        a.name.toLowerCase().trim() === account.toLowerCase().trim()
      );

      // Si no hay match exacto, buscamos parcial
      if (!targetAccount) {
        targetAccount = accounts.find((a: any) =>
          a.name.toLowerCase().includes(account.toLowerCase())
        );
      }
    } else if (accounts.length === 1) {
      // Si solo hay una cuenta, usar esa
      targetAccount = accounts[0];
    }

    // 3. Fallback: Si no hay cuenta identificada, pedir al usuario seleccionarla
    if (!targetAccount) {
      return {
        ok: true,
        requiresAccountSelection: true,
        availableAccounts: accounts, // Pasamos la lista para que el usuario elija
        message: `Tengo el gasto de $${amount}, pero ¿a qué cuenta debería cargarlo?`,
        pendingTransaction: payload // Guardamos el payload original para reintentar luego
      };
    }

    let when = new Date().toISOString();
    if (date) {
      when = date;
    } else if (year && month) {
      const d = day || 1;
      // Argentina Midnight = 03:00 UTC
      const dateObj = new Date(Date.UTC(year, month - 1, d, 3, 0, 0));
      when = dateObj.toISOString();
    }

    // 4. Crear Transacción
    const txPayload = {
      amount: Math.abs(amount), // Ensure positive for storage unless logic differs
      description: merchant || category || 'Gasto registrado por IA',
      category: category || 'Sin clasificar',
      account: targetAccount.name,
      accountId: targetAccount._id, // Adding ID helps backend
      transactionType: 'egreso',
      paymentMethod: 'efectivo',
      when: when,
      confirmed: true
    };

    const res = await fetch(`${backendUrl}/api/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': buildBearer(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(txPayload)
    });

    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.message || 'Error creating transaction' };
    }

    const record = await res.json();

    // Warning logic (saldo duplicado/etc handled by backend ideally, or we add warning if response suggests it)
    let warning = '';

    return { ok: true, record, warning };

  } catch (err: any) {
    console.error('[actionAddExpense] Error:', err);
    return { ok: false, error: err.message };
  }
}

// Alias for compatibility if needed, though we export individually
export const actionQuerySummary = querySummary;


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
    // NOTE: Backend already excludes internal transfers (transactionType: 'transferencia')
    // These are normal egreso transactions, possibly with paymentMethod: 'transferencia'
    const top = transactions
      .filter(t => t.transactionType === 'egreso')
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

    // IMPORTANT: Backend already filters out internal transfers (transactionType: 'transferencia')
    // These are normal transactions (ingreso/egreso) that may use paymentMethod: 'transferencia'
    // When user asks "cuánto gasté en transferencias", they mean paymentMethod, not transactionType
    let totalIncome = 0, totalExpense = 0;

    for (const t of transactions) {
      const val = Number(t.amount) || 0;
      const type = t.transactionType; // 'ingreso', 'egreso'

      if (type === 'ingreso' || (val < 0 && !type)) {
        totalIncome += Math.abs(val);
      } else if (type === 'egreso' || (val > 0 && !type)) {
        totalExpense += Math.abs(val);
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
