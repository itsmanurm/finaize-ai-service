/**
 * Sistema completo de análisis de perfil financiero
 * Identifica patrones, comportamientos y genera recomendaciones personalizadas
 */

export interface Transaction {
  amount: number;
  type: 'income' | 'expense';
  category: string;
  merchant?: string;
  date: string;
  account?: string;
  paymentMethod?: string;
}

export interface Budget {
  category: string;
  amount: number;
  month: number;
  year: number;
}

export interface Goal {
  description: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  currency?: 'ARS' | 'USD';
}

export interface FinancialProfileInput {
  transactions: Transaction[];
  budgets?: Budget[];
  goals?: Goal[];
  timeframeMonths?: number; // Análisis de últimos X meses (default: 6)
}

export interface FinancialProfile {
  // Identificación del perfil
  profileType: 'Ahorrador' | 'Equilibrado' | 'Gastador' | 'Impulsivo' | 'Planificador';
  profileDescription: string;
  
  // Scoring de salud financiera (0-100)
  healthScore: number;
  healthLevel: 'Excelente' | 'Bueno' | 'Regular' | 'Crítico';
  
  // Métricas clave
  metrics: {
    avgMonthlyIncome: number;
    avgMonthlyExpense: number;
    savingsRate: number; // Porcentaje de ahorro
    expenseToIncomeRatio: number;
    volatilityScore: number; // Qué tan variables son los gastos
  };
  
  // Patrones de comportamiento detectados
  patterns: {
    spendingTiming: 'Inicio de mes' | 'Fin de mes' | 'Distribuido' | 'Irregular';
    topCategories: Array<{ category: string; percentage: number; amount: number }>;
    recurringExpenses: Array<{ merchant: string; frequency: string; avgAmount: number }>;
    impulseScore: number; // 0-100, qué tan impulsivo es el gasto
    planningScore: number; // 0-100, qué tan planificado es
    volatilityScore: number; // 0-100, variabilidad de montos
  };
  
  // Hábitos financieros
  habits: {
    usesbudgets: boolean;
    hasGoals: boolean;
    trackingConsistency: number; // 0-100
    categoryDiversity: number; // Qué tan variadas son las categorías
    avgTransactionSize: number;
    largeExpensesCount: number; // Gastos >50% del ingreso promedio
  };
  
  // Capacidad financiera
  capacity: {
    monthlyDisposableIncome: number;
    recommendedSavings: number;
    budgetSuggestion: number;
    emergencyFundStatus: 'Inexistente' | 'Insuficiente' | 'Adecuado' | 'Óptimo';
  };
  
  // Fortalezas y áreas de mejora
  strengths: string[];
  improvements: string[];
  
  // Recomendaciones personalizadas
  recommendations: Array<{
    priority: 'Alta' | 'Media' | 'Baja';
    category: 'Ahorro' | 'Presupuesto' | 'Inversión' | 'Reducción de gastos' | 'Planificación';
    title: string;
    description: string;
    potentialSavings?: number;
  }>;
  
  // Comparación temporal (si hay datos históricos)
  trend?: {
    direction: 'Mejorando' | 'Estable' | 'Empeorando';
    scoreChange: number; // Cambio en el health score
    message: string;
  };
}

/**
 * Analiza el perfil financiero completo del usuario
 */
