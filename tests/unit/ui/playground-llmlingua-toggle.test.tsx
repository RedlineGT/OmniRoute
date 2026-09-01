// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

let container: HTMLElement;
let root: Root;
let fetchCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver ||=
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push(body);
      const engine = body.engineId ?? "combo";
      return {
        ok: true,
        json: async () => ({
          original: "o",
          compressed: "c",
          originalTokens: 10,
          compressedTokens: 6,
          savingsPct: 40,
          mode: "stacked",
          durationMs: 1,
          engineBreakdown: [
            { engine, originalTokens: 10, compressedTokens: 6, savingsPercent: 40, techniquesUsed: [] },
          ],
          diff: [],
          preservedBlocks: [],
          ruleRemovals: [],
          validation: { valid: true, errors: [], warnings: [], fallbackApplied: false },
        }),
      } as any;
    })
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Studio llmlingua toggle", () => {
  it("includes llmlingua in the real (non-overridden) LANE_ENGINES list", async () => {
    const { LANE_ENGINES } = await import(
      "@/app/(dashboard)/dashboard/compression/studio/PlaygroundInput"
    );
    expect(LANE_ENGINES).toContain("llmlingua");
  });

  it("renders the llmlingua checkbox enabled and wired via checked/onChange, not as a static disabled stub", async () => {
    const { PlayView } = await import("@/app/(dashboard)/dashboard/compression/studio/PlayView");
    await act(async () => {
      root.render(<PlayView text="hello world" onText={() => {}} />);
    });
    const toggle = container.querySelector(
      '[data-testid="engine-toggle-llmlingua"]'
    ) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(false);
  });

  it("toggling llmlingua on and running includes it in both the per-lane and combined preview requests", async () => {
    const { PlayView } = await import("@/app/(dashboard)/dashboard/compression/studio/PlayView");
    await act(async () => {
      root.render(<PlayView text="hello world" onText={() => {}} />);
    });
    const toggle = container.querySelector(
      '[data-testid="engine-toggle-llmlingua"]'
    ) as HTMLInputElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const runBtn = container.querySelector('[data-testid="play-run"]') as HTMLButtonElement;
    await act(async () => {
      runBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const perLaneCall = fetchCalls.find((c) => c.engineId === "llmlingua");
    expect(perLaneCall).toBeTruthy();

    const combinedCall = fetchCalls.find((c) => Array.isArray(c.pipeline));
    expect(combinedCall).toBeTruthy();
    expect(combinedCall!.pipeline).toContain("llmlingua");
  });
});
