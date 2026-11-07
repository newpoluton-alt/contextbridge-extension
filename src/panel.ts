import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { hostPattern, validateSelection } from './selection';
import { matchingEncounter } from './overlay';
import type { Account, Chat, Encounter, Lookup, Mode, PublicConfig, Reply, Selection, Settings } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const text = (id: string, value: string) => { $(id).textContent = value; };
const show = (id: string, visible = true) => { $(id).hidden = !visible; };
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type View = 'explore' | 'library' | 'chat' | 'settings';
type Draft = {
  selection: Selection; language: string; translationLanguage: string; mode: Mode;
  result?: Lookup; revealed: boolean; hints: number; assistance: string[];
  initialInterpretation: string; revisedInterpretation: string; unresolved: boolean;
  checkResponse: string; savedId?: string; attemptHadHelp: boolean; checked: boolean;
  followupQuestion?: string;
};
let preferences: Settings | undefined;
let settingsDirty = false;
let accountEpoch = 0;
let draft: Draft = freshDraft();
let config: PublicConfig | undefined;
let connected = false;
let connectionApiUrl = __API_URL__;
let connectionRefresh = 0;
let busy = false;
let revision = 0;
let activeView: View = location.hash === '#settings' ? 'settings' : 'explore';
let chats: Chat[] = [];
let currentChat: Chat | undefined;
let library: Encounter[] = [];

function freshDraft(selection?: Selection): Draft {
  return {
    selection: selection || { expression: '', sentence: '', sourceUrl: '', capturedAt: Date.now() },
    language: preferences?.learningLanguage || 'English', translationLanguage: preferences?.translationLanguage || 'English',
    mode: preferences?.mode || 'guided', revealed: false, hints: 0, assistance: [],
    initialInterpretation: '', revisedInterpretation: '', unresolved: false, checkResponse: '', attemptHadHelp: false, checked: false,
  };
}

async function send<T>(message: Record<string, unknown>): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message) as Reply<T>;
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The extension restarted. Please reopen the panel.');
  return reply.data;
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> { const epoch = accountEpoch; const value = await send<T>({ type: 'api', path, method, body }); if (epoch !== accountEpoch) throw new Error('Your account changed. Please try again.'); return value; }

function notify(message: string, error = false) {
  show(error ? 'notice' : 'error', false);
  text(error ? 'error' : 'notice', message);
  show(error ? 'error' : 'notice');
}

async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  show('error', false); show('notice', false);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((button) => { button.disabled = true; });
  document.body.setAttribute('aria-busy', 'true');
  try { await action(); } catch (error) { notify(error instanceof Error ? error.message : 'Something went wrong. Please try again.', true); }
  finally { busy = false; buttons.forEach((button) => { button.disabled = false; }); $<HTMLButtonElement>('return-source').disabled = !/^https?:\/\//.test(draft.selection.sourceUrl); document.body.removeAttribute('aria-busy'); }
}

function selectValue(id: string, value: string) {
  const select = $<HTMLSelectElement>(id);
  if (![...select.options].some((option) => option.value === value)) select.add(new Option(value, value));
  select.value = value;
}

function syncInputs() {
  draft.selection.expression = input('expression').value.trim();
  draft.selection.sentence = input('sentence').value.trim();
  draft.language = input('language').value;
  draft.translationLanguage = input('translation-language').value;
  draft.mode = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')!.value as Mode;
  draft.revisedInterpretation = input('revision').value.trim();
  draft.unresolved = input('unresolved').checked;
  draft.checkResponse = input('check-response').value.trim();
}

function persist() {
  void chrome.storage.session.set({ draft: { ...draft, draftInterpretation: input('interpretation').value }, chatDraft: input('chat-input').value });
}

