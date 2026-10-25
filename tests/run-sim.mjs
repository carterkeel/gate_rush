import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({ entryPoints: ['tests/sim.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'tests/.sim.bundle.mjs', logLevel: 'error' });
const r = spawnSync('node', ['tests/.sim.bundle.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
