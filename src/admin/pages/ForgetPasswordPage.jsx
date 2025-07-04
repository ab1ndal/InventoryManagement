// src/admin/pages/ForgotPasswordPage.jsx
import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");

  const handleReset = async (e) => {
    e.preventDefault();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Reset Link Sent",
        description: "Check your inbox for a password reset link.",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-amber-100">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 text-center space-y-6">
        <h2 className="text-2xl font-semibold text-amber-700">
          Forgot Password
        </h2>
        <form onSubmit={handleReset} className="space-y-4 text-left">
          <input
            type="email"
            required
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded text-sm"
          />
          <button
            type="submit"
            className="w-full py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
          >
            Send Reset Link
          </button>
        </form>
        <p className="text-sm text-gray-600">
          <a href="/admin/login" className="text-amber-600 underline">
            Back to Login
          </a>
        </p>
      </div>
    </div>
  );
}
