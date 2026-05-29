/**
 * Parse a `curl '…' -H '…' …` command (as copied from Chrome DevTools)
 * into a Session object. Shared between scripts/curl-to-session.ts (the
 * CLI helper) and the padi_refresh_session MCP tool.
 */
import type { Session } from './session.js';

const ENDPOINT = 'https://logbook.global-prod.padi.com/api/Logbook';

interface ParsedCurl {
  url: string | null;
  headers: Record<string, string>;
}

/**
 * Tokenise a single-line or multi-line curl command, respecting single
 * and double quotes (Chrome emits single-quoted -H args on macOS/Linux).
 */
function tokeniseCurl(input: string): string[] {
  const cleaned = input.replace(/\\\r?\n/g, ' ').replace(/[;\n\r]+$/g, ' ');
  const tokens: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let buf = '';
      while (i < cleaned.length) {
        const c = cleaned[i]!;
        if (c === '\\' && quote === '"' && i + 1 < cleaned.length) {
          buf += cleaned[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        buf += c;
        i++;
      }
      tokens.push(buf);
      continue;
    }
    let buf = '';
    while (i < cleaned.length && !/\s/.test(cleaned[i]!)) {
      buf += cleaned[i];
      i++;
    }
    tokens.push(buf);
  }
  return tokens;
}

function parseCurl(input: string): ParsedCurl {
  const tokens = tokeniseCurl(input);
  let url: string | null = null;
  const headers: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === 'curl') continue;
    if (t === '-H' || t === '--header') {
      const v = tokens[++i];
      if (!v) continue;
      const idx = v.indexOf(':');
      if (idx === -1) continue;
      const name = v.slice(0, idx).trim();
      const value = v.slice(idx + 1).trim();
      headers[name.toLowerCase()] = value;
      continue;
    }
    if (t === '-b' || t === '--cookie') {
      const v = tokens[++i];
      if (v) headers.cookie = v;
      continue;
    }
    if (t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '-d') {
      i++; // body — ignored
      continue;
    }
    if (t === '-X' || t === '--request') {
      i++;
      continue;
    }
    if (t.startsWith('-')) continue;
    if (!url && /^https?:\/\//.test(t)) url = t;
  }
  return { url, headers };
}

function decodeJwtSub(authHeader: string): string {
  const m = authHeader.match(/Bearer\s+([A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/);
  if (!m) return '';
  const payload = m[1]!.split('.')[1]!;
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
  const buf = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
    return typeof parsed.sub === 'string' ? parsed.sub : '';
  } catch {
    return '';
  }
}

export function buildSessionFromCurl(input: string): Session {
  const { url, headers } = parseCurl(input);
  const endpoint = url && /\/api\/Logbook/i.test(url) ? url : ENDPOINT;
  const authorization = headers.authorization ?? '';
  if (!authorization) throw new Error('curl is missing Authorization header');
  const affiliate_id = headers['affiliate-id'] ?? '';
  if (!affiliate_id) throw new Error('curl is missing affiliate-id header');
  const x_platform = headers['x-platform'] ?? 'web';
  const user_agent = headers['user-agent'] ?? '';
  const cognito_sub = decodeJwtSub(authorization);
  return { endpoint, authorization, affiliate_id, x_platform, user_agent, cognito_sub };
}
