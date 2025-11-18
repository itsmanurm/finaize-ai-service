import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

interface CacheEntry {
  data: any;
  timestamp: number;
}

interface CategorizationCacheKey {
  description: string;
  merchant?: string;
  amount: number;
  currency: string;
}

function generateCacheKey(key: CategorizationCacheKey): string {
  const keyString = JSON.stringify(key);
  return crypto.createHash('md5').update(keyString).digest('hex');
}

// Map para coordinar escrituras concurrentes por key (evita race conditions)
export const inFlightWrites = new Map<string, Promise<void>>();

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating cache directory:', error);
  }
}

export async function getCachedCategorization(key: CategorizationCacheKey): Promise<any | null> {
  await ensureCacheDir();
  
  const cacheKey = generateCacheKey(key);
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  // Si hay una escritura en curso para esta key, esperar a que termine
  if (inFlightWrites.has(cacheKey)) {
    try {
      await inFlightWrites.get(cacheKey);
    } catch (_) {
      // Ignorar errores de la escritura en curso y continuar a leer
    }
  }
  
  try {
    const data = await fs.readFile(cacheFile, 'utf8');
    const entry: CacheEntry = JSON.parse(data);
    
    // Verificar si el cache aún es válido
    const isExpired = Date.now() - entry.timestamp > CACHE_TTL;
    if (isExpired) {
      await fs.unlink(cacheFile);
      return null;
    }
    
    return entry.data;
  } catch (error) {
    return null;
  }
}

export async function setCachedCategorization(key: CategorizationCacheKey, data: any): Promise<void> {
  await ensureCacheDir();
  
  const cacheKey = generateCacheKey(key);
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  
  const entry: CacheEntry = {
    data,
    timestamp: Date.now()
  };
  
  try {
    // Escribir de forma atómica: escribir en archivo temporal y renombrar
    const tmpFile = `${cacheFile}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const writePromise = (async () => {
      await fs.writeFile(tmpFile, JSON.stringify(entry, null, 2), 'utf8');
      await fs.rename(tmpFile, cacheFile);
    })();

    inFlightWrites.set(cacheKey, writePromise);
    await writePromise;
    inFlightWrites.delete(cacheKey);
  } catch (error) {
    console.error('Error writing cache:', error);
  }
}

export async function clearExpiredCache(): Promise<{ cleared: number; errors: number }> {
  await ensureCacheDir();
  
  let clearedCount = 0;
  let errorCount = 0;
  const files = await fs.readdir(CACHE_DIR);
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const filePath = path.join(CACHE_DIR, file);
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const entry: CacheEntry = JSON.parse(data);
      
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        await fs.unlink(filePath);
        clearedCount++;
      }
    } catch (error) {
      // Archivo corrupto, eliminar
      try {
        await fs.unlink(filePath);
        clearedCount++;
      } catch (unlinkError) {
        console.error(`Error deleting cache file ${file}:`, unlinkError);
        errorCount++;
      }
    }
  }
  
  return { cleared: clearedCount, errors: errorCount };
}

export async function clearAllCache(): Promise<{ deleted: number; errors: number }> {
  await ensureCacheDir();
  
  let deletedCount = 0;
  let errorCount = 0;
  const files = await fs.readdir(CACHE_DIR);
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const filePath = path.join(CACHE_DIR, file);
    try {
      await fs.unlink(filePath);
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting cache file ${file}:`, error);
      errorCount++;
    }
  }
  
  return { deleted: deletedCount, errors: errorCount };
}

export async function getCacheStats(): Promise<{ totalFiles: number; totalSize: number }> {
  await ensureCacheDir();
  
  const files = await fs.readdir(CACHE_DIR);
  let totalSize = 0;
  let totalFiles = 0;
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    try {
      const stats = await fs.stat(path.join(CACHE_DIR, file));
      totalSize += stats.size;
      totalFiles++;
    } catch (error) {
      // Error reading stats, ignore
    }
  }
  
  return { totalFiles, totalSize };
}