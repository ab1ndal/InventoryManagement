import { useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useToast } from "../../components/hooks/use-toast";

export default function UserRegistration() {
  const { toast } = useToast();

  useEffect(() => {
    const handleUserRegistration = async (session) => {
      if (!session?.user) return;

      try {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (profileData) {
          //console.log("[UserRegistration] Profile exists:", profileData);
          return;
        }

        if (
          profileError?.code === "PGRST116" ||
          profileError?.message?.includes("No rows")
        ) {
          const { error: insertError } = await supabase
            .from("profiles")
            .insert([
              {
                id: session.user.id,
                email: session.user.email,
                role: "user",
              },
            ]);

          if (insertError) {
            toast({
              title: "Error",
              description: "Could not create your user profile.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Welcome",
              description: "Your user profile was created successfully.",
            });
          }
        }
      } catch (err) {
        toast({
          title: "Error",
          description: err.message,
          variant: "destructive",
        });
      }
    };

    const waitForSession = async () => {
      let attempts = 0;
      while (attempts < 10) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          //console.log("[UserRegistration] Session restored after retry");
          handleUserRegistration(session);
          return;
        }
        //console.log(`[UserRegistration] Waiting for session... retry ${attempts + 1}`);
        await new Promise((res) => setTimeout(res, 500));
        attempts++;
      }
      console.warn("[UserRegistration] Session was never restored");
    };

    waitForSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        //console.log("[UserRegistration] Auth change:", _event, session);
        if (session) {
          handleUserRegistration(session);
        }
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [toast]);

  return null;
}
