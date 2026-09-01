/**
 * Regression guard: the LLMLingua worker must construct successfully via
 * `new Worker(pathToFileURL(file), opts)`.
 *
 * Root cause: `worker.ts` previously called
 * `new Worker(pathToFileURL(absoluteWorkerFile).href, { execArgv })` — passing the
 * `.href` STRING of the file URL, not the `URL` object itself. Node's
 * `worker_threads.Worker` constructor rejects a `file://` string passed this way:
 *
 *   TypeError: The worker script or module filename must be an absolute path or a
 *   relative path starting with './' or '../'. Wrap file:// URLs with `new URL`.
 *
 * That throw happened synchronously inside `ensureWorker()`, was caught by the
 * surrounding `try/catch` in the dispatch-queue logic, and silently fail-opened —
 * the worker never spawned, no error surfaced anywhere, and `workerBackend()` simply
 * returned the original, uncompressed text every single call, indistinguishable from
 * "nothing to compress." Confirmed live: enabling `--import tsx/esm` and hitting the
 * real preview endpoint reproduced this exact TypeError once the surrounding fail-open
 * `catch` blocks were instrumented.
 *
 * `workerBackend()` is documented as STRICTLY fail-open (never rejects), so this test
 * cannot assert on a thrown error directly. Instead it uses timing as the
 * discriminator: a synchronous constructor throw fail-opens in single-digit
 * milliseconds; a genuine `worker_threads` spawn (creating a new V8 isolate and
 * loading the entry script) inherently takes tens of milliseconds at minimum, even
 * before any model loading begins. The margin between the two is large enough to be a
 * reliable, non-flaky signal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  workerBackend,
  __resetLlmlinguaWorkerForTests,
} from "../../../open-sse/services/compression/engines/llmlingua/worker.ts";

const require = createRequire(import.meta.url);

/** Whether all three optional deps resolve in this environment. */
function depsResolve(): boolean {
  try {
    require.resolve("@atjsh/llmlingua-2");
    require.resolve("@huggingface/transformers");
    require.resolve("js-tiktoken");
    return true;
  } catch {
    return false;
  }
}

test("workerBackend genuinely attempts a worker spawn when deps are present (does not fail-open synchronously)", async () => {
  if (!depsResolve()) {
    console.log("skip: optional deps absent in this environment");
    return;
  }

  __resetLlmlinguaWorkerForTests();

  const input =
    "The quick brown fox jumps over the lazy dog while the sun sets slowly behind the distant hills.";

  const start = Date.now();
  await workerBackend(input, {});
  const elapsed = Date.now() - start;

  // A broken `new Worker(...)` call throws synchronously and fail-opens in low
  // single-digit milliseconds. A genuine spawn attempt — even one that ultimately
  // fails later for an unrelated reason (no network for the model download, etc.) —
  // cannot possibly settle this fast, because creating the worker thread itself has
  // real overhead. This is the regression signal for the `.href` constructor bug.
  assert.ok(
    elapsed >= 20,
    `expected a genuine worker spawn attempt (>=20ms), got ${elapsed}ms — ` +
      "this fast almost certainly means the Worker constructor threw synchronously " +
      "and fail-opened without ever spawning (the .href regression)"
  );

  __resetLlmlinguaWorkerForTests();
});
