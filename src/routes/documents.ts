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

    console.log('[Documents API] === ANALYZE REQUEST ===');
    console.log('[Documents API] fileName:', fileName);
    console.log('[Documents API] fileType:', fileType);
    console.log('[Documents API] has file:', !!file);
    console.log('[Documents API] has text:', !!text);
    console.log('[Documents API] file length:', file ? file.length : 0);

    if (!fileName) {
      return res.status(400).json({ ok: false, error: 'fileName requerido' });
    }

    let result;

    // === CASO 1: PDF => ANÁLISIS HÍBRIDO (Texto + Visión) ===
    if (fileType === 'application/pdf' && file) {
      console.log(`[Documents API] ========== PDF ANALYSIS START ==========`);
      console.log(`[Documents API] Processing PDF: ${fileName}`);
      console.log(`[Documents API] Original file length: ${file.length}`);

      // Variables para la estrategia
      let imageBase64: string | null = null;
      let textExtractionFailed = false;

      // 1. Limpieza y Validación
      // Limpiar prefijo data URI si existe
      const base64Clean = file.replace(/^data:application\/pdf;base64,/, '');
      console.log(`[Documents API] Clean base64 length: ${base64Clean.length}`);

      // Verificar MAGIC BYTES de PDF (%PDF)
      const bufferCheck = Buffer.from(base64Clean, 'base64');
      const header = bufferCheck.subarray(0, 5).toString('ascii');
      const hexHeader = bufferCheck.subarray(0, 5).toString('hex');
      console.log(`[Documents API] PDF Header Check: "${header}" (Hex: ${hexHeader})`);

      if (!header.startsWith('%PDF-')) {
        console.error(`[Documents API] CRITICAL: Invalid PDF header. Expected '%PDF-', got '${header}'`);
      }

      // 2. Intentar extracción de texto (Estrategia PRIMARIA)
      try {
        console.log('[Documents API] Strategy: Trying text extraction first...');
        const { extractTextFromPdf, cleanPdfText } = await import('../utils/pdf-utils');
        let extractedText = '';

        try {
          extractedText = cleanPdfText(await extractTextFromPdf(base64Clean));
          console.log(`[Documents API] Text extraction success: ${extractedText.length} chars`);
        } catch (e: any) {
          console.warn(`[Documents API] Text extraction failed: ${e.message}`);
          textExtractionFailed = true;
        }

        // Si hay texto suficiente (>50 chars), analizamos el texto
        if (!textExtractionFailed && extractedText.length > 50) {
          console.log('[Documents API] Analyzing extracted text directly...');
          result = await analyzeDocumentText(extractedText, fileName);

          // Evaluar confianza
          if (result.confidenceScores.global > 0.8) {
            result.reasoning = 'Analyzed via text extraction (High Confidence)';
            console.log('[Documents API] Text analysis sufficient. Skipping Vision.');
          } else {
            console.log('[Documents API] Text confidence low, proceeding to Vision fallback...');
            // Marcar para usar visión aunque tengamos texto resultado (para posible merge)
            // Pero primero necesitamos convertir a imagen
          }
        } else {
          console.log('[Documents API] Not enough usable text. Proceeding to Vision...');
        }
      } catch (err: any) {
        console.error('[Documents API] Error in text extraction phase:', err);
      }

      // 3. Estrategia de Visión (FALLBACK o COMPLEMENTO)
      // Si no tenemos resultado aún O la confianza es baja, intentamos visión
      if (!result || result.confidenceScores.global <= 0.8) {
        try {
          console.log('[Documents API] Converting PDF to image for Vision...');
          const imageBase64 = await convertPdfPageToImage(base64Clean, 1);

          if (!imageBase64 || imageBase64.length < 1000) {
            throw new Error('PDF conversion returned empty or too small image');
          }

          console.log(`[Documents API] PDF converted successfully (${imageBase64.length} chars). Sending to Vision...`);
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

          console.log('[Documents API] Vision analysis complete.');

        } catch (visionError: any) {
          console.error('[Documents API] Vision strategy failed:', visionError.message);
          
          if (!result) {
             // Si falló visión Y no teníamos resultado de texto, devolvemos error controlado
             console.error('[Documents API] Both text and vision strategies failed.');
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
      console.log(`[Documents API] ========== PDF ANALYSIS SUCCESS ==========`);
    }

    // === CASO 2: Texto plano ya extraído (para futuros OCR) ===
    else if (text) {
      console.log(`[Documents API] Analyzing provided text from: ${fileName}`);
      result = await analyzeDocumentText(text, fileName);
    }

    // === CASO 3: Imágenes (JPG/PNG/WEBP) ===
    else if (file && fileType) {
      console.log(`[Documents API] Analyzing image: ${fileName} (${fileType})`);
      result = await analyzeDocument(file, fileName, fileType);
    }

    else {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere file + fileType (para imágenes/PDFs) o text (para texto extraído)'
      });
    }

    console.log(`[Documents API] Analysis result for ${fileName}:`, {
      docType: result?.detectedDocType,
      hasAmount: !!result?.detectedFields?.monto,
      confidence: result?.confidenceScores?.global
    });

    return res.json({
      ok: true,
      analysis: result
    });

  } catch (error: any) {
    console.error('[Documents API] Error:', error);
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
            console.log(`[Documents API Batch] Processing PDF with Vision only: ${doc.fileName}`);
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
          console.error(`[Documents API Batch] Error analyzing ${doc.fileName}:`, error);
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
    console.error('[Documents API] Batch error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error al analizar documentos en lote'
    });
  }
});

export default r;
