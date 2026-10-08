import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const source = read("../src/lib/ai-consent-gate.ts").split("/** Used by web REST")[0];
const { ConsentGate, consentPolicy } = new Function("AI_CONSENT_VERSION", stripTypeScriptTypes(source.replace(/^import[^;]+;\s*/m, "").replace(/^export /gm, "")) + "\nreturn { ConsentGate, consentPolicy };")(2);
const agreed = { aiConsent: { version: 2, acceptedAt: "2026-10-08T20:00:00Z" }, aiConsentRequired: 2 };
const none = { aiConsent: null, aiConsentRequired: 2 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("mobile and web run the identical consent state machine", () => {
  assert.equal(read("../mobile/src/lib/aiConsentGate.ts"), source.replace('from "./ai-consent"', 'from "./aiConsent"'));
});
test("reading, stored audio, ordinary saves and external upload URLs aren't AI calls", () => {
  for (const [path, method] of [["/api/bible/chapter", "GET"], ["/api/bible/audio", "GET"], ["/api/verse-of-day/audio", "GET"], ["/api/notes/n1", "PATCH"], ["/api/preferences", "PATCH"], ["/api/conversations/c1", "GET"], ["/api/chat/attachments/a1", "DELETE"]]) assert.equal(consentPolicy(path, method), null);
});
test("chat, note AI, audio transcription and narration need an explicit consent gate", () => {
  for (const path of ["/api/ask-question", "/api/guest/ask", "/api/note-ai", "/api/notes/n1/ai", "/api/chat/attachments", "/api/chat/attachments/a1/complete", "/api/memories/summary", "/api/verse-of-day/audio"]) assert.equal(consentPolicy(path, "POST"), "tap", path);
  assert.equal(consentPolicy("/api/verse-insight", "POST"), "automatic");
  assert.equal(consentPolicy("/api/verse-words", "POST"), "automatic");
});
test("custom reading goals require consent while arithmetic presets remain usable", () => {
  assert.equal(consentPolicy("/api/reading-plans", "POST", { goal: "Help me study grace", days: 30 }), "tap");
  assert.equal(consentPolicy("/api/reading-plans", "POST", JSON.stringify({ goal: "Help me study grace", days: 30 })), "tap");
  assert.equal(consentPolicy("/api/reading-plans", "POST", { presetKey: "gospels-30" }), null);
  assert.equal(consentPolicy("/api/reading-plans", "POST", JSON.stringify({ presetKey: "gospels-30" })), null);
  assert.equal(consentPolicy("/api/reading-plans/p1/days/1", "POST", { done: true }), null);
});
test("automatic verse studies decline quietly while a deliberate retry can ask", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => agreed }); await tick();
  assert.equal(await gate.ensure(false), false); assert.equal(gate.getSnapshot().prompt, false);
  const pending = gate.ensure(true); await tick(); assert.equal(gate.getSnapshot().prompt, true);
  gate.decline(); assert.equal(await pending, false);
});
test("agreement waits for successful server recording, then releases exactly one action", async () => {
  const saved = deferred(); let writes = 0;
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => { writes++; return saved.promise; } }); await tick();
  const pending = gate.ensure(); await tick();
  assert.equal(await gate.ensure(), false);
  const saving = gate.agree(); void gate.agree(); assert.equal(writes, 1);
  let sent = false; void pending.then(value => { sent = value; }); await tick(); assert.equal(sent, false);
  saved.resolve(agreed); await saving; assert.equal(await pending, true); assert.equal(await gate.ensure(false), true);
});
test("a failed consent write keeps the sheet open and never grants permission", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => { throw new Error("offline"); } }); await tick();
  const pending = gate.ensure(); await tick(); await gate.agree();
  assert.equal(gate.getSnapshot().prompt, true); assert.equal(gate.getSnapshot().error, "offline");
  gate.decline(); assert.equal(await pending, false);
});
test("account switching cancels a pending action and drops the previous account's consent", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => agreed }); await tick();
  const pending = gate.ensure(); await tick(); gate.configure({ load: async () => none, save: async () => agreed });
  assert.equal(await pending, false); await tick(); assert.equal(await gate.ensure(false), false);
});
test("a consent save completing after sign-out cannot unlock the new session", async () => {
  const saved = deferred(); const gate = new ConsentGate();
  gate.configure({ load: async () => none, save: async () => saved.promise }); await tick();
  const pending = gate.ensure(); await tick(); const saving = gate.agree(); gate.configure(null);
  saved.resolve(agreed); await saving; assert.equal(await pending, false); assert.equal(gate.getSnapshot().record, null);
});
test("a slow startup read cannot undo a newer agreement", async () => {
  const slow = deferred(); let reads = 0; const gate = new ConsentGate();
  gate.configure({ load: async () => ++reads === 1 ? slow.promise : none, save: async () => agreed });
  const pending = gate.ensure(); await tick(); await gate.agree(); assert.equal(await pending, true);
  slow.resolve(none); await tick(); assert.equal(await gate.ensure(false), true);
});
test("withdrawal clears permission and a stale concurrent read cannot restore it", async () => {
  const slow = deferred(); let reads = 0; const gate = new ConsentGate();
  gate.configure({ load: async () => ++reads === 1 ? agreed : slow.promise, save: async () => none }); await tick();
  const refresh = gate.refresh(); await gate.withdraw(); slow.resolve(agreed); await refresh;
  assert.equal(await gate.ensure(false), false);
});
test("an old disclosure is not sufficient for the current provider list", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => ({ aiConsent: { version: 1, acceptedAt: "2026-10-07T00:00:00Z" }, aiConsentRequired: 1 }), save: async () => agreed }); await tick();
  assert.equal(await gate.ensure(false), false); assert.equal(gate.getSnapshot().required, 2);
});
test("the SDK account can revoke the old grant before React reconfigures the store", async () => {
  let currentAccount = true;
  const gate = new ConsentGate(); gate.configure({ isCurrentAccount: () => currentAccount, load: async () => agreed, save: async () => agreed }); await tick();
  const session = gate.sessionId;
  assert.equal(await gate.ensure(false), true);
  currentAccount = false;
  assert.equal(gate.sessionId, session);
  assert.equal(gate.isCurrentAccount(), false);
  assert.equal(await gate.ensure(), false);
});
test("aborting a waiting action closes its disclosure and never grants it", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => agreed }); await tick();
  const controller = new AbortController(); const pending = gate.ensure(true, controller.signal); await tick();
  controller.abort(); assert.equal(await pending, false); assert.equal(gate.getSnapshot().prompt, false);
});
test("a save finishing after an aborted action cannot release a later action", async () => {
  const saved = deferred(); const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => saved.promise }); await tick();
  const controller = new AbortController(); const first = gate.ensure(true, controller.signal); await tick(); const save = gate.agree(); controller.abort();
  const second = gate.ensure(); await tick(); saved.resolve(agreed); await save;
  assert.equal(await first, false); assert.equal(gate.getSnapshot().prompt, true); gate.decline(); assert.equal(await second, false);
});