export function analyzeFinancialProfile(input: FinancialProfileInput): FinancialProfile {
  const { transactions, budgets = [], goals = [], timeframeMonths = 6 } = input;
  
  // Separar ingresos y gastos
  const incomes = transactions.filter(t => t.type === 'income');
  const expenses = transactions.filter(t => t.type === 'expense');
  
  // Calcular métricas básicas
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const avgMonthlyIncome = totalIncome / timeframeMonths;
  const avgMonthlyExpense = totalExpense / timeframeMonths;
  const savingsRate = avgMonthlyIncome > 0 ? ((avgMonthlyIncome - avgMonthlyExpense) / avgMonthlyIncome) * 100 : 0;
  const expenseToIncomeRatio = avgMonthlyIncome > 0 ? (avgMonthlyExpense / avgMonthlyIncome) : 0;
  
  // Detectar patrones de comportamiento
  const patterns = detectSpendingPatterns(expenses);
  
  // Analizar hábitos
  const habits = analyzeHabits(transactions, budgets, goals, avgMonthlyIncome);
  
  // Calcular health score
  const healthScore = calculateHealthScore({
    savingsRate,
    expenseToIncomeRatio,
    volatilityScore: patterns.volatilityScore,
    impulseScore: patterns.impulseScore,
    planningScore: patterns.planningScore,
    usesbudgets: habits.usesbudgets,
    hasGoals: habits.hasGoals,
    trackingConsistency: habits.trackingConsistency
  });
  
  // Clasificar perfil
  const profileType = classifyProfile({
    savingsRate,
    expenseToIncomeRatio,
    impulseScore: patterns.impulseScore,
    planningScore: patterns.planningScore,
    usesbudgets: habits.usesbudgets
  });
  
  // Analizar capacidad financiera
  const capacity = analyzeCapacity(avgMonthlyIncome, avgMonthlyExpense, expenses);
  
  // Generar fortalezas y áreas de mejora
  const { strengths, improvements } = identifyStrengthsAndImprovements({
    savingsRate,
    expenseToIncomeRatio,
    usesbudgets: habits.usesbudgets,
    hasGoals: habits.hasGoals,
    impulseScore: patterns.impulseScore,
    planningScore: patterns.planningScore,
    healthScore
  });
  
  // Generar recomendaciones personalizadas
  const recommendations = generateRecommendations({
    profileType,
    savingsRate,
    expenseToIncomeRatio,
    topCategories: patterns.topCategories,
    avgMonthlyIncome,
    avgMonthlyExpense,
    usesbudgets: habits.usesbudgets,
    hasGoals: habits.hasGoals,
    largeExpensesCount: habits.largeExpensesCount,
    capacity
  });
  
  return {
    profileType,
    profileDescription: getProfileDescription(profileType),
    healthScore: Math.round(healthScore),
    healthLevel: getHealthLevel(healthScore),
    metrics: {
      avgMonthlyIncome: Math.round(avgMonthlyIncome),
      avgMonthlyExpense: Math.round(avgMonthlyExpense),
      savingsRate: Math.round(savingsRate * 10) / 10,
      expenseToIncomeRatio: Math.round(expenseToIncomeRatio * 100) / 100,
      volatilityScore: patterns.volatilityScore
    },
    patterns,
    habits,
    capacity,
    strengths,
    improvements,
    recommendations
  };
}

/**
 * Detecta patrones de gasto temporal y categórico
 */
function detectSpendingPatterns(expenses: Transaction[]): FinancialProfile['patterns'] {
  if (expenses.length === 0) {
    return {
      spendingTiming: 'Irregular',
      topCategories: [],
      recurringExpenses: [],
      impulseScore: 0,
      planningScore: 0,
      volatilityScore: 0
    };
  }
  
  // Análisis temporal: ¿cuándo gasta más?
  const byDayOfMonth = new Map<number, number>();
  expenses.forEach(t => {
    const day = new Date(t.date).getDate();
    byDayOfMonth.set(day, (byDayOfMonth.get(day) || 0) + Math.abs(t.amount));
  });
  
  const firstWeekTotal = Array.from({ length: 10 }, (_, i) => byDayOfMonth.get(i + 1) || 0).reduce((a, b) => a + b, 0);
  const lastWeekTotal = Array.from({ length: 10 }, (_, i) => byDayOfMonth.get(21 + i) || 0).reduce((a, b) => a + b, 0);
  const totalExpense = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  let spendingTiming: FinancialProfile['patterns']['spendingTiming'] = 'Distribuido';
  if (firstWeekTotal > totalExpense * 0.4) spendingTiming = 'Inicio de mes';
  else if (lastWeekTotal > totalExpense * 0.4) spendingTiming = 'Fin de mes';
  else if (Math.abs(firstWeekTotal - lastWeekTotal) < totalExpense * 0.1) spendingTiming = 'Distribuido';
  else spendingTiming = 'Irregular';
  
  // Top categorías
  const byCategory = new Map<string, number>();
  expenses.forEach(t => {
    const cat = t.category || 'Sin categoría';
    byCategory.set(cat, (byCategory.get(cat) || 0) + Math.abs(t.amount));
  });
  
  const topCategories = Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount),
      percentage: Math.round((amount / totalExpense) * 1000) / 10
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  
  // Gastos recurrentes (mismo merchant repetido)
  const merchantFrequency = new Map<string, { count: number; total: number }>();
  expenses.forEach(t => {
    if (t.merchant) {
      const existing = merchantFrequency.get(t.merchant) || { count: 0, total: 0 };
      merchantFrequency.set(t.merchant, {
        count: existing.count + 1,
        total: existing.total + Math.abs(t.amount)
      });
    }
  });
  
  const recurringExpenses = Array.from(merchantFrequency.entries())
    .filter(([_, data]) => data.count >= 3)
    .map(([merchant, data]) => ({
      merchant,
      frequency: data.count >= 10 ? 'Muy frecuente' : data.count >= 5 ? 'Frecuente' : 'Ocasional',
      avgAmount: Math.round(data.total / data.count)
    }))
    .sort((a, b) => b.avgAmount - a.avgAmount)
    .slice(0, 5);
  
  // Impulse score: gastos pequeños y frecuentes sugieren compras impulsivas
  const smallExpenses = expenses.filter(t => Math.abs(t.amount) < totalExpense / expenses.length / 2);
  const impulseScore = Math.min(100, Math.round((smallExpenses.length / expenses.length) * 100));
  
  // Planning score: gastos grandes y poco frecuentes sugieren planificación
  const largeExpenses = expenses.filter(t => Math.abs(t.amount) > totalExpense / expenses.length * 2);
  const planningScore = Math.min(100, Math.round((largeExpenses.length / expenses.length) * 100 * 3));
  
  // Volatilidad: qué tan variables son los montos
  const amounts = expenses.map(t => Math.abs(t.amount));
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, amt) => sum + Math.pow(amt - avgAmount, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  const volatilityScore = Math.min(100, Math.round((stdDev / avgAmount) * 100));
  
  return {
    spendingTiming,
    topCategories,
    recurringExpenses,
    impulseScore,
    planningScore,
    volatilityScore: Math.round(volatilityScore)
  };
}

