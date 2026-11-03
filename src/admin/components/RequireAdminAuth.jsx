// src/admin/components/RequireAdminAuth.jsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
//import { useToast } from "../../components/hooks/use-toast";
import UserRegistration from "./UserRegistration";
import { ADMIN_ROLES, NO_ADMIN_ACCESS, OAUTH_PENDING_KEY, hasAdminAccess } from "../lib/adminAccess";

export default function RequireAdminAuth({ allowedRoles = ADMIN_ROLES }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const location = useLocation();

  const checkUserRole = async (session) => {
    if (!session?.user) return;

    // Read before the await: the auth listener and the session restore both run this check at once,
    // and both must agree on the attempt.
    const freshOAuthLogin = sessionStorage.getItem(OAUTH_PENDING_KEY);
    const allowed = await hasAdminAccess(supabase, session.user.id, allowedRoles);
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    // A Google sign-in that turns out not to be an admin must not stay logged in. Anyone else refused
    // here may be a shop customer, so their shop session is left alone.
    if (!allowed && freshOAuthLogin) {
      sessionStorage.setItem(
        "toastData",
        JSON.stringify({ title: "Login Failed", description: NO_ADMIN_ACCESS, icon: "⚠️" })
      );
      await supabase.auth.signOut();
      return;
    }
    setIsAuthorized(allowed);
    setLoading(false);
  };

  const waitForSession = async () => {
    let attempts = 0;
    while (attempts < 10) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setSession(session);
        checkUserRole(session);
        return;
      }
      await new Promise((res) => setTimeout(res, 500));
      attempts++;
    }
    console.warn("[RequireAdminAuth] Session was never restored");
    setLoading(false);
  };

  useEffect(() => {
    // Auth change listener
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        //console.log("[RequireAdminAuth] Auth event:", _event, session);
        if (session) {
          setSession(session);
          checkUserRole(session);
        } else {
          setSession(null);
          setIsAuthorized(false);
          setLoading(false);
        }
      }
    );

    // Fallback session restore for first load
    waitForSession();

    return () => {
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // UI states
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-orange-600 border-opacity-50"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <Navigate
        to="/admin/login"
        state={{ toast: "not_logged_in", from: location.pathname }}
      />
    );
  }

  if (!isAuthorized) {
    return (
      <Navigate
        to="/unauthorized"
        state={{ toast: "unauthorized", from: location.pathname }}
      />
    );
  }

  return (
    <>
      <UserRegistration />
      <Outlet />
    </>
  );
}
