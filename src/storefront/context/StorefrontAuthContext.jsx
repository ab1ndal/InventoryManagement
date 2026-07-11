import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "lib/supabaseClient";

const StorefrontAuthContext = createContext(null);

export function StorefrontAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithOtp = useCallback(
    (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/account` },
      }),
    []
  );
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  return (
    <StorefrontAuthContext.Provider
      value={{ user: session?.user ?? null, session, loading, signInWithOtp, signOut }}
    >
      {children}
    </StorefrontAuthContext.Provider>
  );
}

export function useStorefrontAuth() {
  const ctx = useContext(StorefrontAuthContext);
  if (!ctx) throw new Error("useStorefrontAuth must be used inside StorefrontAuthProvider");
  return ctx;
}
