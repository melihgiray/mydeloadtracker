"use client";

import { useEffect } from "react";

// Registers the service worker so the app is installable as a PWA. Only runs in
// production (e.g. on Vercel) — in local dev it's a no-op so it never interferes
// with hot reload.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
