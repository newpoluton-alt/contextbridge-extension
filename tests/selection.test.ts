import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAround, validateSelection, normalizeOrigin, hostPattern } from '../src/selection.ts';

test('captures the selected occurrence instead of a prior identical word', () => {
  const text = 'The address is on the letter. The proposal addresses the housing shortage by funding construction. This is another point.';
  const start = text.indexOf('addresses');
  assert.equal(sentenceAround(text, start, start + 9), 'The proposal addresses the housing shortage by funding construction.');
});
test('supports short expressions and non-Latin punctuation', () => {
  assert.doesNotThrow(() => validateSelection('takes into account', 'The decision takes into account the wider context.'));
  const value = 'これは前です。言葉を学びます。次です。';
  assert.equal(sentenceAround(value, value.indexOf('言葉'), value.indexOf('言葉') + 2), '言葉を学びます。');
});
test('selection cannot silently become whole-document translation', () => {
  assert.throws(() => validateSelection('word '.repeat(14), 'word '.repeat(14)), /short expression/);
  assert.throws(() => validateSelection('addresses', 'The sentence does not contain the selection.'), /Include the selected expression/);
  assert.throws(() => validateSelection('one', 'one'.repeat(1000)), /2,400/);
});
test('oversized paragraph is clipped around the selected expression', () => {
  const text = 'a'.repeat(3000) + ' selected ' + 'b'.repeat(3000);
  const sentence = sentenceAround(text, 3001, 3009);
  assert.ok(sentence.includes('selected'));
  assert.ok(sentence.length <= 2400);
});
test('server origins reject remote HTTP, credentials, and hidden URL targets', () => {
  assert.equal(normalizeOrigin('https://example.com/'), 'https://example.com');
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const value of ['http://example.com', 'javascript:alert(1)', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com?token=secret']) {
    assert.throws(() => normalizeOrigin(value));
  }
  assert.equal(hostPattern('http://localhost:3000'), 'http://localhost/*');
});
