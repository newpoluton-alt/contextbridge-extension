import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { sentenceAround } from './selection';
import type { Selection } from './types';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.mjs');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let pdf: PDFDocumentProxy | undefined;
let currentPage = 1;
let scale = 1.3;
let textMode = false;
let filename = '';
let selected: Selection | undefined;
let renderTask: RenderTask | undefined;
let layer: TextLayer | undefined;
let generation = 0;
let windowId: number | undefined;
void chrome.windows.getCurrent().then((window) => { windowId = window.id; });

function message(value: string) { $('message').textContent = value; }
function controls() {
  $<HTMLButtonElement>('previous').disabled = !pdf || currentPage <= 1;
  $<HTMLButtonElement>('next').disabled = !pdf || currentPage >= pdf.numPages;
  $('page-number').textContent = pdf ? `Page ${currentPage} of ${pdf.numPages}` : 'No document open';
  $('page').hidden = !pdf || textMode; $('reading-text').hidden = !pdf || !textMode;
  $('text-toggle').textContent = textMode ? 'Original page view' : 'Reading text view';
}

async function renderPage() {
  if (!pdf) return;
  const version = ++generation;
  renderTask?.cancel(); layer?.cancel();
  try { await renderTask?.promise; } catch { /* A newer render replaced it. */ }
  if (version !== generation) return;
  const page = await pdf.getPage(currentPage);
  if (version !== generation) return;
  const viewport = page.getViewport({ scale });
  const pixelRatio = Math.min(devicePixelRatio || 1, 2);
  const canvas = $<HTMLCanvasElement>('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create the PDF canvas.');
  canvas.width = Math.round(viewport.width * pixelRatio); canvas.height = Math.round(viewport.height * pixelRatio);
  canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  $('page').style.width = `${viewport.width}px`; $('page').style.height = `${viewport.height}px`;
  $('page').style.setProperty('--scale-factor', String(scale));
  $('page').style.setProperty('--total-scale-factor', String(scale));
  $('page').style.setProperty('--user-unit', '1');
  $('text-layer').replaceChildren();
  controls();
  const content = await page.getTextContent();
  if (version !== generation) return;
  const lines: string[] = [];
  for (const item of content.items) if ('str' in item) lines.push(item.str + (item.hasEOL ? '\n' : ' '));
  $('reading-text').textContent = lines.join('');
  renderTask = page.render({ canvas, canvasContext: context, viewport, transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined });
  await renderTask.promise;
  if (version !== generation) return;
  layer = new TextLayer({ textContentSource: content, viewport, container: $('text-layer') });
  await layer.render();
  if (version !== generation) return;
  message(lines.length ? 'Select a short expression. Your original page stays visible alongside the learning panel.' : 'No selectable text on this page. It may be a scan; OCR is not included. You can enter a sentence manually in the panel.');
}

function render() { void renderPage().catch((error) => { if (error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException') message('This page could not be rendered. Try the next page or a different PDF.'); }); }

$('file').addEventListener('change', () => {
  const file = $<HTMLInputElement>('file').files?.[0]; if (!file) return;
  if (file.size > 50 * 1024 * 1024) { message('Please choose a PDF smaller than 50 MB for this reader.'); return; }
  void (async () => {
    generation++; renderTask?.cancel(); layer?.cancel();
    await pdf?.loadingTask.destroy(); pdf = undefined;
    filename = file.name; $('filename').textContent = filename; message('Opening your PDF locally…');
    const loading = getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: chrome.runtime.getURL('cmaps/'), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('standard_fonts/'), wasmUrl: chrome.runtime.getURL('wasm/'),
    });
    loading.onPassword = (updatePassword: (password: string) => void) => {
      const password = prompt('This PDF is password-protected. Enter its document password:');
      if (password !== null) updatePassword(password); else { void loading.destroy(); message('Opening cancelled. Choose a PDF to try again.'); }
    };
    pdf = await loading.promise; currentPage = 1;
    const firstPage = await pdf.getPage(1);
    scale = Math.max(.45, Math.min(1.3, (window.innerWidth - 40) / firstPage.getViewport({ scale: 1 }).width));
    $('welcome').hidden = true; await renderPage();
  })().catch(() => { message('This PDF could not be opened. Check that it is a valid PDF and try again.'); controls(); });
});
$('previous').addEventListener('click', () => { if (currentPage > 1) { currentPage--; render(); } });
$('next').addEventListener('click', () => { if (pdf && currentPage < pdf.numPages) { currentPage++; render(); } });
$('zoom-out').addEventListener('click', () => { scale = Math.max(.6, scale - .2); render(); });
$('zoom-in').addEventListener('click', () => { scale = Math.min(2.5, scale + .2); render(); });
$('text-toggle').addEventListener('click', () => { textMode = !textMode; controls(); });

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const container = textMode ? $('reading-text') : $('text-layer');
  if (!container.contains(range.commonAncestorContainer)) return;
  const expression = selection.toString().replace(/\s+/g, ' ').trim();
  if (!expression || expression.length > 160 || expression.split(/\s+/u).length > 12) {
    $<HTMLButtonElement>('explore').disabled = true; $('selected-label').textContent = 'Choose one word or a short expression (up to 12 words).'; return;
  }
  const before = document.createRange(); before.selectNodeContents(container); before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  selected = { expression, sentence: sentenceAround(container.textContent || expression, start, start + range.toString().length), sourceUrl: '', title: `${filename} · page ${currentPage}`, capturedAt: Date.now() };
  $('selected-label').textContent = `“${expression}”`; $('selected-context').textContent = selected.sentence;
  $<HTMLButtonElement>('explore').disabled = false;
});
$('explore').addEventListener('pointerdown', (event) => event.preventDefault());
$('explore').addEventListener('click', () => {
  if (!selected || windowId === undefined) return;
  void chrome.sidePanel.open({ windowId }).catch(() => message('Click the ContextBridge toolbar icon to open your learning panel.'));
  void chrome.runtime.sendMessage({ type: 'selection', selection: selected }).then(() => message('Selection ready. Confirm its context and choose assistance in the learning panel.'));
});
