import { describe, it, expect } from 'vitest';
import { parseMessage } from '../src/ai/nlu';

describe('NLU básico', () => {
  it('detecta gasto y extrae entidades', async () => {
    const msg = 'Agrega un gasto de 1200 en supermercado Carrefour';
    const result = await parseMessage(msg);
    expect(result.intent).toBe('add_expense');
    expect(result.entities.amount).toBe(1200);
    expect(result.entities.merchant).toMatch(/Carrefour/i);
  });

  it('detecta consulta de resumen', async () => {
    const msg = '¿Cuánto gasté este mes?';
    const result = await parseMessage(msg);
    expect(result.intent).toBe('query_summary');
  });

  it('detecta creación de meta', async () => {
    const msg = 'Quiero crear una meta para ahorrar 5000 pesos';
    const result = await parseMessage(msg);
    expect(result.intent).toBe('create_goal');
    expect(result.entities.amount).toBe(5000);
    expect(result.entities.currency).toMatch(/ARS|PESOS/i);
  });

  it('fallback a OpenAI en mensaje ambiguo', async () => {
    const msg = 'Me gustaría guardar dinero para vacaciones';
    const result = await parseMessage(msg);
    expect(result.intent).toMatch(/create_goal|unknown/);
  });
});
