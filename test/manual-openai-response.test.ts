import { describe, it } from 'vitest';
import { parseMessage } from '../src/ai/nlu';

const cases = [
  'Transferí $5000 a Juan',
  'Categoriza esta transacción: Starbucks $1200',
  '¿Cuáles son los mejores cedear hoy?',
  '¿Qué criptomonedas están subiendo esta semana?',
  'Recomendame acciones para invertir este mes'
];

describe('OpenAI NLU manual response analysis', () => {
  cases.forEach((msg) => {
    it(`OpenAI response for: ${msg}`, async () => {
      const res = await parseMessage(msg);
      // Loguea el resultado completo para análisis manual
      // eslint-disable-next-line no-console
      console.log('\nMensaje:', msg, '\nResultado:', JSON.stringify(res, null, 2));
    });
  });
});
