/** Sign-in state for the whole app. */
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

interface AuthState {
  /** True until the saved session has been checked. */
  loading: boolean;
  session: Session | null;
  userId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns true when the account is ready to use, false when an email confirmation is needed first. */
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      userId: session?.user.id ?? null,
      signIn: async (email, password) => {
        const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message);
      },
      signUp: async (email, password, displayName) => {
        const { data, error } = await supabase!.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        });
        if (error) throw new Error(error.message);
        return data.session !== null;
      },
      signOut: async () => {
        await supabase!.auth.signOut();
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The signed-in user's ID. Only call on screens behind the sign-in gate. */
export function useUserId(): string {
  const { userId } = useAuth();
  if (!userId) throw new Error('Not signed in');
  return userId;
}
