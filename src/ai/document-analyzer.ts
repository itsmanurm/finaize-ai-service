// src/ai/document-analyzer.ts
import { getOpenAIClient } from './openai-service';

/**
 * Tipos de documentos detectables
 */
export enum DocumentType {
  FACTURA = 'factura',
  RECIBO = 'recibo',
  TRANSFERENCIA = 'transferencia',
  INGRESO = 'ingreso',
  EGRESO = 'egreso',
  RESUMEN_TARJETA = 'resumen_tarjeta',
  COMPROBANTE = 'comprobante',
  OTRO = 'otro'
}

/**
 * Dirección del flujo de dinero (para transferencias principalmente)
 */
export enum TransferDirection {
  SALIDA = 'salida',      // El usuario envió dinero
  ENTRADA = 'entrada',    // El usuario recibió dinero
  INTERNA = 'interna',    // Entre cuentas del mismo usuario
  INDETERMINADO = 'indeterminado'
}

/**
 * Tipo de entidad sugerida para crear a partir del documento
 */
export enum SuggestedEntityType {
  TRANSACTION = 'transaction',
  BILL = 'bill',
  INCOME = 'income',
  EXPENSE = 'expense',
  ADJUSTMENT = 'adjustment'
}

/**
 * Campos detectados en el documento
 */
export interface DetectedFields {
  fecha?: string;
  monto?: number;
  moneda?: string;
  origen?: string;
  destino?: string;
  aliasCbu?: string;
  categoria?: string;
  numeroFactura?: string;
  periodo?: string;
  vencimiento?: string;
  empresa?: string;
  concepto?: string;
  referencia?: string;
  nombreContraparte?: string;
  cuenta?: string;
  metodoPago?: string;
  impuestos?: number;
}

/**
 * Resultado del análisis de documento
 */
export interface DocumentAnalysisResult {
  detectedDocType: DocumentType;
  direction: TransferDirection;
  detectedFields: DetectedFields;
  confidenceScores: {
    global: number;
    [key: string]: number;
  };
  suggestedEntityType: SuggestedEntityType;
  reasoning?: string; // Explicación del análisis (para debug)
}

/**
 * ANÁLISIS POR HEURÍSTICAS (sin IA, gratis)
 * Intenta extraer info básica usando regex y patrones conocidos
 */
