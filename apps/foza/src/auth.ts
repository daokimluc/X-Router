import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { checkCredentials, isGmail, upsertOAuthUser } from "@/lib/users";

/**
 * Auth.js (NextAuth v5) configuration. Foza owns user identity; X-Router has
 * no user accounts (see the integration contract). After sign-in, the existing
 * `ensureUserKey()` seam provisions an X-Router buyer key on first use.
 *
 * Session strategy is JWT (required by the Credentials provider and avoids a
 * database adapter). The session cookie is signed with AUTH_SECRET.
 */

// Google is only registered when credentials are configured, so the app boots
// (and email/password works) before the Google OAuth client is set up.
const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        // Gmail-only + must be verified. checkCredentials enforces verified.
        if (!isGmail(email)) return null;
        const res = await checkCredentials(email, password);
        if (!res.ok) return null;
        // Auth.js requires an `id`; use the email as the stable identifier.
        return { id: res.user.email, name: res.user.name, email: res.user.email };
      },
    }),
  ],
  callbacks: {
    // Gmail-only: reject Google accounts that aren't @gmail.com. Also upsert a
    // users-table row for federated sign-ins so roles can be attached to them
    // (Google never calls createUser, so without this it'd be absent).
    async signIn({ account, profile, user }) {
      if (account?.provider === "google") {
        const email = profile?.email;
        if (!email || !isGmail(email)) return false;
        await upsertOAuthUser({ email, name: profile?.name ?? user?.name });
        return true;
      }
      return true;
    },
    // Persist name/email onto the JWT so the session reflects the user even
    // without a database lookup.
    jwt({ token, user }) {
      if (user) {
        token.name = user.name ?? token.name;
        token.email = user.email ?? token.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.name = (token.name as string) ?? session.user.name;
        session.user.email = (token.email as string) ?? session.user.email;
      }
      return session;
    },
  },
});
