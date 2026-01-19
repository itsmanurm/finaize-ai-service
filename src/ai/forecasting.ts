import * as ss from 'simple-statistics';

export interface DataPoint {
    date: Date;
    value: number;
}

export interface ForecastResult {
    modelVersion: "v2-adaptive",
    trend: 'up' | 'down' | 'stable';
    slopeDaily: number;
    slopeMonthly: number;
    slope?: number; // Legacy support for tests
    stabilityLevel: 'high' | 'medium' | 'low';
    rSquared: number;
    predictions: DataPoint[];
    alerts: string[];
    explanation: string;
    confidenceNote: string;
    movingAverage?: DataPoint[]; // Legacy support
}

export class ForecastingService {
    /**
     * Genera una estimación adaptativa basada en el peso del día del mes.
     * Combina tendencia histórica (inicio de mes) con comportamiento actual (fin de mes).
     * 
     * @param historicalData Datos de meses anteriores
     * @param currentMonthData Datos del mes actual (días con transacciones)
     * @param totalDaysInMonth Total días del mes calendario (28-31)
     * @param calendarDayOfMonth Día calendario actual (1-31). CRÍTICO para el peso.
     */
    static predictAdaptive(
        historicalData: DataPoint[],
        currentMonthData: DataPoint[],
        totalDaysInMonth: number = 30,
        calendarDayOfMonth: number // Replaces explicit reliance on data.length for time
    ): ForecastResult {

        // 1. Validar Datos Mínimos
        // Si hay muy pocos datos históricos, marcamos calidad baja (se maneja en response wrapper)
        if (currentMonthData.length === 0 && historicalData.length === 0) {
            return this.getEmptyForecast("Sin datos suficientes");
        }

        // 2. Ordenar datos y Calcular Active Stats
        const currentSorted = [...currentMonthData].sort((a, b) => a.date.getTime() - b.date.getTime());
        const historySorted = [...historicalData].sort((a, b) => a.date.getTime() - b.date.getTime());

        const activeSpendingDays = currentSorted.length; // Días que EFECTIVAMENTE hubo gasto
        const currentTotal = currentSorted.reduce((sum, d) => sum + d.value, 0);

        // 3. Calcular Velocidad de Gasto Actual
        // OJO: Si dividimos currentTotal / activeSpendingDays, obtenemos "Promedio cuando gasta".
        // Si dividimos currentTotal / calendarDayOfMonth, obtenemos "Promedio diario real extensivo".
        // Para proyección de fin de mes, necesitamos el "Promedio diario real extensivo" (diluido).
        const currentDailyAvg = calendarDayOfMonth > 0 ? currentTotal / calendarDayOfMonth : 0;

        // 4. Calcular Tendencia Histórica (Slope)
        let historicalDailySlope = 0;
        let stabilityMetric = 0;

        if (historySorted.length > 5) {
            const startDate = historySorted[0].date.getTime();
            const oneDay = 24 * 60 * 60 * 1000;
            const regData: [number, number][] = historySorted.map(d => [
                (d.date.getTime() - startDate) / oneDay,
                d.value
            ]);

            const mb = ss.linearRegression(regData);
            historicalDailySlope = Math.max(0, mb.m);

            const line = ss.linearRegressionLine(mb);
            stabilityMetric = ss.rSquared(regData, line);
        }

        // 5. Lógica de Ponderación (ADAPTIVE WEIGHTS)
        // Usamos calendarDayOfMonth para el peso temporal.
        // Day 1: 90% Historia. Day 25+: 90% Actual.

        // CALIBRATION: Smoother transition. 
        // day 1: 0.1
        // day 10: 0.4
        // day 20: 0.8
        let weightCurrent = Math.min(Math.max(calendarDayOfMonth / 25, 0.1), 1.0);

        // Si no hay historial, confiamos 100% en actual (mode cold start)
        if (historySorted.length < 5) weightCurrent = 1.0;

        // Velocidad Final Estimada
        // Si currentDailyAvg es 0 (ej. dia 1 sin gasto), usar historia
        const safeCurrentAvg = currentDailyAvg === 0 ? historicalDailySlope : currentDailyAvg;

        const finalDailySlope = (safeCurrentAvg * weightCurrent) + (historicalDailySlope * (1 - weightCurrent));

        // 6. Proyección
        const predictions: DataPoint[] = [];
        const lastDate = currentSorted.length > 0
            ? currentSorted[currentSorted.length - 1].date
            : new Date();

        let accumulated = currentTotal;
        const oneDay = 24 * 60 * 60 * 1000;
        const remainingDays = Math.max(0, totalDaysInMonth - calendarDayOfMonth);

        for (let i = 1; i <= remainingDays; i++) {
            accumulated += finalDailySlope;
            const nextDate = new Date(Date.now() + (i * oneDay));
            predictions.push({
                date: nextDate,
                value: accumulated
            });
        }

        // 7. Determinar Estabilidad y Etiquetas (Neutras)
        let trend: 'up' | 'down' | 'stable' = 'stable';
        const percentChange = historicalDailySlope > 0
            ? (finalDailySlope - historicalDailySlope) / historicalDailySlope
            : 0;

        if (percentChange > 0.15) trend = 'up';
        else if (percentChange < -0.15) trend = 'down';

        // CALIBRATION: Stability Logic V2 (Human Centric)
        // Default is MEDIUM. Downgrade only if chaotic. Upgrade only if strictly stable.
        let stabilityLevel: 'high' | 'medium' | 'low' = 'medium';

        // A. Early Month Check
        // Early month (< 7 days) does NOT force stability=low anymore. 
        // It simply relies on History stability.

        // B. Late Month High Confidence
        if (calendarDayOfMonth > 25) {
            stabilityLevel = 'high'; // The month is basically done, prediction is fact.
        }
        else {
            // C. Check Volatility / Consistency
            // We use R^2 from history as a proxy for "user usually behaves consistently"

            if (historySorted.length > 5) {
                if (stabilityMetric > 0.6) { // Lowered from 0.7
                    stabilityLevel = 'high';
                } else if (stabilityMetric < 0.3) { // Lowered from 0.4
                    stabilityLevel = 'low';
                } else {
                    stabilityLevel = 'medium';
                }
            } else {
                // No history = medium default (give benefit of doubt), unless active data is chaotic?
                // For now, stick to Medium default.
                stabilityLevel = 'medium';
            }

            // D. Penalty for extreme inactivity vs calendar time? 
            // Only if user has spent < 20% of days late in month.
            // e.g. Day 20, but only 2 active days. That is 'low' stability prediction-wise.
            if (calendarDayOfMonth > 10 && (activeSpendingDays / calendarDayOfMonth) < 0.2) {
                stabilityLevel = 'low';
            }
        }

        // E. Override for "Chaotic" Changes
        // If current slope is HUGE vs Historical (e.g. 2x), stability drops
        if (historySorted.length > 5 && percentChange > 1.0) {
            stabilityLevel = 'low';
        }

        // Mensajes Neutros
        const explanation = `Estimación ponderada: ${Math.round(weightCurrent * 100)}% mes actual, ${Math.round((1 - weightCurrent) * 100)}% referencia histórica.`;
        const confidenceNote = calendarDayOfMonth < 7
            ? "Inicio de mes: datos limitados."
            : "Proyección basada en comportamiento reciente.";

        return {
            modelVersion: "v2-adaptive",
            trend,
            slopeDaily: finalDailySlope,
            slopeMonthly: finalDailySlope * 30,
            stabilityLevel,
            rSquared: stabilityMetric,
            predictions,
            explanation,
            confidenceNote,
            alerts: []
        };
    }

