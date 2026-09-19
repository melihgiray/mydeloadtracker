import type { ClientScanLogEvent } from "@/lib/scan-log";

const QUEUE_KEY = "mdt_scan_log_queue_v1";
const MAX_QUEUED_EVENTS = 50;

interface QueuedScanLogEvent {
  queueId: string;
  event: ClientScanLogEvent;
}

let flushing: Promise<void> | null = null;

function readQueue(): QueuedScanLogEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is QueuedScanLogEvent => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<QueuedScanLogEvent>;
      return typeof value.queueId === "string" && value.event != null;
    });
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedScanLogEvent[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_EVENTS)));
}

export function newScanAttemptId(): string {
  return crypto.randomUUID();
}

export function queueScanLog(event: ClientScanLogEvent): void {
  if (typeof window === "undefined") return;
  const queue = readQueue();
  queue.push({ queueId: crypto.randomUUID(), event });
  writeQueue(queue);
  void flushScanLogQueue();
}

export function flushScanLogQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    while (true) {
      const queued = readQueue().slice(0, 25);
      if (queued.length === 0) return;
      const response = await fetch("/api/scan/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: queued.map((item) => item.event) }),
        keepalive: true,
      });
      if (!response.ok) return;
      const sent = new Set(queued.map((item) => item.queueId));
      writeQueue(readQueue().filter((item) => !sent.has(item.queueId)));
    }
  })().catch(() => {
    // Remain queued. An online event or the next scanner mount retries it.
  }).finally(() => {
    flushing = null;
  });
  return flushing;
}

export function scanLogQueueSize(): number {
  return readQueue().length;
}
