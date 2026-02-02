// src/routes/documents.ts
import { Router } from 'express';
import { analyzeDocument, analyzeDocumentText } from '../ai/document-analyzer';
import { convertPdfPageToImage } from '../utils/pdf-converter';

const r = Router();

/**
 * POST /ai/documents/analyze
 * Analiza un documento (imagen o PDF) y extrae información estructurada
 */
r.post('/analyze', async (req, res) => {
  try {
    const { file, fileName, fileType, text } = req.body;

    /*
    console.log('[Documents API] === ANALYZE REQUEST ===');
    console.log('[Documents API] fileName:', fileName);
    console.log('[Documents API] fileType:', fileType);
    console.log('[Documents API] has file:', !!file);
    console.log('[Documents API] has text:', !!text);
    console.log('[Documents API] file length:', file ? file.length : 0);
    */

    if (!fileName) {
      return res.status(400).json({ ok: false, error: 'fileName requerido' });
    }

    let result;

    // === CASO 1: PDF => ANÁLISIS HÍBRIDO (Texto + Visión) ===
    if (fileType === 'application/pdf' && file) {
      // console.log(`[Sistema] ========== INICIO ANÁLISIS PDF ==========`);
      // console.log(`[Sistema] Procesando PDF: ${fileName}`);
      // console.log(`[Sistema] Longitud original del archivo: ${file.length}`);

      // Variables para la estrategia
      let imageBase64: string | null = null;
      let textExtractionFailed = false;

      // 1. Limpieza y Validación
      // Limpiar prefijo data URI si existe
      const base64Clean = file.replace(/^data:application\/pdf;base64,/, '');
      // console.log(`[Sistema] Longitud base64 limpia: ${base64Clean.length}`);

      // Verificar MAGIC BYTES de PDF (%PDF)
      const bufferCheck = Buffer.from(base64Clean, 'base64');
      const header = bufferCheck.subarray(0, 5).toString('ascii');
      const hexHeader = bufferCheck.subarray(0, 5).toString('hex');
      // console.log(`[Sistema] Verificación de Header PDF: "${header}" (Hex: ${hexHeader})`);

      if (!header.startsWith('%PDF-')) {
        console.error(`[Sistema] ❌ Header de PDF inválido. Se esperaba '%PDF-', se obtuvo '${header}'`);
      }

      // 2. Intentar extracción de texto (Estrategia PRIMARIA)
      try {
        // console.log('[Sistema] Estrategia: Intentando extracción de texto primero...');
        const { extractTextFromPdf, cleanPdfText } = await import('../utils/pdf-utils');
        let extractedText = '';

        try {
          extractedText = cleanPdfText(await extractTextFromPdf(base64Clean));
          // console.log(`[Sistema] Extracción de texto exitosa: ${extractedText.length} caracteres`);
        } catch (e: any) {
          console.warn(`[Sistema] ⚠️ Falló la extracción de texto: ${e.message}`);
          textExtractionFailed = true;
        }

        // Si hay texto suficiente (>50 chars), analizamos el texto
        if (!textExtractionFailed && extractedText.length > 50) {
          // console.log('[Sistema] Analizando texto extraído directamente...');
          result = await analyzeDocumentText(extractedText, fileName);

          // Evaluar confianza
          if (result.confidenceScores.global > 0.8) {
            result.reasoning = 'Analyzed via text extraction (High Confidence)';
            // console.log('[Sistema] Análisis de texto suficiente. Saltando Visión.');
          } else {
            // console.log('[Sistema] Confianza de texto baja, procediendo a fallback con Visión...');
            // Marcar para usar visión aunque tengamos texto resultado (para posible merge)
            // Pero primero necesitamos convertir a imagen
          }
        } else {
          // console.log('[Sistema] No hay suficiente texto usable. Procediendo a Visión...');
        }
      } catch (err: any) {
        console.error('[Sistema] ❌ Error en fase de extracción de texto:', err);
      }

      // 3. Estrategia de Visión (FALLBACK o COMPLEMENTO)
      // Si no tenemos resultado aún O la confianza es baja, intentamos visión
      if (!result || result.confidenceScores.global <= 0.8) {
        try {
          // console.log('[Sistema] Convirtiendo PDF a imagen para Visión...');
          const imageBase64 = await convertPdfPageToImage(base64Clean, 1);

          if (!imageBase64 || imageBase64.length < 1000) {
            throw new Error('La conversión de PDF devolvió una imagen vacía o demasiado pequeña');
          }

          // console.log(`[Sistema] PDF convertido con éxito (${imageBase64.length} caracteres). Enviando a Visión...`);
          const visionResult = await analyzeDocument(imageBase64, fileName, 'image/jpeg');

          if (result) {
            // MERGE: Si ya teníamos un resultado de texto (baja confianza), comparamos
            if (visionResult.confidenceScores.global > result.confidenceScores.global) {
              result = visionResult;
              result.reasoning = 'Hybrid: Vision preferred (Higher Confidence)';
            } else {
              result.reasoning = 'Hybrid: Text preferred (despite low confidence)';
            }
          } else {
            // Si no había resultado de texto, usamos Vision directo
            result = visionResult;
            result.reasoning = 'Analyzed via Vision (PDF image)';
          }

          // console.log('[Sistema] Análisis de Visión completado.');

        } catch (visionError: any) {
          console.error('[Sistema] ❌ Falló la estrategia de Visión:', visionError.message);

          if (!result) {
            // Si falló visión Y no teníamos resultado de texto, devolvemos error controlado
            console.error('[Sistema] ❌ Ambas estrategias (texto y visión) fallaron.');
            result = {
              detectedDocType: 'otro',
              direction: 'indeterminado',
              detectedFields: {},
              confidenceScores: { global: 0 },
              suggestedEntityType: 'transaction',
              reasoning: `PDF analysis failed. Text extraction failed. Image conversion failed: ${visionError.message}`
            } as any;
          }
        }
      }
      // console.log(`[Sistema] ========== ANÁLISIS PDF EXITOSO ==========`);
    }

    // === CASO 2: Texto plano ya extraído (para futuros OCR) ===
    else if (text) {
      // console.log(`[Sistema] Analizando texto proporcionado de: ${fileName}`);
      result = await analyzeDocumentText(text, fileName);
    }

    // === CASO 3: Imágenes (JPG/PNG/WEBP) ===
    else if (file && fileType) {
      // console.log(`[Sistema] Analizando imagen: ${fileName} (${fileType})`);
      result = await analyzeDocument(file, fileName, fileType);
    }

    else {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere file + fileType (para imágenes/PDFs) o text (para texto extraído)'
      });
    }

    /*
    console.log(`[Documents API] Analysis result for ${fileName}:`, {
      docType: result?.detectedDocType,
      hasAmount: !!result?.detectedFields?.monto,
      confidence: result?.confidenceScores?.global
    });
    */

    return res.json({
      ok: true,
      analysis: result
    });

  } catch (error: any) {
    console.error('[Sistema] ❌ Error en Documents API:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al analizar documento'
    });
  }
});

