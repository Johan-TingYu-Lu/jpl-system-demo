import { handlers } from '@/lib/auth/config';

// Wrap NextAuth handlers for Next.js 16 type compatibility
const { GET: authGET, POST: authPOST } = handlers;
export const GET = authGET;
export const POST = authPOST;
