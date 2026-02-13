/**
 * Helper functions for profile analysis
 * These functions analyze investments, subscriptions, accounts, and payment methods
 */

import type { Investment, RecurringSubscription, Account, Transaction } from './profile-analyzer';

/**
 * Analyzes investment portfolio
 */
export function analyzeInvestments(investments: Investment[]) {
    if (investments.length === 0) {
        return {
            diversityScore: 0,
            currentValue: 0,
            avgROI: 0,
            health: undefined
        };
    }

    // Calculate total invested and current value
    let totalInvested = 0;
    let totalCurrent = 0;
    const rois: number[] = [];
    const typeSet = new Set<string>();

    investments.forEach(inv => {
        const invested = inv.quantity * inv.purchasePrice;
        const current = inv.currentPrice ? inv.quantity * inv.currentPrice : invested;

        totalInvested += invested;
        totalCurrent += current;

        if (inv.currentPrice) {
            const roi = ((current - invested) / invested) * 100;
            rois.push(roi);
        }

        typeSet.add(inv.type);
    });

    const avgROI = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : 0;

    // Calculate diversity (0-100)
    const typeCount = typeSet.size;
    const countScore = Math.min(100, (typeCount / 3) * 50); // Max 50 points for types
    const distributionScore = calculateDistributionScore(investments); // Max 50 points
    const diversityScore = Math.round(countScore + distributionScore);

    // Identify best and worst performers
    let bestPerformer, worstPerformer;
    if (rois.length > 0) {
        const withROI = investments
            .map((inv, idx) => ({ inv, roi: rois[idx] }))
            .filter(x => x.roi !== undefined);

        if (withROI.length > 0) {
            const sorted = withROI.sort((a, b) => b.roi - a.roi);
            bestPerformer = { ticker: sorted[0].inv.ticker, roi: Math.round(sorted[0].roi * 10) / 10 };
            worstPerformer = { ticker: sorted[sorted.length - 1].inv.ticker, roi: Math.round(sorted[sorted.length - 1].roi * 10) / 10 };
        }
    }

    // Determine risk level
    const volatility = rois.length > 1 ? Math.abs(Math.max(...rois) - Math.min(...rois)) : 0;
    let riskLevel: 'Bajo' | 'Moderado' | 'Alto' = 'Moderado';
    if (volatility < 20) riskLevel = 'Bajo';
    else if (volatility > 50) riskLevel = 'Alto';

    return {
        diversityScore,
        currentValue: totalCurrent,
        avgROI: Math.round(avgROI * 10) / 10,
        health: {
            totalInvested: Math.round(totalInvested),
            currentValue: Math.round(totalCurrent),
            avgROI: Math.round(avgROI * 10) / 10,
            bestPerformer,
            worstPerformer,
            riskLevel
        }
    };
}

function calculateDistributionScore(investments: Investment[]): number {
    // Calculate how distributed the capital is
    const totalValue = investments.reduce((sum, inv) =>
        sum + (inv.currentPrice ? inv.quantity * inv.currentPrice : inv.quantity * inv.purchasePrice), 0
    );

    const percentages = investments.map(inv => {
        const value = inv.currentPrice ? inv.quantity * inv.currentPrice : inv.quantity * inv.purchasePrice;
        return (value / totalValue) * 100;
    });

    // Penalize concentration (if one investment is >60% of total)
    const maxPercentage = Math.max(...percentages);
    if (maxPercentage > 60) return 10;
    if (maxPercentage > 40) return 30;
    return 50;
}

/**
 * Analyzes subscriptions health
 */
export function analyzeSubscriptions(subscriptions: RecurringSubscription[], avgMonthlyExpense: number) {
    if (subscriptions.length === 0) {
        return {
            monthlyCost: 0,
            percentage: 0,
            healthScore: 100
        };
    }

    // Calculate total monthly cost
    const monthlyCost = subscriptions.reduce((sum, sub) => {
        const amount = sub.frequency === 'YEARLY' ? sub.amount / 12 : sub.amount;
        return sum + amount;
    }, 0);

    const percentage = avgMonthlyExpense > 0 ? (monthlyCost / avgMonthlyExpense) * 100 : 0;

    // Health score: penalize if >15% of expense
    let healthScore = 100;
    if (percentage > 20) healthScore = 40;
    else if (percentage > 15) healthScore = 60;
    else if (percentage > 10) healthScore = 80;

    return {
        monthlyCost: Math.round(monthlyCost),
        percentage: Math.round(percentage),
        healthScore
    };
}

