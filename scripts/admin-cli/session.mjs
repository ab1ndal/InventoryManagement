/**
 * Admin CLI login session. The CLI never holds the service-role key: it signs
 * in as an admin user with the public anon key, so every command runs under
 * the same RLS policies and admin-role check as the admin app
 * (src/admin/components/RequireAdminAuth.jsx).
 *
 * `login` stores the session (access + refresh token, no password) in
 * ~/.config/bindals-admin-cli/session.json, readable only by the OS user
 * (dir 0700, file 0600). Each command restores it, refreshes the access token
 * if needed (Supabase rotates refresh tokens, so the new pair is written
 * back), and re-checks the role, so revoking an admin takes effect on their
 * next command.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const ADMIN_ROLES = ["admin", "superadmin"];

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export function sessionPath(env = process.env) {
  return env.ADMIN_CLI_SESSION || path.join(os.homedir(), ".config", "bindals-admin-cli", "session.json");
}

function readSession(file) {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  // Refuse a session file others can read: it grants admin access.
  if ((st.mode & 0o077) !== 0) {
    throw new AuthError(`${file} is readable by other users; delete it and log in again`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeSession(file, session) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const data = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user_id: session.user.id,
    email: session.user.email,
  };
  // Write-then-rename so a crash never leaves a half-written token file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function anonClient({ url, anonKey }) {
  if (!url || !anonKey) {
    throw new AuthError("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY in .env");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Throws AuthError unless the signed-in user is an active admin/superadmin. */
export async function assertAdmin(client, userId) {
  const { data, error } = await client
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new AuthError(`Could not check admin role: ${error.message}`);
  if (!data || !ADMIN_ROLES.includes(data.role) || data.is_active === false) {
    throw new AuthError("This account is not an active admin");
  }
  return data.role;
}

/** Signs in with email + password, checks the role, stores the session. */
export async function login({ url, anonKey, email, password, file = sessionPath() }) {
  const client = anonClient({ url, anonKey });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new AuthError(`Login failed: ${error.message}`);
  try {
    const role = await assertAdmin(client, data.user.id);
    writeSession(file, data.session);
    return { email: data.user.email, user_id: data.user.id, role, session_file: file };
  } catch (e) {
    await client.auth.signOut();
    throw e;
  }
}

/**
 * A client signed in as the stored admin session, or AuthError if there is
 * none, it has expired, or the user is no longer an admin.
 */
export async function authedClient({ url, anonKey, file = sessionPath() }) {
  const stored = readSession(file);
  if (!stored) {
    throw new AuthError("Not logged in. In your own terminal run: node scripts/admin-cli.mjs login --email <you>");
  }
  const client = anonClient({ url, anonKey });
  const { data, error } = await client.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  });
  if (error || !data.session) {
    throw new AuthError(`Session expired or revoked (${error?.message ?? "no session"}); log in again`);
  }
  if (data.session.refresh_token !== stored.refresh_token) writeSession(file, data.session);
  const role = await assertAdmin(client, data.session.user.id);
  return { client, user: { email: data.session.user.email, user_id: data.session.user.id, role } };
}

/** Revokes the stored session server-side (best effort) and deletes the file. */
export async function logout({ url, anonKey, file = sessionPath() }) {
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  if (stored) {
    const client = anonClient({ url, anonKey });
    const { error } = await client.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    if (!error) await client.auth.signOut();
    fs.rmSync(file, { force: true });
  }
  return { logged_out: Boolean(stored), session_file: file };
}

/** Reads a password from the terminal without echoing it. */
export function promptHidden(question) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    return Promise.reject(
      new AuthError("login needs an interactive terminal to type the password (it is never read from arguments or files)"),
    );
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stderr.write("\n");
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new AuthError("Login cancelled")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
