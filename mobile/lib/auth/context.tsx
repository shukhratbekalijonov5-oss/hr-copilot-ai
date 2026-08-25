import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  restoreSession,
  setSessionEndedListener,
} from "@/lib/api/client";
import { me } from "@/lib/auth/session";
import { queryKeys } from "@/lib/query/keys";
import type { SessionUser } from "@/types";

/**
 * Who is signed in — decided by the server, every launch.
 *
 * ## The launch sequence
 *
 * Restore tokens from the keychain → if none, we are signed out → otherwise
 * ask `GET /auth/me`. The API client transparently refreshes an expired
 * access token during that call and, if the refresh fails, ends the session.
 * So a revoked or expired session resolves to "signed out" without any
 * special case here.
 *
 * ## Role is never inferred on the device
 *
 * `accountType` comes from `/auth/me` and nowhere else. Nothing reads a JWT
 * claim, a stored flag or a previous screen to decide whether somebody is a
 * recruiter — that is what makes role spoofing a non-question rather than a
 * thing to defend against.
 */
interface AuthValue {
  /** True until the keychain has been read; render a splash, not a login. */
  restoring: boolean;
  user: SessionUser | null;
  isSignedIn: boolean;
  /** Re-reads `/auth/me`, e.g. after a plan change. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState(true);
  const [hasTokens, setHasTokens] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void restoreSession()
      .then((tokens) => {
        if (cancelled) return;
        setHasTokens(Boolean(tokens));
        setRestoring(false);
      })
      .catch(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * When the client gives up on a session — a failed refresh, a revoked
   * token — every cached server answer belongs to somebody who is no longer
   * signed in. Clearing the cache is what stops the previous account's
   * dashboard flashing behind the login screen.
   */
  useEffect(() => {
    setSessionEndedListener(() => {
      setHasTokens(false);
      queryClient.clear();
    });
    return () => setSessionEndedListener(null);
  }, [queryClient]);

  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: me,
    enabled: !restoring && hasTokens,
    staleTime: 60_000,
    retry: false,
  });

  const value = useMemo<AuthValue>(
    () => ({
      // Still restoring while the identity call is in flight, so the router
      // never bounces a signed-in user to the login screen for one frame.
      restoring: restoring || (hasTokens && session.isLoading),
      user: session.data ?? null,
      isSignedIn: Boolean(session.data),
      refresh: async () => {
        setHasTokens(true);
        await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      },
    }),
    [restoring, hasTokens, session.data, session.isLoading, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in account, for screens that only render when signed in. */
export function useSessionUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error("useSessionUser requires a signed-in session");
  return user;
}
