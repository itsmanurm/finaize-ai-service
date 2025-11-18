import { describe, it, expect, vi } from 'vitest';
import { getOpenAIClient } from '../src/ai/openai-service';

describe('OpenAI Service', () => {
  it('should throw an error if OPENAI_API_KEY is not set', () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => getOpenAIClient()).toThrow('La variable de entorno OPENAI_API_KEY no está configurada.');

    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it('should return a client if OPENAI_API_KEY is set', () => {
    const client = getOpenAIClient();
    expect(client).toBeDefined();
  });
});