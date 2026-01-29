/**
 * Formatea un número como moneda siguiendo las reglas de negocio:
 * - ARS: "$1.548.526,36" (con decimales) o "$1.548.526" (sin decimales si es entero)
 * - USD: "USD $520,34" (con decimales) o "USD $520" (sin decimales si es entero)
 * 
 * @param amount El monto a formatear
 * @param currency La moneda ('ARS' o 'USD')
 */
export function formatCurrency(amount: number, currency: string = 'ARS'): string {
    const isUSD = currency === 'USD';
    const prefix = isUSD ? 'USD $' : '$';

    // Check if it has distinct decimals from 00
    // Handle floating point precision issues if needed, but simple modulo usually works for money
    const hasDecimals = amount % 1 !== 0;

    const formatted = Math.abs(amount).toLocaleString('es-AR', {
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2,
    });

    return `${prefix}${formatted}`;
}
