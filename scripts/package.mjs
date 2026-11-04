import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('releases', { recursive: true });
const output = '../releases/contextbridge-extension.zip';
await rm('releases/contextbridge-extension.zip', { force: true });
const result = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Compress-Archive -Path dist/* -DestinationPath releases/contextbridge-extension.zip -Force'], { stdio: 'inherit' })
  : spawnSync('zip', ['-q', '-r', output, '.'], { cwd: 'dist', stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error('ZIP creation failed. You can still load dist directly in Chrome.');
console.log('Created releases/contextbridge-extension.zip');
