import * as ss from 'simple-statistics';
import type { TransactionInput } from './schema';

export interface AnomalyResult {
    transactionId?: string; // ID si existe, o índice
    amount: number;
    description: string;
    category: string;
    severity: 'low' | 'medium' | 'high';
    reason: string;
}

export class AnomalyService {

    /**
     * Detecta anomalías usando Robust Z-Score (basado en Median y MAD).
     * Más efectivo para detectar outliers en datasets pequeños o con valores extremos.
     * @param transactions Lista de transacciones validadas
     * @param threshold Umbral de desviación (default: 3.5)
     */
    static detectOutliers(transactions: TransactionInput[], threshold: number = 3.5): AnomalyResult[] {
        const anomalies: AnomalyResult[] = [];

        // 1. Agrupar por categoría
        const byCategory = new Map<string, TransactionInput[]>();
        for (const t of transactions) {
            const cat = t.category || 'Uncategorized';
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)?.push(t);
        }

        // 2. Analizar cada grupo
        for (const [cat, group] of byCategory) {
            if (!group || group.length < 5) continue;

            const values = group.map(t => Math.abs(t.amount));
            const median = ss.median(values);
            const mad = ss.medianAbsoluteDeviation(values);

            // Si MAD es 0 (ej: todos los valores son iguales salvo 1), ajustamos mínimo para evitar división por cero
            const safeMad = mad === 0 ? 1 : mad;

            for (const t of group) {
                const val = Math.abs(t.amount);
                // Fórmula Robust Z-Score: 0.6745 * (x - median) / MAD
                const score = (0.6745 * (val - median)) / safeMad;

                if (score > threshold) {
                    anomalies.push({
                        transactionId: t._id || t.id,
                        amount: t.amount,
                        description: t.description || 'Sin descripción',
                        category: cat,
                        severity: score > 8 ? 'high' : (score > 5 ? 'medium' : 'low'),
                        reason: `Gasto inusual de $${val.toLocaleString('es-AR')} en '${cat}' (Mediana: $${median.toLocaleString('es-AR', { maximumFractionDigits: 0 })}). Score: ${score.toFixed(1)}`
                    });
                }
            }
        }

        return anomalies;
    }
}
