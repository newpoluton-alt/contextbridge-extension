import { build } from 'esbuild';
import { readFile, mkdir, cp, rm } from 'node:fs/promises';

const environment = await readFile('.env', 'utf8').catch(() => '');
function publicSetting(key, fallback) {
  const value = process.env[key] || environment.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim() || fallback;
  const url = new URL(value.replace(/^['"]|['"]$/g, ''));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error(`${key} must use HTTPS, or HTTP on localhost.`);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`${key} must be an origin without credentials, query, or path.`);
  return url.origin;
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const shared = {
  bundle: true, minify: true, target: 'chrome121', platform: 'browser', logLevel: 'info',
  define: {
    __API_URL__: JSON.stringify(publicSetting('CONTEXTBRIDGE_API_URL', 'https://contextbridge-newpoluton.vercel.app')),
    __WEB_URL__: JSON.stringify(publicSetting('CONTEXTBRIDGE_WEB_URL', 'https://contextbridge-newpoluton.vercel.app')),
  },
};
await build({ ...shared, entryPoints: ['src/worker.ts', 'src/panel.ts', 'src/reader.ts'], outdir: 'dist', format: 'esm' });
await build({ ...shared, entryPoints: ['src/content.ts'], outdir: 'dist', format: 'iife' });
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/pdf.worker.mjs');
await cp('node_modules/pdfjs-dist/web/pdf_viewer.css', 'dist/pdf_viewer.css');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${folder}`, `dist/${folder}`, { recursive: true });
await cp('node_modules/pdfjs-dist/LICENSE', 'dist/PDFJS-LICENSE.txt');
// Shared open-book SVG and its PNG exports are copied from public/icons.
console.log('Extension ready: load the dist folder in Chrome. No private environment values were included.');