/**
 * Analyzes account usage strategy
 */
export function analyzeAccounts(accounts: Account[], transactions: Transaction[]) {
    if (accounts.length === 0) {
        return {
            hasStrategy: false,
            distribution: []
        };
    }

    // Calculate expense distribution by account
    const byAccount = new Map<string, number>();
    transactions.forEach(t => {
        if (t.account) {
            byAccount.set(t.account, (byAccount.get(t.account) || 0) + Math.abs(t.amount));
        }
    });

    const total = Array.from(byAccount.values()).reduce((a, b) => a + b, 0);
    const distribution = Array.from(byAccount.entries()).map(([account, amount]) => ({
        account,
        amount: Math.round(amount),
        percentage: Math.round((amount / total) * 100)
    })).sort((a, b) => b.amount - a.amount);

    // Has strategy if uses 3+ accounts
    const hasStrategy = accounts.length >= 3;

    return {
        hasStrategy,
        distribution
    };
}

/**
 * Analyzes payment methods usage and installment risk
 */
export function analyzePaymentMethods(transactions: Transaction[], avgMonthlyIncome: number) {
    const byMethod = new Map<string, number>();
    const installmentTransactions: Transaction[] = [];

    transactions.forEach(t => {
        if (t.paymentMethod) {
            byMethod.set(t.paymentMethod, (byMethod.get(t.paymentMethod) || 0) + 1);
        }

        // Detectar transacciones en cuotas
        if (t.paymentMethod === 'credito' && t.installments && t.installments > 1) {
            installmentTransactions.push(t);
        }
    });

    const total = Array.from(byMethod.values()).reduce((a, b) => a + b, 0);
    if (total === 0) {
        return {
            preferred: 'N/A',
            creditPercentage: 0,
            installmentRisk: {
                count: 0,
                totalMonthlyCommitment: 0,
                percentageOfIncome: 0,
                longestInstallment: 0
            },
            details: {
                method: 'N/A',
                percentage: 0,
                insight: 'No hay información de métodos de pago'
            }
        };
    }

    const sorted = Array.from(byMethod.entries()).sort((a, b) => b[1] - a[1]);

    const preferred = sorted[0]?.[0] || 'N/A';
    const preferredPercentage = sorted[0] ? Math.round((sorted[0][1] / total) * 100) : 0;

    const creditCount = byMethod.get('credito') || 0;
    const creditPercentage = Math.round((creditCount / total) * 100);

    // Calcular riesgo de cuotas
    const totalMonthlyCommitment = installmentTransactions.reduce((sum, t) => {
        const monthlyPayment = Math.abs(t.amount) / (t.installments || 1);
        return sum + monthlyPayment;
    }, 0);

    const percentageOfIncome = avgMonthlyIncome > 0
        ? (totalMonthlyCommitment / avgMonthlyIncome) * 100
        : 0;

    const longestInstallment = installmentTransactions.length > 0
        ? Math.max(...installmentTransactions.map(t => t.installments || 0))
        : 0;

    return {
        preferred,
        creditPercentage,
        installmentRisk: {
            count: installmentTransactions.length,
            totalMonthlyCommitment: Math.round(totalMonthlyCommitment),
            percentageOfIncome: Math.round(percentageOfIncome),
            longestInstallment
        },
        details: {
            method: preferred,
            percentage: preferredPercentage,
            insight: `Usás mayormente ${preferred} (${preferredPercentage}% de tus gastos)`
        }
    };
}

/**
 * Calculates average progress across all goals
 */
export function calculateGoalsProgress(goals: Array<{ targetAmount: number; currentAmount: number }>): number {
    if (goals.length === 0) return 0;

    const progresses = goals.map(g => {
        const progress = (g.currentAmount / g.targetAmount) * 100;
        return Math.min(100, progress);
    });

    return Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length);
}
