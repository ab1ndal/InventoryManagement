import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

export default function UnauthorizedPage() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserEmail(user.email);
    })();
  }, []);

  const handleLogout = async () => {
    sessionStorage.setItem(
      "toastData",
      JSON.stringify({
        title: "Logout Success",
        description: "Logged out successfully.",
        icon: "✅",
      })
    );
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  return (
    <div className="h-screen bg-red-50 flex flex-col">
      {/* Top Left Logout Section */}
      <div className="flex justify-start p-4">
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          {userEmail && <span className="hidden sm:inline">{userEmail}</span>}
          <button
            onClick={handleLogout}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Centered Main Message */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-700">Access Denied</h1>
          <p className="text-gray-600">You do not have admin privileges.</p>
        </div>
      </div>
    </div>
  );
}
