// src/utils/pdf-utils.ts
import { Buffer } from 'buffer';

/**
 * Extrae texto de un PDF usando pdf-parse
 * Útil para PDFs digitales (no escaneados)
 */
export async function extractTextFromPdf(base64: string): Promise<string> {
  try {
    console.log('[PDF Utils] Extracting text from PDF...');
    
    const buffer = Buffer.from(base64, 'base64');
    
    // Usar require para pdf-parse (mejor compatibilidad con tipos)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    
    console.log('[PDF Utils] Text extracted, length:', data.text.length);
    console.log('[PDF Utils] Pages found:', data.numpages);
    
    return data.text;
  } catch (error: any) {
    console.error('[PDF Utils] Error extracting text:', error.message);
    return '';
  }
}

/**
 * Determina si un PDF es escaneado (imagen) o digital (texto embebido)
 * Un PDF escaneado tendrá muy poco texto extraíble
 */
export function isPdfScanned(extractedText: string, pageCount: number = 1): boolean {
  // Si hay menos de 50 caracteres por página, probablemente es escaneado
  const charsPerPage = extractedText.length / pageCount;
  const isScanned = charsPerPage < 50;
  
  console.log(`[PDF Utils] Chars per page: ${charsPerPage}, isScanned: ${isScanned}`);
  return isScanned;
}

/**
 * Limpia el texto extraído de un PDF
 * Elimina espacios excesivos, caracteres de control, etc.
 */
export function cleanPdfText(text: string): string {
  return text
    // Normalizar saltos de línea
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Eliminar múltiples espacios
    .replace(/[ \t]+/g, ' ')
    // Eliminar líneas vacías múltiples
    .replace(/\n{3,}/g, '\n\n')
    // Eliminar caracteres de control excepto newline
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Obtiene información básica del PDF sin renderizar
 */
export async function getPdfInfo(base64: string): Promise<{
  pageCount: number;
  hasText: boolean;
  textLength: number;
}> {
  try {
    const buffer = Buffer.from(base64, 'base64');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    
    return {
      pageCount: data.numpages,
      hasText: data.text.length > 100,
      textLength: data.text.length
    };
  } catch (error) {
    return {
      pageCount: 1,
      hasText: false,
      textLength: 0
    };
  }
}
