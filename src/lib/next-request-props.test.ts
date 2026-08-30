import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.name === "page.tsx" ? [path] : [];
  });
}

describe("Next request props", () => {
  it("keeps every App Router page on the asynchronous Next 15+ contract", () => {
    const appRoot = join(process.cwd(), "src/app");
    const synchronous = pageFiles(appRoot)
      .filter((file) => /\b(?:params|searchParams)\s*:\s*\{/.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));

    expect(synchronous).toEqual([]);
  });
});