/**
 * Analiza hábitos financieros del usuario
 */
function analyzeHabits(
  transactions: Transaction[],
  budgets: Budget[],
  goals: Goal[],
  avgMonthlyIncome: number
): FinancialProfile['habits'] {
  const expenses = transactions.filter(t => t.type === 'expense');
  
  // Consistencia de tracking: ¿registra transacciones regularmente?
  const datesSet = new Set(transactions.map(t => t.date.split('T')[0]));
  const uniqueDays = datesSet.size;
  const daysSinceFirst = transactions.length > 0 
    ? Math.ceil((new Date().getTime() - new Date(transactions[0].date).getTime()) / (1000 * 60 * 60 * 24))
    : 1;
  const trackingConsistency = Math.min(100, Math.round((uniqueDays / daysSinceFirst) * 100 * 3));
  
  // Diversidad de categorías
  const categories = new Set(expenses.map(t => t.category).filter(Boolean));
  const categoryDiversity = Math.min(100, categories.size * 10);
  
  // Promedio de transacción
  const avgTransactionSize = expenses.length > 0
    ? Math.round(expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0) / expenses.length)
    : 0;
  
  // Gastos grandes (>50% del ingreso promedio)
  const largeExpensesCount = expenses.filter(t => Math.abs(t.amount) > avgMonthlyIncome * 0.5).length;
  
  return {
    usesbudgets: budgets.length > 0,
    hasGoals: goals.length > 0,
    trackingConsistency,
    categoryDiversity,
    avgTransactionSize,
    largeExpensesCount
  };
}

/**
 * Calcula el health score (0-100)
 */
