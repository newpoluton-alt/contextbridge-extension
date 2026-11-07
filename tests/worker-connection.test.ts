import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const origin = 'https://contextbridge-newpoluton.vercel.app';
const id = 'dfpafpdmlhafhpknaijeeelhdpbkiogk';
const token = (owner: string) => `cb_ext_${owner}_${'x'.repeat(32)}`;
const bundle = await build({ entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', define: { __API_URL__: JSON.stringify(origin), __WEB_URL__: JSON.stringify(origin) } });
type Message = Record<string, unknown>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
async function fixture() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const listeners: Record<string, Function> = {};
  const revoked: string[] = [];
  const tabs: Record<string, unknown>[] = [];
  let permitted = true;
  let fetchHook: ((url: string, init: RequestInit) => Promise<Response> | undefined) | undefined;
  const storage = (data: Record<string, unknown>) => ({
    async get(key?: string | string[]) { if (!key) return structuredClone(data); return Object.fromEntries((Array.isArray(key) ? key : [key]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])); },
    async set(value: Record<string, unknown>) { Object.assign(data, structuredClone(value)); },
    async clear() { Object.keys(data).forEach((key) => delete data[key]); },
    async remove(keys: string | string[]) { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete data[key]); },
    async setAccessLevel() {},
  });
  const event = (key: string) => ({ addListener(listener: Function) { listeners[key] = listener; } });
  const chrome = {
    runtime: { id, getURL: (path: string) => `chrome-extension://${id}/${path}`, onMessage: event('internal'), onMessageExternal: event('external'), onInstalled: event('install'), async openOptionsPage() {} },
    storage: { local: storage(local), session: storage(session) },
    permissions: { async contains() { return permitted; } },
    tabs: { async query() { return []; }, async sendMessage() {}, onRemoved: event('removed'), async create(options: Record<string, unknown>) { tabs.push(options); return { id: tabs.length }; }, async update(_id: number, options: Record<string, unknown>) { tabs.push(options); return { id: _id }; } },
    contextMenus: { onClicked: event('contextmenu'), removeAll(callback: Function) { callback(); }, create() {} },
    action: { onClicked: event('action') }, sidePanel: { async open() {} }, scripting: { async executeScript() {} },
  };
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const intercepted = fetchHook?.(url, init); if (intercepted) return intercepted;
    const path = new URL(url).pathname;
    if (path.endsWith('/extension/exchange')) {
      const owner = String(JSON.parse(String(init.body)).code).startsWith('accountB') ? 'accountB' : 'accountA';
      return response({ token: token(owner) });
    }
    const bearer = (init.headers as Record<string, string>)?.Authorization || '';
    if (path.endsWith('/extension/token')) { revoked.push(bearer); return response({ ok: true }); }
    const owner = bearer.includes('accountB') ? 'accountB' : 'accountA';
    if (path.endsWith('/me')) return response({ id: owner, email: `${owner}@example.invalid`, name: owner });
    return response({ owner });
  };
  vm.runInNewContext(bundle.outputFiles[0].text, { chrome, fetch: fetcher, URL, crypto, AbortSignal, Date, console, setTimeout, clearTimeout });
  function send(kind: 'internal' | 'external', message: Message) {
    return new Promise<any>((resolve) => {
      listeners[kind](message, kind === 'external' ? { url: `${origin}/`, origin, frameId: 0 } : { id, url: `chrome-extension://${id}/sidepanel.html` }, resolve);
    });
  }
  return { local, session, revoked, tabs, send, permission: (value: boolean) => { permitted = value; }, hook: (value?: typeof fetchHook) => { fetchHook = value; } };
}
const pair = (f: Awaited<ReturnType<typeof fixture>>, accountId = 'accountA') => f.send('external', { type: 'CB_PAIR', accountId, code: `${accountId}_single_use_code_12345` });

test('connection reports the verified identity internally and only a matching status externally', async () => {
  const f = await fixture();
  assert.equal((await pair(f)).status, 'connected');
  const internal = await f.send('internal', { type: 'connection' });
  assert.equal(internal.data.account.email, 'accountA@example.invalid');
  assert.deepEqual(JSON.parse(JSON.stringify(await f.send('external', { type: 'CB_STATUS', accountId: 'accountA' }))), { ok: true, status: 'connected' });
  assert.equal((await f.send('external', { type: 'CB_DISCONNECT', accountId: 'accountB' })).status, 'disconnected');
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, true);
  await f.send('external', { type: 'CB_DISCONNECT', accountId: 'accountA' });
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, false);
});

