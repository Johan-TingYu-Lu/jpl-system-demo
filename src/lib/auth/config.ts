/**
 * NextAuth v5 configuration — Google OAuth
 *
 * 只允許特定 email 登入（呂老師的 Google 帳號）
 */
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      // 只允許白名單 email
      if (ALLOWED_EMAILS.length === 0) return true; // 開發模式：未設白名單則全部放行
      return ALLOWED_EMAILS.includes(user.email?.toLowerCase() || '');
    },
    async session({ session }) {
      return session;
    },
  },
});
