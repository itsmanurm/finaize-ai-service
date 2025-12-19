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
                    const ratio = Math.round((val / median) * 100);
                    let reason = '';
                    if (score > 8) {
                        reason = `¡Cuidado! Este gasto es completamente atípico: gastaste $${val.toLocaleString('es-AR')} en ${cat}, más de 3 veces lo que gastan normalmente ($${Math.round(median).toLocaleString('es-AR')}). Verificá si es correcto.`;
                    } else if (score > 5) {
                        reason = `Detectamos un gasto importante: $${val.toLocaleString('es-AR')} en ${cat}. Es bastante más que lo habitual ($${Math.round(median).toLocaleString('es-AR')}). ¿Fue intencional?`;
                    } else {
                        reason = `Notamos un gasto un poco elevado: $${val.toLocaleString('es-AR')} en ${cat}, por encima de tu promedio ($${Math.round(median).toLocaleString('es-AR')}). Solo para que lo tengas en cuenta.`;
                    }
                    anomalies.push({
                        transactionId: t._id || t.id,
                        amount: t.amount,
                        description: t.description || 'Sin descripción',
                        category: cat,
                        severity: score > 8 ? 'high' : (score > 5 ? 'medium' : 'low'),
                        reason
                    });
                }
            }
        }

        return anomalies;
    }
}
