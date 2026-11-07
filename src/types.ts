export type Mode = 'guided' | 'direct';
export type Selection = { expression: string; sentence: string; sourceUrl: string; title?: string; capturedAt: number };
export type Explanation = {
  meaning: string; translation: string; partOfSpeech: string; lemma: string;
  grammar: string; clue: string; question: string; example: string; evidence: string;
  alternatives: string[]; check: { sentence: string; question: string; answer: string };
};
export type Encounter = {
  id: string; expression: string; sentence: string; language: string; translationLanguage: string;
  sourceUrl: string; mode: Mode; explanation: Explanation; initialInterpretation: string;
  revisedInterpretation: string; assistance: string[]; checkResponse: string;
  unresolved: boolean; attemptStatus: 'not_attempted' | 'attempted' | 'assisted';
  createdAt: string; updatedAt: string;
  review: { dueAt: string; interval: number; repetitions: number; ease: number };
};
export type Settings = {
  name: string; learningLanguage: string; translationLanguage: string; mode: Mode;
  instructions: string; dailyGoal: number;
};
export type Chat = {
  id: string; title: string; createdAt: string; updatedAt: string; encounterId?: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
};
export type Account = { id: string; name: string; email: string };
export type Connection = { apiUrl: string; webUrl: string; token?: string; account?: Account };
export type PublicConfig = { demo: boolean; authUrl: string; aiConfigured: boolean; storage: 'local' | 'neon'; appUrl: string };
export type Lookup = { explanation: Explanation; cached: boolean; matches: Encounter[]; source: 'ai' | 'demo' };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
declare global { const __API_URL__: string; const __WEB_URL__: string; }
