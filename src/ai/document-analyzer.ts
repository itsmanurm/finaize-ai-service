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
  PAGO_SERVICIOS = 'pago_servicios', // Nuevo tipo para servicios públicos
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

  // console.log('[Sistema] Intentando análisis por heurísticas, longitud:', clean.length);

  let detectedDocType = DocumentType.OTRO;
  let direction = TransferDirection.INDETERMINADO;
  const detectedFields: DetectedFields = {};
  let confidence = 0.3;

  // ===== 1. TIPO DE DOCUMENTO (mejorado para Argentina) =====

  // Mercado Pago patterns
  const isMercadoPago = lower.includes('mercado pago') || lower.includes('mercadopago') ||
    lower.includes('le pagaste a') || lower.includes('te pagó') ||
    lower.includes('dinero disponible') || lower.includes('cvu');

  // Personal Pay patterns
  const isPersonalPay = lower.includes('personal pay') || lower.includes('personalpay') ||
    lower.includes('te enviaron dinero') || lower.includes('enviaste dinero');

  // Transfer patterns (expanded con Personal Pay y más variantes)
  const isTransfer = lower.includes('transferencia') || lower.includes('transferiste') ||
    lower.includes('transferido') || lower.includes('transference') ||
    lower.includes('le pagaste a') || lower.includes('te pagó') ||
    lower.includes('enviaste') || lower.includes('recibiste') ||
    lower.includes('te enviaron dinero') || lower.includes('enviaste dinero') ||
    lower.includes('cbu') || lower.includes('alias') ||
    lower.includes('n° de operación') || lower.includes('coelsa');

  // Invoice/Bill patterns (facturas de servicios argentinos)
  const isFactura = lower.includes('factura') || lower.includes('invoice') ||
    lower.includes('período') || lower.includes('vencimiento') ||
    lower.includes('edenor') || lower.includes('edesur') ||
    lower.includes('metrogas') || lower.includes('aysa') ||
    lower.includes('telecom') || lower.includes('personal') ||
    lower.includes('movistar') || lower.includes('claro') ||
    lower.includes('cuit') || lower.includes('número de cliente');

  // Receipt patterns
  const isRecibo = lower.includes('recibo') || lower.includes('comprobante de pago') ||
    lower.includes('ticket') || lower.includes('constancia');

  // Card statement patterns
  const isResumenTarjeta = (lower.includes('resumen') && (lower.includes('tarjeta') || lower.includes('credit'))) ||
    lower.includes('visa') || lower.includes('mastercard') ||
    lower.includes('american express') || lower.includes('consumos del período');

  if (isTransfer || isMercadoPago || isPersonalPay) {
    detectedDocType = DocumentType.TRANSFERENCIA;
  } else if (
    (lower.includes('litoral') && lower.includes('gas')) ||
    lower.includes('edenor') ||
    lower.includes('edesur') ||
    lower.includes('metrogas') ||
    lower.includes('aysa') ||
    lower.includes('telecom') ||
    lower.includes('personal') ||
    lower.includes('fibertel') ||
    lower.includes('movistar') ||
    lower.includes('claro') ||
    lower.includes('flow') ||
    lower.includes('trenes argentinos') || // Transporte
    lower.includes('operadora ferroviaria') // Legal name Trenes Argentinos
  ) {
    detectedDocType = DocumentType.PAGO_SERVICIOS;
  } else if (isFactura) {
    detectedDocType = DocumentType.FACTURA;
  } else if (isRecibo) {
    detectedDocType = DocumentType.RECIBO;
  } else if (isResumenTarjeta) {
    detectedDocType = DocumentType.RESUMEN_TARJETA;
  } else if ((lower.includes('ingreso') || lower.includes('depositado')) && !lower.includes('impuesto') && !/ingresos?\s*brutos|imp\.ing\.?|iibb/i.test(lower)) {
    detectedDocType = DocumentType.INGRESO;
  } else if (lower.includes('egreso') || lower.includes('pago')) {
    detectedDocType = DocumentType.EGRESO;
  }

  // ===== 2. DIRECCIÓN (mejorado para Personal Pay) =====
  // ===== 2. DIRECCIÓN (mejorado para Personal Pay) =====

  // Prioridad 1: Si es Pago de Servicios, es SALIDA (gastos)
  if (detectedDocType === DocumentType.PAGO_SERVICIOS) {
    direction = TransferDirection.SALIDA;
  }
  // Prioridad 2: Keywords explícitas
  else if (
    lower.includes('recibiste') ||
    lower.includes('te acreditamos') ||
    lower.includes('te depositamos') ||
    (lower.includes('ingreso') && !lower.includes('impuesto') && !/ingresos?\s*brutos|imp\.ing\.?|iibb/i.test(lower)) || // Evitar confusion con IIBB y variantes
    lower.includes('te transferimos') ||
    lower.includes('depositado') ||
    lower.includes('acreditado') ||
    (lower.includes('crédito') && !lower.includes('nota de crédito') && !lower.includes('imp.s/créd') && !lower.includes('impuesto')) || // Evitar impuestos y creditos fiscales
    (lower.includes('entrada') && !lower.includes('entrada/salida')) || // Evitar "lugares de entrada/salida"
    lower.includes('recibida') ||
    lower.includes('te enviaron dinero') ||
    lower.includes('te pagó')
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
    lower.includes('destino') ||
    lower.includes('total a pagar') || // Facturas suelen implicar pago
    detectedDocType === DocumentType.FACTURA
  ) {
    direction = TransferDirection.SALIDA;
  } else if (lower.includes('entre tus cuentas') || lower.includes('cuenta propia')) {
    direction = TransferDirection.INTERNA;
  }

  // ===== 3. MONTO (Lógica mejorada: Detección inteligente de formato US/AR) =====

  // Función helper para parsear montos ambiguos
  const parseFlexibleAmount = (raw: string): number | null => {
    // Limpiar basura
    let val = raw.trim().replace(/^[^\d]+/, '');
    if (!val) return null;

    const lastDot = val.lastIndexOf('.');
    const lastComma = val.lastIndexOf(',');

    // Caso 1: Ambos separadores presentes (Ej: 1,234.56 o 1.234,56)
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastDot > lastComma) {
        // Formato US: 1,234.56 -> eliminar comas
        val = val.replace(/,/g, '');
      } else {
        // Formato AR/EU: 1.234,56 -> eliminar puntos, cambiar coma por punto
        val = val.replace(/\./g, '').replace(',', '.');
      }
    }
    // Caso 2: Solo comas (Ej: 123,45 o 1,234)
    else if (lastComma !== -1) {
      // En contexto AR, la coma suele ser decimal: 123,45
      // Pero si es "1,234", podría ser mil.
      // Heurística: si tiene 3 decimales exactos (1,234) y es un número "redondo" visualmente podría ser miles,
      // pero ante la duda en AR, coma = decimal.
      // Excepcion: si hay multiples comas "1,234,567" -> imposible en AR, es US.
      if ((val.match(/,/g) || []).length > 1) {
        val = val.replace(/,/g, ''); // US Thousands
      } else {
        val = val.replace(',', '.'); // AR Decimal
      }
    }
    // Caso 3: Solo puntos (Ej: 1.234 o 123.45)
    else if (lastDot !== -1) {
      // Si hay más de un punto (1.234.567), seguro son miles AR.
      if ((val.match(/\./g) || []).length > 1) {
        val = val.replace(/\./g, '');
      } else {
        // Un solo punto: "1.234" vs "11607.90"
        // REGLA MEJORADA: En AR, el punto de miles agrupa de a 3.
        // Si lo que sigue al punto NO son 3 dígitos exactos, asumo que es decimal.
        const parts = val.split('.');
        const lastPart = parts[parts.length - 1]; // Lo que está después del último punto

        if (lastPart && lastPart.length === 3) {
          // Ej: "1.234" -> Probable 1234
          // Asumimos miles AR
          val = val.replace(/\./g, '');
        } else {
          // Ej: "11607.90" (2 digitos) -> Decimal
          // Ej: "12.5" (1 digito) -> Decimal
          // Dejar el punto como decimal
        }
      }
    }

    const num = Number(val);
    return isNaN(num) ? null : num;
  };

  // A) Buscar etiquetas explícitas de TOTAL (Muy confiables)
  // Regex relajada: captura todo lo que parezca número con separadores
  // A) Buscar etiquetas explícitas de TOTAL (Muy confiables)
  // ESTRATEGIA: Buscar TODAS las coincidencias, filtrar falsos positivos ("Sub Total", "P.Total"), 
  // y elegir el MAYOR monto encontrado (ya que el Total siempre es >= Subtotal/Neto).
  const totalPatterns = [
    // Total con posible simbolo de moneda (o OCR fail como S, s, 5)
    /(?:^|\s)(?:total a pagar|importe total|saldo a pagar|total)(?:[:\s]|$)+(?:[\$Ss5]\s*)?([\d.,]+)/gi,
    // Total simple con boundary estricto
    /(?:^|\s)Total(?:[:\s]|$)+\$?\s*([\d.,]+)/gi
  ];

  let validTotalCandidates: number[] = [];
  let montoFound = false;

  for (const pattern of totalPatterns) {
    let match;
    while ((match = pattern.exec(clean)) !== null) {
      const rawAmount = match[1];
      const fullMatch = match[0];
      const matchIndex = match.index;

      // Validación de CONTEXTO: Verificar qué hay justo antes del match
      const prefixWindow = clean.substring(Math.max(0, matchIndex - 15), matchIndex).toLowerCase();

      // Ignorar si está precedido por "sub", "p.", "precio", "neto" (si es que la regex de total matcheó solo "total")
      // Ejemplo: "Sub Total", "P. Total", "Precio Total", "Importe Base"
      if (/(?:sub|p\.|precio|neto|base)\s*$/.test(prefixWindow)) {
        // console.log(`[Sistema] Ignorando coincidencia por prefijo: "${prefixWindow}" -> "${fullMatch}"`);
        continue;
      }

      const parsed = parseFlexibleAmount(rawAmount);
      if (parsed !== null && parsed > 0) {
        validTotalCandidates.push(parsed);
        // console.log(`[Sistema] Candidato a TOTAL: ${parsed} (de "${fullMatch}")`);
      }
    }
  }

  // Fallback: Neto / Gravado (si no hay ningun total válido)
  if (validTotalCandidates.length === 0) {
    const fallbackPattern = /(?:^|\s)(?:neto|gravado)(?:[:\s]|$)+\$?\s*([\d.,]+)/i;
    const match = clean.match(fallbackPattern);
    if (match?.[1]) {
      const parsed = parseFlexibleAmount(match[1]);
      if (parsed) validTotalCandidates.push(parsed);
    }

    // Fallback 2: P.Total (si realmente no hay nada más, ni total ni neto)
    if (validTotalCandidates.length === 0) {
      const pTotalPattern = /(?:^|\s)(?:p\.?\s*total|subtotal)(?:[:\s]|$)+\$?\s*([\d.,]+)/i;
      const matchPT = clean.match(pTotalPattern);
      if (matchPT?.[1]) {
        const parsed = parseFlexibleAmount(matchPT[1]);
        if (parsed) validTotalCandidates.push(parsed);
      }
    }
  }

  if (validTotalCandidates.length > 0) {
    // Elegir el MAXIMO monto de los candidatos a TOTAL válido
    // El Total a pagar suele ser el número más grande de una factura (suma de netos + iva + etc)
    const maxTotal = Math.max(...validTotalCandidates);
    detectedFields.monto = maxTotal;
    confidence = 0.9;
    // console.log(`[Sistema] Mejor TOTAL seleccionado: ${maxTotal} (candidatos: ${validTotalCandidates.join(', ')})`);
    montoFound = true;
  }

  // B) Si no hay Total explícito, buscar el mayor monto encontrado
  if (!montoFound) {
    // Patrón general: captura cualquier secuencia de dígitos, puntos y comas
    const genericMonto = /\$\s*([\d.,]+)/g;
    const genericNumber = /(?:^|\s)([\d]{1,3}(?:[.,]\d{3})*[.,]\d{2})(?=\s|$)/g; // Números "bien formados" aislados

    let maxMonto = 0;

    // Combinamos estrategias de búsqueda
    const rawCandidates: string[] = [];

    let match;
    while ((match = genericMonto.exec(clean)) !== null) rawCandidates.push(match[1]);
    while ((match = genericNumber.exec(clean)) !== null) rawCandidates.push(match[1]);

    for (const raw of rawCandidates) {
      const parsed = parseFlexibleAmount(raw);
      if (parsed !== null && parsed > 0 && parsed < 100000000) {
        // Filtro de años
        if (parsed >= 1900 && parsed <= 2100 && Number.isInteger(parsed)) continue;

        if (parsed > maxMonto) {
          maxMonto = parsed;
        }
      }
    }

    if (maxMonto > 0) {
      detectedFields.monto = maxMonto;
      confidence = Math.max(confidence, 0.7);
      // console.log('[Sistema] Monto MAX seleccionado:', maxMonto);
    }
  }

  // ===== 4. FECHA (Filtro Anti-Antigüedad) =====
  const fechaPatterns = [
    /fecha de emisión[:\s]*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i, // Prioridad Emisión
    /fecha[:\s]*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i, // Prioridad etiqueta "Fecha:"
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, // ISO primero
    /vencimiento[:\s]*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i, // Vencimiento (baja prioridad para campo fecha principal)
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, // DD/MM/YYYY genérico
    /(\d{1,2})\s+de\s+([a-zA-Z]+)(?:\s+de\s+(\d{4}))?/i,
    /(\d{1,2})\s+([a-zA-Z]{3})\.?\s+(\d{4})/i,
  ];

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 1; // Solo aceptar fechas recientes (ej. 2025-2026)
  // console.log(`[Sistema] Extracción de fecha - Año actual: ${currentYear}, Año min: ${minYear}`);

  for (const pattern of fechaPatterns) {
    // Usamos loop global para filtrar fechas viejas
    const globalPat = new RegExp(pattern.source, pattern.flags + 'g');
    let match;
    let bestFecha = null;

    while ((match = globalPat.exec(clean)) !== null) {
      // console.log(`[Sistema] Coincidencia de fecha encontrada: ${pattern.source}`, match[0]);
      let day, month, year;

      // Intentar inferir grupos según patrón
      if (pattern.source.includes('vencimiento')) { // Vencimiento DD-MM-YYYY
        day = match[1]; month = match[2]; year = match[3];
      } else if (match.length >= 4 && match[3]) { // Tiene año explícito (DD de MM de YYYY)
        if (pattern.source.startsWith('(\\d{4})')) { // ISO YYYY-MM-DD
          year = match[1]; month = match[2]; day = match[3];
        } else {
          day = match[1]; month = match[2]; year = match[3];
        }
      } else if (match.length >= 3 && !match[3]) { // Fecha sin año (DD de MM)
        day = match[1];
        month = match[2];

        // Lógica de inferencia de año:
        // Normalizar mes primero para poder comparar
        const monthsEs: Record<string, string> = {
          'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
          'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12',
          'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04', 'may': '05', 'jun': '06',
          'jul': '07', 'ago': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12'
        };
        let textMonth = month;
        if (isNaN(Number(month)) && monthsEs[month.toLowerCase()]) {
          textMonth = monthsEs[month.toLowerCase()];
        }

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentDay = now.getDate();

        const m = Number(textMonth);
        const d = Number(day);

        // Si la fecha detectada es "futura" respecto a hoy (ej. Hoy es Enero, detecto Diciembre),
        // asumimos que fue del año pasado.
        if (m > currentMonth || (m === currentMonth && d > currentDay)) {
          year = String(currentYear - 1);
        } else {
          year = String(currentYear);
        }
        // console.log(`[Sistema] Año inferido ${year} para fecha ${day}/${month}`);
      } else {
        // Fallback genérico
        day = match[1]; month = match[2]; year = match[3];
      }

      if (Number(day) > 31) [day, year] = [year, day]; // swap simple
      if (year && Number(year) < 100) year = String(2000 + Number(year));

      // FILTRO CRÍTICO
      if (Number(year) < minYear) {
        // console.log(`[Sistema] Ignorando fecha antigua: ${day}/${month}/${year}`);
        continue;
      }

      // Normalizar mes... (código abreviado para update)
      const monthsEs: Record<string, string> = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
        'julio': '07', 'agosto': '08', 'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12',
        'ene': '01', 'feb': '02', 'mar': '03', 'abr': '04', 'may': '05', 'jun': '06',
        'jul': '07', 'ago': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dic': '12'
      };
      if (isNaN(Number(month)) && monthsEs[month.toLowerCase()]) { month = monthsEs[month.toLowerCase()]; }

      bestFecha = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`;

      // Si encontramos una fecha explícita de vencimiento válida, paramos.
      if (pattern.source.includes('vencimiento')) break;
    }

    if (bestFecha) {
      detectedFields.fecha = bestFecha;
      confidence = Math.max(confidence, 0.75);
      // console.log('[Sistema] Fecha válida encontrada:', bestFecha);
      break;
    }
  }

  // ===== 5. CONTRAPARTE =====
  // ===== 5. CONTRAPARTE =====
  // 5.A) Contraparte por Tipo de Servicio (Más confiable que regex genérica)
  if (detectedDocType === DocumentType.PAGO_SERVICIOS) {
    if (lower.includes('personal') || lower.includes('flow')) detectedFields.nombreContraparte = 'Personal Flow';
    else if (lower.includes('telecom')) detectedFields.nombreContraparte = 'Telecom';
    else if (lower.includes('movistar')) detectedFields.nombreContraparte = 'Movistar';
    else if (lower.includes('claro')) detectedFields.nombreContraparte = 'Claro';
    else if (lower.includes('fibertel')) detectedFields.nombreContraparte = 'Fibertel';
    else if (lower.includes('edenor')) detectedFields.nombreContraparte = 'Edenor';
    else if (lower.includes('edesur')) detectedFields.nombreContraparte = 'Edesur';
    else if (lower.includes('metrogas')) detectedFields.nombreContraparte = 'Metrogas';
    else if (lower.includes('litoral') && lower.includes('gas')) detectedFields.nombreContraparte = 'Litoral Gas';
    else if (lower.includes('aysa')) detectedFields.nombreContraparte = 'AySA';
    else if (lower.includes('trenes argentinos') || lower.includes('operadora ferroviaria')) detectedFields.nombreContraparte = 'Trenes Argentinos';

    if (detectedFields.nombreContraparte) {
      // console.log('[Sistema] Proveedor inferido:', detectedFields.nombreContraparte);
    }
  }

  // 5.B) Búsqueda genérica (si no se encontró arriba)
  if (!detectedFields.nombreContraparte) {
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
          // console.log('[Sistema] Contraparte encontrada:', detectedFields.nombreContraparte);
          break;
        }
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
      // console.log('[Sistema] Concepto encontrado:', detectedFields.concepto);
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
    // console.log('[Sistema] Datos insuficientes (falta monto+fecha), delegando a GPT');
    return null;
  }

  // console.log('[Sistema] ¡Éxito con heurísticas!', {
  //   docType: detectedDocType,
  //   direction,
  //   monto: detectedFields.monto,
  //   fecha: detectedFields.fecha,
  // });

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
  // console.log('[IA] Iniciando análisis de visión para:', fileName);

  try {
    const openai = getOpenAIClient();
    // console.log('[IA] Cliente OpenAI obtenido con éxito');

    // Remover prefijo data:image si existe
    const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

    const now = new Date();
    const todayISO = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();

    const prompt = `Sos un experto analizando documentos financieros ARGENTINOS. La FECHA DE HOY es: ${todayISO}.
Analiza esta imagen con mucho cuidado y extrae TODA la información relevante.

APPS Y BANCOS COMUNES EN ARGENTINA:
- Mercado Pago: "Le pagaste a", "Te pagó", CVU, "Dinero disponible"
- Personal Pay: "Te enviaron dinero", "Enviaste dinero", Coelsa ID
- Brubank, Ualá, Naranja X: Transferencia inmediata, CBU
- Bancos tradicionales: Santander, Galicia, BBVA, Macro, HSBC, Nación, etc.

EMPRESAS DE SERVICIOS COMUNES:
- Luz: Edenor, Edesur, EPEC, EPE
- Gas: Metrogas, Camuzzi, Litoral Gas
- Agua: AySA, ABSA
- Internet/TV: Telecom, Personal, Movistar, Claro, Fibertel
- Impuestos: AFIP, ARBA, AGIP

TIPOS DE DOCUMENTOS:
1. Captura de app (transferencia): Mira si dice "transferiste"/"pagaste" (SALIDA) o "recibiste"/"te pagaron" (ENTRADA)
2. Factura de servicio: Busca período, vencimiento, número de cliente, CUIT
3. Ticket/recibo impreso: Busca total, fecha, comercio
4. Resumen de tarjeta: Visa, Mastercard, consumos del período

IMPORTANTE - DIRECCIÓN DE TRANSFERENCIAS:
    - Para PAGOS DE SERVICIOS: concepto = "Pago de [Servicio]" (ej: "Pago de Luz", "Pago de Internet")
    - Para TRANSFERENCIAS PROPIAS: concepto = "Transferencia propia"
    - Para COMPRAS: concepto = "Compra en [Comercio]" o descripción del producto si es claro.
    
    IMPORTANTE - FECHAS (Anti-Alucinación):

- Busca la fecha en formato YYYY-MM-DD.
- SI EL DOCUMENTO NO TIENE AÑO (ej: "20 de Diciembre"):
  - Compáralo con la FECHA DE HOY (${todayISO}).
  - Si el mes del documento (ej: Dic) ya pasó o es el actual: Asume AÑO ACTUAL (${currentYear}) o AÑO ANTERIOR (${currentYear - 1}) según lógica.
  - Ej: Si hoy es Enero 2026 y dice "Diciembre", fue en 2025.
  - Ej: Si hoy es Mayo 2026 y dice "Abril", fue en 2026.
- ¡NUNCA INVENTES UN AÑO (como 2023) SI NO ESTÁ ESCRITO! Ante la duda, usa el año actual.

EXTRAE TODO LO POSIBLE:
- fecha: formato YYYY-MM-DD
- monto: solo el número, SIN $ ni puntos de miles (ej: 15000.50)
- moneda: ARS o USD
- nombreContraparte: El nombre REAL del comercio/persona.
    - Prioriza LOGOTIPOS grandes (generalmente arriba a la derecha o izquierda) o "Razón Social".
    - EN FACTURAS DE SERVICIOS: Busca nombres conocidos en la lista (ABSA, Edenor, etc.).
    - IGNORA etiquetas como "Cliente", "Usuario", "Consumidor Final", "Destinatario" (si es una factura y NO una transferencia).
    - IGNORA etiquetas técnicas como: "Domicilio Comercial", "Punto de Venta", "Ingresos Brutos", "Caja", "Sucursal", "Unidad de Facturación", "Partido/Partida".
    - Si ves "Cliente: Sebastián Giordanino", "Sebastián" NO es el comercio. Busca quién emite la factura (ej: Kevingston, KVN SRL).
    - Si ves "Unidad de Facturación Partido: 055-...", IGNORALO. Busca "ABSA" o el logo.
- categoria: Servicios, Alimentación, Transporte, Transferencias, Salud, Entretenimiento, etc.
- empresa: nombre de la empresa emisora
- concepto: descripción corta del movimiento.
    - IMPORTANTE: SOLO usa "Transferencia propia" si dice explícitamente "Cuenta propia" o el destinatario SOS VOS MISMO.
    - Si hay un destinatario con nombre diferente, NUNCA pongas "Transferencia propia". Usa "Transferencia a [Nombre]".
- numeroFactura: si es factura
- metodoPago: transferencia, débito, crédito, efectivo

FORMATO DE RESPUESTA (JSON puro, sin markdown):
{
  "detectedDocType": "transferencia|factura|recibo|ingreso|egreso|resumen_tarjeta|comprobante|otro",
  "direction": "entrada|salida|interna|indeterminado",
  "detectedFields": {
    "fecha": "${todayISO}",
    "monto": 15000.50,
    "moneda": "ARS",
    "nombreContraparte": "Nombre",
    "categoria": "Servicios",
    "concepto": "Descripción"
  },
  "confidenceScores": { "global": 0.85 },
  "suggestedEntityType": "transaction",
  "reasoning": "Breve explicación"
}`;

    // console.log('[IA] Analizando documento:', fileName);

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

    // console.log('[IA] Longitud de respuesta cruda:', content.length);

    // Parsear JSON, manejando posibles bloques de markdown
    let jsonText = content.trim();
    if (jsonText.startsWith('```')) {
      // Remover bloques de markdown
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // console.log('[IA] Parseando JSON, longitud:', jsonText.length);

    const result: DocumentAnalysisResult = JSON.parse(jsonText);

    /*
    console.log('[IA] Análisis completo:', {
      docType: result.detectedDocType,
      direction: result.direction,
      confidence: result.confidenceScores?.global,
      entityType: result.suggestedEntityType,
      hasAmount: !!result.detectedFields?.monto
    });
    */

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

    // FIX: Normalizar fecha a mediodía para evitar problemas de timezone en frontend
    if (result.detectedFields.fecha && /^\d{4}-\d{2}-\d{2}$/.test(result.detectedFields.fecha)) {
      result.detectedFields.fecha = `${result.detectedFields.fecha}T12:00:00.000Z`;
      // console.log('[IA] Fecha normalizada a T12:00:', result.detectedFields.fecha);
    }

    return result;

  } catch (error: any) {
    console.error('[IA] ❌ Error analizando documento:', error);

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
  // console.log('[IA] analyzeDocumentText iniciado, longitud de texto:', text.length);

  // STEP 1: Clean text
  const cleanText = text.replace(/\s+/g, ' ').trim();
  // console.log('[IA] Texto limpio, longitud:', cleanText.length);

  // STEP 2: TRY HEURISTICS FIRST (no GPT cost)
  // console.log('[IA] Intentando análisis por heurísticas...');
  const heuristicResult = analyzeTextHeuristics(cleanText);

  if (heuristicResult &&
    heuristicResult.detectedFields?.monto &&
    heuristicResult.detectedFields?.fecha &&
    heuristicResult.detectedFields?.nombreContraparte && // Require merchant validation for early exit
    !heuristicResult.detectedFields.nombreContraparte.includes('Domicilio Comercial') // Anti-hallucination check
  ) {
    console.log('[IA] ✅ ¡Heurísticas exitosas! Usando resultado, saltando GPT-4');
    
    console.log('[IA] Resultado heurístico:', {
      monto: heuristicResult.detectedFields.monto,
      fecha: heuristicResult.detectedFields.fecha,
      contraparte: heuristicResult.detectedFields.nombreContraparte,
      confidence: heuristicResult.confidenceScores.global
    });
    
    return heuristicResult;
  }

  if (heuristicResult) {
    // console.log('[IA] Heurísticas parciales (faltan campos críticos), usando GPT como fallback');
  } else {
    // console.log('[IA] Heurísticas devolvieron null, delegando a GPT-4');
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

IMPORTANTE - DESCRIPCIONES (concepto):
- Para TRANSFERENCIAS DE ENTRADA: concepto = "Transferencia de [Nombre]"
- Para TRANSFERENCIAS DE SALIDA: concepto = "Transferencia a [Nombre]"
- Para PAGOS DE SERVICIOS: concepto = "Pago de [Servicio]"
- Para TRANSFERENCIAS PROPIAS: concepto = "Transferencia propia"

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

    // FIX: Normalizar fecha a mediodía para evitar problemas de timezone en frontend
    if (result.detectedFields.fecha && /^\d{4}-\d{2}-\d{2}$/.test(result.detectedFields.fecha)) {
      result.detectedFields.fecha = `${result.detectedFields.fecha}T12:00:00.000Z`;
      console.log('[Document Analyzer] Text-analysis date normalized to T12:00:', result.detectedFields.fecha);
    }

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
