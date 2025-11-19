import { describe, it, expect } from 'vitest';
import { parseMessage } from '../src/ai/nlu';


const cases = [
  {
    message: '¿Cuáles fueron mis gastos altos este mes?',
    expectedIntent: 'query_top_expenses',
  },
  {
    message: 'Sumame todos los gastos en supermercados en noviembre',
    expectedIntent: 'query_summary',
  },
  {
    message: 'Transferí $5000 a Juan',
    expectedIntent: 'add_expense',
    expectedEntities: { category: 'transferencia', amount: 5000, merchant: 'Juan' }
  },
  {
    message: '¿Cuánto gasté en restaurantes este año?',
    expectedIntent: 'query_summary',
  },
  {
    message: 'Quiero crear una meta de ahorro de $10000',
    expectedIntent: 'create_goal',
  },
  {
    message: 'Categoriza esta transacción: Starbucks $1200',
    expectedIntent: 'categorize',
    expectedEntities: { amount: 1200, merchant: 'Starbucks' }
  },
  {
    message: '¿Cuáles son los mejores cedear hoy?',
    expectedIntent: 'query_market_info',
    expectedEntities: { activo: 'cedear', period: 'hoy', tipo: 'mejores' }
  },
  {
    message: '¿Qué criptomonedas están subiendo esta semana?',
    expectedIntent: 'query_market_info',
    expectedEntities: { activo: 'criptomoneda', period: 'semana', tipo: 'subiendo' }
  },
  {
    message: 'Recomendame acciones para invertir este mes',
    expectedIntent: 'query_market_info',
    expectedEntities: { activo: 'acción', period: 'mes', tipo: 'recomendación' }
  },
  {
    message: '¿Cuánto gasté en Uber en octubre?',
    expectedIntent: 'query_summary',
  },
];


describe('NLU Intents - Robustness', () => {
  cases.forEach(({ message, expectedIntent, expectedEntities }) => {
    it(`detects intent '${expectedIntent}' for: ${message}`, async () => {
      const result = await parseMessage(message);
      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBeGreaterThan(0.7);
      // Ajustar el test para usar el nuevo tipo de entidades
      if (expectedEntities) {
        expect(result.entities).toBeDefined();
        // comparar parcialmente las entidades esperadas (mejor práctica en tests)
        expect(result.entities).toEqual(expect.objectContaining(expectedEntities));
      }
    });
  });
});
