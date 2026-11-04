export const pairingOrigins = {
  'https://contextbridge-newpoluton.vercel.app': 'https://contextbridge-newpoluton.vercel.app',
  'http://localhost:5173': 'http://localhost:3000',
  'http://127.0.0.1:5173': 'http://127.0.0.1:3000',
} as const;

export function externalPairTarget(senderUrl: string, senderOrigin?: string, frameId?: number) {
  const url = new URL(senderUrl);
  if (frameId !== undefined && frameId !== 0) throw new Error('Connect from the website’s main page.');
  if (senderOrigin && senderOrigin !== url.origin) throw new Error('The connection origin did not match.');
  const apiUrl = pairingOrigins[url.origin as keyof typeof pairingOrigins];
  if (!apiUrl || url.username || url.password) throw new Error('This website is not allowed to connect ContextBridge.');
  return { apiUrl, webUrl: url.origin };
}

export function externalPairCode(message: unknown): string {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid connection request.');
  const value = message as Record<string, unknown>;
  if (value.type !== 'CB_PAIR' || Object.keys(value).some((key) => !['type', 'code'].includes(key))) throw new Error('Unsupported connection request.');
  if (typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(value.code)) throw new Error('The one-time connection code is invalid.');
  return value.code;
}
