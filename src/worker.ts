import { hostPattern, normalizeOrigin, validateSelection } from './selection';
import type { Account, Connection, Encounter, Lookup, Mode, Reply, Selection, Settings } from './types';
import { matchingEncounter, overlayAction, type OverlayDraft } from './overlay';
import { externalAccountMessage, externalPairCode, externalPairTarget } from './pairing';

const defaults: Connection = { apiUrl: __API_URL__, webUrl: __WEB_URL__ };
type PendingPair = { apiUrl: string; webUrl: string; code: string; accountId?: string; expiresAt: number };
let accountEpoch = 0;
let connectionOperation = 0;
let activePair: { operation: number; accountId?: string; apiUrl: string } | undefined;
let connectionMutation: Promise<unknown> = Promise.resolve();
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function connection(): Promise<Connection> {
  const stored = await chrome.storage.local.get('connection');
  return { ...defaults, ...(stored.connection as Partial<Connection> | undefined) };
}

async function pendingPair(): Promise<PendingPair | undefined> {
  const value = (await chrome.storage.session.get('pendingPair')).pendingPair as PendingPair | undefined;
  if (value && value.expiresAt > Date.now()) return value;
  if (value) await chrome.storage.session.remove('pendingPair');
}

// Serialize account writes so a late sign-in or failed old request cannot restore
// an account after sign-out, or clear a newly connected account.
function mutateConnection<T>(action: () => Promise<T>): Promise<T> {
  const result = connectionMutation.then(action, action);
  connectionMutation = result.catch(() => {});
  return result;
}

async function announceAccountChange() {
  await chrome.storage.session.clear();
  await chrome.storage.session.set({ connectionChanged: crypto.randomUUID() });
  for (const tab of await chrome.tabs.query({})) if (tab.id) void chrome.tabs.sendMessage(tab.id, { type: 'accountChanged' }).catch(() => {});
}

async function forgetConnection(expectedToken?: string): Promise<boolean> {
  return mutateConnection(async () => {
    const current = await connection();
    if (expectedToken !== undefined && current.token !== expectedToken) return false;
    connectionOperation++;
    accountEpoch++;
    const { token: _token, account: _account, ...next } = current;
    await chrome.storage.local.set({ connection: next });
    await announceAccountChange();
    return true;
  });
}

