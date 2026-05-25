import { describe, expect, it } from 'vitest';
import { verifyWorkosToken } from '../lib/mcp-auth';

describe('verifyWorkosToken', () => {
  it('returns undefined when no bearer token is present', async () => {
    expect(await verifyWorkosToken(new Request('http://localhost/api/mcp'), undefined)).toBeUndefined();
  });

  it('returns undefined for a malformed (non-JWT) token', async () => {
    expect(await verifyWorkosToken(new Request('http://localhost/api/mcp'), 'not-a-jwt')).toBeUndefined();
  });
});