function setForm() {
  input('expression').value = draft.selection.expression;
  input('sentence').value = draft.selection.sentence;
  input('interpretation').value = draft.initialInterpretation;
  input('revision').value = draft.revisedInterpretation;
  input('unresolved').checked = draft.unresolved;
  input('check-response').value = draft.checkResponse;
  input('source-question').value = draft.followupQuestion ?? `In this sentence, why is “${draft.selection.expression}” used this way?\n\n${draft.selection.sentence}`;
  $<HTMLButtonElement>('return-source').disabled = !/^https?:\/\//.test(draft.selection.sourceUrl);
  selectValue('language', draft.language); selectValue('translation-language', draft.translationLanguage);
  document.querySelector<HTMLInputElement>(`input[name="mode"][value="${draft.mode}"]`)!.checked = true;
  text('source', draft.selection.title || (draft.selection.sourceUrl ? new URL(draft.selection.sourceUrl).hostname : ''));
  text('explore-submit', draft.result ? 'Explore this context again →' : 'Explore this expression →');
  show('feedback', false); show('understanding-check', false); show('check-feedback', false); show('comparison', false);
  renderLearning();
}

function renderLearning() {
  show('learning', Boolean(draft.result));
  if (!draft.result) return;
  const explanation = draft.result.explanation;
  text('lookup-source', draft.result.source === 'demo' ? 'LOCAL DEMO · Sample assistance, not a live AI response' : draft.result.cached ? 'REUSED FROM YOUR SAVED CONTEXT · No new explanation generated' : 'AI SUGGESTION · Check it against your sentence');
  text('question', explanation.question);
  show('guided', !draft.revealed);
  show('explanation', draft.revealed);
  show('matches', draft.result.matches.length > 0);
  show('clue', draft.hints > 0);
  text('clue', draft.hints === 1 ? explanation.clue : `${explanation.clue}\n\n${explanation.grammar}`);
  text('hint', draft.hints === 0 ? 'I’m not sure' : draft.hints === 1 ? 'Another clue' : 'Reveal meaning');
  text('part-of-speech', explanation.partOfSpeech);
  text('meaning', explanation.meaning);
  text('translation', explanation.translation);
  text('evidence', explanation.evidence);
  text('grammar', explanation.grammar);
  text('example', explanation.example);
  show('initial-thought', Boolean(draft.initialInterpretation));
  text('initial-thought-text', draft.initialInterpretation);
  $('alternatives').innerHTML = explanation.alternatives.length ? `<div class="detail"><h3>Other possible readings</h3><ul>${explanation.alternatives.map((item) => `<li>${escape(item)}</li>`).join('')}</ul></div>` : '';
  text('save', draft.savedId ? '♥ Update saved encounter' : '♡ Save encounter');
  $('save').setAttribute('aria-pressed', String(Boolean(draft.savedId)));
  text('save-summary', draft.initialInterpretation ? 'Your attempt and the help you used travel with this encounter.' : 'No interpretation yet. This will be marked “Not attempted.”');
}

function reveal() {
  draft.revealed = true;
  if (!draft.assistance.includes('answer_revealed')) draft.assistance.push('answer_revealed');
  renderLearning(); persist();
}

async function switchView(view: View) {
  activeView = view;
  for (const name of ['explore', 'library', 'chat', 'settings']) show(`view-${name}`, name === view);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  location.hash = view;
  if (view === 'library' && config && connected) await refreshLibrary();
  if (view === 'chat' && config && connected) await loadChats();
  if (view === 'settings' && config && connected) await loadPreferences();
}

async function refreshConnection() {
  const version = ++connectionRefresh;
  const info = await send<{ apiUrl: string; webUrl: string; connected: boolean; account?: Account; unavailable?: boolean; pendingPair?: boolean }>({ type: 'connection' });
  if (version !== connectionRefresh) return;
  connectionApiUrl = info.apiUrl;
  connected = info.connected && !info.pendingPair;
  show('connect-account', !connected);
  show('disconnect', connected);
  show('account-email', connected && Boolean(info.account?.email));
  text('account-email', info.account?.email || '');
  text('account-heading', connected ? 'Signed in' : 'Connect your account');
  text('account-description', connected
    ? info.unavailable ? 'You’re offline. Your account is still connected. Try again when your connection returns.' : 'Connected to your website account. Your library and chats stay in sync.'
    : info.pendingPair ? 'Your account is ready. Connect below to finish.' : 'Sign in or create an account on the website. We’ll connect you automatically.');
  $('account-card').classList.toggle('is-connected', connected);
  show('settings-form', connected);
  show('usage-card', connected);
  text('connection-state', connected ? info.unavailable ? 'Connected · Waiting for internet' : 'Connected to your website account' : 'Not signed in · Connect in Settings');
  $('connection-state').classList.remove('demo');
  if (!connected || info.unavailable) return;
  config = await api<PublicConfig>('/api/config');
  if (version !== connectionRefresh) return;
  $('connection-state').classList.toggle('demo', config.demo);
  if (config.demo) text('connection-state', 'LOCAL DEMO · Saved on this computer');
  await loadPreferences();
}