    private static getEmptyForecast(reason: string): ForecastResult {
        return {
            modelVersion: "v2-adaptive",
            trend: 'stable',
            slopeDaily: 0,
            slopeMonthly: 0,
            stabilityLevel: 'low',
            rSquared: 0,
            predictions: [],
            alerts: [reason],
            explanation: "Sin datos",
            confidenceNote: ""
        };
    }

    /**
     * Calcula Media Móvil Simple (SMA) para visualización suavizada.
     * Mantenemos este helper para el gráfico de "Acumulado Real".
     */
    static calculateMovingAverage(data: DataPoint[], windowSize: number = 3): DataPoint[] {
        if (data.length < windowSize) return data;
        const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());
        const result: DataPoint[] = [];

        for (let i = 0; i <= sorted.length - windowSize; i++) {
            const window = sorted.slice(i, i + windowSize);
            const avg = window.reduce((sum, d) => sum + d.value, 0) / windowSize;
            result.push({
                date: window[window.length - 1].date,
                value: avg
            });
        }
        return result;
    }

    /**
     * Predice el cierre de gastos del mes actual basándose en la acumulación diaria.
     * (Legacy/Agent Support)
     */
    static predictIntraMonth(currentMonthData: DataPoint[], monthTotalDays: number = 30): ForecastResult {
        // Wrapper barato para usar la nueva lógica o mantener la vieja si se necesita comportamiento idéntico.
        // Por ahora restauramos la lógica simple antigua para evitar romper agent.ts

        const sorted = [...currentMonthData].sort((a, b) => a.date.getTime() - b.date.getTime());
        const cumulativeReal: DataPoint[] = [];
        let sum = 0;
        sorted.forEach(d => {
            sum += d.value;
            cumulativeReal.push({ date: d.date, value: sum });
        });

        if (sorted.length < 2) {
            // Fallback minimal
            return this.getEmptyForecast("Insuficientes datos");
        }

        // Simple linear regression on cumulative
        const startOfMonth = new Date(sorted[0].date.getFullYear(), sorted[0].date.getMonth(), 1);
        const oneDay = 24 * 60 * 60 * 1000;

        const regData: [number, number][] = cumulativeReal.map(d => {
            const dayOfMonth = Math.ceil((d.date.getTime() - startOfMonth.getTime()) / oneDay) + 1;
            return [dayOfMonth, d.value];
        });

        const mb = ss.linearRegression(regData);
        const line = ss.linearRegressionLine(mb);

        const predictions: DataPoint[] = [];
        const lastDayProcessed = regData[regData.length - 1][0];

        for (let day = lastDayProcessed + 1; day <= monthTotalDays; day++) {
            const val = line(day);
            const date = new Date(startOfMonth.getTime() + (day - 1) * oneDay); // day-1 offsets
            predictions.push({ date, value: Math.max(sum, val) });
        }

        return {
            modelVersion: "v2-adaptive", // Reuse new type for compatibility
            trend: mb.m > 0 ? 'up' : 'stable',
            slopeDaily: mb.m,
            slopeMonthly: mb.m * 30,
            stabilityLevel: 'medium',
            rSquared: ss.rSquared(regData, line),
            predictions,
            alerts: [],
            explanation: "Estimación rápida (Legacy)",
            confidenceNote: "Modo simple",
            movingAverage: cumulativeReal // Added back for agent.ts
        };
    }

    /**
     * Predicción lineal pura (Legacy para tests)
     */
    static predictLinear(data: DataPoint[], forecastDays: number = 30): ForecastResult {
        if (data.length < 2) return this.getEmptyForecast("Insuficientes datos para predecir");

        const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());
        const startDate = sorted[0].date.getTime();
        const oneDay = 24 * 60 * 60 * 1000;

        const regData: [number, number][] = sorted.map(d => [
            (d.date.getTime() - startDate) / oneDay,
            d.value
        ]);

        const mb = ss.linearRegression(regData);
        const line = ss.linearRegressionLine(mb);

        const predictions: DataPoint[] = [];
        const lastDate = sorted[sorted.length - 1].date;

        for (let i = 1; i <= forecastDays; i++) {
            const nextDate = new Date(lastDate.getTime() + (i * oneDay));
            predictions.push({
                date: nextDate,
                value: line((nextDate.getTime() - startDate) / oneDay)
            });
        }

        return {
            modelVersion: "v2-adaptive",
            trend: mb.m > 0 ? 'up' : (mb.m < 0 ? 'down' : 'stable'),
            slopeDaily: mb.m,
            slopeMonthly: mb.m * 30,
            slope: mb.m, // Alias para tests
            stabilityLevel: 'medium',
            rSquared: ss.rSquared(regData, line),
            predictions,
            explanation: "Proyección lineal simple",
            confidenceNote: "Basado en tendencia histórica",
            alerts: []
        };
    }
}
