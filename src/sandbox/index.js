import { env } from '../config/env.js';
import { createSandboxClient } from './SandboxClient.js';

/** Process-wide sandbox client (shares one concurrency limiter). */
export const sandbox = createSandboxClient(env);
