/**
 * Next.js 16 proxy (formerly middleware.ts). Manages the AuthKit session and
 * gates the web pages that need a signed-in user. The MCP endpoint (/api/mcp)
 * is intentionally NOT matched here — it authenticates via bearer tokens
 * (withMcpAuth), not the session cookie.
 */
import { authkit, handleAuthkitHeaders } from '@workos-inc/authkit-nextjs';
import type { NextRequest } from 'next/server';

export default async function proxy(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);

  if (request.nextUrl.pathname.startsWith('/connect') && !session.user && authorizationUrl) {
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl });
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = { matcher: ['/connect/:path*'] };
