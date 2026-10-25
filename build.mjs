import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  logLevel: 'info',
});
const js = result.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
const html = readFileSync('index.template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
writeFileSync('dist/index.html', html);
// GitHub Pages serves the committed docs/ folder
mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
