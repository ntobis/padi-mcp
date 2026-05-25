import { handleAuth } from '@workos-inc/authkit-nextjs';

// Exchanges the AuthKit authorization code for a session, then returns the user
// to /connect. Must match the redirect URI configured in the WorkOS dashboard
// (http://localhost:3000/callback).
export const GET = handleAuth({ returnPathname: '/connect' });
