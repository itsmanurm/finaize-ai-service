import { describe, it, expect, beforeEach } from 'vitest';
import { categorize } from '../src/ai/enhanced-service';
import { clearAllCache } from '../src/ai/cache';

beforeEach(async () => {
  await clearAllCache();
});

describe('enhanced-service', () => {
  it('falls back to income default when no rules and no AI', async () => {
    const input = {
      description: 'some random description unlikely to match rules 12345',
      amount: 1000,
      currency: 'ARS'
    } as any;
    // Simular ausencia de AI para este test
    const _orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await categorize(input);

    // Restaurar clave
    process.env.OPENAI_API_KEY = _orig;
    expect(res).toBeTruthy();
    expect(res.category).toBe('Ingresos');
  });

  it('falls back to expense default when no rules and no AI', async () => {
    const input = {
      description: 'another-random-xxxxx',
      amount: -250,
      currency: 'ARS'
    } as any;
    // Simular ausencia de AI para este test
    const _orig = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await categorize(input);

    // Restaurar clave
    process.env.OPENAI_API_KEY = _orig;
    expect(res).toBeTruthy();
    expect(res.category).toBe('Sin clasificar');
  });
});
