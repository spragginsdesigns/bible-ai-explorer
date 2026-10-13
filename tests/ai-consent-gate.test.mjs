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
  assert.equal(consentPolicy("/api/reading-log/reflection", "GET"), "automatic");
  assert.equal(consentPolicy("/api/reading-log/overview", "GET"), null);
  assert.equal(consentPolicy("/api/reading-log", "GET"), null);
});
test("custom reading goals require consent while arithmetic presets remain usable", () => {
  assert.equal(consentPolicy("/api/reading-plans", "POST", { goal: "Help me study grace", days: 30 }), "tap");
  assert.equal(consentPolicy("/api/reading-plans", "POST", JSON.stringify({ goal: "Help me study grace", days: 30 })), "tap");
  assert.equal(consentPolicy("/api/reading-plans", "POST", { presetKey: "gospels-30" }), null);
  assert.equal(consentPolicy("/api/reading-plans", "POST", JSON.stringify({ presetKey: "gospels-30" })), null);
  assert.equal(consentPolicy("/api/reading-plans/p1/days/1", "POST", { done: true }), null);
});
const declinedDoc = { aiConsent: null, aiConsentDeclined: true, aiConsentRequired: 2 };
const undecided = { aiConsent: null, aiConsentDeclined: false, aiConsentRequired: 2 };
const saver = async version => version === null ? declinedDoc : agreed;
test("automatic verse studies decline quietly while a deliberate retry can ask", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: saver }); await tick();
  assert.equal(await gate.ensure(false), false); assert.equal(gate.getSnapshot().prompt, false);
  const pending = gate.ensure(true); await tick(); assert.equal(gate.getSnapshot().prompt, true);
  await gate.agree(); assert.equal(await pending, true);
});
test("No thanks asks for confirmation instead of closing the sheet", async () => {
  let writes = 0;
  const gate = new ConsentGate(); gate.configure({ load: async () => undecided, save: async version => { writes++; return saver(version); } }); await tick();
  const pending = gate.ensure(); await tick();
  gate.decline();
  assert.equal(gate.getSnapshot().prompt, true); assert.equal(gate.getSnapshot().confirming, true); assert.equal(writes, 0);
  gate.back(); assert.equal(gate.getSnapshot().confirming, false);
  gate.decline(); await gate.confirmDecline();
  assert.equal(await pending, false); assert.equal(writes, 1);
  assert.equal(gate.getSnapshot().prompt, false); assert.equal(gate.getSnapshot().declined, true);
});
test("Allow AI on the confirmation agrees and releases the action", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => undecided, save: saver }); await tick();
  const pending = gate.ensure(); await tick(); gate.decline(); await gate.agree();
  assert.equal(await pending, true); assert.equal(gate.getSnapshot().declined, false);
});
test("a declined account is never asked again, even on a tap", async () => {
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => declinedDoc, save: saver }); await tick();
  assert.equal(gate.getSnapshot().prompt, false);
  assert.equal(await gate.ensure(true), false); assert.equal(gate.getSnapshot().prompt, false);
  await gate.refresh(); assert.equal(gate.getSnapshot().prompt, false);
});
test("the sheet opens by itself once for an account that never chose", async () => {
  let server = undecided;
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => server, save: async version => (server = await saver(version)) }); await tick();
  assert.equal(gate.getSnapshot().prompt, true);
  gate.decline(); await gate.confirmDecline();
  assert.equal(gate.getSnapshot().prompt, false);
  await gate.refresh(); assert.equal(gate.getSnapshot().prompt, false);
});
test("the launch sheet waits for a server that records a no, and never shows to guests or allowed accounts", async () => {
  for (const [askOnLaunch, doc] of [[true, none], [true, agreed], [false, undecided]]) {
    const gate = new ConsentGate(); gate.configure({ askOnLaunch, load: async () => doc, save: saver }); await tick();
    assert.equal(gate.getSnapshot().prompt, false, JSON.stringify(doc));
  }
});
test("automatic actions started while the sheet is up wait for its answer", async () => {
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => undecided, save: saver }); await tick();
  const automatic = gate.ensure(false); const tap = gate.ensure(true); await tick();
  await gate.agree(); assert.equal(await automatic, true); assert.equal(await tap, true);
});
test("Settings can turn AI back on after a no", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => declinedDoc, save: saver }); await tick();
  gate.reconsider(); assert.equal(gate.getSnapshot().prompt, true);
  await gate.agree(); assert.equal(await gate.ensure(false), true);
});
test("agreement waits for successful server recording, then releases every waiting action once", async () => {
  const saved = deferred(); let writes = 0;
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => { writes++; return saved.promise; } }); await tick();
  const pending = gate.ensure(); const second = gate.ensure(); await tick();
  const saving = gate.agree(); void gate.agree(); assert.equal(writes, 1);
  let sent = false; void pending.then(value => { sent = value; }); await tick(); assert.equal(sent, false);
  saved.resolve(agreed); await saving; assert.equal(await pending, true); assert.equal(await second, true); assert.equal(await gate.ensure(false), true);
});
test("a failed consent write keeps the sheet open and never grants permission", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: async () => { throw new Error("offline"); } }); await tick();
  const pending = gate.ensure(); await tick(); await gate.agree();
  assert.equal(gate.getSnapshot().prompt, true); assert.equal(gate.getSnapshot().error, "offline");
  // Offline, "No thanks" closes the sheet unrecorded instead of trapping the person.
  gate.decline();
  assert.equal(gate.getSnapshot().prompt, false); assert.equal(gate.getSnapshot().declined, false);
  assert.equal(await pending, false);
});
test("account switching cancels a pending action and drops the previous account's consent", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: saver }); await tick();
  const pending = gate.ensure(); await tick(); gate.configure({ load: async () => none, save: saver });
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
  gate.configure({ load: async () => ++reads === 1 ? slow.promise : none, save: saver });
  const pending = gate.ensure(); await tick(); await gate.agree(); assert.equal(await pending, true);
  slow.resolve(none); await tick(); assert.equal(await gate.ensure(false), true);
});
test("turning AI off in Settings is recorded as a no and a stale concurrent read cannot restore it", async () => {
  const slow = deferred(); let reads = 0; const gate = new ConsentGate();
  gate.configure({ load: async () => ++reads === 1 ? agreed : slow.promise, save: saver }); await tick();
  const refresh = gate.refresh(); await gate.withdraw(); slow.resolve(agreed); await refresh;
  assert.equal(gate.getSnapshot().declined, true);
  assert.equal(await gate.ensure(true), false); assert.equal(gate.getSnapshot().prompt, false);
});
test("an agreement to older copy still counts: the sheet is asked once, ever", async () => {
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => ({ aiConsent: { version: 1, acceptedAt: "2026-10-07T00:00:00Z" }, aiConsentDeclined: false, aiConsentRequired: 2 }), save: saver }); await tick();
  assert.equal(await gate.ensure(false), true); assert.equal(gate.getSnapshot().prompt, false);
});
test("the SDK account can revoke the old grant before React reconfigures the store", async () => {
  let currentAccount = true;
  const gate = new ConsentGate(); gate.configure({ isCurrentAccount: () => currentAccount, load: async () => agreed, save: saver }); await tick();
  const session = gate.sessionId;
  assert.equal(await gate.ensure(false), true);
  currentAccount = false;
  assert.equal(gate.sessionId, session);
  assert.equal(gate.isCurrentAccount(), false);
  assert.equal(await gate.ensure(), false);
});
test("aborting a waiting action drops it without answering the sheet for anyone", async () => {
  const gate = new ConsentGate(); gate.configure({ load: async () => none, save: saver }); await tick();
  const controller = new AbortController(); const pending = gate.ensure(true, controller.signal); await tick();
  const other = gate.ensure(); await tick();
  controller.abort(); assert.equal(await pending, false); assert.equal(gate.getSnapshot().prompt, true);
  await gate.agree(); assert.equal(await other, true);
});
test("a cached copy read offline never opens the launch sheet", async () => {
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => ({ ...undecided, stale: true }), save: saver }); await tick();
  assert.equal(gate.getSnapshot().prompt, false);
});
test("after a failed save, Back or Escape closes the sheet unrecorded so nobody is trapped offline", async () => {
  let writes = 0;
  const gate = new ConsentGate(); gate.configure({ askOnLaunch: true, load: async () => undecided, save: async () => { writes++; throw new Error("offline"); } }); await tick();
  const pending = gate.ensure(); await tick();
  gate.decline(); await gate.confirmDecline();
  assert.equal(gate.getSnapshot().prompt, true); assert.equal(gate.getSnapshot().error, "offline");
  gate.back();
  assert.equal(gate.getSnapshot().prompt, false); assert.equal(await pending, false);
  assert.equal(gate.getSnapshot().declined, false); assert.equal(writes, 1);
});
