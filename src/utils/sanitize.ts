export function maskNip(nip: string): string {
  const raw = String(nip ?? '').trim();
  if (!raw) return '';
  if (raw.length <= 6) return `${raw.slice(0, 2)}****`;
  return `${raw.slice(0, 4)}****${raw.slice(-2)}`;
}

export function maskToken(token: string): string {
  const raw = String(token ?? '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 4)}...${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

type HeadersLike =
  | Record<string, string | string[] | undefined>
  | Array<[string, string]>
  | Headers
  | undefined
  | null;

const SENSITIVE_HEADER_KEYS = new Set(['authorization', 'sessiontoken', 'session-token', 'x-session-token']);

export function sanitizeHeaders(headers: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  const set = (k: string, v: string) => {
    const key = k.toLowerCase();
    if (SENSITIVE_HEADER_KEYS.has(key)) {
      out[k] = '[REDACTED]';
      return;
    }
    out[k] = v;
  };

  if (typeof (headers as any).forEach === 'function' && typeof (headers as any).get === 'function') {
    // Headers
    (headers as Headers).forEach((value, key) => set(key, value));
    return out;
  }

  if (Array.isArray(headers)) {
    for (const [k, v] of headers) set(k, v);
    return out;
  }

  for (const [k, v] of Object.entries(headers as Record<string, any>)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) set(k, v.join(','));
    else set(k, String(v));
  }

  return out;
}

export function truncateBody(body: unknown, maxLen: number = 500): unknown {
  if (body == null) return body;
  if (typeof body === 'string') {
    if (body.length <= maxLen) return body;
    return `${body.slice(0, maxLen)}…(+${body.length - maxLen} chars)`;
  }
  try {
    const json = JSON.stringify(body);
    if (json.length <= maxLen) return body;
    return `${json.slice(0, maxLen)}…(+${json.length - maxLen} chars)`;
  } catch {
    return '[Unserializable body]';
  }
}

