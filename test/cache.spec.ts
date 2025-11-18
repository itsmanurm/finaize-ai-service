import { describe, it, expect, beforeEach } from 'vitest';
import { setCachedCategorization, getCachedCategorization, clearAllCache } from '../src/ai/cache';

beforeEach(async () => {
  await clearAllCache();
});

describe('cache', () => {
  it('set and get cached categorization', async () => {
    const key = { description: 'unique-desc-' + Date.now(), amount: 123, currency: 'ARS' } as any;
    const data = { category: 'Test', confidence: 0.9 };

    await setCachedCategorization(key, data);
    const got = await getCachedCategorization(key);
    expect(got).toBeTruthy();
    expect(got.category).toBe('Test');
  });
});