async function loadPreferences(force = false) {
  if (settingsDirty && !force) return;
  preferences = await api<Settings>('/api/settings');
  input('settings-language').value = preferences.learningLanguage;
  input('settings-translation').value = preferences.translationLanguage;
  input('settings-mode').value = preferences.mode;
  input('instructions').value = preferences.instructions;
  if (!draft.selection.expression) {
    draft.language = preferences.learningLanguage; draft.translationLanguage = preferences.translationLanguage; draft.mode = preferences.mode;
    setForm();
  }
}

async function lookup() {
  syncInputs();
  validateSelection(draft.selection.expression, draft.selection.sentence);
  const version = ++revision;
  text('explore-submit', 'Finding the right context…');
  try {
    const result = await api<Lookup>('/api/lookup', 'POST', {
      expression: draft.selection.expression, sentence: draft.selection.sentence,
      language: draft.language, translationLanguage: draft.translationLanguage, mode: draft.mode,
    });
    if (version !== revision) return;
    draft.revealed = false; draft.hints = 0; draft.assistance = [];
    draft.initialInterpretation = ''; draft.revisedInterpretation = ''; draft.savedId = undefined; draft.attemptHadHelp = false;
    draft.checked = false; draft.checkResponse = ''; draft.unresolved = false;
    draft.result = result;
    const exact = matchingEncounter(result.matches, draft.selection, draft.language, draft.translationLanguage);
    if (exact) draft.savedId = exact.id;
    if (draft.mode === 'direct') reveal();
    setForm(); persist(); $('learning').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally { text('explore-submit', 'Explore this expression →'); }
}

async function saveEncounter() {
  syncInputs();
  if (!draft.result) throw new Error('Explore an expression before saving it.');
  const encounter = await api<Encounter>('/api/encounters', 'POST', {
    expression: draft.selection.expression, sentence: draft.selection.sentence, sourceUrl: draft.selection.sourceUrl,
    language: draft.language, translationLanguage: draft.translationLanguage, mode: draft.mode,
    explanation: draft.result.explanation, initialInterpretation: draft.initialInterpretation,
    revisedInterpretation: draft.revisedInterpretation, assistance: draft.assistance,
    checkResponse: draft.checkResponse, unresolved: draft.unresolved,
    attemptStatus: !draft.initialInterpretation ? 'not_attempted' : draft.attemptHadHelp ? 'assisted' : 'attempted',
  });
  draft.savedId = encounter.id; renderLearning(); persist();
  notify('Saved to your library. You can revisit this context on the website.');
}

async function refreshLibrary() {
  const query = input('library-search').value.trim();
  const data = await api<{ items: Encounter[] }>(`/api/encounters?q=${encodeURIComponent(query)}`);
  library = data.items;
  $('library-list').innerHTML = library.length ? library.map((item) => `<article class="library-item"><div class="row-between"><h2>${escape(item.expression)}</h2><span class="tag">${escape(item.language)}</span></div><p>${escape(item.sentence)}</p><span class="micro-label">${item.attemptStatus === 'not_attempted' ? 'NOT ATTEMPTED' : item.attemptStatus === 'assisted' ? 'ATTEMPTED WITH HELP' : 'ATTEMPTED'}${item.unresolved ? ' · STILL UNSURE' : ''}</span><div class="actions"><button class="text-button" data-revisit="${escape(item.id)}">Revisit this encounter →</button><button class="text-button danger" data-delete="${escape(item.id)}">Delete</button></div></article>`).join('') : '<div class="empty">No saved encounters here yet.<br>One good question is a lovely place to start.</div>';
}

function revisit(encounter: Encounter) {
  draft = {
    ...freshDraft({ expression: encounter.expression, sentence: encounter.sentence, sourceUrl: encounter.sourceUrl, capturedAt: Date.now() }),
    language: encounter.language, translationLanguage: encounter.translationLanguage, mode: 'guided',
    result: { explanation: encounter.explanation, cached: true, matches: [], source: config?.demo ? 'demo' : 'ai' },
    savedId: encounter.id, assistance: [...encounter.assistance], initialInterpretation: encounter.initialInterpretation,
    revisedInterpretation: encounter.revisedInterpretation, checkResponse: encounter.checkResponse, unresolved: encounter.unresolved,
    attemptHadHelp: encounter.attemptStatus === 'assisted',
  };
  setForm(); persist(); void switchView('explore');
  $('learning').scrollIntoView({ behavior: 'smooth' });
}

async function loadChats() {
  chats = (await api<{ items: Chat[] }>('/api/chats')).items;
  const history = $<HTMLSelectElement>('chat-history');
  history.replaceChildren(new Option('New conversation', ''));
  chats.forEach((chat) => history.add(new Option(chat.title, chat.id)));
  history.value = currentChat?.id || '';
  renderChat();
}

function renderMarkdown(container: HTMLElement, value: string) {
  container.innerHTML = DOMPurify.sanitize(marked.parse(value, { async: false }) as string, {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'video', 'audio', 'style', 'form', 'input', 'button', 'iframe'],
    FORBID_ATTR: ['style', 'srcset'],
  });
  container.querySelectorAll('a').forEach((anchor) => { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; });
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.textContent || '';
    const copy = document.createElement('button'); copy.className = 'copy-code'; copy.textContent = 'Copy text';
    copy.addEventListener('click', () => { void navigator.clipboard.writeText(code).then(() => { copy.textContent = 'Copied'; }).catch(() => notify('Select the text and copy it manually.', true)); });
    pre.append(copy);
  });
}

