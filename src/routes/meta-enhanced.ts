import { Router } from 'express';
import { getCacheStats, clearExpiredCache, clearAllCache } from '../ai/cache';
import { countLines } from '../utils/jsonl';
import { getEnhancedMetrics, metricsCollector } from '../ai/metrics';
import pkg from '../../package.json';

const r = Router();

r.get('/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

r.get('/version', async (_req, res) => {
  res.json({
    ok: true,
    version: pkg.version,
    patterns: 50, // Actualizado con los nuevos patrones
    feedbackCount: await countLines('feedback.jsonl'),
    cacheEnabled: true,
    features: {
      advancedPatterns: true,
      cache: true,
      metrics: true
    }
  });
});

// Endpoint de métricas avanzadas
r.get('/metrics', async (_req, res) => {
  try {
    const metrics = await getEnhancedMetrics();
    res.json({
      ok: true,
      ...metrics
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'metrics_error',
      message: error.message
    });
  }
});

// Endpoint para estadísticas de performance
r.get('/stats', (_req, res) => {
  const currentMetrics = metricsCollector.getMetrics();
  res.json({
    ok: true,
    stats: {
      uptime: currentMetrics.service.uptime,
      uptimeFormatted: formatUptime(currentMetrics.service.uptime),
      requestsProcessed: currentMetrics.performance.requestsPerMinute > 0 ? 
        Math.floor(currentMetrics.performance.requestsPerMinute * (currentMetrics.service.uptime / (1000 * 60))) : 0,
      avgResponseTime: `${currentMetrics.performance.avgProcessingTime.toFixed(2)}ms`,
      cacheHitRate: `${(currentMetrics.performance.cacheHitRate * 100).toFixed(1)}%`,
      serviceStatus: 'healthy',
      lastUpdate: new Date().toISOString()
    }
  });
});

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Endpoint para limpiar cache
r.post('/cache/clear', async (_req, res) => {
  try {
    const result = await clearExpiredCache();
    res.json({
      ok: true,
      message: 'Cache cleanup completed',
      timestamp: new Date().toISOString(),
      details: {
        filesCleared: result.cleared,
        errors: result.errors
      }
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'cache_clear_error',
      message: error.message
    });
  }
});

// Endpoint para limpiar todo el cache
r.delete('/cache/all', async (_req, res) => {
  try {
    const result = await clearAllCache();
    res.json({
      ok: true,
      message: 'All cache cleared',
      timestamp: new Date().toISOString(),
      details: {
        filesDeleted: result.deleted,
        errors: result.errors
      }
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: 'cache_clear_all_error',
      message: error.message
    });
  }
});

// Health check mejorado
r.get('/health', async (_req, res) => {
  try {
    const metrics = await getEnhancedMetrics();
    const isHealthy = metrics.performance.avgProcessingTime < 5000; // Menos de 5 segundos
    
    res.json({
      ok: isHealthy,
      service: 'ai-service-enhanced',
      time: new Date().toISOString(),
      status: isHealthy ? 'healthy' : 'degraded',
      version: pkg.version,
      features: {
        patterns: `${metrics.ai.totalPatterns} patterns`,
        cache: metrics.ai.cacheEnabled ? 'enabled' : 'disabled',
        feedback: `${metrics.transactions.feedbackCount} records`
      },
      performance: {
        avgResponseTime: `${metrics.performance.avgProcessingTime.toFixed(2)}ms`,
        requestsPerMinute: metrics.performance.requestsPerMinute.toFixed(1),
        cacheHitRate: `${(metrics.performance.cacheHitRate * 100).toFixed(1)}%`
      }
    });
  } catch (error: any) {
    res.status(503).json({
      ok: false,
      service: 'ai-service-enhanced',
      status: 'unhealthy',
      error: error.message,
      time: new Date().toISOString()
    });
  }
});

export default r;