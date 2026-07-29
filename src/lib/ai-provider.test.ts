import { describe, it, expect, afterEach } from "vitest";
import {
  LOCAL_TIMEOUT_MS,
  cloudAvailable,
  localBaseUrl,
  preferredProvider,
} from "@/lib/ai-provider";

const KEYS = [
  "OLLAMA_BASE_URL",
  "AI_SCAN_PROVIDER",
  "AI_COACH_PROVIDER",
  "ANTHROPIC_API_KEY",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("localBaseUrl", () => {
  it("is null when unset, so production stays on the cloud by default", () => {
    expect(localBaseUrl()).toBeNull();
  });

  it("ignores whitespace-only values rather than treating them as a URL", () => {
    process.env.OLLAMA_BASE_URL = "   ";
    expect(localBaseUrl()).toBeNull();
  });

  it("strips a trailing slash so path joins never double up", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/";
    expect(localBaseUrl()).toBe("http://127.0.0.1:11434");
  });
});

describe("preferredProvider", () => {
  it("is cloud for both surfaces when no local URL is configured", () => {
    expect(preferredProvider("scan")).toBe("cloud");
    expect(preferredProvider("coach")).toBe("cloud");
  });

  it("is local for both surfaces once a local URL exists", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    expect(preferredProvider("scan")).toBe("local");
    expect(preferredProvider("coach")).toBe("local");
  });

  it("lets the scanner be pinned to the cloud while the coach stays local", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.AI_SCAN_PROVIDER = "cloud";
    expect(preferredProvider("scan")).toBe("cloud");
    expect(preferredProvider("coach")).toBe("local");
  });

  it("honours a local override even with no base URL, so the failure is loud", () => {
    process.env.AI_SCAN_PROVIDER = "local";
    expect(preferredProvider("scan")).toBe("local");
  });

  it("ignores a value that is neither local nor cloud instead of guessing", () => {
    process.env.AI_COACH_PROVIDER = "ollama";
    expect(preferredProvider("coach")).toBe("cloud");
  });
});

describe("cloudAvailable", () => {
  it("is false without a key, so callers do not promise a fallback that cannot happen", () => {
    expect(cloudAvailable()).toBe(false);
  });

  it("is true with a key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(cloudAvailable()).toBe(true);
  });
});

describe("LOCAL_TIMEOUT_MS", () => {
  // The scan route declares maxDuration 30s. A cloud scan measured p95 7.6s in
  // production, so the local attempt plus a full cloud retry has to fit.
  it("leaves room for a cloud fallback inside the scan route's 30s budget", () => {
    expect(LOCAL_TIMEOUT_MS.scan / 1000 + 7.6).toBeLessThan(30);
  });

  it("gives the coach longer, since its route allows 60s", () => {
    expect(LOCAL_TIMEOUT_MS.coach).toBeGreaterThan(LOCAL_TIMEOUT_MS.scan);
  });
});
