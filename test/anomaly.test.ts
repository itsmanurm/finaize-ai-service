import { describe, it, expect } from 'vitest';
import { AnomalyService } from '../src/ai/anomaly';

describe('AnomalyService', () => {

    it('should detect a significant outlier', () => {
        // Category: Food. Average ~10. Anomaly 100.
        const transactions = [
            { amount: 10, category: 'Food' },
            { amount: 12, category: 'Food' },
            { amount: 11, category: 'Food' },
            { amount: 9, category: 'Food' },
            { amount: 13, category: 'Food' },
            { amount: 100, category: 'Food' } // Spike
        ];

        const anomalies = AnomalyService.detectOutliers(transactions);
        expect(anomalies).toHaveLength(1);
        expect(anomalies[0].amount).toBe(100);
        expect(anomalies[0].severity).toBe('high');
    });

    it('should ignore small groups (< 5 items)', () => {
        const transactions = [
            { amount: 10, category: 'Food' },
            { amount: 100, category: 'Food' }
        ];
        // Not enough data to determine if 100 is weird or just rare
        const anomalies = AnomalyService.detectOutliers(transactions);
        expect(anomalies).toHaveLength(0);
    });

    it('should not flag normal variances', () => {
        const transactions = [
            { amount: 10, category: 'Food' },
            { amount: 15, category: 'Food' },
            { amount: 12, category: 'Food' },
            { amount: 8, category: 'Food' },
            { amount: 20, category: 'Food' }
        ];
        // 20 is high but likely within 2.5 std devs
        const anomalies = AnomalyService.detectOutliers(transactions);
        expect(anomalies).toHaveLength(0);
    });

});
