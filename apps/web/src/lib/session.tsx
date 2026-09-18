"use client";

import type { SessionUser } from "@stream/shared";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, ApiError } from "./api";

type SessionState = {
  user: SessionUser | null;
  /** True until the first `/v1/auth/me` resolves; screens render a skeleton. */
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: SessionUser }>("/v1/auth/me");
      setUser(me);
      return me;
    } catch (error) {
      // A 401 here is the normal signed-out case, not a failure worth showing.
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.error("session lookup failed", error);
      }
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user: me } = await api.post<{ user: SessionUser }>("/v1/auth/login", {
      email,
      password,
    });
    setUser(me);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/v1/auth/logout");
    } finally {
      setUser(null);
      router.push("/login");
    }
  }, [router]);

  const value = useMemo<SessionState>(
    () => ({ user, loading, refresh, signIn, signOut, setUser }),
    [user, loading, refresh, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return context;
}

export function isOrgAdmin(user: SessionUser | null): boolean {
  return user !== null && (user.role === "ADMIN" || user.role === "OWNER");
}

