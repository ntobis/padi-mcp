/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). Tells MCP clients which
 * authorization server (our WorkOS AuthKit) can issue tokens for this resource,
 * so clients can discover where to log in. The auth server URL is the AuthKit
 * domain (WORKOS_AUTHKIT_DOMAIN, e.g. https://<slug>.authkit.app).
 */
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';

const authServer = (process.env.WORKOS_AUTHKIT_DOMAIN ?? '').trim().replace(/\/$/, '');

const handler = protectedResourceHandler({
  authServerUrls: authServer ? [authServer] : [],
});

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
