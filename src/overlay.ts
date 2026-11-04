import type { Encounter, Lookup, Mode, Selection } from './types';

export interface OverlayDraft {
  ticket: string; tabId: number; origin: string; expiresAt: number;
  selection: Selection; language: string; translationLanguage: string; mode: Mode;
  result: Lookup; savedId?: string; revealed: boolean; hints: number;
  assistance: string[]; initialInterpretation: string; revisedInterpretation: string;
  unresolved: boolean; checkResponse: string; attemptHadHelp: boolean; checked: boolean;
}

export function normalizedContext(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export function matchingEncounter(items: Encounter[], selection: Selection, language: string, translationLanguage: string) {
  return items.find((item) => normalizedContext(item.expression) === normalizedContext(selection.expression)
    && normalizedContext(item.sentence) === normalizedContext(selection.sentence)
    && normalizedContext(item.language) === normalizedContext(language)
    && normalizedContext(item.translationLanguage) === normalizedContext(translationLanguage));
}

export function overlayAction(draft: OverlayDraft, action: string, value?: string): void {
  if (action === 'hint') { draft.hints = Math.min(2, draft.hints + 1); draft.assistance.push(draft.hints === 1 ? 'context_clue' : 'grammar_clue'); }
  else if (action === 'reveal') { draft.revealed = true; if (!draft.assistance.includes('answer_revealed')) draft.assistance.push('answer_revealed'); }
  else if (action === 'revision') draft.revisedInterpretation = String(value || '').trim().slice(0, 2000);
  else if (action === 'unresolved') draft.unresolved = value === 'true';
  else if (action === 'earlier_meaning') draft.assistance.push('earlier_meaning_revealed');
  else if (action === 'mode' && (value === 'guided' || value === 'direct')) {
    draft.mode = value;
    if (value === 'direct') overlayAction(draft, 'reveal'); else draft.revealed = false;
  }
  else throw new Error('Unsupported overlay action.');
}
