"use client";

import { createContext, useContext, useMemo } from "react";
import {
  SessionProvider,
  useSession,
  signOut as nextSignOut,
} from "next-auth/react";
import { type Session } from "@/lib/auth";

type AuthContextValue = {
  user: Session | null;
  ready: boolean;
  /** Sign out and hard-redirect home (Auth.js clears the JWT cookie). */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Auth.js owns the real session (JWT cookie, validated server-side). This
 * provider adapts `useSession()` to the small `useAuth()` shape the app already
 * consumes (`{ user, ready, signOut }`), so existing chrome stays unchanged.
 */
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();

  const value = useMemo<AuthContextValue>(() => {
    const email = data?.user?.email ?? null;
    const user: Session | null = email
      ? { name: data?.user?.name ?? email, email }
      : null;
    return {
      user,
      ready: status !== "loading",
      signOut: () => nextSignOut({ callbackUrl: "/" }),
    };
  }, [data, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthBridge>{children}</AuthBridge>
    </SessionProvider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