function renderChat() {
  const container = $('chat-messages'); container.replaceChildren();
  show('chat-context', Boolean(draft.selection.expression) && !currentChat);
  text('chat-context', `About “${draft.selection.expression}” in: ${draft.selection.sentence}`);
  if (!currentChat?.messages.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'What caught your attention? A grammatical pattern, a useful clue, or another meaning?'; container.append(empty);
    return;
  }
  for (const message of currentChat.messages) {
    const article = document.createElement('article'); article.className = `chat-message ${message.role}`;
    const label = document.createElement('div'); label.className = 'chat-role'; label.textContent = message.role === 'user' ? 'You' : 'ContextBridge';
    const content = document.createElement('div'); renderMarkdown(content, message.content);
    article.append(label, content); container.append(article);
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { void run(() => switchView(button.dataset.view as View)); }));
$('explore-form').addEventListener('submit', (event) => { event.preventDefault(); void run(lookup); });
$('explore-form').addEventListener('input', () => {
  const old = JSON.stringify([draft.selection.expression, draft.selection.sentence, draft.language, draft.translationLanguage]);
  const oldMode = draft.mode;
  syncInputs();
  if (old !== JSON.stringify([draft.selection.expression, draft.selection.sentence, draft.language, draft.translationLanguage])) {
    revision++; draft.result = undefined; draft.savedId = undefined; draft.followupQuestion = undefined; show('learning', false);
  } else if (oldMode !== draft.mode && draft.result) {
    show('understanding-check', false); show('feedback', false);
    if (draft.mode === 'direct') reveal(); else { draft.revealed = false; renderLearning(); }
  }
  persist();
});
['interpretation', 'revision', 'unresolved', 'check-response', 'chat-input', 'source-question'].forEach((id) => $(id).addEventListener('input', () => { syncInputs(); if (id === 'source-question') draft.followupQuestion = input(id).value; persist(); }));
$('hint').addEventListener('click', () => {
  if (draft.hints >= 2) { reveal(); return; }
  draft.hints++; draft.assistance.push(draft.hints === 1 ? 'context_clue' : 'grammar_clue'); renderLearning(); persist();
});
$('reveal').addEventListener('click', reveal);
$('submit-interpretation').addEventListener('click', () => { void run(async () => {
  const interpretation = input('interpretation').value.trim();
  if (!interpretation) throw new Error('Write your interpretation, or choose “I’m not sure.”');
  if (!draft.result) return;
  if (!draft.initialInterpretation) { draft.initialInterpretation = interpretation; draft.attemptHadHelp = draft.assistance.length > 0; draft.assistance.push('initial_attempt'); }
  const response = await api<{ feedback: string }>('/api/feedback', 'POST', { expression: draft.selection.expression, sentence: draft.selection.sentence, interpretation, explanation: draft.result.explanation, kind: 'interpretation' });
  renderMarkdown($('feedback'), response.feedback); show('feedback'); reveal();
}); });
$('compare').addEventListener('click', () => {
  const matches = draft.result?.matches || [];
  $('comparison').innerHTML = `<span class="tag">Current sentence</span><blockquote>“${escape(draft.selection.sentence)}”</blockquote><p>This may be a different meaning. Use an earlier example only if it helps.</p>${matches.slice(0, 3).map((item) => `<span class="tag">${escape(item.language)} · Earlier encounter</span><blockquote>“${escape(item.sentence)}”</blockquote><details><summary>Show the earlier meaning</summary><p>${escape(item.explanation.meaning)}</p></details>`).join('')}<p><strong>Does the earlier meaning fit this sentence? What suggests that?</strong></p><button class="text-button" id="decline-comparison">Continue with the current context</button>`;
  show('comparison');
  $('decline-comparison').addEventListener('click', () => show('comparison', false));
  $('comparison').querySelectorAll('details').forEach((details) => details.addEventListener('toggle', () => { if (details.open) { draft.assistance.push('earlier_meaning_revealed'); persist(); } }));
});
$('try-check').addEventListener('click', () => {
  if (!draft.result) return;
  show('explanation', false); show('feedback', false); show('guided', false); show('matches', false); show('comparison', false); show('check-feedback', false); show('understanding-check');
  text('check-sentence', draft.result.explanation.check.sentence); text('check-question', draft.result.explanation.check.question);
  $('understanding-check').scrollIntoView({ behavior: 'smooth' });
});
$('check-help').addEventListener('click', () => {
  if (!draft.result) return;
  const part = draft.result.explanation.partOfSpeech.toLowerCase();
  const clue = part.includes('verb') ? 'Find who or what performs the action, then look at what follows the expression. Does the sentence describe an action, a state, or a completed result?'
    : part.includes('noun') ? 'Look at the article, adjective, or verb linked to this expression. What kind of thing would fit that grammatical role?'
    : part.includes('adjective') ? 'Find the noun this expression describes. Use nearby contrasts or examples to narrow down the property.'
    : `Look immediately before and after “${draft.selection.expression}”. Identify one clue about its role, then try a short paraphrase that fits the new sentence.`;
  draft.assistance.push('check_help'); text('check-feedback', clue); show('check-feedback'); persist();
});
$('check-reveal').addEventListener('click', () => { if (!draft.result) return; draft.assistance.push('check_answer_revealed'); text('check-feedback', draft.result.explanation.check.answer); show('check-feedback'); persist(); });
$('submit-check').addEventListener('click', () => { void run(async () => {
  syncInputs(); if (!draft.checkResponse) throw new Error('Write an interpretation, request help, or skip this activity.');
  if (!draft.result) return;
  const response = await api<{ feedback: string }>('/api/feedback', 'POST', { expression: draft.selection.expression, sentence: draft.result.explanation.check.sentence, interpretation: draft.checkResponse, explanation: draft.result.explanation, kind: 'check' });
  draft.checked = true; draft.assistance.push('check_attempt'); draft.assistance.push(draft.assistance.some((event) => event === 'check_help' || event === 'check_answer_revealed') ? 'check_attempt_after_help' : 'check_attempt_before_additional_help');
  text('check-feedback', response.feedback); show('check-feedback'); persist();
}); });
$('skip-check').addEventListener('click', () => { show('understanding-check', false); renderLearning(); });
$('save').addEventListener('click', () => { void run(saveEncounter); });
$('continue-reading').addEventListener('click', () => { window.close(); notify('You can leave this panel open or close it with the browser’s side-panel button.'); });
$('clear').addEventListener('click', () => { revision++; draft = freshDraft(); setForm(); persist(); notify('Ready when you find your next expression.'); });
$('capture').addEventListener('click', () => { void run(async () => { await send({ type: 'captureCurrent' }); notify('If nothing appears, select text on the page and click the extension icon once to activate it.'); }); });
$('open-pdf').addEventListener('click', () => { void run(async () => { await send({ type: 'openPdf' }); }); });
for (const id of ['open-web', 'review-web']) $(id).addEventListener('click', () => { void run(async () => { await send({ type: 'openWeb' }); }); });
$('connect-account').addEventListener('click', () => {
  if (busy) return;
  // Chrome needs the permission request directly in this click handler.
  const permission = chrome.permissions.request({ origins: [hostPattern(connectionApiUrl)] });
  void run(async () => {
    if (!(await permission)) throw new Error('Website access was declined. Choose Connect account whenever you’re ready.');
    const result = await send<{ connected: boolean }>({ type: 'beginConnect' });
    await refreshConnection();
    if (!result.connected) text('account-description', 'Finish signing in on the website. This panel updates automatically when you’re connected.');
  });
});
$('disconnect').addEventListener('click', () => { void run(async () => {
  await send({ type: 'disconnect' }); await refreshConnection();
}); });
$('settings-form').addEventListener('input', () => { settingsDirty = true; });
$('settings-form').addEventListener('submit', (event) => { event.preventDefault(); void run(async () => {
  const values = {
    learningLanguage: input('settings-language').value.trim(), translationLanguage: input('settings-translation').value.trim(),
    mode: input('settings-mode').value as Mode, instructions: input('instructions').value.trim(),
  };
  const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== preferences?.[key as keyof Settings]));
  if (!Object.keys(changes).length) { settingsDirty = false; notify('Your preferences are already saved.'); return; }
  preferences = await api<Settings>('/api/settings', 'PUT', changes); settingsDirty = false;
  await loadPreferences(true); notify('Preferences saved and shared with the website.');
}); });
$('refresh-usage').addEventListener('click', () => { void run(async () => {
  const usage = await api<{ requests: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; reservedTokens: number; requestLimit: number; tokenLimit: number }>('/api/usage');
  const format = (value: number) => Number.isFinite(value) ? value.toLocaleString() : '0';
  const total = usage.inputTokens + usage.outputTokens;
  text('usage-summary', `${format(total)} / ${format(usage.tokenLimit)} tokens today\n${format(usage.requests)} / ${format(usage.requestLimit)} requests\n${format(usage.cachedInputTokens)} input tokens reused from the provider’s cache${usage.reservedTokens > 0 ? `\n${format(usage.reservedTokens)} tokens reserved for requests in progress` : ''}\nResets daily at 00:00 UTC.`);
  show('usage-summary');
}); });
$('refresh-library').addEventListener('click', () => { void run(refreshLibrary); });
let searchTimer: ReturnType<typeof setTimeout> | undefined;
$('library-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { void run(refreshLibrary); }, 250); });
$('library-list').addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button) return;
  if (button.dataset.revisit) { const item = library.find((entry) => entry.id === button.dataset.revisit); if (item) revisit(item); }
  if (button.dataset.delete) void run(async () => {
    if (!confirm('Delete this saved encounter? Its review progress will also be removed.')) return;
    await api(`/api/encounters/${encodeURIComponent(button.dataset.delete!)}`, 'DELETE'); await refreshLibrary(); notify('Encounter deleted.');
  });
});
$('ask-follow-up').addEventListener('click', () => { currentChat = undefined; void run(async () => { await switchView('chat'); input('chat-input').focus(); }); });
$('copy-source-question').addEventListener('click', () => { void run(async () => { const question = input('source-question').value.trim(); if (!question) throw new Error('Write the question you want to take back.'); await navigator.clipboard.writeText(question); notify('Question copied. Review it in the original conversation and send it when you’re ready.'); }); });
$('return-source').addEventListener('click', () => { void run(async () => { await send({ type: 'openSource', url: draft.selection.sourceUrl }); }); });
$('new-chat').addEventListener('click', () => { currentChat = undefined; $<HTMLSelectElement>('chat-history').value = ''; renderChat(); input('chat-input').focus(); });
$('chat-history').addEventListener('change', () => { void run(async () => {
  const id = input('chat-history').value; currentChat = id ? await api<Chat>(`/api/chats/${encodeURIComponent(id)}`) : undefined; renderChat();
}); });
$('chat-form').addEventListener('submit', (event) => { event.preventDefault(); void run(async () => {
  const question = input('chat-input').value.trim(); if (!question) return;
  let message = question;
  if (!currentChat && !draft.savedId && !draft.result && draft.selection.expression) message = `Selection: ${draft.selection.expression}\nSentence: ${draft.selection.sentence}\n\n${question}`;
  const transientContext = !draft.savedId && draft.result ? {
    expression: draft.selection.expression, sentence: draft.selection.sentence, language: draft.language,
    translationLanguage: draft.translationLanguage, mode: draft.mode, explanation: draft.result.explanation,
    initialInterpretation: draft.initialInterpretation, revisedInterpretation: draft.revisedInterpretation,
    assistance: draft.assistance.slice(-30), unresolved: draft.unresolved,
  } : undefined;
  currentChat = currentChat
    ? await api<Chat>(`/api/chats/${encodeURIComponent(currentChat.id)}/messages`, 'POST', { message })
    : await api<Chat>('/api/chats', 'POST', { message, ...(draft.savedId ? { encounterId: draft.savedId } : transientContext ? { context: transientContext } : {}) });
  input('chat-input').value = ''; persist(); await loadChats(); $('chat-input').scrollIntoView({ behavior: 'smooth', block: 'end' });
}); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes.connectionChanged?.newValue) {
    accountEpoch++; connectionRefresh++; revision++; currentChat = undefined; chats = []; library = []; preferences = undefined; settingsDirty = false;
    connected = false; config = undefined; draft = freshDraft(); input('chat-input').value = ''; $('library-list').replaceChildren();
    show('error', false); show('notice', false); show('usage-summary', false);
    $<HTMLSelectElement>('chat-history').replaceChildren(new Option('New conversation', ''));
    $<HTMLFormElement>('settings-form').reset(); setForm(); renderChat();
    void refreshConnection().then(() => { if (activeView === 'library' || activeView === 'chat') return switchView(activeView); }).catch((error) => notify(error.message, true));
  } else if ('pendingPair' in changes) void refreshConnection().catch((error) => notify(error.message, true));
  if (changes.selection?.newValue || (changes.draft?.newValue && changes.panelTarget?.newValue)) {
    const selection = (changes.selection?.newValue || (changes.draft.newValue as Draft).selection) as Selection;
    if (selection.capturedAt === draft.selection.capturedAt && !changes.panelTarget?.newValue) return;
    revision++; draft = changes.draft?.newValue ? changes.draft.newValue as Draft : freshDraft(selection); setForm(); persist();
    void switchView(changes.panelTarget?.newValue === 'chat' ? 'chat' : 'explore').catch((error) => notify(error.message, true));
    if (changes.panelTarget?.newValue) void chrome.storage.session.remove('panelTarget');
    if (!draft.result) notify('Check the selected expression and sentence, then choose the help you want.');
  }
  if (typeof changes.selectionNotice?.newValue === 'string') notify(changes.selectionNotice.newValue);
});

