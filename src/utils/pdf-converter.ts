// src/utils/pdf-converter.ts
import { Buffer } from 'buffer';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/**
 * Carga pdfjs-dist de forma dinámica (ESM desde CommonJS)
 * Usa canvas para renderizar las páginas del PDF
 */
async function getPdfjsLib() {
  try {
    // Cargar pdfjs-dist dinámicamente usando import()
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib.default || pdfjsLib;
  } catch (err) {
    console.error('[PDF Converter] Error loading pdfjs-dist:', err);
    throw new Error('pdfjs-dist ESM module failed to load. Fallback: return placeholder');
  }
}

/**
 * Renderiza PDF a imagen usando canvas + pdfjs-dist
 * Fallback: si pdf2pic está disponible, usar eso
 */
export async function convertPdfPageToImage(
  base64: string,
  pageNumber: number = 1
): Promise<string> {
  try {
    console.log(`[PDF Converter] Converting PDF page ${pageNumber} to image`);
    
    const buffer = Buffer.from(base64, 'base64');
    console.log(`[PDF Converter] Buffer size: ${buffer.length} bytes`);

    // Intentar con pdf2pic primero (si ghostscript está disponible)
    try {
      console.log('[PDF Converter] Attempting pdf2pic (requires Ghostscript)...');
      const { fromBuffer } = await import('pdf2pic');
      
      const tmpDir = path.join(os.tmpdir(), 'pdf-conversions');
      const options = {
        density: 150,
        saveFilename: `page-${pageNumber}`,
        savePath: tmpDir,
        format: 'jpeg',
        width: 1200,
        height: 1600
      };

      const converter = fromBuffer(buffer, options);
      const result = await converter(pageNumber) as any;
      
      const imagePath = result?.path;
      if (imagePath) {
        console.log('[PDF Converter] pdf2pic succeeded');
        const imageBuffer = await fs.readFile(imagePath);
        return imageBuffer.toString('base64');
      }
    } catch (pdf2picError) {
      console.warn('[PDF Converter] pdf2pic not available, trying pdfjs-dist fallback...');
    }

    // Fallback: usar pdfjs-dist con canvas (sin ghostscript)
    console.log('[PDF Converter] Using pdfjs-dist + canvas (no Ghostscript needed)');
    
    let Canvas: any;
    try {
      // Intentar cargar canvas
      Canvas = require('canvas');
    } catch (e) {
      console.error('[PDF Converter] Canvas module not available');
      // Respuesta de error detallado
      throw new Error('Neither pdf2pic (Ghostscript) nor canvas module available. Please install Ghostscript or ensure canvas is installed.');
    }

    const { createCanvas } = Canvas;
    const pdfjsLib = await getPdfjsLib();
    
    const uint8Array = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    
    console.log(`[PDF Converter] PDF loaded, total pages: ${pdf.numPages}`);

    let pageNum = pageNumber;
    if (pageNum > pdf.numPages) {
      console.warn(`[PDF Converter] Page ${pageNum} exceeds PDF, using page 1`);
      pageNum = 1;
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 3 }); // Alta resolución para mejor OCR
    
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    const task = page.render({
      canvasContext: context,
      viewport: viewport
    } as any);
    await task.promise;

    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    const base64Image = imageBuffer.toString('base64');

    console.log(`[PDF Converter] Image created (${base64Image.length} chars base64)`);
    return base64Image;

  } catch (error) {
    console.error('[PDF Converter] Fatal error:', error);
    throw error;
  }
}
