# FinAize AI Service
- Node + TS + Express, API-Key en header `x-api-key`
- Endpoints: /health (público), /ai/ping, /ai/version, /ai/categorize, /ai/categorize/batch
- Dev: npm run dev | Build: npm run build | Prod: npm start
- Env: PORT, CORS_ORIGIN, API_KEYS, AI_MIN_CONFIDENCE (opcional), OPENAI_API_KEY
   - Env: PORT, CORS_ORIGIN, API_KEY, AI_MIN_CONFIDENCE (opcional), OPENAI_API_KEY

## Tests
- Framework: Vitest
- Configuración: `vitest.config.ts`
- Comando: `npm test`
- Variables de entorno simuladas en `test/setup.ts`

## Cambios recientes
### 5. NLU híbrido y extracción de entidades
- **Archivo**: `src/ai/nlu.ts`
- **Descripción**: Extracción de intención y entidades (monto, moneda, comercio, categoría) por reglas y fallback a OpenAI. Respuestas robustas y logging estructurado.


### 1. Validación de claves API
- **Archivo**: `src/ai/openai-service.ts`
- **Descripción**: Se agregó validación para garantizar que la variable de entorno `OPENAI_API_KEY` esté configurada antes de realizar solicitudes a OpenAI.
- **Error manejado**: Si la clave no está configurada, se lanza un error descriptivo.

### 2. Manejo de errores
- **Archivo**: `src/ai/openai-service.ts`
- **Descripción**: Se implementó un sistema de reintentos y tiempos de espera para manejar errores transitorios como límites de tasa o problemas de red.
- **Funciones clave**:
  - `callWithTimeoutAndRetries`: Maneja reintentos con backoff exponencial.

### 3. Procesamiento en lotes
- **Archivo**: `src/ai/openai-service.ts`
- **Descripción**: La función `categorizeBatchOpenAI` permite procesar múltiples transacciones en paralelo con lógica de fallback en caso de errores.
- **Lógica de fallback**: Si una transacción falla, se devuelve una categorización predeterminada.

### 4. Pruebas unitarias
- **Framework**: Vitest
- **Cobertura**:
  - `openai-service`: Validación de claves API, manejo de errores y procesamiento en lotes.
  - `cache`: Manejo de caché con TTL.
  - `enhanced-service`: Deduplicación de solicitudes concurrentes.
- **Estado actual**: Todas las pruebas relevantes están pasando.

---

## Instalación
1. Clonar el repositorio:
   ```bash
   git clone https://github.com/itsmanurm/ai-service.git
   ```
2. Instalar dependencias:
   ```bash
   npm install
   ```
3. Configurar variables de entorno:
   - `API_KEY`: Clave para autenticación de la API (header `x-api-key`).
   - `OPENAI_API_KEY`: Clave de la API de OpenAI.
   - `OPENAI_MODEL` (opcional): Modelo a utilizar (por defecto: `gpt-3.5-turbo`).

---

## Uso
### Seguridad y recomendaciones
- Mantén tu `API_KEY` y `OPENAI_API_KEY` fuera del control de versiones.
- Limita el origen con `CORS_ORIGIN` y ajusta `RATE_LIMIT_PER_MIN` para evitar abuso.
### Ejemplo básico
```typescript
import { categorizeWithOpenAI } from './src/ai/openai-service';

const input = {
  description: 'Compra en supermercado',
  amount: -1500,
  currency: 'ARS',
  merchant: 'Supermercado X'
};

categorizeWithOpenAI(input)
  .then(result => console.log(result))
  .catch(error => console.error(error));
```

---

## Contribuciones
1. Crear un branch para tu funcionalidad o corrección:
   ```bash
   git checkout -b feature/nueva-funcionalidad
   ```
2. Realizar cambios y confirmar:
   ```bash
   git commit -m "Descripción de los cambios"
   ```
3. Crear un pull request.

---

## Licencia
Este proyecto está bajo la licencia MIT.
