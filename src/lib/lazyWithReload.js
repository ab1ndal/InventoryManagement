import { lazy } from "react";

const RELOADED_KEY = "chunk_reload_attempted";

// A deploy removes the previous build's files, so a tab left open can ask for code that no longer exists.
// Reloading fetches the current build. Only once per session: if the file is still missing the failure is
// real, and reloading again would loop forever.
export function retryAfterReload(load) {
  return load().then(
    (module) => {
      sessionStorage.removeItem(RELOADED_KEY);
      return module;
    },
    (error) => {
      if (sessionStorage.getItem(RELOADED_KEY)) throw error;
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
      return new Promise(() => {});
    }
  );
}

export const lazyWithReload = (load) => lazy(() => retryAfterReload(load));