async function revokeConnection(config: Connection) {
  if (!config.token) return;
  await fetch(`${normalizeOrigin(config.apiUrl)}/api/extension/token`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${config.token}` },
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

async function disconnect(config: Connection) {
  // Signing out must work offline too. Revoke the captured old token separately.
  if (await forgetConnection(config.token)) void revokeConnection(config);
}

function accountFrom(value: unknown): Account {
  const data = value as Partial<Account> | undefined;
  if (!data || typeof data.id !== 'string' || !data.id || typeof data.email !== 'string') throw new Error('Could not confirm your account. Please try again.');
  return { id: data.id, name: typeof data.name === 'string' ? data.name : '', email: data.email };
}

async function connectionStatus() {
  const c = await connection();
  const pending = await pendingPair();
  const base = { apiUrl: pending?.apiUrl || c.apiUrl, webUrl: pending?.webUrl || c.webUrl, pendingPair: Boolean(pending) };
  if (!c.token) return { ...base, connected: false, account: undefined, unavailable: false };
  if (!(await chrome.permissions.contains({ origins: [hostPattern(c.apiUrl)] }))) {
    await disconnect(c);
    return { ...base, connected: false, account: undefined, unavailable: false };
  }
  try {
    const account = accountFrom(await request('/api/me'));
    await mutateConnection(async () => {
      const current = await connection();
      if (current.token === c.token) await chrome.storage.local.set({ connection: { ...current, account } });
    });
    const current = await connection();
    if (current.token !== c.token) return { ...base, connected: false, account: undefined, unavailable: false };
    return { ...base, connected: true, account, unavailable: false };
  } catch {
    const current = await connection();
    return { ...base, connected: Boolean(current.token), account: current.account, unavailable: Boolean(current.token) };
  }
}

async function pairAt(target: { apiUrl: string; webUrl: string }, code: string, operation = ++connectionOperation, accountId?: string) {
  activePair = { operation, accountId, apiUrl: target.apiUrl };
  if (!(await chrome.permissions.contains({ origins: [hostPattern(target.apiUrl)] }))) throw new Error('Choose Connect account in the extension and approve website access.');
  const response = await fetch(`${normalizeOrigin(target.apiUrl)}/api/extension/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.message === 'string' ? result.message.slice(0, 300) : 'Could not connect. Choose Connect account to try again.');
  if (typeof result.token !== 'string' || !/^cb_ext_[A-Za-z0-9_-]{20,200}$/.test(result.token)) throw new Error('The server returned an invalid connection token.');
  const next: Connection = { ...target, token: result.token };
  try {
    const identity = await fetch(`${normalizeOrigin(target.apiUrl)}/api/me`, {
      headers: { Authorization: `Bearer ${result.token}` }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!identity.ok) throw new Error('Could not confirm your account. Choose Connect account to try again.');
    next.account = accountFrom(await identity.json());
    if (accountId && next.account.id !== accountId) throw new Error('Your account changed. Choose Connect account to try again.');
    await mutateConnection(async () => {
      if (operation !== connectionOperation) throw new Error('Your connection changed. Choose Connect account to try again.');
      const previous = await connection();
      accountEpoch++;
      await chrome.storage.local.set({ connection: next });
      await announceAccountChange();
      void revokeConnection(previous);
    });
  } catch (error) {
    void revokeConnection(next);
    throw error;
  } finally {
    if (activePair?.operation === operation) activePair = undefined;
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  void (async () => {
    const target = externalPairTarget(sender.url || '', sender.origin, sender.frameId);
    if (message?.type === 'CB_STATUS' || message?.type === 'CB_DISCONNECT') {
      const command = externalAccountMessage(message);
      if (command.type === 'CB_DISCONNECT') {
        await mutateConnection(async () => {
          if (activePair?.apiUrl === target.apiUrl && activePair.accountId === command.accountId) {
            connectionOperation++;
            activePair = undefined;
          }
          const pending = await pendingPair();
          if (pending?.apiUrl === target.apiUrl && pending.accountId === command.accountId) await chrome.storage.session.remove('pendingPair');
        });
      }
      const c = await connection();
      if (c.apiUrl !== target.apiUrl || !c.token) return { ok: true, status: 'disconnected' };
      // Cached identity is trusted extension-only data and lets explicit sign-out
      // clear locally even while the backend is temporarily unreachable.
      if (command.type === 'CB_DISCONNECT' && c.account?.id === command.accountId) {
        await disconnect(c);
        return { ok: true, status: 'disconnected' };
      }
      const status = await connectionStatus();
      if (status.unavailable) return { ok: true, status: 'unavailable' };
      if (!status.connected || status.account?.id !== command.accountId) return { ok: true, status: 'disconnected' };
      if (command.type === 'CB_DISCONNECT') {
        await disconnect(c);
        return { ok: true, status: 'disconnected' };
      }
      return { ok: true, status: 'connected' };
    }
    const code = externalPairCode(message);
    const operation = ++connectionOperation;
    const accountId = typeof message.accountId === 'string' ? message.accountId : undefined;
    activePair = { operation, accountId, apiUrl: target.apiUrl };
    if (!(await chrome.permissions.contains({ origins: [hostPattern(target.apiUrl)] }))) {
      await mutateConnection(async () => {
        if (operation !== connectionOperation) throw new Error('Your connection changed. Please try again.');
        await chrome.storage.session.set({ pendingPair: { ...target, code, accountId, expiresAt: Date.now() + 4 * 60_000 } });
      });
      await chrome.runtime.openOptionsPage();
      return { ok: true, status: 'permission_required', message: 'Choose Connect account in the extension to approve website access and finish connecting.' };
    }
    await pairAt(target, code, operation, accountId);
    return { ok: true, status: 'connected', message: 'Your ContextBridge account is connected to the extension.' };
  })().then(respond).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Could not connect the extension.' }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'explore', title: 'Explore “%s” with ContextBridge', contexts: ['selection'] });
  });
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html#settings') });
});

