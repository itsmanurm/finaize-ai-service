// src/utils/pdf-converter.ts
import { Buffer } from 'buffer';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Polyfill para Node.js + Canvas + PDF.js
// Esto es CRÍTICO para solucionar "Image or Canvas expected"
// pdfjs-dist busca estas clases en el scope global al parsear imágenes
if (typeof process !== 'undefined' && process.versions != null && process.versions.node != null) {
  try {
    const Canvas = require('canvas');
    if (!(global as any).ImageData) { (global as any).ImageData = Canvas.ImageData; }
    if (!(global as any).Image) { (global as any).Image = Canvas.Image; }
    if (!(global as any).HTMLCanvasElement) { (global as any).HTMLCanvasElement = Canvas.Canvas; }
    // console.log('[Sistema] Inyectados polyfills de Global Canvas para pdfjs-dist');
  } catch (e) {
    console.warn('[Sistema] ⚠️ No se pudieron inyectar los globals de Canvas:', e);
  }
}

/**
 * Carga pdfjs-dist de forma dinámica (ESM desde CommonJS)
 * Usa canvas para renderizar las páginas del PDF
 */
export async function getPdfjsLib() {
  try {
    // Cargar pdfjs-dist dinámicamente usando import()
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib.default || pdfjsLib;
  } catch (err) {
    console.error('[Sistema] ❌ Error cargando pdfjs-dist:', err);
    throw new Error('El módulo ESM pdfjs-dist falló al cargar.');
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
    // console.log(`[Sistema] Convirtiendo página PDF ${pageNumber} a imagen`);

    const buffer = Buffer.from(base64, 'base64');
    console.log(`[PDF Converter] Buffer size: ${buffer.length} bytes`);

    // Intentar con pdf2pic primero (si ghostscript está disponible)
    try {
      // console.log('[Sistema] Intentando con pdf2pic (requiere Ghostscript)...');
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
        // console.log('[Sistema] pdf2pic completado con éxito');
        const imageBuffer = await fs.readFile(imagePath);
        return imageBuffer.toString('base64');
      }
    } catch (pdf2picError) {
      // console.warn('[Sistema] pdf2pic no disponible, intentando fallback con pdfjs-dist...');
    }

    // Fallback: usar pdfjs-dist con canvas (sin ghostscript)
    // console.log('[Sistema] Usando pdfjs-dist + canvas (no requiere Ghostscript)');

    let Canvas: any;
    try {
      // Intentar cargar canvas
      Canvas = require('canvas');
    } catch (e) {
      console.error('[Sistema] ❌ Módulo Canvas no disponible');
      // Respuesta de error detallado
      throw new Error('Neither pdf2pic (Ghostscript) nor canvas module available. Please install Ghostscript or ensure canvas is installed.');
    }

    const { createCanvas, Image } = Canvas;
    const pdfjsLib = await getPdfjsLib();

    // Configurar NodeCanvasFactory para pdfjs-dist
    // Esto es necesario para evitar "Image or Canvas expected"
    const canvasFactory = {
      create: function (width: number, height: number) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        return {
          canvas: canvas,
          context: context,
        };
      },
      reset: function (canvasAndContext: any, width: number, height: number) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
      },
      destroy: function (canvasAndContext: any) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
      },
    };

    let standardFontDataUrl: string | undefined;
    try {
      // Intentar configurar path a fuentes estándar
      const fontDir = path.join(
        path.dirname(require.resolve('pdfjs-dist/package.json')),
        'standard_fonts'
      );
      // pdfjs-dist requiere trailing slash y preferiblemente forward slashes como "factory url"
      const fontDirWin = fontDir.split(path.sep).join('/');
      standardFontDataUrl = fontDirWin.endsWith('/') ? fontDirWin : fontDirWin + '/';

      // console.log(`[Sistema] Ruta de fuentes estándar (normalizada): ${standardFontDataUrl}`);
    } catch (fontError) {
      console.warn('[Sistema] ⚠️ No se pudo resolver la ruta de fuentes estándar, siguiendo sin configuración específica:', fontError);
      // No lanzamos error, dejamos que pdfjs intente resolverlo o use fallback
    }

    const uint8Array = new Uint8Array(buffer);

    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      standardFontDataUrl, // Puede ser undefined
      disableFontFace: true,
    });

    const pdf = await loadingTask.promise;

    // console.log(`[Sistema] PDF cargado, total páginas: ${pdf.numPages}`);

    let pageNum = pageNumber;
    if (pageNum > pdf.numPages) {
      // console.warn(`[Sistema] Página ${pageNum} excede el PDF, usando página 1`);
      pageNum = 1;
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 3 }); // Alta resolución para mejor OCR

    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvasFactory: canvasFactory
    } as any;

    const task = page.render(renderContext);
    await task.promise;

    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });
    const base64Image = imageBuffer.toString('base64');

    // console.log(`[Sistema] Imagen creada (${base64Image.length} caracteres base64)`);
    return base64Image;

  } catch (error) {
    console.error('[Sistema] ❌ Error fatal en PDF Converter:', error);
    throw error;
  }
}
