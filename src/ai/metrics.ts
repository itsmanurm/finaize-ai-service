import { getCacheStats } from './cache';
import { countLines } from '../utils/jsonl';
import patterns from './patterns.json';

interface MetricsData {
  service: {
    uptime: number;
    timestamp: string;
    version: string;
  };
  ai: {
    totalPatterns: number;
    cacheEnabled: boolean;
    lastCacheStats: {
      totalFiles: number;
      totalSize: number;
    } | null;
  };
  transactions: {
    feedbackCount: number;
    feedbackLastUpdate: string | null;
  };
  performance: {
    avgProcessingTime: number;
    requestsPerMinute: number;
    cacheHitRate: number;
  };
}

class MetricsCollector {
  private startTime = Date.now();
  private requestCount = 0;
  private totalProcessingTime = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  
  recordRequest(processingTime: number, cacheHit: boolean) {
    this.requestCount++;
    this.totalProcessingTime += processingTime;
    
    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }
  
  getMetrics(): MetricsData {
    const uptime = Date.now() - this.startTime;
    const avgProcessingTime = this.requestCount > 0 ? 
      this.totalProcessingTime / this.requestCount : 0;
    
    const cacheHitRate = (this.cacheHits + this.cacheMisses) > 0 ? 
      this.cacheHits / (this.cacheHits + this.cacheMisses) : 0;
    
    return {
      service: {
        uptime,
        timestamp: new Date().toISOString(),
        version: '1.1.0' // Versión mejorada
      },
      ai: {
        totalPatterns: Array.isArray(patterns) ? patterns.length : 0,
        cacheEnabled: true,
        lastCacheStats: null // Se actualizará async
      },
      transactions: {
        feedbackCount: 0, // Se actualizará async
        feedbackLastUpdate: null
      },
      performance: {
        avgProcessingTime,
        requestsPerMinute: this.getRequestsPerMinute(),
        cacheHitRate
      }
    };
  }
  
  private getRequestsPerMinute(): number {
    const uptimeMinutes = (Date.now() - this.startTime) / (1000 * 60);
    return uptimeMinutes > 0 ? this.requestCount / uptimeMinutes : 0;
  }
}

export const metricsCollector = new MetricsCollector();

export async function getEnhancedMetrics(): Promise<MetricsData> {
  const baseMetrics = metricsCollector.getMetrics();
  
  try {
    const cacheStats = await getCacheStats();
    const feedbackCount = await countLines('feedback.jsonl');
    
    return {
      ...baseMetrics,
      ai: {
        ...baseMetrics.ai,
        lastCacheStats: cacheStats
      },
      transactions: {
        feedbackCount,
        feedbackLastUpdate: new Date().toISOString()
      }
    };
  } catch (error) {
    // Si hay error obteniendo stats adicionales, devolver métricas básicas
    return baseMetrics;
  }
}

// Decorator para medir performance de funciones
export function measurePerformance(target: any, propertyName: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function (...args: any[]) {
    const startTime = Date.now();
    let cacheHit = false;
    
    try {
      const result = await originalMethod.apply(this, args);
      return result;
    } finally {
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // Si el método es categorize, registrar métricas
      if (propertyName === 'categorize') {
        // Intentar detectar si fue cache hit (esto podría mejorarse)
        cacheHit = false; // Por ahora siempre false, se puede mejorar
        metricsCollector.recordRequest(processingTime, cacheHit);
      }
    }
  };
  
  return descriptor;
}