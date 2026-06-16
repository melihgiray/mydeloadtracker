"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Watch } from "lucide-react";
import { capture } from "@/lib/track";

export function WearableConnect({
  configured,
  connected,
  lastSync,
  status,
}: {
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  status?: string;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    status === "connected"
      ? "Oura connected. Recovery data synced into your readiness score."
      : status === "error"
        ? "Couldn't connect Oura. Please try again."
        : null,
  );
  const [isError, setIsError] = useState(status === "error");

  useEffect(() => {
    if (status === "connected") capture("wearable_connected", { provider: "oura" });
  }, [status]);

  async function syncNow() {
    setSyncing(true);
    setMsg(null);
    setIsError(false);
    try {
      const res = await fetch("/api/wearables/oura/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed.");
      setMsg(`Synced ${json.synced} day${json.synced === 1 ? "" : "s"} of recovery data.`);
      router.refresh();
    } catch (e) {
      setIsError(true);
      setMsg(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="card max-w-lg">
      <div className="mb-1 flex items-center gap-2">
        <Watch className="h-5 w-5 text-brand" />
        <h2 className="font-semibold">Connected devices</h2>
      </div>
      <p className="text-sm text-muted">
        Auto-sync HRV, resting heart rate, and sleep into your readiness score.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
        <div>
          <div className="font-medium">Oura Ring</div>
          <div className="text-xs text-muted">
            {!configured
              ? "Not enabled on this server yet."
              : connected
                ? `Connected${lastSync ? ` · last sync ${new Date(lastSync).toLocaleDateString()}` : ""}`
                : "Not connected."}
          </div>
        </div>
        {!configured ? (
          <span className="text-xs text-muted">Coming soon</span>
        ) : connected ? (
          <button onClick={syncNow} disabled={syncing} className="btn-ghost flex-shrink-0">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync now
          </button>
        ) : (
          <a href="/api/wearables/oura/connect" className="btn-brand flex-shrink-0">
            Connect
          </a>
        )}
      </div>

      {msg && <p className={`mt-3 text-sm ${isError ? "text-danger" : "text-success"}`}>{msg}</p>}

      <p className="mt-3 text-xs text-muted">Whoop, Garmin, and Apple Health are on the roadmap.</p>
    </div>
  );
}
