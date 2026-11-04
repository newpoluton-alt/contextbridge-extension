import { hostPattern, normalizeOrigin, validateSelection } from './selection';
import type { Connection, Encounter, Lookup, Mode, Reply, Selection, Settings } from './types';
import { matchingEncounter, overlayAction, type OverlayDraft } from './overlay';

const defaults: Connection = { apiUrl: __API_URL__, webUrl: __WEB_URL__ };
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function connection(): Promise<Connection> {
  const stored = await chrome.storage.local.get('connection');
  return { ...defaults, ...(stored.connection as Partial<Connection> | undefined) };
}

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

async function storeOverlay(draft: OverlayDraft) { await chrome.storage.session.set({ [`overlay:${draft.tabId}`]: draft }); }

/** Page scripts get only these scoped learning actions, never arbitrary API access or tokens. */
async function pageAction(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
  const origin = pageOrigin(sender);
  if (message.type === 'pagePreferences') {
    const settings = await request('/api/settings') as Settings;
    return { mode: settings.mode, learningLanguage: settings.learningLanguage, translationLanguage: settings.translationLanguage };
  }
  if (message.type === 'pageExplore') {
    const value = message.selection as Partial<Selection> | undefined;
    if (!value || typeof value.expression !== 'string' || typeof value.sentence !== 'string') throw new Error('Select an expression and its sentence.');
    validateSelection(value.expression, value.sentence);
    const settings = await request('/api/settings') as Settings;
    const mode: Mode = message.mode === 'direct' ? 'direct' : message.mode === 'guided' ? 'guided' : settings.mode;
    const selection: Selection = { expression: value.expression.trim(), sentence: value.sentence.trim(), sourceUrl: /^https?:/.test(sender.url!) ? sender.url!.slice(0, 2048) : '', title: String(sender.tab?.title || '').slice(0, 200), capturedAt: Date.now() };
    const result = await request('/api/lookup', 'POST', { expression: selection.expression, sentence: selection.sentence, language: settings.learningLanguage, translationLanguage: settings.translationLanguage, mode }) as Lookup;
    const draft: OverlayDraft = {
      ticket: crypto.randomUUID(), tabId: sender.tab!.id!, origin, expiresAt: Date.now() + 20 * 60_000,
      selection, result, mode, language: settings.learningLanguage, translationLanguage: settings.translationLanguage,
      savedId: matchingEncounter(result.matches, selection, settings.learningLanguage, settings.translationLanguage)?.id,
      revealed: mode === 'direct', hints: 0, assistance: mode === 'direct' ? ['answer_revealed'] : [],
      initialInterpretation: '', revisedInterpretation: '', unresolved: false, checkResponse: '', attemptHadHelp: false, checked: false,
    };
    await storeOverlay(draft);
    return draft;
  }
  const draft = await pageDraft(sender, message.ticket);
  if (message.type === 'pageFeedback') {
    if (typeof message.interpretation !== 'string' || !message.interpretation.trim() || message.interpretation.length > 2000) throw new Error('Write a short interpretation first.');
    if (!draft.initialInterpretation) { draft.initialInterpretation = message.interpretation.trim(); draft.attemptHadHelp = draft.assistance.length > 0; draft.assistance.push('initial_attempt'); }
    await storeOverlay(draft);
    const response = await request('/api/feedback', 'POST', { expression: draft.selection.expression, sentence: draft.selection.sentence, interpretation: message.interpretation.trim(), explanation: draft.result.explanation, kind: 'interpretation' });
    overlayAction(draft, 'reveal'); await storeOverlay(draft);
    return { draft, feedback: response.feedback };
  }
  if (message.type === 'pageAction') {
    overlayAction(draft, String(message.action), typeof message.value === 'string' ? message.value : undefined);
    await storeOverlay(draft); return draft;
  }
  if (message.type === 'pageSave') {
    const saved = await request('/api/encounters', 'POST', {
      expression: draft.selection.expression, sentence: draft.selection.sentence, sourceUrl: draft.selection.sourceUrl,
      language: draft.language, translationLanguage: draft.translationLanguage, mode: draft.mode,
      explanation: draft.result.explanation, initialInterpretation: draft.initialInterpretation, revisedInterpretation: draft.revisedInterpretation,
      assistance: draft.assistance, checkResponse: draft.checkResponse, unresolved: draft.unresolved,
      attemptStatus: draft.initialInterpretation ? draft.attemptHadHelp ? 'assisted' : 'attempted' : 'not_attempted',
    }) as Encounter;
    draft.savedId = saved.id; await storeOverlay(draft); return { id: saved.id };
  }
  if (message.type === 'pageContinue') {
    if (typeof message.revision === 'string') overlayAction(draft, 'revision', message.revision);
    if (typeof message.unresolved === 'boolean') overlayAction(draft, 'unresolved', String(message.unresolved));
    const snapshot = { ...draft, draftInterpretation: typeof message.interpretation === 'string' ? message.interpretation.slice(0, 2000) : draft.initialInterpretation };
    await chrome.storage.session.set({ draft: snapshot, selection: draft.selection, panelTarget: message.target === 'chat' ? 'chat' : 'explore' });
    return { ok: true };
  }
  throw new Error('Unsupported page action.');
}
chrome.tabs.onRemoved.addListener((tabId) => { void chrome.storage.session.remove(`overlay:${tabId}`); });

async function request(path: string, method = 'GET', body?: unknown) {
  if (!allowedPath(path) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error('Unsupported request.');
  }
  const config = await connection();
  if (!config.token && !['/api/config', '/api/extension/exchange'].includes(path)) {
    throw new Error('Link your account with a one-time code in Settings first.');
  }
  if (!(await chrome.permissions.contains({ origins: [hostPattern(config.apiUrl)] }))) {
    throw new Error('Connect to your server in Settings to allow access.');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  let response: Response;
  try {
    response = await fetch(`${normalizeOrigin(config.apiUrl)}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error('Could not reach your server. Check the server address and try again. Your draft is still here.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in on the website and connect a new pairing code in Settings.');
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
      case 'connection': {
        const c = await connection();
        return { apiUrl: c.apiUrl, webUrl: c.webUrl, connected: Boolean(c.token) };
      }
      case 'configure': {
        const previous = await connection();
        const next: Connection = { apiUrl: normalizeOrigin(message.apiUrl), webUrl: normalizeOrigin(message.webUrl) };
        if (next.apiUrl === previous.apiUrl) next.token = previous.token;
        await chrome.storage.local.set({ connection: next });
        return { ok: true };
      }
      case 'pair': {
        const result = await request('/api/extension/exchange', 'POST', { code: String(message.code || '').trim() });
        if (typeof result.token !== 'string' || !result.token.startsWith('cb_ext_')) throw new Error('The server returned an invalid connection token.');
        const c = await connection();
        await chrome.storage.local.set({ connection: { ...c, token: result.token } });
        return { ok: true };
      }
      case 'disconnect': {
        // Revoke remotely before forgetting the local token; errors remain visible.
        const c = await connection();
        if (c.token) await request('/api/extension/token', 'DELETE');
        delete c.token;
        await chrome.storage.local.set({ connection: c });
        await chrome.storage.session.remove(['draft', 'selection']);
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
