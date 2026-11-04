import { build } from 'esbuild';
import { readFile, mkdir, cp, rm, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

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
await mkdir('dist/icons', { recursive: true });

// Generate our simple bridge/book mark as PNG; no remote image or font dependency.
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size; const py = y / size;
    const arch = Math.abs(Math.hypot((px - .5) * 1.2, (py - .63)) - .3) < .055 && py < .64;
    const pillar = ((px > .18 && px < .28) || (px > .72 && px < .82)) && py > .46 && py < .8;
    const baseline = py > .74 && py < .81 && px > .16 && px < .84;
    const color = arch || pillar || baseline ? [216, 233, 158] : [47, 74, 55];
    const index = y * (size * 4 + 1) + 1 + x * 4;
    rows[index] = color[0]; rows[index + 1] = color[1]; rows[index + 2] = color[2]; rows[index + 3] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(`dist/icons/${size}.png`, png);
}
console.log('Extension ready: load the dist folder in Chrome. No private environment values were included.');