export function analyzeTextHeuristics(text: string): DocumentAnalysisResult | null {
  const lower = text.toLowerCase();
  const clean = text.replace(/\s+/g, ' ').trim();

  console.log('[Heuristics] Attempting text analysis, length:', clean.length);

  let detectedDocType = DocumentType.OTRO;
  let direction = TransferDirection.INDETERMINADO;
  const detectedFields: DetectedFields = {};
  let confidence = 0.3;

  // ===== 1. TIPO DE DOCUMENTO =====
  if (
    lower.includes('transferencia') ||
    lower.includes('transferiste') ||
    lower.includes('transferido') ||
    lower.includes('transference')
  ) {
    detectedDocType = DocumentType.TRANSFERENCIA;
  } else if (lower.includes('factura')) {
    detectedDocType = DocumentType.FACTURA;
  } else if (lower.includes('recibo') || lower.includes('comprobante de pago')) {
    detectedDocType = DocumentType.RECIBO;
  } else if (
    lower.includes('resumen') &&
    (lower.includes('tarjeta') || lower.includes('credit'))
  ) {
    detectedDocType = DocumentType.RESUMEN_TARJETA;
  } else if (lower.includes('ingreso') || lower.includes('depositado')) {
    detectedDocType = DocumentType.INGRESO;
  } else if (lower.includes('egreso') || lower.includes('pago')) {
    detectedDocType = DocumentType.EGRESO;
  }

  // ===== 2. DIRECCIÓN =====
  if (
    lower.includes('recibiste') ||
    lower.includes('te acreditamos') ||
    lower.includes('te depositamos') ||
    lower.includes('ingreso') ||
    lower.includes('te transferimos') ||
    lower.includes('depositado') ||
    lower.includes('acreditado') ||
    lower.includes('crédito') ||
    lower.includes('entrada') ||
    lower.includes('recibida')
  ) {
    direction = TransferDirection.ENTRADA;
  } else if (
    lower.includes('transferiste') ||
    lower.includes('enviaste') ||
    lower.includes('pagaste') ||
    lower.includes('débito') ||
    lower.includes('debito') ||
    lower.includes('transferencia') ||
    lower.includes('compra') ||
    lower.includes('egreso') ||
    lower.includes('salida') ||
    lower.includes('enviada') ||
    lower.includes('destino')
  ) {
    direction = TransferDirection.SALIDA;
  } else if (lower.includes('entre tus cuentas') || lower.includes('cuenta propia')) {
    direction = TransferDirection.INTERNA;
  }

  // ===== 3. MONTO =====
  const montoPatterns = [
    /monto[:\s]+([\d\.\,]+)/i,
    /total[:\s]+([\d\.\,]+)/i,
    /importe[:\s]+([\d\.\,]+)/i,
    /cantidad[:\s]+([\d\.\,]+)/i,
    /(?:ars|\$)\s+([\d\.\,]+(?:[\.,]\d{2})?)/i,
    /(?:ars|\$)\s*([\d\.\,]+(?:[\.,]\d{2})?)\s*(?:ars|pesos)?/i,
  ];

  for (const pattern of montoPatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      let raw = match[1];
      const parts = raw.split(/[.,]/);
      if (parts.length > 2) {
        raw = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
      } else {
        raw = raw.replace(/\./g, '').replace(',', '.');
      }

      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed < 100000000) {
        detectedFields.monto = parsed;
        confidence = Math.max(confidence, 0.75);
        console.log('[Heuristics] Found monto:', parsed);
        break;
      }
    }
  }

  // ===== 4. FECHA =====
  const fechaPatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /(\d{1,2})\s+de\s+([a-zA-Z]+)(?:\s+de\s+(\d{4}))?/, // 12 de Diciembre
    /(\d{1,2})\s+([a-zA-Z]{3})\.?\s+(\d{4})/, // 12 Dic 2024
  ];

  for (const pattern of fechaPatterns) {
    const match = clean.match(pattern);
    if (match) {
      let day = match[1];
      let month = match[2];
      let year = match[3];

      if (Number(day) > 31) {
        [day, year] = [year, day];
      }

      if (Number(year) < 100) {
        year = String(2000 + Number(year));
      }

      detectedFields.fecha = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      confidence = Math.max(confidence, 0.75);
      console.log('[Heuristics] Found fecha:', detectedFields.fecha);
      break;
    }
  }

  // ===== 5. CONTRAPARTE =====
  const contrapartePatterns = [
    /(?:destino|destina)[\s]*Titular[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\w\s\.]+?)(?:\n|$|CBU|Alias)/i,
    /(?:destinatario)[\s:]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\w\s\.]{3,50})/i,
    /(?:empresa|cliente|usuario)[\s:]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\w\s\.]{3,50})/i,
    /(?:para|a|remitente)[\s:]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\w\s\.]{3,50})/i,
  ];

  for (const pattern of contrapartePatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      // Exclude if it looks like a date or technical info
      if (!/^\d|Fecha|operación|comprobante|banco|estado|número/i.test(candidate) && candidate.length > 2) {
        detectedFields.nombreContraparte = candidate;
        console.log('[Heuristics] Found contraparte:', detectedFields.nombreContraparte);
        break;
      }
    }
  }

  // ===== 6. CONCEPTO =====
  if (!detectedFields.nombreContraparte) {
    const conceptoMatch = clean.match(
      /(?:concepto|descripcion|motivo|asunto)[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\w\s\.,]{5,80})/i
    );
    if (conceptoMatch?.[1]) {
      detectedFields.concepto = conceptoMatch[1].trim();
      console.log('[Heuristics] Found concepto:', detectedFields.concepto);
    }
  }

  // ===== 7. MONEDA =====
  if (lower.includes('usd') || lower.includes('dolar')) {
    detectedFields.moneda = 'USD';
  } else if (lower.includes('ars') || lower.includes('pesos')) {
    detectedFields.moneda = 'ARS';
  }

  // ===== 8. MÉTODO DE PAGO =====
  if (lower.includes('transferencia')) {
    detectedFields.metodoPago = 'transferencia';
  } else if (lower.includes('débito') || lower.includes('debito')) {
    detectedFields.metodoPago = 'debito';
  } else if (lower.includes('crédito') || lower.includes('credito')) {
    detectedFields.metodoPago = 'credito';
  }

  // ===== 9. CATEGORÍA =====
  if (detectedDocType === DocumentType.TRANSFERENCIA) {
    detectedFields.categoria =
      direction === TransferDirection.ENTRADA ? 'Ingresos' : 'Transferencias';
  }

  // ===== DECIDIR SI DEVUELVO =====
  const hasMinimum = !!detectedFields.monto && !!detectedFields.fecha;
  if (!hasMinimum) {
    console.log('[Heuristics] Insufficient data (needs monto+fecha), delegating to GPT');
    return null;
  }

  console.log('[Heuristics] Success with heuristics!', {
    docType: detectedDocType,
    direction,
    monto: detectedFields.monto,
    fecha: detectedFields.fecha,
  });

  return {
    detectedDocType,
    direction,
    detectedFields,
    confidenceScores: {
      global: confidence,
      monto: !!detectedFields.monto ? 0.8 : 0,
      fecha: !!detectedFields.fecha ? 0.8 : 0,
    },
    suggestedEntityType: SuggestedEntityType.TRANSACTION,
    reasoning: 'Análisis por heurísticas (sin consumir tokens GPT)',
  };
}

