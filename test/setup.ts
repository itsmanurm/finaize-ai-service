// Central test setup for ai-service
import { beforeAll, afterAll } from 'vitest';
import { clearAllCache } from '../src/ai/cache';

beforeAll(async () => {
	// Always use OpenAI mock for tests
	process.env.USE_OPENAI_MOCK = 'true';
	// Clean cache before tests
	await clearAllCache();
});

afterAll(async () => {
	// Clean cache after tests
	await clearAllCache();
});
import 'dotenv/config';

// Forzar carga de .env.test si existe
import { existsSync } from 'fs';
import { join } from 'path';
const envTestPath = join(process.cwd(), '.env.test');
if (existsSync(envTestPath)) {
	require('dotenv').config({ path: envTestPath });
}