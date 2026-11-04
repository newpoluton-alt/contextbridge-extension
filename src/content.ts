import { sentenceAround } from './selection';
import type { Mode, Reply, Selection } from './types';
import type { OverlayDraft } from './overlay';

declare global { interface Window { __contextBridgeAttached?: boolean } }

if (!window.__contextBridgeAttached) {
  window.__contextBridgeAttached = true;
  const host = document.createElement('div'); host.dataset.contextbridge = 'reading-help';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host{position:fixed;z-index:2147483647;display:none;color-scheme:light dark;font:13px/1.55 system-ui,-apple-system,sans-serif;color:var(--ink);--bg:#fffef7;--muted:#718065;--line:#d8dfca;--soft:#edf2df;--ink:#293c2d;--accent:#294b33;--button:#f6faee}
    *{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer;border:0}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #92ad61;outline-offset:2px}button{border-radius:9px;padding:8px 12px;color:var(--ink);background:var(--soft)}button.primary{background:var(--accent);color:var(--button);font-weight:600}.affordance{box-shadow:0 3px 18px #0002;border:1px solid var(--line)}.popup{width:min(360px,calc(100vw - 20px));max-height:min(650px,78vh);overflow:auto;border:1px solid var(--line);border-radius:15px;background:var(--bg);box-shadow:0 8px 45px #0003;padding:17px}.top{display:flex;align-items:center;gap:8px}.word{font:25px/1.25 Georgia,serif;flex:1;overflow-wrap:anywhere}.icon{padding:5px 9px;font-size:18px;line-height:1.2;background:none}.saved{color:#111;background:var(--soft)}.label{font-size:9px;letter-spacing:1px;color:var(--muted);font-weight:650}.sentence{font:15px/1.55 Georgia,serif;margin:14px 0;padding-left:11px;border-left:2px solid #b7ca86;white-space:pre-wrap}p{margin:9px 0;font-size:12px}h3{font-size:15px;line-height:1.5;margin:13px 0 8px}label{display:block;font-size:11px;margin:11px 0 5px}textarea,input{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:9px;border-radius:7px;line-height:1.5;resize:vertical;font-size:12px}.row{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:11px}.row button{flex:1}.small{font-size:10px;color:var(--muted)}.choice{display:flex;align-items:center;gap:8px;border:1px solid var(--line);padding:9px;border-radius:8px;cursor:pointer}.choice input{width:auto;accent-color:var(--accent)}.hint{background:var(--soft);padding:10px;border-radius:8px;font-size:12px;margin:10px 0;white-space:pre-wrap}.error{color:#9c4f32}.separator{border-top:1px solid var(--line);margin-top:13px;padding-top:10px}.link{padding:4px 0;background:none;text-decoration:underline;color:var(--muted);font-size:11px}.footer{display:flex;gap:12px;justify-content:space-between;margin-top:12px}.translate{font-style:italic;color:var(--muted)}details{font-size:11px;margin:10px 0}summary{cursor:pointer}.previous{border-left:2px solid #b7ca86;margin:10px 0;padding-left:9px}.checkbox{display:flex;gap:7px;align-items:center}.checkbox input{width:auto}#cb-status{font-size:11px;color:var(--muted);white-space:pre-wrap}#cb-feedback{font-size:12px;white-space:pre-wrap}.mode{color:var(--muted);font-size:10px} .pill{padding:3px 7px;border-radius:9px;background:var(--soft);font-size:9px}
    @media(prefers-color-scheme:dark){:host{--bg:#202820;--muted:#b2bfa3;--line:#49593f;--soft:#303f2d;--ink:#e8eddf;--accent:#c7dda0;--button:#22321e}.saved{color:#fff}.error{color:#ffb6a0}.popup{box-shadow:0 8px 45px #0008}}
  `;
  const view = document.createElement('div');
  shadow.append(style, view); document.documentElement.append(host);
  const underlineStyle = document.createElement('style');
  underlineStyle.dataset.contextbridge = 'underlines';
  underlineStyle.textContent = '::highlight(contextbridge-words){text-decoration-line:underline;text-decoration-color:rgba(96,133,63,.32);text-decoration-thickness:1px;text-underline-offset:3px}';
  document.documentElement.append(underlineStyle);
  let latest: Selection | undefined;
  let current: OverlayDraft | undefined;
  let anchor: DOMRect | undefined;
  let expanded = false;
  let busy = false;
  let mode: Mode = 'guided';
  let generation = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let feedback = '';
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const excluded = 'script,style,noscript,input,textarea,select,button,pre,code,nav,header,footer,[contenteditable="true"],[data-contextbridge]';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

  async function message<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const reply = await chrome.runtime.sendMessage({ type, ...payload }) as Reply<T>;
    if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'Reopen ContextBridge to continue.');
    return reply.data;
  }
  function status(value: string, error = false) {
    if (!$('cb-status')) return;
    $('cb-status').textContent = value; $('cb-status').className = error ? 'error' : '';
  }
  async function run(task: () => Promise<void>) {
    if (busy) return; busy = true;
    shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
    try { await task(); } catch (error) { status(error instanceof Error ? error.message : 'Could not complete this action.', true); }
    finally { busy = false; shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = false; }); if ($('cb-save')) ($('cb-save') as HTMLButtonElement).disabled = !current; }
  }
  function position() {
    if (!anchor) return;
    const width = expanded ? Math.min(360, innerWidth - 20) : 240;
    host.style.cssText = `position:fixed;z-index:2147483647;display:block;left:${Math.max(10, Math.min(innerWidth - width - 10, anchor.left))}px;top:${Math.max(10, Math.min(innerHeight - (expanded ? Math.min(650, innerHeight * .78) : 52) - 10, anchor.bottom + 8))}px`;
  }
  function readRange(range: Range): Selection | undefined {
    const expression = range.toString().replace(/\s+/gu, ' ').trim();
    if (!expression || expression.length > 160 || expression.split(/\s+/u).length > 12) return;
    const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    if (!parent || parent.closest(excluded)) return;
    const block = parent.closest('.textLayer,#reading-text,p,li,blockquote,article,section,td,h1,h2,h3,h4') || parent;
    const before = document.createRange(); before.selectNodeContents(block);
    try { before.setEnd(range.startContainer, range.startOffset); } catch { return; }
    const start = before.toString().length;
    return { expression, sentence: sentenceAround(block.textContent || expression, start, start + range.toString().length), sourceUrl: location.href, title: document.title, capturedAt: Date.now() };
  }
  function readSelection(fallback = ''): Selection | undefined {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return fallback ? { expression: fallback.slice(0, 160), sentence: fallback.slice(0, 2400), sourceUrl: location.href, title: document.title, capturedAt: Date.now() } : undefined;
    anchor = selection.getRangeAt(0).getBoundingClientRect();
    return readRange(selection.getRangeAt(0));
  }
  function hide() { generation++; expanded = false; host.style.display = 'none'; }
  function confirmMarkup() {
    return `<div class="label">NOT SURE WHAT THIS MEANS HERE?</div><label for="cb-expression">Selected expression</label><input id="cb-expression" maxlength="160" value="${escape(latest!.expression)}"><label for="cb-sentence">Check the sentence · edit or expand if needed</label><textarea id="cb-sentence" rows="3" maxlength="2400">${escape(latest!.sentence)}</textarea><label class="choice"><input type="radio" name="cb-mode" value="guided" ${mode === 'guided' ? 'checked' : ''}>Help me work it out</label><label class="choice"><input type="radio" name="cb-mode" value="direct" ${mode === 'direct' ? 'checked' : ''}>Show me the meaning</label><div class="row"><button class="primary" data-action="explore">Explore this expression →</button><button data-action="close">Close</button></div><p class="small">Only this expression and sentence are sent when you choose Explore.</p>`;
  }
  function learningMarkup() {
    const d = current!; const e = d.result.explanation;
    const comparison = d.result.matches.length ? `<details id="cb-compare"><summary>Compare an earlier encounter? (${d.result.matches.length})</summary><p>This might be a different meaning. Choose an earlier example only if it is useful.</p><div class="previous"><strong>Current sentence</strong><p>${escape(d.selection.sentence)}</p></div>${d.result.matches.slice(0, 3).map((item) => `<div class="previous"><strong>Earlier sentence</strong><p>${escape(item.sentence)}</p><details data-earlier-meaning><summary>Show its earlier meaning</summary><p>${escape(item.explanation.meaning)}</p></details></div>`).join('')}<p>Does the earlier meaning fit here? What suggests that?</p></details>` : '';
    return `<p class="sentence">${escape(d.selection.sentence)}</p><div class="row"><span class="pill">${escape(e.partOfSpeech)}</span><span class="mode">${d.mode === 'guided' ? 'Guided support' : 'Direct explanation'} · ${d.result.cached ? 'Reused saved context' : d.result.source === 'demo' ? 'Local sample' : 'AI suggestion'}</span></div><button class="link" data-action="mode">${d.mode === 'guided' ? 'Switch to direct explanation' : 'Switch to guided hints'}</button>${comparison}${d.revealed ? `<h3>${escape(e.meaning)}</h3><p class="translate">${escape(e.translation)}</p><div class="hint"><strong>The evidence</strong><br>${escape(e.evidence)}</div><p><strong>Grammar:</strong> ${escape(e.grammar)}</p><p class="sentence">${escape(e.example)}</p>${e.alternatives.length ? `<p class="small">${e.alternatives.map(escape).join(' · ')}</p>` : ''}${d.initialInterpretation ? `<p><strong>Your initial thought:</strong> ${escape(d.initialInterpretation)}</p>` : ''}<label for="cb-revision">Revise your interpretation (optional)</label><textarea id="cb-revision" rows="2" maxlength="2000">${escape(d.revisedInterpretation)}</textarea><label class="checkbox"><input id="cb-unresolved" type="checkbox" ${d.unresolved ? 'checked' : ''}>I’m still unsure about this explanation</label><p class="small">AI feedback is provisional. You do not have to agree to continue.</p>` : `<h3>${escape(e.question)}</h3>${d.hints ? `<div class="hint">${escape(e.clue)}${d.hints > 1 ? `<br><br>${escape(e.grammar)}` : ''}</div>` : ''}<label for="cb-attempt">What do you think it means?</label><textarea id="cb-attempt" rows="2" maxlength="2000" placeholder="I think…">${escape(d.initialInterpretation)}</textarea><div class="row"><button class="primary" data-action="feedback">Check my thinking</button><button data-action="hint">${d.hints ? 'Another clue' : 'I’m not sure'}</button></div><button class="link" data-action="reveal">Reveal the explanation now</button>`}<p id="cb-feedback">${escape(feedback)}</p><div class="separator"><button class="primary" data-action="save">${d.savedId ? '♥ Update saved encounter' : '♡ Save this encounter'}</button><p class="small">${d.initialInterpretation ? 'Your attempt and assistance are recorded.' : 'No attempt yet. Saved as “Not attempted,” not incorrect.'}</p><div class="footer"><button class="link" data-action="continue">Practice in the panel ↗</button><button class="link" data-action="chat">Ask a follow-up ↗</button></div></div>`;
  }
  function renderPopup() {
    if (!latest) return;
    expanded = true;
    view.innerHTML = `<section class="popup" role="dialog" aria-label="Explore expression with ContextBridge"><div class="top"><span class="word">${escape(current?.selection.expression || latest.expression)}</span><button id="cb-save" class="icon ${current?.savedId ? 'saved' : ''}" data-action="save" aria-label="${current?.savedId ? 'Update saved encounter' : 'Save encounter'}" aria-pressed="${Boolean(current?.savedId)}" ${!current ? 'disabled' : ''}>${current?.savedId ? '♥' : '♡'}</button><button class="icon" data-action="close" aria-label="Close explanation">×</button></div><div id="cb-body">${current ? learningMarkup() : confirmMarkup()}</div><p id="cb-status" role="status"></p></section>`;
    position();
  }
  function openPopup(selection: Selection) {
    generation++; latest = selection; current = undefined; feedback = ''; renderPopup();
    const version = generation;
    void message<{ mode: Mode; learningLanguage: string; translationLanguage: string }>('pagePreferences').then((settings) => {
      if (version !== generation || current || !expanded) return;
      mode = settings.mode;
      const radio = shadow.querySelector<HTMLInputElement>(`input[name="cb-mode"][value="${mode}"]`); if (radio) radio.checked = true;
      status(`${settings.learningLanguage} → ${settings.translationLanguage} · Shared learning preferences`);
    }).catch((error) => status(`${error.message} Open the side panel’s Settings to connect.`, true));
  }
  function showAffordance() {
    if (busy || expanded) return;
    latest = readSelection(); if (!latest) { hide(); return; }
    view.innerHTML = '<button class="primary affordance" data-action="open">Explore this expression ↗</button>';
    position();
  }
  function underlineVisibleWords() {
    if (!('highlights' in CSS) || typeof Highlight === 'undefined') return;
    const ranges: Range[] = [];
    const root = document.querySelector('main,article') || document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || parent.closest(excluded)) return NodeFilter.FILTER_REJECT;
      const box = parent.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < -innerHeight || box.top > innerHeight * 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    let node: Node | null;
    while ((node = walker.nextNode()) && ranges.length < 12000) {
      for (const segment of segmenter.segment(node.textContent || '')) if (segment.isWordLike) {
        if (ranges.length >= 12000) break;
        const range = document.createRange(); range.setStart(node, segment.index); range.setEnd(node, segment.index + segment.segment.length); ranges.push(range);
      }
    }
    CSS.highlights.set('contextbridge-words', new Highlight(...ranges));
  }
  function scheduleUnderlines() { clearTimeout(renderTimer); renderTimer = setTimeout(underlineVisibleWords, 250); }
  underlineVisibleWords();
  new MutationObserver(scheduleUnderlines).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener('scroll', () => { if (!expanded) hide(); scheduleUnderlines(); }, { passive: true });
  window.addEventListener('resize', () => { position(); scheduleUnderlines(); });
  document.addEventListener('mouseup', (event) => { if (!event.composedPath().includes(host) && !expanded) setTimeout(showAffordance, 0); });
  document.addEventListener('keyup', (event) => { if (event.key === 'Escape') hide(); else if (event.key === 'Shift' || event.key.startsWith('Arrow')) showAffordance(); });
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || event.composedPath().includes(host) || busy) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(`${excluded},a,[role="button"],[role="link"]`)) { if (expanded) hide(); return; }
    if (!getSelection()?.isCollapsed) return;
    const caret = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(event.clientX, event.clientY);
    if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) { if (expanded) hide(); return; }
    const segment = [...segmenter.segment(caret.startContainer.textContent || '')].find((word) => word.isWordLike && caret.startOffset >= word.index && caret.startOffset < word.index + word.segment.length);
    if (!segment) { if (expanded) hide(); return; }
    const range = document.createRange(); range.setStart(caret.startContainer, segment.index); range.setEnd(caret.startContainer, segment.index + segment.segment.length);
    const selected = readRange(range); if (!selected) return;
    anchor = range.getBoundingClientRect(); openPopup(selected);
  });
  shadow.addEventListener('toggle', (event) => {
    const details = event.target as HTMLDetailsElement;
    if (!current || !details.matches('details[data-earlier-meaning]') || !details.open) return;
    void message<OverlayDraft>('pageAction', { ticket: current.ticket, action: 'earlier_meaning' }).then((draft) => { current = draft; }).catch(() => {});
  }, true);
  shadow.addEventListener('pointerdown', (event) => { if ((event.target as Element).closest('button')) event.preventDefault(); });
  shadow.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const action = (event.target as Element).closest<HTMLButtonElement>('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') { hide(); return; }
    if (action === 'open' && latest) { openPopup(latest); return; }
    if (action === 'explore') {
      const expression = $<HTMLInputElement>('cb-expression').value.trim();
      const sentence = $<HTMLTextAreaElement>('cb-sentence').value.trim();
      mode = shadow.querySelector<HTMLInputElement>('input[name="cb-mode"]:checked')!.value as Mode;
      const version = generation;
      void run(async () => {
        status('Finding the contextual explanation…');
        const response = await message<OverlayDraft>('pageExplore', { selection: { expression, sentence }, mode });
        if (version !== generation) return;
        current = response; latest = response.selection; renderPopup();
      }); return;
    }
    if (!current) return;
    if (action === 'continue' || action === 'chat') {
      // Send immediately from this click so Chrome retains the side-panel gesture.
      void message('pageContinue', { ticket: current.ticket, target: action === 'chat' ? 'chat' : 'explore', revision: $<HTMLTextAreaElement>('cb-revision')?.value, unresolved: $<HTMLInputElement>('cb-unresolved')?.checked, interpretation: $<HTMLTextAreaElement>('cb-attempt')?.value }).then(hide).catch((error) => status(error.message, true)); return;
    }
    void run(async () => {
      if (!current) return;
      if (action === 'feedback') {
        const interpretation = $<HTMLTextAreaElement>('cb-attempt').value.trim();
        const response = await message<{ draft: OverlayDraft; feedback: string }>('pageFeedback', { ticket: current.ticket, interpretation });
        current = response.draft; feedback = response.feedback; renderPopup();
      } else if (action === 'mode') {
        current = await message<OverlayDraft>('pageAction', { ticket: current.ticket, action: 'mode', value: current.mode === 'guided' ? 'direct' : 'guided' }); feedback = ''; renderPopup();
      } else if (action === 'hint' || action === 'reveal') {
        current = await message<OverlayDraft>('pageAction', { ticket: current.ticket, action: action === 'hint' && current.hints < 2 ? 'hint' : 'reveal' }); renderPopup();
      } else if (action === 'save') {
        const revision = $<HTMLTextAreaElement>('cb-revision')?.value.trim();
        const unresolved = $<HTMLInputElement>('cb-unresolved')?.checked;
        if (revision !== undefined && revision !== current.revisedInterpretation) current = await message<OverlayDraft>('pageAction', { ticket: current.ticket, action: 'revision', value: revision });
        if (unresolved !== undefined && unresolved !== current.unresolved) current = await message<OverlayDraft>('pageAction', { ticket: current.ticket, action: 'unresolved', value: String(unresolved) });
        const response = await message<{ id: string }>('pageSave', { ticket: current.ticket }); current.savedId = response.id; renderPopup(); status('Saved to your library.');
      }
    });
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'accountChanged') { current = undefined; latest = undefined; feedback = ''; hide(); respond({ ok: true }); return false; }
    if (message.type !== 'capture') return false;
    const result = readSelection(message.fallback);
    if (result) { void chrome.runtime.sendMessage({ type: 'selection', selection: result }); if (anchor) openPopup(result); }
    respond({ ok: true }); return false;
  });
}
