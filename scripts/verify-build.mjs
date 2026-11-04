import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (character) => String.fromCharCode(97 + parseInt(character, 16)));
assert.equal(extensionId, 'dfpafpdmlhafhpknaijeeelhdpbkiogk', 'Stable ID must match the server origin allowlist.');
assert.ok(!manifest.host_permissions?.length, 'All server access must be requested explicitly.');
assert.ok(!manifest.content_scripts, 'No blanket page collection on install.');
assert.deepEqual(manifest.externally_connectable?.matches, ['https://contextbridge-newpoluton.vercel.app/*', 'http://localhost/*', 'http://127.0.0.1/*'], 'Only the official website and local development may request scoped pairing.');
const paths = [];
async function walk(path) { for (const name of await readdir(path)) { const next = join(path, name); if ((await stat(next)).isDirectory()) await walk(next); else paths.push(next); } }
await walk('dist');
const env = await readFile('.env', 'utf8').catch(() => '');
const localKey = env.match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
for (const file of paths) {
  assert.ok(!file.includes('.env'), 'Environment files must never be packaged.');
  if (!/\.(js|mjs|html|json|css)$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  assert.ok(!source.includes('OPENAI_API_KEY'), 'Private API-key variables must never enter a browser bundle.');
  assert.ok(!source.includes('api.openai.com'), 'The extension must use the authenticated web backend.');
  if (localKey && localKey.length > 8) assert.ok(!source.includes(localKey), 'A private key reached the build.');
}
for (const path of ['dist/worker.js', 'dist/content.js', 'dist/panel.js', 'dist/reader.js', 'dist/pdf.worker.mjs', 'dist/icons/128.png']) await stat(path);
console.log(`Verified ${paths.length} packaged files: local PDF assets, least-privilege manifest, no OpenAI credentials.`);
