// src/admin/pages/LoginPage.jsx
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Admin Login | Bindal's Creation";

    if (location.state?.toast === "not_logged_in") {
      sessionStorage.setItem("toastData", JSON.stringify({
        title: "Login Required",
        description: "Please log in to access the admin portal.",
        icon: "⚠️",
      }));
    }
  }, [location.state]);

  const redirectTo = location.state?.from || "/admin/inventory";

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      console.log("Login Failed", error);
      sessionStorage.setItem("toastData", JSON.stringify({
        title: "Login Failed",
        description: error.message,
        icon: "⚠️",
      }));
      toast("Login Failed", {
        description: error.message,
        icon: "⚠️",
      });
    } else {
      sessionStorage.setItem("toastData", JSON.stringify({
        title: "Login Success",
        description: "Logged in successfully.",
        icon: "✅",
      }));
      navigate(redirectTo);
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + redirectTo },
    });

    if (error) {
      sessionStorage.setItem("toastData", JSON.stringify({
        title: "Google Login Failed",
        description: error.message,
        icon: "⚠️",
      }));
      toast("Google Login Failed", {
        description: error.message,
        icon: "⚠️",
      });
    } else {
      sessionStorage.setItem("toastData", JSON.stringify({
        title: "Google Login Success",
        description: "Logged in successfully.",
        icon: "✅",
      }));
      navigate(redirectTo);
    }
  };

  useEffect(() => {
    console.log("[LoginPage] useEffect");
    console.log(sessionStorage.getItem("toastData"));
    const toastData = JSON.parse(sessionStorage.getItem("toastData"));
    if (toastData) {
      toast(toastData.title, {
        description: toastData.description,
        icon: toastData.icon,
      });
      sessionStorage.removeItem("toastData");
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 text-center space-y-6">
        <h2 className="text-2xl font-semibold text-amber-700">
          Admin Portal Login
        </h2>
        <p className="text-sm text-gray-500">Login with Google or Email</p>

        {/* Email/Password Login */}
        <form onSubmit={handleEmailLogin} className="space-y-4 text-left">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login with Email"}
          </button>
        </form>

        <p className="text-sm text-right">
          <a href="/admin/forgot-password" className="text-amber-600 underline">
            Forgot Password?
          </a>
        </p>

        <div className="flex items-center gap-4">
          <hr className="flex-1 border-gray-300" />
          <span className="text-xs text-gray-500">OR</span>
          <hr className="flex-1 border-gray-300" />
        </div>

        {/* Google Login Button */}
        <button
          onClick={handleGoogleLogin}
          className="w-full py-2 px-4 border border-gray-300 flex items-center justify-center rounded hover:bg-gray-100 transition"
        >
          <img
            src="https://www.svgrepo.com/show/475656/google-color.svg"
            alt="Google logo"
            className="w-5 h-5 mr-2"
          />
          <span className="text-sm font-medium text-gray-700">
            Sign in with Google
          </span>
        </button>

        <p className="text-sm text-gray-600 mt-2">
          Don't have an account?{" "}
          <a href="/admin/signup" className="text-amber-600 underline">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
