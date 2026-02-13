/**
 * Sistema completo de análisis de perfil financiero
 * Identifica patrones, comportamientos y genera recomendaciones personalizadas
 */
import { SUSCRIPCIONES } from '../utils/ai-constants';

export interface Transaction {
  amount: number;
  type: 'income' | 'expense';
  category: string;
  merchant?: string;
  date?: string;
  when?: string;
  account?: string;
  paymentMethod?: string;
}

export interface Budget {
  name?: string;
  category: string;
  categories?: string[];
  amount: number;
  month: number;
  year: number;
  currency?: 'ARS' | 'USD';
  autoRenew?: boolean;
  archived?: boolean;
}

export interface Goal {
  description: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  currency?: 'ARS' | 'USD';
}

export interface BudgetCompliance {
  totalBudgets: number;
  activeBudgets: number;        // No archivados
  exceededBudgets: number;      // Over 100%
  nearLimitBudgets: number;     // 80-100%
  healthyBudgets: number;       // <80%
  avgUsagePercent: number;      // Promedio de % usado
  complianceScore: number;      // 0-100 (qué tan bien se cumplen)
  complianceRate: number;       // % de presupuestos respetados (<100%)
  problematicCategories: Array<{
    category: string;
    budgetAmount: number;
    actualSpent: number;
    usagePercent: number;
    suggestion: string;
  }>;
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
    recurringExpenses: Array<{ merchant: string; frequency: string; avgAmount: number; type: string }>;
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

  // Análisis de cumplimiento de presupuestos
  budgetCompliance?: BudgetCompliance;

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

  // Analizar cumplimiento de presupuestos (si tiene presupuestos activos)
  const budgetCompliance = budgets.length > 0
    ? analyzeBudgetCompliance(budgets, expenses, timeframeMonths)
    : undefined;

