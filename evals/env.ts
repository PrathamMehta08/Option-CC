import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load .env.local the way Next does, so the CLI tools need no extra setup.
 *
 * Call this before reading anything from process.env. Everything in
 * lib/assistant/model.ts resolves at call time precisely so that this can run
 * from inside main(), after the imports have already been evaluated.
 */
export function loadEnvLocal() {
  for (const file of ['.env.local', '.env']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      const [, key, rawValue] = match;
      // A real environment variable wins over the file, so one-off overrides
      // on the command line work.
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}
