import * as ss from 'simple-statistics';

export interface DataPoint {
    date: Date;
    value: number;
}

export interface ForecastResult {
    modelVersion: "v3-hybrid";
    trend: 'up' | 'down' | 'stable';
    slopeDaily: number;   // Velocidad diaria estimada de acá a fin de mes
    slopeMonthly: number; // Proyección total fin de mes
    stabilityLevel: 'high' | 'medium' | 'low';
    predictions: DataPoint[]; // Puntos futuros (línea punteada)
    explanation: string;
    confidenceNote: string;
    alerts: string[];
    // Metadata for frontend debugging/display
    meta?: {
        currentTotal: number;
        daysRemaining: number;
        blendedDailyRate: number;
    }
}

export class ForecastingService {
    /**
     * Genera una estimación híbrida robusta.
     * Combina el "Run Rate" actual con la "Historia" basándose en el progreso del mes.
     * 
     * @param historicalData Datos de los últimos 6 meses (todos los puntos diarios)
     * @param currentMonthData Datos del mes actual (acumulado o diario)
     * @param totalDaysInMonth Días totales del mes (ej. 30, 31)
     * @param calendarDayOfMonth Día actual (ej. 23)
     */
    static predictAdaptive(
        historicalData: DataPoint[],
        currentMonthData: DataPoint[],
        totalDaysInMonth: number = 30,
        calendarDayOfMonth: number
    ): ForecastResult {

        // 1. Preparar Datos Actuales
        // Asegurar orden
        const currentSorted = [...currentMonthData].sort((a, b) => a.date.getTime() - b.date.getTime());
        // Calcular acumulado actual real
        const currentTotal = currentSorted.reduce((sum, p) => sum + p.value, 0);

        // 2. Analizar Historia (Totales Mensuales)
        // Agrupar historicalData por mes (YYYY-MM) para sacar promedios mensuales reales
        const monthlyTotals = new Map<string, number>();
        historicalData.forEach(d => {
            const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
            monthlyTotals.set(k, (monthlyTotals.get(k) || 0) + d.value);
        });

        const historyValues = Array.from(monthlyTotals.values());
        // Promedio Histórico (Baseline)
        const avgHistoryTotal = historyValues.length > 0 ? ss.mean(historyValues) : 0;
        // Promedio Diario Histórico
        const avgHistoryDaily = avgHistoryTotal / 30; // Aprox

        // 3. Calcular Velocidad Actual (Burn Rate)
        // Evitar división por cero
        const effectiveDay = Math.max(1, calendarDayOfMonth);
        const currentDailyRate = currentTotal / effectiveDay;

        // 4. Lógica de Ponderación (Hybrid Blend)
        // Cuanto más avanzado el mes, más confiamos en el ritmo actual.
        // weight favorece al actual conforme avanza el mes.

        let weightCurrent = 0.5; // Default equilibrado

        if (calendarDayOfMonth <= 5) {
            // Inicio de mes: Muy volátil. Confiamos 80% en historia, 20% actual
            weightCurrent = 0.2;
        } else if (calendarDayOfMonth >= 20) {
            // Fin de mes: El partido está casi jugado. Confiamos 90% en actual.
            weightCurrent = 0.9;
        } else {
            // Mitad de mes: Transición lineal
            weightCurrent = calendarDayOfMonth / totalDaysInMonth;
        }

        // Si no hay historia, confiamos 100% en actual
        if (historyValues.length === 0) weightCurrent = 1.0;

        // 5. Cálculo de Proyección
        // Velocidad combinada para los días RESTANTES
        const blendedDailyRate = (currentDailyRate * weightCurrent) + (avgHistoryDaily * (1 - weightCurrent));

        const daysRemaining = Math.max(0, totalDaysInMonth - calendarDayOfMonth);
        const predictedRemaining = blendedDailyRate * daysRemaining;

        const slopeMonthly = Math.round(currentTotal + predictedRemaining);

        // 6. Generar Puntos de Proyección (Línea Punteada)
        const predictions: DataPoint[] = [];
        const oneDay = 24 * 60 * 60 * 1000;

        let accum = currentTotal;
        for (let i = 1; i <= daysRemaining; i++) {
            accum += blendedDailyRate;
            const nextDate = new Date(Date.now() + (i * oneDay));
            predictions.push({
                date: nextDate,
                value: accum
            });
        }

        // 7. Determinar Tendencia y Mensajes
        let trend: 'up' | 'down' | 'stable' = 'stable';

        if (avgHistoryTotal > 0) {
            const diffPct = (slopeMonthly - avgHistoryTotal) / avgHistoryTotal;
            if (diffPct > 0.1) trend = 'up';
            else if (diffPct < -0.1) trend = 'down';
        }

        // Estabilidad: Si el usuario es consistente en su historia
        let stabilityLevel: 'high' | 'medium' | 'low' = 'medium';
        if (calendarDayOfMonth > 20) stabilityLevel = 'high';
        // (Podríamos agregar más lógica de varianza histórica aquí si fuera necesario)

        const explanation = trend === 'up'
            ? `Vas camino a gastar un ${Math.abs(Math.round((slopeMonthly - avgHistoryTotal) / avgHistoryTotal * 100))}% más que tu promedio.`
            : trend === 'down'
                ? `Vas camino a ahorrar un ${Math.abs(Math.round((slopeMonthly - avgHistoryTotal) / avgHistoryTotal * 100))}% respecto a tu promedio.`
                : `Proyección estable acorde a tu historial.`;

        return {
            modelVersion: "v3-hybrid",
            trend,
            slopeDaily: blendedDailyRate,
            slopeMonthly: slopeMonthly,
            stabilityLevel,
            predictions,
            explanation,
            confidenceNote: calendarDayOfMonth < 7 ? "Estimación preliminar (inicio de mes)" : "Proyección de alta confianza",
            alerts: [],
            meta: {
                currentTotal,
                daysRemaining,
                blendedDailyRate
            }
        };
    }
}
