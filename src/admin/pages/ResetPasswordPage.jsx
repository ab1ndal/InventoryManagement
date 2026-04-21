import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // PKCE: Supabase auto-exchanges ?code= in URL and fires PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setSession(session);
        setLoading(false);
      }
    });

    // Fallback: session already exists (e.g. implicit flow or already exchanged)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        setLoading(false);
      }
    });

    // Timeout: if no recovery session after 5s, show error
    const timeout = setTimeout(() => setLoading(false), 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast("Error", { description: error.message, icon: "⚠️" });
    } else {
      toast("Password Updated", {
        description: "You can now log in with your new password.",
        icon: "✅",
      });
      await supabase.auth.signOut();
      navigate("/admin/login");
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-amber-600 border-opacity-50"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100">
        <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 text-center space-y-4">
          <h2 className="text-2xl font-semibold text-amber-700">Invalid Link</h2>
          <p className="text-sm text-gray-600">
            This reset link is invalid or has expired.
          </p>
          <a
            href="/admin/forgot-password"
            className="text-amber-600 underline text-sm"
          >
            Request a new reset link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 text-center space-y-6">
        <h2 className="text-2xl font-semibold text-amber-700">
          Reset Password
        </h2>
        <form onSubmit={handleReset} className="space-y-4 text-left">
          <input
            type="password"
            required
            placeholder="New Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <button
            type="submit"
            className="w-full py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
          >
            Set New Password
          </button>
        </form>
      </div>
    </div>
  );
}