test('sign-out during the first exchange cancels the matching in-flight connection', async () => {
  const f = await fixture(); const pending = deferred<Response>(); const entered = deferred<void>();
  f.hook((url) => { if (url.endsWith('/extension/exchange')) { entered.resolve(); return pending.promise; } });
  const pairing = pair(f); await entered.promise;
  await f.send('external', { type: 'CB_DISCONNECT', accountId: 'accountA' });
  pending.resolve(response({ token: token('accountA') }));
  assert.equal((await pairing).ok, false);
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, false);
  assert.ok(f.revoked.includes(`Bearer ${token('accountA')}`));
});

test('a wrong-account sign-out cannot cancel an in-flight connection', async () => {
  const f = await fixture(); const pending = deferred<Response>(); const entered = deferred<void>();
  f.hook((url) => { if (url.endsWith('/extension/exchange')) { entered.resolve(); return pending.promise; } });
  const pairing = pair(f); await entered.promise;
  await f.send('external', { type: 'CB_DISCONNECT', accountId: 'accountB' });
  pending.resolve(response({ token: token('accountA') }));
  assert.equal((await pairing).status, 'connected');
});

test('a late failed request from the previous account cannot clear the new account', async () => {
  const f = await fixture(); await pair(f);
  const pending = deferred<Response>(); const entered = deferred<void>();
  f.hook((url) => { if (url.endsWith('/settings')) { entered.resolve(); return pending.promise; } });
  const oldRequest = f.send('internal', { type: 'api', path: '/api/settings' }); await entered.promise;
  await pair(f, 'accountB'); pending.resolve(response({ message: 'Expired' }, 401));
  assert.equal((await oldRequest).ok, false);
  assert.equal((await f.send('internal', { type: 'connection' })).data.account.id, 'accountB');
});

test('expiry clears account drafts and shows disconnected, while offline preserves the connected identity', async () => {
  const f = await fixture(); await pair(f);
  f.hook((url) => url.endsWith('/me') ? Promise.reject(new Error('Offline')) : undefined);
  const offline = await f.send('internal', { type: 'connection' });
  assert.equal(offline.data.connected, true); assert.equal(offline.data.unavailable, true);
  assert.equal((await f.send('external', { type: 'CB_STATUS', accountId: 'accountA' })).status, 'unavailable');
  f.session.draft = { private: 'prior account' };
  f.hook((url) => url.endsWith('/me') ? Promise.resolve(response({ message: 'Expired' }, 401)) : undefined);
  const expired = await f.send('internal', { type: 'connection' });
  assert.equal(expired.data.connected, false); assert.equal(expired.data.account, undefined);
  assert.equal(f.session.draft, undefined); assert.ok(f.session.connectionChanged);
});

test('revoked host permission exposes reconnect, and sign-out clears locally despite failed remote revoke', async () => {
  const f = await fixture(); await pair(f);
  f.permission(false);
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, false);
  f.permission(true); await pair(f);
  f.hook((url) => url.endsWith('/extension/token') ? Promise.reject(new Error('Offline')) : undefined);
  await f.send('internal', { type: 'disconnect' });
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, false);
});

test('pending permission connects with one button without showing or pasting a code', async () => {
  const f = await fixture(); f.permission(false);
  assert.equal((await pair(f)).status, 'permission_required');
  f.permission(true);
  assert.equal((await f.send('internal', { type: 'beginConnect' })).data.connected, true);
  assert.equal(f.tabs.length, 0);
  await f.send('internal', { type: 'disconnect' });
  await f.send('internal', { type: 'beginConnect' });
  assert.equal(f.tabs[0].url, `${origin}/?connect=extension`);
});


test('the returned account must match the expected website account', async () => {
  const f = await fixture();
  const result = await f.send('external', { type: 'CB_PAIR', accountId: 'accountB', code: 'accountA_single_use_code_12345' });
  assert.equal(result.ok, false);
  assert.equal((await f.send('internal', { type: 'connection' })).data.connected, false);
  assert.ok(f.revoked.includes(`Bearer ${token('accountA')}`));
});

test('the newest connection wins when earlier exchanges complete later', async () => {
  const f = await fixture(); const pending = deferred<Response>(); const entered = deferred<void>();
  f.hook((url, init) => {
    if (url.endsWith('/extension/exchange') && String(init.body).includes('accountA')) { entered.resolve(); return pending.promise; }
  });
  const olderPair = pair(f); await entered.promise;
  assert.equal((await pair(f, 'accountB')).status, 'connected');
  pending.resolve(response({ token: token('accountA') }));
  assert.equal((await olderPair).ok, false);
  assert.equal((await f.send('internal', { type: 'connection' })).data.account.id, 'accountB');
});
