/** Keep context around the selected occurrence, rather than the first repeated word. */
export function sentenceAround(text: string, selectionStart: number, selectionEnd: number): string {
  const start = Math.max(0, Math.min(text.length, selectionStart));
  const end = Math.max(start, Math.min(text.length, selectionEnd));
  let left = start;
  let right = end;
  while (left > 0 && !/[.!?。！？\n]/u.test(text[left - 1])) left--;
  while (right < text.length && !/[.!?。！？\n]/u.test(text[right])) right++;
  if (right < text.length && text[right] !== '\n') right++;
  if (right - left > 2400) {
    left = Math.max(left, start - 1000);
    right = Math.min(right, Math.max(end, start + 1400));
  }
  return text.slice(left, right).replace(/\s+/g, ' ').trim();
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter only the server origin, for example https://contextbridge.vercel.app.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost for development.');
  }
  return url.origin;
}

export function hostPattern(origin: string): string {
  const url = new URL(normalizeOrigin(origin));
  // Chrome match patterns cannot narrow a host permission to one port.
  return `${url.protocol}//${url.hostname}/*`;
}

export function validateSelection(expression: string, sentence: string): void {
  if (!expression.trim() || expression.length > 160 || expression.trim().split(/\s+/u).length > 12) {
    throw new Error('Select one word or a short expression (up to 12 words).');
  }
  if (sentence.trim().length < expression.trim().length || sentence.length > 2400) {
    throw new Error('Include the surrounding sentence, up to 2,400 characters.');
  }
  if (!sentence.toLocaleLowerCase().includes(expression.trim().toLocaleLowerCase())) {
    throw new Error('Include the selected expression in the sentence, or adjust your selection.');
  }
}
