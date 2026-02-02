// src/utils/pdf-utils.ts
import { Buffer } from 'buffer';

// Importamos la función auxiliar para obtener pdfjsLib configurado
import { getPdfjsLib } from './pdf-converter';

/**
 * Extrae texto de un PDF usando pdfjs-dist directamente
 * Elimina la necesidad de pdf-parse y unifica la lógica
 */
export async function extractTextFromPdf(base64: string): Promise<string> {
  try {
    // console.log('[Sistema] Extrayendo texto de PDF vía pdfjs-dist...');

    const buffer = Buffer.from(base64, 'base64');
    const uint8Array = new Uint8Array(buffer);

    const pdfjsLib = await getPdfjsLib();

    // Configuración mínima para cargar el documento solo para texto
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      disableFontFace: true, // No necesitamos fuentes para extraer texto
      useSystemFonts: false
    });

    const pdf = await loadingTask.promise;
    // console.log('[Sistema] Documento cargado, páginas:', pdf.numPages);

    let fullText = '';

    // Extraer texto de todas las páginas (o límite seguro)
    const maxPages = Math.min(pdf.numPages, 5);

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // Unir items de texto con espacios
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');

      fullText += pageText + '\n\n';
    }

    // console.log('[Sistema] Texto extraído, longitud:', fullText.length);

    return fullText;
  } catch (error: any) {
    console.error('[Sistema] ❌ Error extrayendo texto:', error.message);
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

  // console.log(`[Sistema] Chars por página: ${charsPerPage}, isScanned: ${isScanned}`);
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
