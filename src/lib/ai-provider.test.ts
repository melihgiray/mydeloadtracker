import { describe, it, expect, afterEach } from "vitest";
import {
  LOCAL_MODELS,
  LOCAL_TIMEOUT_MS,
  cloudAvailable,
  localBaseUrl,
  preferredProvider,
} from "@/lib/ai-provider";

const KEYS = [
  "OLLAMA_BASE_URL",
  "AI_SCAN_PROVIDER",
  "AI_COACH_PROVIDER",
  "AI_PLAN_PROVIDER",
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

// The planner is opt-in only, and the reason is measured rather than a
// preference. See docs/AUDIT_2026-07-29_pr3.md: a plan is a one-shot
// non-streaming call of 1,600 to 2,600 output tokens, which ran 80 to 95
// seconds locally. It must not switch on just because Ollama is reachable.
describe("the plan surface is opt-in only", () => {
  it("stays on the cloud even when a local URL is configured", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    expect(preferredProvider("plan")).toBe("cloud");
    // The other two DO follow the base URL, which is the contrast that matters.
    expect(preferredProvider("coach")).toBe("local");
    expect(preferredProvider("scan")).toBe("local");
  });

  it("goes local only when named explicitly", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.AI_PLAN_PROVIDER = "local";
    expect(preferredProvider("plan")).toBe("local");
  });

  it("stays on the cloud with no local URL at all", () => {
    expect(preferredProvider("plan")).toBe("cloud");
  });

  it("ignores a value that is neither local nor cloud", () => {
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    process.env.AI_PLAN_PROVIDER = "ollama";
    expect(preferredProvider("plan")).toBe("cloud");
  });

  it("does not let the coach override leak into the planner", () => {
    process.env.AI_COACH_PROVIDER = "local";
    expect(preferredProvider("plan")).toBe("cloud");
  });
});

describe("plan timeout and model", () => {
  // A streaming call's timeout bounds the connection. A one-shot call's bounds
  // the whole generation, so the planner needs its own far larger budget.
  it("gives the planner a budget that covers a measured 94.6s generation", () => {
    expect(LOCAL_TIMEOUT_MS.plan).toBeGreaterThan(94_600);
  });

  it("is far larger than the streaming coach budget", () => {
    expect(LOCAL_TIMEOUT_MS.plan).toBeGreaterThan(LOCAL_TIMEOUT_MS.coach * 4);
  });

  it("falls back to the coach model when no plan model is named", () => {
    expect(LOCAL_MODELS.plan).toBeTruthy();
  });
});
