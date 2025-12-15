import * as ss from 'simple-statistics';

export interface DataPoint {
    date: Date;
    value: number;
}

export interface ForecastResult {
    trend: 'up' | 'down' | 'stable';
    slope: number;
    rSquared: number;
    predictions: DataPoint[];
    movingAverage?: DataPoint[];
    alerts: string[];
}

export class ForecastingService {
    /**
     * Genera una predicción lineal simple para los próximos 'horizonDays' días.
     * @param data Lista de puntos {date, value}
     * @param horizonDays Días a proyectar (default: 30)
     */
    static predictLinear(data: DataPoint[], horizonDays: number = 30): ForecastResult {
        if (data.length < 2) {
            return {
                trend: 'stable',
                slope: 0,
                rSquared: 0,
                predictions: [],
                alerts: ['Insuficientes datos para predecir']
            };
        }

        // Ordenar por fecha
        const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());

        // Normalizar fechas a días relativos (x=0 es la primera fecha)
        const startDate = sorted[0].date.getTime();
        const oneDay = 24 * 60 * 60 * 1000;

        // Preparar datos para regresión: [x, y]
        const regressionData: [number, number][] = sorted.map(d => [
            (d.date.getTime() - startDate) / oneDay,
            d.value
        ]);

        // Calcular regresión lineal
        const mb = ss.linearRegression(regressionData);
        const line = ss.linearRegressionLine(mb);
        const rSquared = ss.rSquared(regressionData, line);

        // Generar predicciones futuras
        const lastDayIndex = regressionData[regressionData.length - 1][0];
        const predictions: DataPoint[] = [];

        for (let i = 1; i <= horizonDays; i++) {
            const futureX = lastDayIndex + i;
            const predictedVal = line(futureX);

            predictions.push({
                date: new Date(startDate + futureX * oneDay),
                value: Math.max(0, predictedVal) // Asumimos no valores negativos para gastos simplificados
            });
        }

        // Determinar tendencia
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (mb.m > 0.1) trend = 'up';
        else if (mb.m < -0.1) trend = 'down';

        return {
            trend,
            slope: mb.m,
            rSquared,
            predictions,
            alerts: []
        };
    }

    /**
     * Calcula Media Móvil Simple (SMA) para suavizar la serie.
     * @param data Lista de puntos
     * @param windowSize Tamaño de la ventana (default: 3)
     */
    static calculateMovingAverage(data: DataPoint[], windowSize: number = 3): DataPoint[] {
        if (data.length < windowSize) return [];

        const sorted = [...data].sort((a, b) => a.date.getTime() - b.date.getTime());
        const values = sorted.map(d => d.value);

        const maData: DataPoint[] = [];

        for (let i = 0; i <= sorted.length - windowSize; i++) {
            const windowSlice = values.slice(i, i + windowSize);
            const avg = ss.mean(windowSlice);
            // La fecha del punto MA suele ser el final de la ventana o el centro. Usaremos el final.
            maData.push({
                date: sorted[i + windowSize - 1].date,
                value: avg
            });
        }

        return maData;
    }

    /**
     * Predice el cierre de gastos del mes actual basándose en la acumulación diaria.
     * @param currentMonthData Puntos del mes actual {date, value} (value es gasto diario)
     * @param monthTotalDays Días totales del mes (28, 30, 31)
     */
    static predictIntraMonth(currentMonthData: DataPoint[], monthTotalDays: number = 30): ForecastResult {
        // 1. Ordenar por fecha
        const sorted = [...currentMonthData].sort((a, b) => a.date.getTime() - b.date.getTime());

        // 2. Calcular Acumulado Real
        const cumulativeReal: DataPoint[] = [];
        let sum = 0;
        sorted.forEach(d => {
            sum += d.value;
            cumulativeReal.push({ date: d.date, value: sum });
        });

        // 3. Chequeo de datos insuficientes (ej. día 1 o 2 del mes)
        if (sorted.length < 3) {
            return {
                trend: 'stable',
                slope: 0,
                rSquared: 0,
                predictions: [], // No proyectamos nada si es muy pronto
                movingAverage: cumulativeReal, // Devolvemos lo real acumulado
                alerts: [`Faltan datos para proyectar (Día ${sorted.length})`]
            };
        }

        // 4. Regresión Lineal sobre el ACUMULADO
        // Usamos días transcurridos como X, y valor acumulado como Y
        const startDate = sorted[0].date.getTime(); // Día 1 (o primer día con gasto)
        // Lo ideal es que X=1 sea el día 1 del mes. 
        // Asumimos que `currentMonthData` trae datas del 1 al hoy.

        const startOfMonth = new Date(sorted[0].date.getFullYear(), sorted[0].date.getMonth(), 1);
        const oneDay = 24 * 60 * 60 * 1000;

        const regressionData: [number, number][] = cumulativeReal.map(d => {
            const dayOfMonth = Math.ceil((d.date.getTime() - startOfMonth.getTime()) / oneDay) + 1;
            return [dayOfMonth, d.value];
        });

        const mb = ss.linearRegression(regressionData);
        const line = ss.linearRegressionLine(mb);
        const rSquared = ss.rSquared(regressionData, line);

        // 5. Generar Proyección hasta fin de mes
        const lastDayProcessed = regressionData[regressionData.length - 1][0]; // Día actual (ej. 15)
        const predictions: DataPoint[] = [];

        // Empezamos predicción desde mañana (o hoy mismo si queremos continuidad visual)
        // Para continuidad, agregamos el último punto real como el primero de predicción si se desea,
        // o arrancamos desde lastDayProcessed + 1

        for (let day = lastDayProcessed + 1; day <= monthTotalDays; day++) {
            const predictedVal = line(day);
            const date = new Date(startOfMonth.getTime() + (day - 1) * oneDay); // day-1 offset
            predictions.push({
                date: date,
                value: Math.max(sum, predictedVal) // No debería bajar de lo acumulado
            });
        }

        // Determinar tendencia (pendiente de la acumulación vs pendiente ideal?)
        // Pendiente 'm' nos dice cuánto aumenta el gasto acumulado por día (gasto promedio diario proyectado)
        // Si m > (Presupuesto / 30) => Alza. Pero aquí no tenemos presupuesto.
        // Simplemente devolvemos la slope.

        return {
            trend: 'stable', // El frontend decidirá en base a la pendiente
            slope: mb.m,     // Gasto diario proyectado
            rSquared,
            predictions,
            movingAverage: cumulativeReal, // Usamos este campo para devolver el acumulado real
            alerts: []
        };
    }
}