function calculateHealthScore(params: {
  savingsRate: number;
  expenseToIncomeRatio: number;
  volatilityScore: number;
  impulseScore: number;
  planningScore: number;
  usesbudgets: boolean;
  hasGoals: boolean;
  trackingConsistency: number;
}): number {
  let score = 50; // Base
  
  // Savings rate (hasta +30 puntos)
  if (params.savingsRate >= 30) score += 30;
  else if (params.savingsRate >= 20) score += 25;
  else if (params.savingsRate >= 10) score += 15;
  else if (params.savingsRate >= 5) score += 5;
  else if (params.savingsRate < 0) score -= 20;
  
  // Expense to income ratio (hasta +20 puntos o -20)
  if (params.expenseToIncomeRatio <= 0.7) score += 20;
  else if (params.expenseToIncomeRatio <= 0.85) score += 10;
  else if (params.expenseToIncomeRatio >= 1.2) score -= 20;
  else if (params.expenseToIncomeRatio >= 1.0) score -= 10;
  
  // Planning vs Impulse (hasta +15 puntos)
  if (params.planningScore > params.impulseScore + 20) score += 15;
  else if (params.planningScore > params.impulseScore) score += 10;
  else if (params.impulseScore > params.planningScore + 30) score -= 15;
  
  // Uso de herramientas (+10 puntos por budgets, +10 por goals)
  if (params.usesbudgets) score += 10;
  if (params.hasGoals) score += 10;
  
  // Consistencia (+5 puntos)
  if (params.trackingConsistency >= 50) score += 5;
  
  // Volatilidad (-10 si es muy alta)
  if (params.volatilityScore > 80) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Clasifica el tipo de perfil del usuario
 */
function classifyProfile(params: {
  savingsRate: number;
  expenseToIncomeRatio: number;
  impulseScore: number;
  planningScore: number;
  usesbudgets: boolean;
}): FinancialProfile['profileType'] {
  // Ahorrador: alta tasa de ahorro y control
  if (params.savingsRate >= 20 && params.expenseToIncomeRatio <= 0.8) {
    return 'Ahorrador';
  }
  
  // Planificador: usa presupuestos, planifica gastos
  if (params.usesbudgets && params.planningScore > params.impulseScore + 20) {
    return 'Planificador';
  }
  
  // Impulsivo: gastos frecuentes pequeños, poco control
  if (params.impulseScore > 70 && !params.usesbudgets) {
    return 'Impulsivo';
  }
  
  // Gastador: gasta casi todo o más de lo que ingresa
  if (params.expenseToIncomeRatio >= 1.0) {
    return 'Gastador';
  }
  
  // Default: Equilibrado
  return 'Equilibrado';
}

/**
 * Obtiene descripción del perfil
 */
function getProfileDescription(type: FinancialProfile['profileType']): string {
  const descriptions = {
    'Ahorrador': 'Tienes un excelente control de tus finanzas y priorizas el ahorro. Mantienes tus gastos bajo control y piensas en el futuro.',
    'Equilibrado': 'Mantienes un balance saludable entre gastos y ahorro. Tienes espacio para mejorar, pero vas por buen camino.',
    'Gastador': 'Tus gastos están cerca o superan tus ingresos. Es momento de revisar tus hábitos y buscar áreas donde reducir.',
    'Impulsivo': 'Realizas muchas compras pequeñas sin planificación. Considera usar presupuestos para tener mayor control.',
    'Planificador': 'Planificas tus gastos con anticipación y usas herramientas para mantener el control. ¡Excelente gestión financiera!'
  };
  return descriptions[type];
}

/**
 * Obtiene nivel de salud basado en score
 */
function getHealthLevel(score: number): FinancialProfile['healthLevel'] {
  if (score >= 80) return 'Excelente';
  if (score >= 60) return 'Bueno';
  if (score >= 40) return 'Regular';
  return 'Crítico';
}

/**
 * Analiza capacidad financiera
 */
function analyzeCapacity(
  avgMonthlyIncome: number,
  avgMonthlyExpense: number,
  expenses: Transaction[]
): FinancialProfile['capacity'] {
  const monthlyDisposableIncome = Math.max(0, avgMonthlyIncome - avgMonthlyExpense);
  const recommendedSavings = avgMonthlyIncome * 0.2; // 20% del ingreso
  const budgetSuggestion = avgMonthlyIncome * 0.75; // 75% para gastos
  
  // Emergency fund: 3-6 meses de gastos
  const emergencyFundNeeded = avgMonthlyExpense * 3;
  let emergencyFundStatus: FinancialProfile['capacity']['emergencyFundStatus'] = 'Inexistente';
  
  if (monthlyDisposableIncome >= emergencyFundNeeded / 6) emergencyFundStatus = 'Óptimo';
  else if (monthlyDisposableIncome >= emergencyFundNeeded / 12) emergencyFundStatus = 'Adecuado';
  else if (monthlyDisposableIncome > 0) emergencyFundStatus = 'Insuficiente';
  
  return {
    monthlyDisposableIncome: Math.round(monthlyDisposableIncome),
    recommendedSavings: Math.round(recommendedSavings),
    budgetSuggestion: Math.round(budgetSuggestion),
    emergencyFundStatus
  };
}

/**
 * Identifica fortalezas y áreas de mejora
 */
function identifyStrengthsAndImprovements(params: {
  savingsRate: number;
  expenseToIncomeRatio: number;
  usesbudgets: boolean;
  hasGoals: boolean;
  impulseScore: number;
  planningScore: number;
  healthScore: number;
}): { strengths: string[]; improvements: string[] } {
  const strengths: string[] = [];
  const improvements: string[] = [];
  
  // Fortalezas
  if (params.savingsRate >= 15) strengths.push('Excelente capacidad de ahorro');
  if (params.expenseToIncomeRatio <= 0.8) strengths.push('Control efectivo de gastos');
  if (params.usesbudgets) strengths.push('Uso activo de presupuestos');
  if (params.hasGoals) strengths.push('Tienes metas financieras definidas');
  if (params.planningScore > params.impulseScore + 20) strengths.push('Alta capacidad de planificación');
  if (params.healthScore >= 80) strengths.push('Salud financiera sobresaliente');
  
  // Áreas de mejora
  if (params.savingsRate < 5) improvements.push('Aumentar tu tasa de ahorro mensual');
  if (params.expenseToIncomeRatio >= 1.0) improvements.push('Reducir gastos para evitar déficit');
  if (!params.usesbudgets) improvements.push('Implementar presupuestos mensuales');
  if (!params.hasGoals) improvements.push('Establecer metas financieras claras');
  if (params.impulseScore > 70) improvements.push('Controlar compras impulsivas');
  if (params.healthScore < 40) improvements.push('Revisar urgentemente tus hábitos financieros');
  
  if (strengths.length === 0) strengths.push('Estás comenzando a tomar control de tus finanzas');
  if (improvements.length === 0) improvements.push('Mantener los buenos hábitos actuales');
  
  return { strengths, improvements };
}

/**
 * Genera recomendaciones personalizadas
 */
function generateRecommendations(params: {
  profileType: FinancialProfile['profileType'];
  savingsRate: number;
  expenseToIncomeRatio: number;
  topCategories: Array<{ category: string; percentage: number; amount: number }>;
  avgMonthlyIncome: number;
  avgMonthlyExpense: number;
  usesbudgets: boolean;
  hasGoals: boolean;
  largeExpensesCount: number;
  capacity: FinancialProfile['capacity'];
}): FinancialProfile['recommendations'] {
  const recommendations: FinancialProfile['recommendations'] = [];
  
  // Recomendación #1: Ahorro (siempre relevante)
  if (params.savingsRate < 10) {
    recommendations.push({
      priority: 'Alta',
      category: 'Ahorro',
      title: 'Establece un fondo de ahorro automático',
      description: `Intenta ahorrar al menos el 10% de tus ingresos mensuales (${Math.round(params.avgMonthlyIncome * 0.1)} ARS). Configura una transferencia automática el día que cobras.`,
      potentialSavings: Math.round(params.avgMonthlyIncome * 0.1)
    });
  } else if (params.savingsRate < 20) {
    recommendations.push({
      priority: 'Media',
      category: 'Ahorro',
      title: 'Aumenta tu tasa de ahorro',
      description: `Estás ahorrando bien, pero podrías llegar al 20% recomendado (${Math.round(params.avgMonthlyIncome * 0.2)} ARS). Analiza gastos no esenciales que puedas reducir.`,
      potentialSavings: Math.round(params.avgMonthlyIncome * 0.2 - params.avgMonthlyIncome * params.savingsRate / 100)
    });
  }
  
  // Recomendación #2: Reducción en categoría principal
  if (params.topCategories.length > 0 && params.topCategories[0].percentage > 30) {
    const topCat = params.topCategories[0];
    recommendations.push({
      priority: 'Alta',
      category: 'Reducción de gastos',
      title: `Optimiza gastos en ${topCat.category}`,
      description: `Esta categoría representa el ${topCat.percentage}% de tus gastos (${topCat.amount} ARS). Reducir un 20% te ahorraría ${Math.round(topCat.amount * 0.2)} ARS mensuales.`,
      potentialSavings: Math.round(topCat.amount * 0.2)
    });
  }
  
  // Recomendación #3: Presupuestos
  if (!params.usesbudgets) {
    recommendations.push({
      priority: 'Alta',
      category: 'Presupuesto',
      title: 'Crea presupuestos mensuales',
      description: 'Establece límites de gasto por categoría. Te ayudará a tener mayor control y evitar sorpresas a fin de mes.',
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.15)
    });
  }
  
  // Recomendación #4: Metas
  if (!params.hasGoals) {
    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Define metas financieras',
      description: 'Establece objetivos concretos (viaje, fondo de emergencia, inversión). Las metas claras aumentan la motivación para ahorrar.',
    });
  }
  
  // Recomendación #5: Fondo de emergencia
  if (params.capacity.emergencyFundStatus === 'Inexistente' || params.capacity.emergencyFundStatus === 'Insuficiente') {
    recommendations.push({
      priority: 'Alta',
      category: 'Ahorro',
      title: 'Construye un fondo de emergencia',
      description: `Busca tener al menos 3 meses de gastos guardados (${Math.round(params.avgMonthlyExpense * 3)} ARS). Empieza con ${Math.round(params.avgMonthlyExpense * 0.3)} ARS mensuales.`,
      potentialSavings: Math.round(params.avgMonthlyExpense * 3)
    });
  }
  
  // Recomendación #6: Gastos grandes
  if (params.largeExpensesCount > 2) {
    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Planifica gastos grandes con anticipación',
      description: `Detectamos ${params.largeExpensesCount} gastos grandes. Considera separarlos en cuotas o ahorrar con anticipación para evitar impacto en tu presupuesto.`
    });
  }
  
  // Recomendación #7: Inversión (para perfiles con buen ahorro)
  if (params.savingsRate >= 20 && params.capacity.monthlyDisposableIncome > 50000) {
    recommendations.push({
      priority: 'Baja',
      category: 'Inversión',
      title: 'Considera opciones de inversión',
      description: 'Con tu capacidad de ahorro actual, podrías invertir una parte en instrumentos de bajo riesgo como plazos fijos o fondos comunes.',
    });
  }
  
  // Recomendación #8: Control de impulsos (para perfiles impulsivos)
  if (params.profileType === 'Impulsivo') {
    recommendations.push({
      priority: 'Alta',
      category: 'Reducción de gastos',
      title: 'Implementa la regla de las 24 horas',
      description: 'Antes de compras no esenciales, espera 24 horas. Esto reduce compras impulsivas hasta en un 40%.',
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.15)
    });
  }
  
  // Ordenar por prioridad
  const priorityOrder = { 'Alta': 1, 'Media': 2, 'Baja': 3 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * Genera un resumen en texto del perfil (para el chat)
 */
export function formatProfileForChat(profile: FinancialProfile): string {
  let message = `📊 **Tu Perfil Financiero**\n\n`;
  
  message += `🎯 **Perfil: ${profile.profileType}**\n`;
  message += `${profile.profileDescription}\n\n`;
  
  message += `💯 **Salud Financiera: ${profile.healthScore}/100 (${profile.healthLevel})**\n\n`;
  
  message += `📈 **Métricas Clave:**\n`;
  message += `• Ingreso promedio mensual: $${profile.metrics.avgMonthlyIncome.toLocaleString('es-AR')}\n`;
  message += `• Gasto promedio mensual: $${profile.metrics.avgMonthlyExpense.toLocaleString('es-AR')}\n`;
  message += `• Tasa de ahorro: ${profile.metrics.savingsRate}%\n`;
  message += `• Relación gasto/ingreso: ${(profile.metrics.expenseToIncomeRatio * 100).toFixed(0)}%\n\n`;
  
  if (profile.strengths.length > 0) {
    message += `✅ **Fortalezas:**\n`;
    profile.strengths.forEach(s => message += `• ${s}\n`);
    message += `\n`;
  }
  
  if (profile.improvements.length > 0) {
    message += `⚠️ **Áreas de Mejora:**\n`;
    profile.improvements.forEach(i => message += `• ${i}\n`);
    message += `\n`;
  }
  
  message += `💡 **Top 3 Recomendaciones:**\n`;
  profile.recommendations.slice(0, 3).forEach((r, i) => {
    message += `${i + 1}. **${r.title}** (${r.priority})\n`;
    message += `   ${r.description}\n`;
    if (r.potentialSavings) {
      message += `   💰 Ahorro potencial: $${r.potentialSavings.toLocaleString('es-AR')}\n`;
    }
    message += `\n`;
  });
  
  message += `\n💬 Preguntame más sobre cualquier aspecto de tu perfil financiero!`;
  
  return message;
}
