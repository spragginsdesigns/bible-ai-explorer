import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { setImmediate as nextTurn } from "node:timers/promises";

const source = readFileSync(new URL("../src/components/connections/useConnectionsExplain.ts", import.meta.url), "utf8")
  .replace(/^import[^;]+;\s*$/gm, "")
  .replace(/^export /gm, "");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Execute the production hook, retaining its state/ref cells between renders. */
function mountHook(fetcher) {
  const states = [];
  const refs = [];
  const cleanups = [];
  let stateIndex = 0;
  let refIndex = 0;
  let mounted = false;
  const dependencies = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useCallback(callback) { return callback; },
    useEffect(effect) { if (!mounted) cleanups.push(effect()); },
    consentFetch: fetcher,
    readModelPref: () => null,
  };
  const useHook = new Function(...Object.keys(dependencies), `${stripTypeScriptTypes(source)}\nreturn useConnectionsExplain;`)(...Object.values(dependencies));
  const render = () => {
    stateIndex = 0; refIndex = 0;
    const result = useHook();
    mounted = true;
    return result;
  };
  return { render, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}

const john = { reference: "John 3:16", translation: "KJV", section: null };
const romans = { reference: "Romans 8:1", translation: "KJV", section: null };

for (const failBody of [false, true]) {
  for (const completeNewerFirst of [false, true]) {
    test(`a stale ${failBody ? "rejected" : "parsed"} error body cannot replace a newer ${completeNewerFirst ? "completed" : "loading"} explanation`, async () => {
      const oldBody = deferred();
      let bodyStarted = false;
      let newerController;
      const requests = [];
      const hook = mountHook(async (_url, init) => {
        requests.push({ body: JSON.parse(init.body), signal: init.signal });
        if (requests.length === 1) return { ok: false, json: () => { bodyStarted = true; return oldBody.promise; } };
        return new Response(new ReadableStream({ start(controller) { newerController = controller; } }));
      });
      hook.render().start(john);
      await nextTurn();
      assert.equal(bodyStarted, true, "the old request is awaiting its delayed error body");
      hook.render().reset();
      hook.render().start(romans);
      await nextTurn();
      assert.equal(requests[0].signal.aborted, true);
      assert.equal(requests[1].body.reference, romans.reference);
      const finishNewer = async () => {
        newerController.enqueue(new TextEncoder().encode("No condemnation in Christ Jesus."));
        newerController.close();
        await nextTurn();
        assert.equal(hook.render().status, "done");
      };
      if (completeNewerFirst) await finishNewer();
      if (failBody) oldBody.reject(new Error("old error body disconnected"));
      else oldBody.resolve({ error: "John explanation failed" });
      await nextTurn();
      const current = hook.render();
      assert.equal(current.status, completeNewerFirst ? "done" : "loading");
      assert.equal(current.error, null);
      assert.equal(current.text, completeNewerFirst ? "No condemnation in Christ Jesus." : "");
      if (!completeNewerFirst) await finishNewer();
      hook.unmount();
    });
  }
}

test("closing or unmounting during an error body read never publishes its failure", async () => {
  for (const close of ["reset", "unmount"]) {
    const body = deferred();
    const hook = mountHook(async () => ({ ok: false, json: () => body.promise }));
    hook.render().start(john);
    await nextTurn();
    if (close === "reset") hook.render().reset();
    else hook.unmount();
    body.resolve({ error: "The closed request failed" });
    await nextTurn();
    assert.equal(hook.render().error, null);
    assert.equal(hook.render().status, close === "reset" ? "idle" : "loading");
  }
});