  // Calcular health score
  const healthScore = calculateHealthScore({
    savingsRate,
    expenseToIncomeRatio,
    volatilityScore: patterns.volatilityScore,
    impulseScore: patterns.impulseScore,
    planningScore: patterns.planningScore,
    usesbudgets: habits.usesbudgets,
    hasGoals: habits.hasGoals,
    trackingConsistency: habits.trackingConsistency,
    budgetComplianceScore: budgetCompliance?.complianceScore
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
    healthScore,
    budgetCompliance
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
    capacity,
    recurringExpenses: patterns.recurringExpenses,
    impulseScore: patterns.impulseScore,
    trackingConsistency: habits.trackingConsistency,
    budgetCompliance
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
    budgetCompliance,
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
    const d = t.when || t.date;
    if (!d) return;
    const day = new Date(d).getDate();
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
    .map(([merchant, data]) => {
      // Check if it's a known subscription
      const isSubscription = SUSCRIPCIONES.some((sub: string) => merchant.toLowerCase().includes(sub.toLowerCase()));
      return {
        merchant,
        frequency: data.count >= 10 ? 'Muy frecuente' : data.count >= 5 ? 'Frecuente' : 'Ocasional',
        avgAmount: Math.round(data.total / data.count),
        type: isSubscription ? 'subscription' : 'habit' // Distinguish type
      };
    })
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
 * Analiza el cumplimiento de presupuestos
 */
function analyzeBudgetCompliance(
  budgets: Budget[],
  expenses: Transaction[],
  timeframeMonths: number
): BudgetCompliance {
  // Filtrar presupuestos no archivados (activos)
  const activeBudgets = budgets.filter(b => !b.archived);

  if (activeBudgets.length === 0) {
    return {
      totalBudgets: budgets.length,
      activeBudgets: 0,
      exceededBudgets: 0,
      nearLimitBudgets: 0,
      healthyBudgets: 0,
      avgUsagePercent: 0,
      complianceScore: 0,
      complianceRate: 0,
      problematicCategories: []
    };
  }

  // Calcular gastos por categoría en el período de cada presupuesto
  const categoryUsage = new Map<string, { budget: Budget; spent: number }>();

  activeBudgets.forEach(budget => {
    const categories = budget.categories && budget.categories.length > 0
      ? budget.categories
      : [budget.category];

    // Filtrar transacciones del mes/año del presupuesto
    const budgetExpenses = expenses.filter(t => {
      const d = t.when || t.date;
      if (!d) return false;
      const date = new Date(d);
      const expenseMonth = date.getMonth() + 1;
      const expenseYear = date.getFullYear();
      return expenseMonth === budget.month && expenseYear === budget.year && categories.includes(t.category);
    });

    const spent = budgetExpenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const key = `${budget.year}-${budget.month}-${categories.join('|')}`;
    categoryUsage.set(key, { budget, spent });
  });

  // Analizar cada presupuesto
  let exceededCount = 0;
  let nearLimitCount = 0;
  let healthyCount = 0;
  let totalUsagePercent = 0;
  const problematic: BudgetCompliance['problematicCategories'] = [];

  categoryUsage.forEach(({ budget, spent }) => {
    const usagePercent = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
    totalUsagePercent += usagePercent;

    if (usagePercent >= 100) {
      exceededCount++;
      problematic.push({
        category: budget.name || budget.category,
        budgetAmount: budget.amount,
        actualSpent: Math.round(spent),
        usagePercent: Math.round(usagePercent),
        suggestion: usagePercent >= 150
          ? 'Exceso crítico: considera revisar tus hábitos de gasto en esta categoría'
          : 'Presupuesto excedido: ajusta el monto o reduce gastos el próximo mes'
      });
    } else if (usagePercent >= 80) {
      nearLimitCount++;
    } else {
      healthyCount++;
    }
  });

  const avgUsagePercent = categoryUsage.size > 0
    ? totalUsagePercent / categoryUsage.size
    : 0;

  const complianceRate = categoryUsage.size > 0
    ? ((categoryUsage.size - exceededCount) / categoryUsage.size) * 100
    : 0;

  // Calcular compliance score (0-100)
  let complianceScore = 50; // Base

  // Bonus por tasa de cumplimiento
  if (complianceRate >= 90) complianceScore += 40;
  else if (complianceRate >= 75) complianceScore += 30;
  else if (complianceRate >= 50) complianceScore += 15;
  else if (complianceRate < 30) complianceScore -= 20;

  // Penalty por uso promedio alto
  if (avgUsagePercent >= 95) complianceScore -= 15;
  else if (avgUsagePercent >= 85) complianceScore -= 5;
  else if (avgUsagePercent < 70) complianceScore += 10;

  complianceScore = Math.max(0, Math.min(100, complianceScore));

  return {
    totalBudgets: budgets.length,
    activeBudgets: activeBudgets.length,
    exceededBudgets: exceededCount,
    nearLimitBudgets: nearLimitCount,
    healthyBudgets: healthyCount,
    avgUsagePercent: Math.round(avgUsagePercent),
    complianceScore: Math.round(complianceScore),
    complianceRate: Math.round(complianceRate),
    problematicCategories: problematic.slice(0, 3) // Top 3 más problemáticos
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
  const datesSet = new Set(transactions.map(t => (t.when || t.date || '').toString().split('T')[0]).filter(Boolean));
  const uniqueDays = datesSet.size;
  const firstDate = transactions.length > 0 ? (transactions[0].when || transactions[0].date) : null;
  const daysSinceFirst = firstDate
    ? Math.max(1, Math.ceil((new Date().getTime() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)))
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
  budgetComplianceScore?: number;
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

  // Uso de herramientas (+5 por budgets, +10 por goals)
  if (params.usesbudgets) score += 5;
  if (params.hasGoals) score += 10;

  // Disciplina presupuestaria (hasta +15 o -15 puntos)
  if (params.budgetComplianceScore !== undefined) {
    if (params.budgetComplianceScore >= 80) score += 15;
    else if (params.budgetComplianceScore >= 60) score += 10;
    else if (params.budgetComplianceScore >= 40) score += 5;
    else if (params.budgetComplianceScore < 30) score -= 15;
    else score -= 5;
  }

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
  budgetCompliance?: BudgetCompliance;
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

  // Fortaleza adicional: buena disciplina presupuestaria
  if (params.budgetCompliance && params.budgetCompliance.complianceRate >= 80) {
    strengths.push('Excelente disciplina en el cumplimiento de presupuestos');
  }

  // Áreas de mejora
  if (params.savingsRate < 5) improvements.push('Aumentar tu tasa de ahorro mensual');
  if (params.expenseToIncomeRatio >= 1.0) improvements.push('Reducir gastos para evitar déficit');
  if (!params.usesbudgets) improvements.push('Implementar presupuestos mensuales');
  if (!params.hasGoals) improvements.push('Establecer metas financieras claras');
  if (params.impulseScore > 70) improvements.push('Controlar compras impulsivas');
  if (params.healthScore < 40) improvements.push('Revisar urgentemente tus hábitos financieros');

  // Mejora adicional: cumplimiento de presupuestos
  if (params.budgetCompliance && params.budgetCompliance.complianceRate < 50) {
    improvements.push('Mejorar el cumplimiento de presupuestos o ajustar montos');
  }

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
  recurringExpenses: FinancialProfile['patterns']['recurringExpenses'];
  impulseScore: number;
  trackingConsistency: number;
  budgetCompliance?: BudgetCompliance;
}): FinancialProfile['recommendations'] {
  const recommendations: FinancialProfile['recommendations'] = [];

  // ----------------------------
  // 0) PRESUPUESTOS - ANÁLISIS DE COMPLIANCE
  // ----------------------------
  if (params.budgetCompliance) {
    const bc = params.budgetCompliance;

    // Si excede muchos presupuestos
    if (bc.exceededBudgets >= 2 && bc.complianceRate < 60) {
      const totalOverage = bc.problematicCategories.reduce(
        (sum, cat) => sum + (cat.actualSpent - cat.budgetAmount),
        0
      );

      recommendations.push({
        priority: 'Alta',
        category: 'Presupuesto',
        title: 'Presupuestos excedidos regularmente',
        description: `Estas excediendo ${bc.exceededBudgets} de ${bc.activeBudgets} presupuestos (${Math.round(bc.complianceRate)}% de cumplimiento). ` +
          `Opciones: 1) Ajusta los montos para ser más realista, 2) Reduce gastos en las categorías problemáticas. ` +
          `Total excedido: ${formatCurrency(Math.round(totalOverage))}.`,
        potentialSavings: Math.round(totalOverage)
      });

      // Recomendaciones específicas por categoría problemática
      bc.problematicCategories.forEach((cat, idx) => {
        if (idx < 2) { // Solo las 2 más problemáticas
          recommendations.push({
            priority: cat.usagePercent >= 150 ? 'Alta' : 'Media',
            category: 'Reducción de gastos',
            title: `Revisa gastos en "${cat.category}"`,
            description: `Gastaste ${formatCurrency(cat.actualSpent)} cuando tu presupuesto era ${formatCurrency(cat.budgetAmount)} (${cat.usagePercent}% de uso). ` +
              cat.suggestion,
            potentialSavings: Math.round(cat.actualSpent - cat.budgetAmount)
          });
        }
      });
    }

    // Si usa presupuestos pero están demasiado holgados
    if (bc.avgUsagePercent < 60 && bc.activeBudgets >= 2) {
      recommendations.push({
        priority: 'Baja',
        category: 'Presupuesto',
        title: 'Presupuestos sobredimensionados',
        description: `Tus presupuestos solo se usan al ${bc.avgUsagePercent}% en promedio. ` +
          `Esto sugiere que son demasiado altos. Considera ajustarlos a montos más realistas o redistribuir ese dinero hacia ahorro.`
      });
    }

    // Si tiene buena disciplina
    if (bc.complianceRate >= 80 && bc.activeBudgets >= 2) {
      recommendations.push({
        priority: 'Baja',
        category: 'Presupuesto',
        title: 'Excelente disciplina presupuestaria',
        description: `Estas cumpliendo ${Math.round(bc.complianceRate)}% de tus presupuestos. ` +
          `Para optimizar tiempo, considera activar la opción de auto-renovación en presupuestos recurrentes.`
      });
    }
  }

  // Si NO usa presupuestos
  if (!params.usesbudgets && params.topCategories.length >= 3) {
    const topCats = params.topCategories.slice(0, 3).map(c => c.category).join(', ');
    const estimatedSavings = Math.round(
      params.topCategories.slice(0, 3).reduce((sum, c) => sum + c.amount, 0) * 0.15
    );

    recommendations.push({
      priority: 'Alta',
      category: 'Presupuesto',
      title: 'Crea presupuestos para tus categorías principales',
      description: `Empezá con 3 presupuestos básicos para tus categorías de mayor gasto: ${topCats}. ` +
        `Esto te ayudará a tomar control y potencialmente ahorrar hasta ${formatCurrency(estimatedSavings)} mensuales.`,
      potentialSavings: estimatedSavings
    });
  }

  // ----------------------------
  // 1) AHORRO PRINCIPAL
  // ----------------------------
  if (params.savingsRate < 10) {
    recommendations.push({
      priority: 'Alta',
      category: 'Ahorro',
      title: 'Establece un fondo de ahorro automático',
      description: `Intenta ahorrar al menos el 10% de tus ingresos mensuales (${formatCurrency(
        params.avgMonthlyIncome * 0.1
      )}). Configura una transferencia automática el día que cobras.`,
      potentialSavings: Math.round(params.avgMonthlyIncome * 0.1)
    });
  } else if (params.savingsRate < 20) {
    recommendations.push({
      priority: 'Media',
      category: 'Ahorro',
      title: 'Aumenta tu tasa de ahorro',
      description: `Estás ahorrando bien, pero podrías llegar al 20% recomendado (${formatCurrency(
        params.avgMonthlyIncome * 0.2
      )}). Analiza gastos no esenciales que puedas reducir.`,
      potentialSavings: Math.round(
        params.avgMonthlyIncome * 0.2 - (params.avgMonthlyIncome * params.savingsRate) / 100
      )
    });
  }

  // Ahorro progresivo (1% por mes)
  recommendations.push({
    priority: 'Media',
    category: 'Ahorro',
    title: 'Aplicá ahorro progresivo (subí 1% por mes)',
    description: `En vez de intentar subir tu ahorro de golpe, aumentalo 1% por mes. Ese cambio gradual es sostenible y construye un hábito real. Este mes podrías sumar ${formatCurrency(
      params.avgMonthlyIncome * 0.01
    )} a tu ahorro.`,
    potentialSavings: Math.round(params.avgMonthlyIncome * 0.01)
  });

  // Ahorro mínimo garantizado
  const guaranteedMinimumSavings = Math.max(10000, Math.round(params.avgMonthlyIncome * 0.03));
  recommendations.push({
    priority: 'Alta',
    category: 'Ahorro',
    title: 'Definí un ahorro mínimo garantizado',
    description: `Definí un mínimo mensual incluso si es chico. Por ejemplo: ${formatCurrency(
      guaranteedMinimumSavings
    )}. La constancia vale más que un mes perfecto.`,
    potentialSavings: guaranteedMinimumSavings
  });

  // Ahorro con cuenta separada
  recommendations.push({
    priority: 'Alta',
    category: 'Ahorro',
    title: 'Separá tu ahorro en una cuenta distinta',
    description:
      'Si tu ahorro vive en la misma cuenta que tu plata diaria, es más fácil gastarlo sin darte cuenta. Separarlo te ayuda a respetarlo como una prioridad.'
  });

  // Ahorro anti-imprevistos
  recommendations.push({
    priority: 'Media',
    category: 'Ahorro',
    title: 'Creá un mini fondo anti-imprevistos',
    description: `Además del fondo de emergencia grande, armá un mini fondo para cosas típicas (farmacia, arreglos, multas, regalos). Separar ${formatCurrency(
      params.avgMonthlyExpense * 0.05
    )} al mes puede evitar que se rompa tu presupuesto.`,
    potentialSavings: Math.round(params.avgMonthlyExpense * 0.05)
  });

  // Ahorro por redondeo inteligente
  recommendations.push({
    priority: 'Baja',
    category: 'Ahorro',
    title: 'Probá el ahorro por redondeo inteligente',
    description:
      'Cada vez que gastás, redondeá para arriba y mandá la diferencia a ahorro. Ej: gastaste $9.200 → redondeás a $10.000 y esos $800 se apartan como ahorro invisible.',
    potentialSavings: Math.round(params.avgMonthlyExpense * 0.02)
  });

  // Día de cobro = día sagrado
  recommendations.push({
    priority: 'Media',
    category: 'Planificación',
    title: 'Hacé del día de cobro tu "día sagrado"',
    description:
      'El día que cobrás, evitá compras no esenciales. Primero pagás lo importante, separás ahorro y armás tu presupuesto. Esta rutina te ordena el mes completo.'
  });

  // ----------------------------
  // 2) REDUCCIÓN EN CATEGORÍA PRINCIPAL
  // ----------------------------
  if (params.topCategories.length > 0 && params.topCategories[0].percentage > 30) {
    const topCat = params.topCategories[0];
    const excludedCategories = ['ahorro', 'inversión', 'inversion', 'transferencia', 'plazos fijos', 'acciones'];

    // Only suggest optimizing if it's not a savings/investment category
    if (!excludedCategories.some(exc => topCat.category.toLowerCase().includes(exc))) {
      recommendations.push({
        priority: 'Alta',
        category: 'Reducción de gastos',
        title: `Optimiza gastos en ${topCat.category}`,
        description: `Esta categoría representa el ${topCat.percentage}% de tus gastos (${formatCurrency(
          topCat.amount
        )}). Reducir un 20% te ahorraría ${formatCurrency(topCat.amount * 0.2)} mensuales.`,
        potentialSavings: Math.round(topCat.amount * 0.2)
      });
    }
  }

  // ----------------------------
  // 3) PRESUPUESTOS
  // ----------------------------
  if (!params.usesbudgets) {
    recommendations.push({
      priority: 'Alta',
      category: 'Presupuesto',
      title: 'Crea presupuestos mensuales',
      description:
        'Establece límites de gasto por categoría. Te ayudará a tener mayor control y evitar sorpresas a fin de mes.',
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.15)
    });
  } else {
    // Presupuesto con margen para imprevistos
    recommendations.push({
      priority: 'Media',
      category: 'Presupuesto',
      title: 'Sumá un margen para imprevistos',
      description: `Un presupuesto muy \"perfecto\" se rompe al primer imprevisto. Reservar un 5–10% del mes te da estabilidad. Podés empezar con ${formatCurrency(
        params.avgMonthlyExpense * 0.07
      )} como margen mensual.`,
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.07)
    });

    // Límites semanales para gastos variables
    const weeklyLimit = Math.round((params.avgMonthlyExpense * 0.35) / 4);
    recommendations.push({
      priority: 'Alta',
      category: 'Presupuesto',
      title: 'Usá límites semanales para gastos variables',
      description: `Comida, transporte y salidas se descontrolan por ser diarios. Un límite semanal te da control antes de que el mes se pierda. Un buen punto de partida puede ser ${formatCurrency(
        weeklyLimit
      )} por semana.`,
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.05)
    });
  }