/**
 * POST /ai/documents/analyze/batch
 * Analiza múltiples documentos en lote
 */
r.post('/analyze/batch', async (req, res) => {
  try {
    const { documents } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ ok: false, error: 'documents array requerido' });
    }

    const results = await Promise.all(
      documents.map(async (doc) => {
        try {
          // === CASO 1: PDF => SIEMPRE IMAGEN + VISION ===
          if (doc.fileType === 'application/pdf' && doc.file) {
            // console.log(`[Sistema] Procesamiento de lote PDF con Visión: ${doc.fileName}`);
            const imageBase64 = await convertPdfPageToImage(doc.file, 1);
            const result = await analyzeDocument(imageBase64, doc.fileName, 'image/jpeg');
            result.reasoning = (result.reasoning || '') + ' | PDF analyzed as image (first page)';
            return result;
          }

          // === CASO 2: Texto plano ya extraído ===
          else if (doc.text) {
            return await analyzeDocumentText(doc.text, doc.fileName);
          }

          // === CASO 3: Imágenes ===
          else if (doc.file && doc.fileType) {
            return await analyzeDocument(doc.file, doc.fileName, doc.fileType);
          }

          else {
            throw new Error('Documento inválido: se requiere file + fileType o text');
          }
        } catch (error: any) {
          console.error(`[Sistema] ❌ Error analizando ${doc.fileName} en lote:`, error);
          return {
            error: error.message,
            fileName: doc.fileName
          };
        }
      })
    );

    return res.json({
      ok: true,
      results
    });

  } catch (error: any) {
    console.error('[Sistema] ❌ Error en lote de Documents API:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al analizar documentos en lote'
    });
  }
});

export default r;