async function capture(tab: chrome.tabs.Tab, fallback = '') {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'capture', fallback });
  } catch {
    if (fallback.trim()) {
      await saveSelection({ expression: fallback.trim().slice(0, 160), sentence: fallback.trim().slice(0, 2400), sourceUrl: tab.url || '', title: tab.title, capturedAt: Date.now() });
    } else {
      await chrome.storage.session.set({ selectionNotice: 'This page cannot be read by extensions. For PDFs, use the PDF reader below. You can also type the expression and sentence.' });
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  // open() must run directly from the user gesture, before asynchronous work.
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  void capture(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'explore' || !tab) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  void capture(tab, info.selectionText || '');
});

async function saveSelection(input: Selection) {
  const clean: Selection = {
    expression: String(input.expression || '').trim().slice(0, 160),
    sentence: String(input.sentence || '').trim().slice(0, 2400),
    sourceUrl: /^https?:\/\//.test(input.sourceUrl) ? input.sourceUrl.slice(0, 2048) : '',
    title: String(input.title || '').slice(0, 200),
    capturedAt: Date.now(),
  };
  if (!clean.expression) return;
  await chrome.storage.session.set({ selection: clean, selectionNotice: '' });
}

function allowedPath(path: string): boolean {
  return /^\/api\/(config|me|settings|usage|lookup|feedback|encounters|chats|extension\/exchange|extension\/token)(\/[a-zA-Z0-9_-]+)?(\/messages|\/review)?(\?[^#]*)?$/.test(path);
}

function pageOrigin(sender: chrome.runtime.MessageSender) {
  if (!sender.tab?.id || !sender.url) throw new Error('Open this tool from a reading page.');
  if (sender.url === chrome.runtime.getURL('reader.html')) return new URL(sender.url).origin;
  const url = new URL(sender.url);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('This page is not supported.');
  return url.origin;
}

async function pageDraft(sender: chrome.runtime.MessageSender, ticket: unknown): Promise<OverlayDraft> {
  const origin = pageOrigin(sender);
  const key = `overlay:${sender.tab!.id}`;
  const stored = (await chrome.storage.session.get(key))[key] as OverlayDraft | undefined;
  if (!stored || typeof ticket !== 'string' || stored.ticket !== ticket || stored.origin !== origin || stored.expiresAt < Date.now()) {
    throw new Error('This explanation expired. Explore the expression again.');
  }
  return stored;
}

async function storeOverlay(draft: OverlayDraft, epoch = accountEpoch) { if (epoch !== accountEpoch) throw new Error('Your account changed. Explore this expression again.'); await chrome.storage.session.set({ [`overlay:${draft.tabId}`]: draft }); }

/** Page scripts get only these scoped learning actions, never arbitrary API access or tokens. */
async function pageAction(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  const epoch = accountEpoch;
  const scopedRequest = (path: string, method = 'GET', body?: unknown) => { if (epoch !== accountEpoch) throw new Error('Your account changed. Explore this expression again.'); return request(path, method, body); };
  const origin = pageOrigin(sender);
  if (message.type === 'pagePreferences') {
    const settings = await scopedRequest('/api/settings') as Settings;
    return { mode: settings.mode, learningLanguage: settings.learningLanguage, translationLanguage: settings.translationLanguage };
  }
  if (message.type === 'pageExplore') {
    const value = message.selection as Partial<Selection> | undefined;
    if (!value || typeof value.expression !== 'string' || typeof value.sentence !== 'string') throw new Error('Select an expression and its sentence.');
    validateSelection(value.expression, value.sentence);
    const settings = await scopedRequest('/api/settings') as Settings;
    const mode: Mode = message.mode === 'direct' ? 'direct' : message.mode === 'guided' ? 'guided' : settings.mode;
    const selection: Selection = { expression: value.expression.trim(), sentence: value.sentence.trim(), sourceUrl: /^https?:/.test(sender.url!) ? sender.url!.slice(0, 2048) : '', title: String(sender.tab?.title || '').slice(0, 200), capturedAt: Date.now() };
    const result = await scopedRequest('/api/lookup', 'POST', { expression: selection.expression, sentence: selection.sentence, language: settings.learningLanguage, translationLanguage: settings.translationLanguage, mode }) as Lookup;
    const draft: OverlayDraft = {
      ticket: crypto.randomUUID(), tabId: sender.tab!.id!, origin, expiresAt: Date.now() + 20 * 60_000,
      selection, result, mode, language: settings.learningLanguage, translationLanguage: settings.translationLanguage,
      savedId: matchingEncounter(result.matches, selection, settings.learningLanguage, settings.translationLanguage)?.id,
      revealed: mode === 'direct', hints: 0, assistance: mode === 'direct' ? ['answer_revealed'] : [],
      initialInterpretation: '', revisedInterpretation: '', unresolved: false, checkResponse: '', attemptHadHelp: false, checked: false,
    };
    await storeOverlay(draft, epoch);
    return draft;
  }
  const draft = await pageDraft(sender, message.ticket);
  if (message.type === 'pageFeedback') {
    if (typeof message.interpretation !== 'string' || !message.interpretation.trim() || message.interpretation.length > 2000) throw new Error('Write a short interpretation first.');
    if (!draft.initialInterpretation) { draft.initialInterpretation = message.interpretation.trim(); draft.attemptHadHelp = draft.assistance.length > 0; draft.assistance.push('initial_attempt'); }
    await storeOverlay(draft, epoch);
    const response = await scopedRequest('/api/feedback', 'POST', { expression: draft.selection.expression, sentence: draft.selection.sentence, interpretation: message.interpretation.trim(), explanation: draft.result.explanation, kind: 'interpretation' });
    overlayAction(draft, 'reveal'); await storeOverlay(draft, epoch);
    return { draft, feedback: response.feedback };
  }
  if (message.type === 'pageAction') {
    overlayAction(draft, String(message.action), typeof message.value === 'string' ? message.value : undefined);
    await storeOverlay(draft, epoch); return draft;
  }
  if (message.type === 'pageSave') {
    const saved = await scopedRequest('/api/encounters', 'POST', {
      expression: draft.selection.expression, sentence: draft.selection.sentence, sourceUrl: draft.selection.sourceUrl,
      language: draft.language, translationLanguage: draft.translationLanguage, mode: draft.mode,
      explanation: draft.result.explanation, initialInterpretation: draft.initialInterpretation, revisedInterpretation: draft.revisedInterpretation,
      assistance: draft.assistance, checkResponse: draft.checkResponse, unresolved: draft.unresolved,
      attemptStatus: draft.initialInterpretation ? draft.attemptHadHelp ? 'assisted' : 'attempted' : 'not_attempted',
    }) as Encounter;
    draft.savedId = saved.id; await storeOverlay(draft, epoch); return { id: saved.id };
  }
  if (message.type === 'pageContinue') {
    if (typeof message.revision === 'string') overlayAction(draft, 'revision', message.revision);
    if (typeof message.unresolved === 'boolean') overlayAction(draft, 'unresolved', String(message.unresolved));
    if (epoch !== accountEpoch) throw new Error('Your account changed. Explore this expression again.');
    const snapshot = { ...draft, draftInterpretation: typeof message.interpretation === 'string' ? message.interpretation.slice(0, 2000) : draft.initialInterpretation };
    await chrome.storage.session.set({ draft: snapshot, selection: draft.selection, panelTarget: message.target === 'chat' ? 'chat' : 'explore' });
    return { ok: true };
  }
  throw new Error('Unsupported page action.');
}
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`overlay:${tabId}`); });