async function init() {
  const saved = await chrome.storage.session.get(['draft', 'selection', 'selectionNotice', 'chatDraft', 'panelTarget']) as { draft?: Draft & { draftInterpretation?: string }; selection?: Selection; selectionNotice?: string; chatDraft?: string; panelTarget?: View };
  if (saved.selection && (!saved.draft || saved.selection.capturedAt > saved.draft.selection.capturedAt)) draft = freshDraft(saved.selection);
  else if (saved.draft) draft = saved.draft as Draft;
  setForm();
  if (saved.draft?.draftInterpretation) input('interpretation').value = saved.draft.draftInterpretation;
  if (saved.chatDraft) input('chat-input').value = saved.chatDraft;
  if (saved.selectionNotice) notify(saved.selectionNotice);
  await switchView(saved.panelTarget || activeView);
  await chrome.storage.session.remove('panelTarget');
  try { await refreshConnection(); if (activeView === 'library' || activeView === 'chat') await switchView(activeView); } catch (error) { notify((error as Error).message, true); }
}
let lastConnectionCheck = 0;
function checkConnection() {
  if (document.visibilityState !== 'visible' || busy || Date.now() - lastConnectionCheck < 1500) return;
  lastConnectionCheck = Date.now();
  void refreshConnection().catch((error) => notify(error.message, true));
}
window.addEventListener('focus', checkConnection);
document.addEventListener('visibilitychange', checkConnection);
// No AI calls: a visible panel checks only the account endpoint for expiry.
setInterval(checkConnection, 30000);
void init().catch((error) => notify(error instanceof Error ? error.message : 'Could not open the extension. Please reload it.', true));