  // Regla 70/20/10
  recommendations.push({
    priority: 'Media',
    category: 'Presupuesto',
    title: 'Probá la regla 70/20/10 para organizar tu mes',
    description:
      'Como guía simple: 70% para gastos del mes, 20% para ahorro y 10% para gustos. Si hoy estás ajustado, adaptala, pero usar una regla fija te da claridad.'
  });

  // Presupuesto por suscripciones
  const subscriptionsEstimate =
    params.recurringExpenses && params.recurringExpenses.length > 0
      ? params.recurringExpenses.reduce((sum, r) => sum + r.avgAmount, 0)
      : Math.round(params.avgMonthlyExpense * 0.05);

  recommendations.push({
    priority: 'Media',
    category: 'Reducción de gastos',
    title: 'Creá un presupuesto específico para suscripciones',
    description: `Las suscripciones son peligrosas porque se vuelven invisibles. Definir un tope mensual te ayuda a controlarlas. Un número razonable para tu caso podría ser ${formatCurrency(
      subscriptionsEstimate
    )} mensuales.`,
    potentialSavings: Math.round(subscriptionsEstimate * 0.15)
  });

  // ----------------------------
  // 4) METAS
  // ----------------------------
  if (!params.hasGoals) {
    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Definí 1 meta principal y 1 secundaria',
      description:
        'Demasiadas metas a la vez hacen que ninguna avance. Con 2 metas claras (por ejemplo emergencia + un objetivo personal), vas a ver progreso y mantener motivación.'
    });
  }

  // ----------------------------
  // 5) FONDO DE EMERGENCIA
  // ----------------------------
  if (params.capacity.emergencyFundStatus === 'Inexistente') {
    recommendations.push({
      priority: 'Alta',
      category: 'Ahorro',
      title: 'Construí un fondo de emergencia por etapas',
      description: `No hace falta llegar a 3 meses de gastos de una. Empezá por una etapa alcanzable como ${formatCurrency(
        100000
      )} o 1 mes de gastos (${formatCurrency(params.avgMonthlyExpense)}). Luego escalás a 3 meses (${formatCurrency(
        params.avgMonthlyExpense * 3
      )}).`,
      potentialSavings: Math.round(params.avgMonthlyExpense * 3)
    });

    recommendations.push({
      priority: 'Media',
      category: 'Ahorro',
      title: 'Separá el fondo de emergencia del ahorro común',
      description:
        'El fondo de emergencia no se toca para gustos o compras planificadas. Tenerlo separado te ayuda a respetarlo como una herramienta de estabilidad.'
    });
  }

  if (params.capacity.emergencyFundStatus === 'Insuficiente') {
    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Definí reglas claras para usar tu fondo de emergencia',
      description:
        'Definir qué cuenta como emergencia evita usarlo por ansiedad o impulso. Ejemplo válido: salud, arreglos, pérdida de ingreso.'
    });

    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Reponé tu fondo automáticamente si lo usás',
      description:
        'Si lo usaste, reconstruirlo debería ser prioridad. Esto evita el ciclo de "zafé una vez pero quedé expuesto otra vez".'
    });

    recommendations.push({
      priority: 'Media',
      category: 'Ahorro',
      title: 'Separá el fondo de emergencia del ahorro común',
      description:
        'Tener el fondo separado te ayuda a no mezclarlo con gastos o metas. Eso mejora tu estabilidad mensual incluso si todavía estás construyéndolo.'
    });
  }

  // ----------------------------
  // 6) GASTOS GRANDES
  // ----------------------------
  if (params.largeExpensesCount > 2) {
    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Planificá gastos grandes con anticipación',
      description: `Detectamos ${params.largeExpensesCount} gastos grandes. En vez de absorberlos en un solo mes, anticipalos con un ahorro mensual específico o plan de pago para evitar desbalances.`,
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.05)
    });

    recommendations.push({
      priority: 'Media',
      category: 'Planificación',
      title: 'Dividí gastos grandes por meses',
      description:
        'Si un gasto grande va a pasar sí o sí, separarlo en meses lo vuelve manejable y evita que un solo pago te rompa el presupuesto.'
    });
  }

  // ----------------------------
  // 7) IMPULSOS
  // ----------------------------
  if (params.profileType === 'Impulsivo') {
    recommendations.push({
      priority: 'Alta',
      category: 'Reducción de gastos',
      title: 'Implementa la regla de las 24 horas',
      description:
        'Antes de compras no esenciales, espera 24 horas. Esto reduce compras impulsivas y mejora tu control del gasto.',
      potentialSavings: Math.round(params.avgMonthlyExpense * 0.15)
    });
  }

  // Lista de deseos con fecha
  recommendations.push({
    priority: 'Media',
    category: 'Reducción de gastos',
    title: 'Usá una lista de deseos con fecha de revisión',
    description:
      'En vez de comprar al instante, anotá el producto y poné una fecha para revisarlo. Muchísimas compras pierden urgencia con el tiempo y terminás gastando mejor.'
  });

  // Poner fricción a compras online
  recommendations.push({
    priority: 'Media',
    category: 'Reducción de gastos',
    title: 'Poné fricción a las compras online',
    description:
      'Sacar tarjetas guardadas o desactivar pagos rápidos reduce compras impulsivas sin depender solo de fuerza de voluntad.'
  });

  // ----------------------------
  // 8) TRACKING
  // ----------------------------
  if (params.trackingConsistency < 50) {
    recommendations.push({
      priority: 'Media',
      category: 'Presupuesto',
      title: 'Reducí la cantidad de categorías para sostener el hábito',
      description:
        'Si el tracking es muy complejo, se abandona. Menos categorías, pero más consistencia = mejores resultados.'
    });
  }

  // ----------------------------
  // 9) INGRESOS / CRECIMIENTO
  // ----------------------------
  recommendations.push({
    priority: 'Media',
    category: 'Planificación',
    title: 'Aumentá ingresos sin inflar tu estilo de vida',
    description:
      'Si sube tu ingreso, intentá que también suba tu ahorro. Si sube tu gasto al mismo ritmo, terminás en el mismo lugar pero con más estrés financiero.'
  });

  recommendations.push({
    priority: 'Media',
    category: 'Planificación',
    title: 'Asignáun destino fijo para tus ingresos extra',
    description:
      'Si recibís ingresos extra (bonos, changas o trabajos extra), definí de antemano a dónde van: fondo de emergencia, pagar deudas o metas de ahorro. Si no tienen destino, suelen desaparecer en gastos del momento.'
  });

  recommendations.push({
    priority: 'Baja',
    category: 'Planificación',
    title: 'Invertí en aumentar tu valor profesional',
    description:
      'Invertir en habilidades suele ser la inversión más rentable. Te aumenta tu ingreso futuro, no solo te ordena el presente.'
  });

  // Ordenar por prioridad
  const priorityOrder = { Alta: 1, Media: 2, Baja: 3 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}


const currencyFormatterInteger = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const currencyFormatterDecimal = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatCurrency(amount: number): string {
  // If whole number, use integer formatter (no decimals). 
  // If has decimals, use decimal formatter (2 decimals, e.g. 10.50)
  return amount % 1 === 0
    ? currencyFormatterInteger.format(amount)
    : currencyFormatterDecimal.format(amount);
}
