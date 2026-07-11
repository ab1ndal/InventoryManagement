jest.mock("lib/supabaseClient");

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { supabase } from "lib/supabaseClient";
import { StorefrontAuthProvider, useStorefrontAuth } from "../context/StorefrontAuthContext";

function Probe() {
  const { signInWithOtp } = useStorefrontAuth();
  return <button onClick={() => signInWithOtp("a@b.com")}>go</button>;
}

describe("StorefrontAuthContext", () => {
  beforeEach(() => {
    const listeners = [];
    supabase.auth = {
      getSession: jest.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: jest.fn((cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signInWithOtp: jest.fn(async () => ({ error: null })),
      signOut: jest.fn(async () => ({ error: null })),
    };
  });

  it("requests a magic link redirecting to /account", async () => {
    render(
      <StorefrontAuthProvider>
        <Probe />
      </StorefrontAuthProvider>
    );
    await act(async () => {
      screen.getByText("go").click();
    });
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      options: { emailRedirectTo: expect.stringContaining("/account") },
    });
  });
});
