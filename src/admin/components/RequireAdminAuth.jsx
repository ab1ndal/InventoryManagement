// src/admin/components/RequireAdminAuth.jsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
//import { useToast } from "../../components/hooks/use-toast";
import UserRegistration from "./UserRegistration";

export default function RequireAdminAuth() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [redirectReason, setRedirectReason] = useState(null);

  const location = useLocation();

  const checkUserRole = async (session) => {
    if (!session?.user) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

        if (!error && ["admin", "superadmin"].includes(data?.role)) {
          setIsAuthorized(true);
        } else {
          setRedirectReason("unauthorized");
        }
    } catch (err) {
      console.error("Role check failed:", err);
      setRedirectReason("unauthorized");
    } finally {
      setLoading(false);
    }
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
    setRedirectReason("not_logged_in");
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
          setRedirectReason("not_logged_in");
          setLoading(false);
        }
      }
    );

    // Fallback session restore for first load
    waitForSession();

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);


  // UI states
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-orange-600 border-opacity-50"></div>
      </div>
    );
  }

  if (!session && redirectReason === "not_logged_in") {
    return (
      <Navigate
        to="/admin/login"
        state={{ toast: "not_logged_in", from: location.pathname }}
      />
    );
  }

  if (!isAuthorized && redirectReason === "unauthorized") {
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
