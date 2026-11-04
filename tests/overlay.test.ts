import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingEncounter, overlayAction, type OverlayDraft } from '../src/overlay.ts';
import type { Encounter, Selection } from '../src/types.ts';

test('saved icon matches the exact context, not just the familiar expression', () => {
  const encounter = { id: 'saved', expression: 'Addresses', sentence: 'The proposal addresses the shortage.', language: 'English', translationLanguage: 'German' } as Encounter;
  const selection = { expression: 'addresses', sentence: '  The proposal   addresses the shortage. ' } as Selection;
  assert.equal(matchingEncounter([encounter], selection, 'english', 'german')?.id, 'saved');
  assert.equal(matchingEncounter([encounter], { ...selection, sentence: 'The address is written on the envelope.' }, 'English', 'German'), undefined);
  assert.equal(matchingEncounter([encounter], selection, 'English', 'French'), undefined);
});

test('overlay assistance keeps chronological events and bounds revision input', () => {
  const draft = { hints: 0, revealed: false, assistance: ['initial_attempt'], revisedInterpretation: '', unresolved: false } as OverlayDraft;
  overlayAction(draft, 'hint'); overlayAction(draft, 'earlier_meaning'); overlayAction(draft, 'reveal'); overlayAction(draft, 'reveal');
  assert.deepEqual(draft.assistance, ['initial_attempt', 'context_clue', 'earlier_meaning_revealed', 'answer_revealed']);
  assert.equal(draft.revealed, true);
  overlayAction(draft, 'mode', 'guided'); assert.equal(draft.revealed, false);
  assert.ok(draft.assistance.includes('answer_revealed'), 'Hiding the answer must not erase previously used assistance.');
  overlayAction(draft, 'mode', 'direct'); assert.equal(draft.mode, 'direct'); assert.equal(draft.revealed, true);
  overlayAction(draft, 'revision', 'x'.repeat(2500)); assert.equal(draft.revisedInterpretation.length, 2000);
  overlayAction(draft, 'unresolved', 'true'); assert.equal(draft.unresolved, true);
  assert.throws(() => overlayAction(draft, '/api/settings'), /Unsupported/);
});
