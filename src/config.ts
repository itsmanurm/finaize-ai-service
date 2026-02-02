// Central config loader and validator
import * as dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env: ${key}`);
  return val;
}

export const config = {
  OPENAI_API_KEY: requireEnv('OPENAI_API_KEY'),
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  AI_MIN_CONFIDENCE: Number(process.env.AI_MIN_CONFIDENCE ?? 0.6),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT ?? 8081),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  RATE_LIMIT_PER_MIN: Number(process.env.RATE_LIMIT_PER_MIN ?? 120),
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:4000',
};
