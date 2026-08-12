/**
 * Shared user session shape. Auth.js (NextAuth v5) now owns the session cookie
 * and its encoding/verification — see `src/auth.ts`. This type is the trimmed
 * view the app passes around (server: `getServerSession()`; client: `useAuth()`).
 */
export type Session = {
  name: string;
  email: string;
};
