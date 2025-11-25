/**
 * Parser robusto de fechas relativas en español (Argentina)
 * Maneja: ayer, anteayer, la semana pasada, el viernes, hace X días, etc.
 */

export interface ParsedDate {
  date: Date;
  confidence: number;
  description: string;
}

/**
 * Obtiene la fecha actual en timezone de Argentina
 */
export function getArgentinaDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

/**
 * Parsea expresiones de fecha relativas en español
 * @param message Mensaje del usuario
 * @returns ParsedDate con la fecha interpretada o null si no detecta fecha
 */
export function parseRelativeDate(message: string): ParsedDate | null {
  const msg = message.toLowerCase().trim();
  const now = getArgentinaDate();
  
  // Hoy
  if (/\bhoy\b/.test(msg)) {
    return {
      date: now,
      confidence: 1.0,
      description: 'hoy'
    };
  }
  
  // Ayer
  if (/\bayer\b/.test(msg)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      date: yesterday,
      confidence: 1.0,
      description: 'ayer'
    };
  }
  
  // Anteayer
  if (/\banteayer\b/.test(msg)) {
    const dayBefore = new Date(now);
    dayBefore.setDate(dayBefore.getDate() - 2);
    return {
      date: dayBefore,
      confidence: 1.0,
      description: 'anteayer'
    };
  }
  
  // Hace X días/semanas/meses
  const agoMatch = msg.match(/hace\s+(\d+)\s+(d[ií]as?|semanas?|meses?)/i);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1]);
    const unit = agoMatch[2];
    const date = new Date(now);
    
    if (/d[ií]as?/.test(unit)) {
      date.setDate(date.getDate() - amount);
      return {
        date,
        confidence: 0.95,
        description: `hace ${amount} día${amount > 1 ? 's' : ''}`
      };
    } else if (/semanas?/.test(unit)) {
      date.setDate(date.getDate() - (amount * 7));
      return {
        date,
        confidence: 0.95,
        description: `hace ${amount} semana${amount > 1 ? 's' : ''}`
      };
    } else if (/meses?/.test(unit)) {
      date.setMonth(date.getMonth() - amount);
      return {
        date,
        confidence: 0.90,
        description: `hace ${amount} mes${amount > 1 ? 'es' : ''}`
      };
    }
  }
  
  // Días de la semana (lunes, martes, etc.) - se refiere al más reciente
  const weekdays = {
    'lunes': 1,
    'martes': 2,
    'miércoles': 3,
    'miercoles': 3,
    'jueves': 4,
    'viernes': 5,
    'sábado': 6,
    'sabado': 6,
    'domingo': 0
  };
  
  for (const [dayName, dayNum] of Object.entries(weekdays)) {
    const regex = new RegExp(`\\b(el\\s+)?${dayName}(\\s+pasado)?\\b`, 'i');
    if (regex.test(msg)) {
      const targetDate = new Date(now);
      const currentDay = targetDate.getDay();
      let daysToSubtract = currentDay - dayNum;
      
      // Si el día ya pasó esta semana, calculamos desde hoy
      if (daysToSubtract <= 0) {
        daysToSubtract += 7;
      }
      
      // Si dice "pasado", agregamos una semana más
      if (/pasado/.test(msg)) {
        daysToSubtract += 7;
      }
      
      targetDate.setDate(targetDate.getDate() - daysToSubtract);
      
      return {
        date: targetDate,
        confidence: 0.90,
        description: `el ${dayName}${/pasado/.test(msg) ? ' pasado' : ''}`
      };
    }
  }
  
  // La semana pasada (interpretar como el mismo día de la semana pasada)
  if (/la semana pasada/.test(msg)) {
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    return {
      date: lastWeek,
      confidence: 0.85,
      description: 'la semana pasada'
    };
  }
  
  // El mes pasado (interpretar como el mismo día del mes pasado)
  if (/el mes pasado/.test(msg)) {
    const lastMonth = new Date(now);
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return {
      date: lastMonth,
      confidence: 0.85,
      description: 'el mes pasado'
    };
  }
  
  // El año pasado
  if (/el a[ñn]o pasado/.test(msg)) {
    const lastYear = new Date(now);
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    return {
      date: lastYear,
      confidence: 0.85,
      description: 'el año pasado'
    };
  }
  
  return null;
}

/**
 * Valida que una fecha no sea futura (para gastos)
 */
export function isFutureDate(date: Date): boolean {
  const now = getArgentinaDate();
  return date > now;
}

/**
 * Formatea una fecha en formato legible español
 */
export function formatDateES(date: Date): string {
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires'
  });
}