async function request(path: string, method = 'GET', body?: unknown) {
  const epoch = accountEpoch;
  if (!allowedPath(path) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error('Unsupported request.');
  }
  const config = await connection();
  if (!config.token && !['/api/config', '/api/extension/exchange'].includes(path)) {
    throw new Error('Choose Connect account to sign in and use your library.');
  }
  if (!(await chrome.permissions.contains({ origins: [hostPattern(config.apiUrl)] }))) {
    throw new Error('Choose Connect account and approve website access.');
  }
  if (epoch !== accountEpoch) throw new Error('Your account changed. Please retry this action.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(`${normalizeOrigin(config.apiUrl)}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('Could not reach ContextBridge. Check your internet connection and try again. Your draft is still here.');
  }
  const data = await response.json().catch(() => ({}));
  if (epoch !== accountEpoch || (await connection()).token !== config.token) throw new Error('Your account changed. Please retry this action.');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      if (config.token) await forgetConnection(config.token);
      throw new Error('You’re signed out. Choose Connect account to sign in again.');
    }
    throw new Error(typeof data.message === 'string' ? data.message.slice(0, 500) : `Request failed (${response.status}). Please retry.`);
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, respond: (value: Reply<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;
  if (['pagePreferences', 'pageExplore', 'pageFeedback', 'pageAction', 'pageSave', 'pageContinue'].includes(message.type)) {
    if (message.type === 'pageContinue' && sender.tab?.windowId !== undefined) void chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    void pageAction(message, sender).then((data) => respond({ ok: true, data })).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Could not complete this action.' }));
    return true;
  }
  const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
  if (message.type === 'selection' && (sender.tab || trusted)) {
    if (message.open && sender.tab?.windowId !== undefined) void chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    saveSelection(message.selection).then(() => respond({ ok: true, data: null })).catch(() => respond({ ok: false, error: 'Could not capture this selection.' }));
    return true;
  }
  if (!trusted) return false;
  const task = async () => {
    switch (message.type) {
      case 'connection': return connectionStatus();
      case 'beginConnect': {
        const pending = await pendingPair();
        if (pending) {
          try {
            await pairAt(pending, pending.code, ++connectionOperation, pending.accountId);
            return { connected: true };
          } catch {
            // A pending one-time code can expire while the permission prompt is
            // open. Start a fresh website connection without asking for a code.
            await chrome.storage.session.remove('pendingPair');
          }
        }
        const stored = await connection();
        const c = pending ? { ...stored, apiUrl: pending.apiUrl, webUrl: pending.webUrl } : stored;
        if (!(await chrome.permissions.contains({ origins: [hostPattern(c.apiUrl)] }))) throw new Error('Approve website access to connect your account.');
        const url = `${normalizeOrigin(c.webUrl)}/?connect=extension`;
        const previous = (await chrome.storage.session.get('connectTabId')).connectTabId;
        if (typeof previous === 'number') {
          try { await chrome.tabs.update(previous, { url, active: true }); return { connected: false }; } catch { /* Closed tabs are replaced below. */ }
        }
        const tab = await chrome.tabs.create({ url });
        if (tab.id) await chrome.storage.session.set({ connectTabId: tab.id });
        return { connected: false };
      }
      case 'disconnect': {
        await disconnect(await connection());
        return { ok: true };
      }
      case 'api': return request(String(message.path || ''), message.method, message.body);
      case 'captureCurrent': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await capture(tab);
        return { ok: true };
      }
      case 'openWeb': {
        const c = await connection();
        await chrome.tabs.create({ url: `${normalizeOrigin(c.webUrl)}${message.settings ? '/#settings' : '/'}` });
        return { ok: true };
      }
      case 'openPdf': {
        await chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
        return { ok: true };
      }
      case 'openSource': {
        const url = new URL(String(message.url || ''));
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('This encounter has no supported source page.');
        await chrome.tabs.create({ url: url.href }); return { ok: true };
      }
      default: throw new Error('Unknown action.');
    }
  };
  void task().then((data) => respond({ ok: true, data })).catch((error) => respond({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong. Please try again.' }));
  return true;
});
