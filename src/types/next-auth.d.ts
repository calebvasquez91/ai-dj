import type { DefaultSession } from "next-auth";

// Every user in this app has a real DB id and no OAuth-provided fields are
// used (Credentials-only auth), so `id` is always present on the session.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
  }
}
