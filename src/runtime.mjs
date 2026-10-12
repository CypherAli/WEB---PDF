import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

export function dependency(name) {
  const require = createRequire(import.meta.url);
  try { return require(name); } catch (error) {
    const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', name);
    try { return require(bundled); } catch { throw new Error(`Thiếu ${name}. Chạy npm install trước. (${error.code})`); }
  }
}
export const { chromium } = dependency('playwright');
