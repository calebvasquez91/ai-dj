import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Credentials-only auth (no OAuth), so sessions are JWT-based and there's no
// need for the Prisma adapter — it exists to persist Account/Session rows
// for OAuth account-linking, which doesn't apply here. `authorize` looks the
// user up and checks the password directly.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Explicit rather than relying on Auth.js's AUTH_SECRET auto-inference —
  // that inference didn't pick it up in production (MissingSecret at
  // runtime despite the env var being set in Vercel).
  secret: process.env.AUTH_SECRET,
  // Without this, Auth.js only trusts a "localhost" host header in dev and
  // silently redirects anything else (e.g. 127.0.0.1) back to a hardcoded
  // localhost URL — the actual cause of credentials sign-in silently
  // failing when testing via 127.0.0.1. Safe in production too; it's
  // Vercel's own recommended setting there.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id as string;
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      return session;
    },
  },
});
