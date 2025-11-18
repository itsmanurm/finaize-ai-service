import dotenv from 'dotenv';
dotenv.config();
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

import { logger } from './lib/logger';
import { apiKeyAuth } from './middleware/auth';
import aiRoutes from './routes/ai';
import chatRoutes from './routes/chat';
import metaRoutes from './routes/meta';
import metaEnhancedRoutes from './routes/meta-enhanced';

const PORT = Number(process.env.PORT ?? 8081);
const ORIGIN = process.env.CORS_ORIGIN ?? '*';

const app = express();
app.set('trust proxy', 1);

app.use(pinoHttp({
  logger,
  genReqId: (req) => req.header('x-request-id') ?? uuidv4(),
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/live' }
}));

app.use(cors({ origin: ORIGIN }));
app.use(express.json());
app.use(morgan('dev'));

// Endpoints de vida/estado (públicos)
app.get('/live', (_req, res) => res.status(200).send('OK'));
app.get('/ready', (_req, res) => res.status(200).json({ ok: true, rulesLoaded: true }));

// Health abierto (sin API-Key)
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-service', time: new Date().toISOString() });
});

// Rate limit por minuto en /ai/*
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MIN ?? 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
app.use('/ai', limiter);

// Auth para /ai/*
app.use(apiKeyAuth);

// Rutas protegidas
app.use('/ai', aiRoutes);
app.use('/ai', chatRoutes);
app.use('/ai', metaRoutes);
// Rutas de métricas avanzadas (también protegidas)
app.use('/ai', metaEnhancedRoutes);

// Propagar X-Request-Id
app.use((req, res, next) => {
  const rid = (req as any).id ?? req.header('x-request-id');
  if (rid) res.setHeader('x-request-id', rid);
  next();
});

app.listen(PORT, () => {
  logger.info(`[ai-service] listening on :${PORT}`);
});
