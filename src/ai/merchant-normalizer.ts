const COMMON_SUFFIXES = [/mp\*?/i, /\*+/g, /txn\d+/i, /#[0-9]+/g];
const CLEANERS = [
  (s: string) => s.toLowerCase(),
  (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''),
  (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, ' '),
  (s: string) => s.replace(/\s+/g, ' ').trim()
];

const CANON_MAP: Record<string, string> = {
  'mercadopago': 'Mercado Pago',
  'mercado pago': 'Mercado Pago',
  'meli': 'Mercado Libre',
  'carrefour': 'Carrefour',
  'jumbo': 'Jumbo',
  'disco': 'Disco',
  'dia': 'DIA',
  'coto': 'Coto',
  'vea': 'Vea',
  'chango mas': 'Chango Más',
  'uber': 'Uber',
  'cabify': 'Cabify',
  'ypf': 'YPF',
  'axion': 'Axion',
  'puma': 'Puma',
  'shell': 'Shell',
  'sube': 'SUBE',
  'edenor': 'Edenor',
  'edesur': 'Edesur',
  'epe': 'EPE',
  'epec': 'EPEC',
  'aysa': 'AySA',
  'aguas santafesinas': 'ASSA',
  'claro': 'Claro',
  'personal': 'Personal',
  'movistar': 'Movistar',
  'fibertel': 'Fibertel',
  'flow': 'Flow',
  'netflix': 'Netflix',
  'spotify': 'Spotify'
};


export function normalizeMerchant(raw?: string): string {
  if (!raw) return '';
  let s = raw;
  for (const re of COMMON_SUFFIXES) s = s.replace(re, ' ');
  for (const f of CLEANERS) s = f(s);
  if (CANON_MAP[s]) return CANON_MAP[s];
  for (const k of Object.keys(CANON_MAP)) {
    if (s.includes(k)) return CANON_MAP[k];
  }
  return s.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '').join(' ').trim();
}
