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

    // === CASO 1: PDF => SIEMPRE IMAGEN + VISION ===
    if (fileType === 'application/pdf' && file) {
      console.log(`[Documents API] Processing PDF with Vision only: ${fileName}`);

      const imageBase64 = await convertPdfPageToImage(file, 1);
      console.log('[Documents API] PDF converted to image, length:', imageBase64.length);

      result = await analyzeDocument(imageBase64, fileName, 'image/jpeg');
      result.reasoning = (result.reasoning || '') + ' | PDF analyzed as image (first page)';
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
