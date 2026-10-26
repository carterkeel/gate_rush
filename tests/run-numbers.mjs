import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/numbers.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'tests/.numbers.bundle.mjs', logLevel: 'error' });
const r = spawnSync('node', ['tests/.numbers.bundle.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
