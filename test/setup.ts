import 'dotenv/config';

// Forzar carga de .env.test si existe
import { existsSync } from 'fs';
import { join } from 'path';
const envTestPath = join(process.cwd(), '.env.test');
if (existsSync(envTestPath)) {
	require('dotenv').config({ path: envTestPath });
}