/**
 * Analiza un documento usando visión de OpenAI
 */
export async function analyzeDocument(
  base64Image: string,
  fileName: string,
  fileType: string,
  userContext?: { userId?: string; recentTransactions?: any[] }
): Promise<DocumentAnalysisResult> {
  console.log('[analyzeDocument] Starting vision analysis for:', fileName);
  
  try {
    const openai = getOpenAIClient();
    console.log('[analyzeDocument] OpenAI client obtained successfully');

    // Remover prefijo data:image si existe
    const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

  const prompt = `Sos un experto analizando documentos financieros argentinos. Analiza esta imagen y extrae la información relevante.

El documento puede ser:
- Factura (servicios, compras, etc)
- Recibo (comprobante de pago)
- Transferencia bancaria (captura de app bancaria o home banking)
- Comprobante de ingreso
- Comprobante de egreso
- Resumen de tarjeta de crédito
- Otro tipo de documento financiero

IMPORTANTE para TRANSFERENCIAS:
- Si el documento dice "transferiste", "enviaste", "pagaste", "transferencia enviada", "débito", o similar: direction = "salida" (el usuario ENVIÓ dinero)
- Si dice "recibiste", "te depositaron", "ingreso", "acreditación", "crédito", o similar: direction = "entrada" (el usuario RECIBIÓ dinero)
- Si menciona "entre tus cuentas", "transferencia interna": direction = "interna"
- Si no está claro: direction = "indeterminado"

Extrae TODO lo que puedas:
- fecha (formato YYYY-MM-DD si es posible, sino el texto original)
- monto (solo el número, sin símbolo de moneda)
- moneda (ARS, USD, etc)
- origen (de dónde viene el dinero: nombre, alias, CBU)
- destino (a dónde va: nombre, alias, CBU)
- aliasCbu (alias o CBU si aparece)
- categoria (sugiere una categoría apropiada: Servicios, Alimentación, Transporte, Transferencias, Salud, etc)
- numeroFactura
- periodo (ej: "Enero 2025" si es factura de servicio)
- vencimiento (fecha de vencimiento)
- empresa (nombre de la empresa emisora)
- concepto (descripción del movimiento)
- referencia (número de operación/referencia)
- nombreContraparte (nombre de la otra persona/empresa involucrada)
- cuenta (número de cuenta si aparece)
- metodoPago (efectivo, débito, crédito, transferencia)
- impuestos (monto de impuestos si aplica)

También asigna:
- suggestedEntityType: qué tipo de registro crear en el sistema (transaction, bill, income, expense, adjustment)
- confidenceScores: un objeto con el score global (0-1) y scores por campo

RESPONDE SOLO CON ESTE FORMATO JSON EXACTO (sin markdown, sin explicaciones adicionales):
{
  "detectedDocType": "transferencia|factura|recibo|ingreso|egreso|resumen_tarjeta|comprobante|otro",
  "direction": "entrada|salida|interna|indeterminado",
  "detectedFields": { ... },
  "confidenceScores": { "global": 0.92, ... },
  "suggestedEntityType": "transaction|bill|income|expense|adjustment"
}
{
  "detectedDocType": "transferencia",
  "direction": "salida",
  "detectedFields": {
    "fecha": "2025-12-10",
    "monto": 15000,
    "moneda": "ARS",
    "origen": "Juan Pérez",
    "destino": "María García",
    "aliasCbu": "maria.garcia.mp",
    "categoria": "Transferencias",
    "concepto": "Pago compartido",
    "referencia": "123456789",
    "nombreContraparte": "María García",
    "metodoPago": "transferencia"
  },
  "confidenceScores": {
    "global": 0.92,
    "fecha": 0.95,
    "monto": 0.98,
    "origen": 0.85,
    "destino": 0.90
  },
  "suggestedEntityType": "transaction",
  "reasoning": "Es una transferencia bancaria enviada por el usuario, con todos los datos claros"
}`;

    console.log('[Document Analyzer] Analyzing document:', fileName);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${fileType};base64,${cleanBase64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.1, // Baja temperatura para respuestas más consistentes
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No se recibió respuesta del modelo');
    }

    console.log('[Document Analyzer] Raw response length:', content.length);

    // Parsear JSON, manejando posibles bloques de markdown
    let jsonText = content.trim();
    if (jsonText.startsWith('```')) {
      // Remover bloques de markdown
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    console.log('[Document Analyzer] Parsing JSON, length:', jsonText.length);

    const result: DocumentAnalysisResult = JSON.parse(jsonText);

    console.log('[Document Analyzer] Analysis complete:', {
      docType: result.detectedDocType,
      direction: result.direction,
      confidence: result.confidenceScores?.global,
      entityType: result.suggestedEntityType,
      hasAmount: !!result.detectedFields?.monto
    });

    // Validaciones y defaults
    if (!result.detectedDocType) {
      result.detectedDocType = DocumentType.OTRO;
    }
    if (!result.direction) {
      result.direction = TransferDirection.INDETERMINADO;
    }
    if (!result.detectedFields) {
      result.detectedFields = {};
    }
    if (!result.confidenceScores) {
      result.confidenceScores = { global: 0.5 };
    }
    if (!result.suggestedEntityType) {
      result.suggestedEntityType = SuggestedEntityType.TRANSACTION;
    }

    return result;

  } catch (error: any) {
    console.error('[Document Analyzer] Error analyzing document:', error);

    // Fallback: retornar análisis básico
    return {
      detectedDocType: DocumentType.OTRO,
      direction: TransferDirection.INDETERMINADO,
      detectedFields: {
        concepto: `Documento: ${fileName}`
      },
      confidenceScores: {
        global: 0.1
      },
      suggestedEntityType: SuggestedEntityType.TRANSACTION,
      reasoning: `Error en análisis: ${error.message}`
    };
  }
}

/**
 * Analiza texto extraído de un PDF (OCR ya aplicado)
 */
export async function analyzeDocumentText(
  text: string,
  fileName: string,
  userContext?: { userId?: string; recentTransactions?: any[] }
): Promise<DocumentAnalysisResult> {
  console.log('[Documents] analyzeDocumentText started, text length:', text.length);

  // STEP 1: Clean text
  const cleanText = text.replace(/\s+/g, ' ').trim();
  console.log('[Documents] Text cleaned, length:', cleanText.length);

  // STEP 2: TRY HEURISTICS FIRST (no GPT cost)
  console.log('[Documents] Attempting heuristic analysis...');
  const heuristicResult = analyzeTextHeuristics(cleanText);

  if (heuristicResult &&
    heuristicResult.detectedFields?.monto &&
    heuristicResult.detectedFields?.fecha) {
    console.log('[Documents] ✅ Heuristics successful! Using result, skipping GPT-4');
    console.log('[Documents] Heuristic result:', {
      monto: heuristicResult.detectedFields.monto,
      fecha: heuristicResult.detectedFields.fecha,
      contraparte: heuristicResult.detectedFields.nombreContraparte,
      confidence: heuristicResult.confidenceScores.global
    });
    return heuristicResult;
  }

  if (heuristicResult) {
    console.log('[Documents] Heuristics partial (missing critical fields), will use GPT as fallback');
  } else {
    console.log('[Documents] Heuristics returned null, delegating to GPT-4');
  }

  // STEP 3: Fallback to GPT-4
  const openai = getOpenAIClient();

  const prompt = `Sos un experto analizando documentos financieros argentinos. Analiza este texto extraído de un documento y extrae la información relevante.

TEXTO DEL DOCUMENTO:
${text}

El documento puede ser:
- Factura (servicios, compras, etc)
- Recibo (comprobante de pago)
- Transferencia bancaria
- Comprobante de ingreso
- Comprobante de egreso
- Resumen de tarjeta de crédito
- Otro tipo de documento financiero

IMPORTANTE para TRANSFERENCIAS:
- Si el documento dice "transferiste", "enviaste", "pagaste", "transferencia enviada", "débito": direction = "salida"
- Si dice "recibiste", "te depositaron", "ingreso", "acreditación", "crédito": direction = "entrada"
- Si menciona "entre tus cuentas", "transferencia interna": direction = "interna"
- Si no está claro: direction = "indeterminado"

Extrae TODO lo que puedas.

RESPONDE SOLO CON ESTE FORMATO JSON EXACTO (sin markdown, sin explicaciones):
{
  "detectedDocType": "transferencia|factura|recibo|ingreso|egreso|resumen_tarjeta|comprobante|otro",
  "direction": "entrada|salida|interna|indeterminado",
  "detectedFields": {
    "fecha": "YYYY-MM-DD o string",
    "monto": número,
    "moneda": "ARS|USD|etc",
    "origen": "string",
    "destino": "string",
    "aliasCbu": "string",
    "categoria": "string",
    "concepto": "string",
    "nombreContraparte": "string"
  },
  "confidenceScores": {
    "global": 0.0-1.0,
    "fecha": 0.0-1.0,
    "monto": 0.0-1.0
  },
  "suggestedEntityType": "transaction"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No se recibió respuesta del modelo');
    }

    console.log('[Document Analyzer] Text analysis response length:', content.length);

    let jsonText = content.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    console.log('[Document Analyzer] Parsing JSON from text, length:', jsonText.length);

    const result: DocumentAnalysisResult = JSON.parse(jsonText);

    console.log('[Document Analyzer] Text analysis complete:', {
      docType: result.detectedDocType,
      direction: result.direction,
      confidence: result.confidenceScores?.global,
      hasAmount: !!result.detectedFields?.monto
    });

    // Validaciones
    if (!result.detectedDocType) result.detectedDocType = DocumentType.OTRO;
    if (!result.direction) result.direction = TransferDirection.INDETERMINADO;
    if (!result.detectedFields) result.detectedFields = {};
    if (!result.confidenceScores) result.confidenceScores = { global: 0.5 };
    if (!result.suggestedEntityType) result.suggestedEntityType = SuggestedEntityType.TRANSACTION;

    return result;

  } catch (error: any) {
    console.error('[Document Analyzer] Error analyzing text:', error.message);
    console.error('[Document Analyzer] Error type:', error.constructor.name);

    return {
      detectedDocType: DocumentType.OTRO,
      direction: TransferDirection.INDETERMINADO,
      detectedFields: {
        concepto: `Documento: ${fileName}`
      },
      confidenceScores: {
        global: 0.1
      },
      suggestedEntityType: SuggestedEntityType.TRANSACTION,
      reasoning: `Error en análisis: ${error.message}`
    };
  }
}
