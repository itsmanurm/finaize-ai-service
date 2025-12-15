import { describe, it, expect } from 'vitest';
import { ForecastingService, DataPoint } from '../src/ai/forecasting';

describe('ForecastingService', () => {

    it('should predict linear growth correctly', () => {
        // 3 days: 10, 20, 30. Expect day 4 to be 40.
        const now = new Date('2025-01-01T00:00:00Z').getTime();
        const oneDay = 24 * 60 * 60 * 1000;

        const data: DataPoint[] = [
            { date: new Date(now), value: 10 },
            { date: new Date(now + oneDay), value: 20 },
            { date: new Date(now + 2 * oneDay), value: 30 }
        ];

        const result = ForecastingService.predictLinear(data, 1);

        expect(result.trend).toBe('up');
        expect(result.rSquared).toBeCloseTo(1, 2); // Perfect fit
        expect(result.predictions).toHaveLength(1);
        expect(result.predictions[0].value).toBeCloseTo(40, 1);
    });

    it('should handle flat trends', () => {
        const now = new Date().getTime();
        const data: DataPoint[] = [
            { date: new Date(now), value: 100 },
            { date: new Date(now + 86400000), value: 100 },
            { date: new Date(now + 2 * 86400000), value: 100 }
        ];

        const result = ForecastingService.predictLinear(data, 5);
        expect(result.trend).toBe('stable');
        expect(result.slope).toBeCloseTo(0, 5);
    });

    it('should return empty prediction if insufficient data', () => {
        const data: DataPoint[] = [{ date: new Date(), value: 100 }];
        const result = ForecastingService.predictLinear(data);
        expect(result.predictions).toHaveLength(0);
        expect(result.alerts).toContain('Insuficientes datos para predecir');
    });

    it('should calculate Moving Average correctly', () => {
        // 10, 20, 30, 40, 50. Window 3. 
        // Avg 1 (10,20,30) = 20
        // Avg 2 (20,30,40) = 30
        // Avg 3 (30,40,50) = 40
        const now = new Date().getTime();
        const data: DataPoint[] = [10, 20, 30, 40, 50].map((v, i) => ({
            date: new Date(now + i * 1000),
            value: v
        }));

        const ma = ForecastingService.calculateMovingAverage(data, 3);
        expect(ma).toHaveLength(3);
        expect(ma[0].value).toBe(20);
        expect(ma[2].value).toBe(40);
    });
});
