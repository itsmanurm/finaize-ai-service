
import { describe, it, expect, vi } from 'vitest';
import { categorize } from '../src/ai/enhanced-service';
import { loadFeedbackMemory } from '../src/ai/learning-service';
import { appendJsonl } from '../src/utils/jsonl';

// Mock config
vi.mock('../src/config', () => ({
    config: {
        OPENAI_API_KEY: 'mock-key',
        AI_MIN_CONFIDENCE: 0.6
    }
}));

// Mock OpenAI service to avoid real costs during quick tests, 
// OR we can make a real call if we want to test connectivity. 
// For now, let's mock the response to verify the flow logic (context injection).
vi.mock('../src/ai/openai-service', () => ({
    categorizeWithOpenAI: vi.fn().mockImplementation(async (input) => {
        // Check if context was passed
        if (input.context?.recentTransactions?.length > 0) {
            return {
                category: 'ConteXto_DetectadO', // Special string to verify context usage
                confidence: 0.99,
                reasoning: 'I saw the history'
            };
        }
        return {
            category: 'SimulatedAI',
            confidence: 0.8,
            reasoning: 'Simulated'
        };
    })
}));

describe('AI Enhanced Service', () => {
    it('should prioritize Feedback Loop (Memory)', async () => {
        // 1. Create a fake feedback entry
        await appendJsonl('feedback.jsonl', {
            dedupHash: 'test-hash',
            category_user: 'CategoriaAprendida',
            item: { description: 'Gasto Recurrente Test', merchant: 'MerchantTest' },
            ts: new Date().toISOString()
        });

        // 2. Force reload memory
        await loadFeedbackMemory(true);

        // 3. Ask to categorize samething
        const result = await categorize({
            description: 'Un Gasto Recurrente Test',
            merchant: 'MerchantTest', // Should match by merchant
            amount: -100,
            currency: 'ARS'
        });

        expect(result.category).toBe('CategoriaAprendida');
        expect(result.reasons[0]).toContain('learned:user_feedback');
    });

    it('should pass context to OpenAI', async () => {
        const result = await categorize({
            description: 'New Transaction',
            amount: -500,
            currency: 'ARS',
            useAI: true,
            previousTransactions: [
                { description: 'Old Tx', amount: -200, category: 'OldCat' }
            ]
        });

        expect(result.category).toBe('ConteXto_DetectadO');
    });
});
