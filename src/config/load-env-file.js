// Side-effect module: loads backend/.env into process.env (when present) before config is read.
// Imported first by server.js; tests set process.env themselves and never import this.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
