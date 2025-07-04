import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
//import { useToast } from "../../components/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function SignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSignup = async (e) => {
    e.preventDefault();

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    console.log("error", error);

    if (error) {
      sessionStorage.setItem(
        "toastData",
        JSON.stringify({
          title: "Signup Failed",
          description: error.message,
          icon: "⚠️",
        })
      );
    } else {
      sessionStorage.setItem(
        "toastData",
        JSON.stringify({
          title: "Signup Success",
          description: "Please check your inbox to verify your account.",
          icon: "✅",
        })
      );
      navigate("/admin/login");
    }
  };


  useEffect(() => {
    console.log("[SignupPage] useEffect");
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
          Create an Account
        </h2>
        <form onSubmit={handleSignup} className="space-y-4 text-left">
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
            className="w-full py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
          >
            Sign Up
          </button>
        </form>
        <p className="text-sm text-gray-600">
          Already have an account?{" "}
          <a href="/admin/login" className="text-amber-600 underline">
            Login
          </a>
        </p>
      </div>
    </div>
  );
}
