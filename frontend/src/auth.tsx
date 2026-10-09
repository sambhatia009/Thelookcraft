import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

import { api, clearToken, loadToken, saveToken } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

type User = { user_id: string; email: string; name?: string; picture?: string | null };

type AuthState = {
  user: User | null;
  loading: boolean;
  signInEmail: (email: string, password: string) => Promise<{ reactivated?: boolean }>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  closeAccount: (mode: "disable" | "delete") => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>(null as any);
export const useAuth = () => useContext(AuthContext);

const processedSessionIds = new Set<string>();

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    if (processedSessionIds.has(sessionId)) return;
    processedSessionIds.add(sessionId);
    const data = await api.googleSession(sessionId);
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Web: handle redirect with session_id first.
        if (Platform.OS === "web" && typeof window !== "undefined") {
          const sid = extractSessionId(window.location.href);
          if (sid) {
            try {
              await exchangeSessionId(sid);
              const url = new URL(window.location.href);
              url.hash = "";
              url.searchParams.delete("session_id");
              window.history.replaceState(window.history.state, "", url.toString());
            } catch {}
          }
        } else {
          // Native cold start deep link.
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial);
          if (sid) {
            try {
              await exchangeSessionId(sid);
            } catch {}
          }
        }

        const t = await loadToken();
        if (t && !user) {
          try {
            const u = await api.me();
            setUser(u);
          } catch {
            await clearToken();
            setUser(null);
          }
        }
      } finally {
        setLoading(false);
      }
    })();

    const sub = Linking.addEventListener("url", async ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) {
        try {
          await exchangeSessionId(sid);
        } catch {}
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInEmail = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    await saveToken(data.session_token);
    setUser(data.user);
    return { reactivated: !!data.reactivated };
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const data = await api.register(name, email, password);
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const resetPassword = useCallback(async (email: string, code: string, newPassword: string) => {
    const data = await api.resetPassword(email, code, newPassword);
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === "web") {
      const redirectUrl = window.location.origin + "/";
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      return;
    }
    const redirectUrl = Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let sid: string | null = null;
    if (result.type === "success" && (result as any).url) sid = extractSessionId((result as any).url);
    if (!sid) sid = extractSessionId(await Linking.getInitialURL());
    if (sid) await exchangeSessionId(sid);
  }, [exchangeSessionId]);

  const closeAccount = useCallback(async (mode: "disable" | "delete") => {
    await api.closeAccount(mode);
    await clearToken();
    setUser(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signInEmail, signUp, resetPassword, closeAccount, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
