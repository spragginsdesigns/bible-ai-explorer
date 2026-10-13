import { AI_CONSENT_VERSION } from "./ai-consent";

export interface ConsentRecord { version: number; acceptedAt: string }
/** `stale` marks a document read from the device cache because the server could not be reached. */
export interface ConsentDocument { aiConsent?: ConsentRecord | null; aiConsentDeclined?: boolean; aiConsentRequired?: number; stale?: boolean }
export interface ConsentTransport {
  isCurrentAccount?: () => boolean;
  /** Signed-in accounts raise the sheet on their own once the server says they never chose. */
  askOnLaunch?: boolean;
  load: () => Promise<ConsentDocument>;
  save: (version: number | null) => Promise<ConsentDocument>;
}
export const CONSENT_DECLINED_NOTICE = "AI is turned off for your account. You can turn it on in Settings → AI.";

/** Only calls that can send study content to a provider. Reading stored history,
 * Scripture, lexicons, preferences and existing audio is never gated. */
export function consentPolicy(path: string, method: string, body?: unknown): "tap" | "automatic" | null {
  const route = path.split("?")[0];
  const write = method.toUpperCase() === "POST";
  if (write && route === "/api/reading-plans") {
    let payload = body;
    if (typeof body === "string") { try { payload = JSON.parse(body); } catch { return "tap"; } }
    const plan = payload as { presetKey?: unknown; goal?: unknown } | null;
    return typeof plan?.presetKey === "string" && !plan.goal ? null : "tap";
  }
  if (write && (route === "/api/verse-insight" || route === "/api/verse-words")) return "automatic";
  if (route === "/api/suggested-questions" || route === "/api/reading-log/reflection") return "automatic";
  if (write && (route === "/api/ask-question" || route === "/api/guest/ask" || route === "/api/note-ai" || /^\/api\/notes\/[^/]+\/ai$/.test(route)
    || route === "/api/memories/summary" || route === "/api/verse-of-day/today"
    || route === "/api/verse-of-day/audio" || route === "/api/chat/attachments"
    || /^\/api\/chat\/attachments\/[^/]+\/complete$/.test(route))) return "tap";
  if (method.toUpperCase() === "GET" && route === "/api/verse-of-day/today") return "tap";
  return null;
}

/** The sheet is shown once per account, ever (Austin, 2026-10-13). "No thanks"
 * asks for confirmation because SureWord is mostly AI; a confirmed no is saved
 * on the account, so it is never asked again. Only Settings → AI reopens it. */
/** The sheet is shown once per account, ever (Austin, 2026-10-13). "No thanks"
 * asks for confirmation because SureWord is mostly AI; a confirmed no is saved
 * on the account, so it is never asked again. Only Settings → AI reopens it. */
export class ConsentGate {
  private state = { record: null as ConsentRecord | null, declined: false, required: AI_CONSENT_VERSION, prompt: false, confirming: false, saving: false, error: null as string | null };
  private listeners = new Set<() => void>();
  private transport: ConsentTransport | null = null;
  private session = 0;
  private hydrated = false;
  private edits = 0;
  private waiting = new Set<(granted: boolean) => void>();
  private promptSeq = 0;
  getSnapshot = () => this.state;
  get sessionId() { return this.session; }
  get allowed() { return this.state.record !== null; }
  isCurrentAccount = () => !!this.transport && (this.transport.isCurrentAccount?.() ?? true);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  configure(transport: ConsentTransport | null) {
    this.finish(false); this.session++; this.transport = transport; this.hydrated = false;
    this.update({ record: null, declined: false, required: AI_CONSENT_VERSION, prompt: false, confirming: false, saving: false, error: null });
    if (transport) void this.refresh();
  }
  private absorb(document: ConsentDocument) {
    this.hydrated = true;
    const record = document.aiConsent ?? null;
    this.update({ record, declined: !record && document.aiConsentDeclined === true, required: Math.max(AI_CONSENT_VERSION, document.aiConsentRequired ?? AI_CONSENT_VERSION) });
    // Only a server that records a no can keep the promise of asking once, and
    // never from a cached copy: offline, neither answer could be saved.
    if (this.transport?.askOnLaunch && !document.stale && !record && document.aiConsentDeclined === false && !this.state.prompt) this.open();
  }
  async refresh() {
    const session = this.session; const transport = this.transport; const edits = this.edits;
    if (!transport) return;
    try { const doc = await transport.load(); if (session === this.session && edits === this.edits) this.absorb(doc); } catch { /* Keep the account's last known consent offline. */ }
  }
  private open() { this.promptSeq++; this.update({ prompt: true, confirming: false, saving: false, error: null }); }
  async ensure(ask = true, signal?: AbortSignal | null): Promise<boolean> {
    const session = this.session;
    if (signal?.aborted) return false;
    if (!this.isCurrentAccount()) return false;
    if (this.allowed) return true;
    if (!this.hydrated) await this.refresh();
    if (session !== this.session || signal?.aborted || !this.isCurrentAccount()) return false;
    if (this.allowed) return true;
    if (this.state.declined) return false;
    // A sheet already up (the launch prompt, or another action's) answers for
    // every action waiting on it, so nothing fails while the person decides.
    if (!this.state.prompt) { if (!ask) return false; this.open(); }
    return new Promise(resolve => {
      const finish = (granted: boolean) => { signal?.removeEventListener("abort", abort); resolve(granted); };
      const abort = () => { if (this.waiting.delete(finish)) finish(false); };
      this.waiting.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  /** Settings → AI → Turn on AI: shows the disclosure again, even after a no. */
  reconsider() { if (this.transport && !this.allowed && !this.state.prompt) this.open(); }
  async agree() {
    if (!this.transport || !this.state.prompt || this.state.saving) return;
    const session = this.session;
    const prompt = this.promptSeq;
    this.edits++;
    this.update({ saving: true, error: null });
    try {
      const doc = await this.transport.save(AI_CONSENT_VERSION);
      if (session !== this.session || prompt !== this.promptSeq) return;
      this.absorb(doc);
      if (!this.allowed) throw new Error("SureWord needs an update before it can use AI. Update the app and try again.");
      this.finish(true);
    } catch (error) {
      if (session === this.session && prompt === this.promptSeq) this.update({ saving: false, error: error instanceof Error ? error.message : "Your choice wasn't saved. Try again." });
    }
  }
  /** "No thanks", Escape or Back: the sheet never closes unanswered, it asks to confirm.
   * After a failed save (offline) it closes unrecorded, so nobody is trapped. */
  decline = () => { if (!this.state.prompt || this.state.saving) return; if (this.state.error) { this.finish(false); return; } this.update({ confirming: true, error: null }); };
  /** Escape or Back on the confirmation returns to the disclosure (or closes after a failed save). */
  back = () => { if (!this.state.prompt || this.state.saving) return; if (this.state.error) { this.finish(false); return; } this.update({ confirming: false, error: null }); };
  /** The confirmed "Turn off AI": saved on the account, so the sheet never returns. */
  async confirmDecline() {
    if (!this.transport || !this.state.prompt || this.state.saving) return;
    const session = this.session;
    const prompt = this.promptSeq;
    this.edits++;
    this.update({ saving: true, error: null });
    try {
      const doc = await this.transport.save(null);
      if (session !== this.session || prompt !== this.promptSeq) return;
      this.absorb(doc); this.finish(false);
    } catch (error) {
      if (session === this.session && prompt === this.promptSeq) this.update({ saving: false, error: error instanceof Error ? error.message : "Your choice wasn't saved. Try again." });
    }
  }
  private finish(granted: boolean) {
    this.promptSeq++;
    const waiting = [...this.waiting]; this.waiting.clear();
    this.update({ prompt: false, confirming: false, saving: false, error: null }); waiting.forEach(resolve => resolve(granted));
  }
  /** Settings → AI → Turn off AI (after its own confirm). Recorded as a no. */
  async withdraw() {
    if (!this.transport || this.state.saving) return;
    const session = this.session;
    this.edits++;
    this.update({ saving: true, error: null });
    try {
      const doc = await this.transport.save(null);
      if (session !== this.session) return;
      this.absorb(doc); this.finish(false);
    } catch (error) {
      if (session === this.session) this.update({ error: error instanceof Error ? error.message : "Your choice wasn't saved. Try again." });
    } finally { if (session === this.session) this.update({ saving: false }); }
  }
}
export const aiConsentGate = new ConsentGate();

/** Used by web REST and AI SDK transports, never wraps global fetch. */
export async function consentFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
  const request = input instanceof Request ? input : null;
  const policy = url.origin === window.location.origin ? consentPolicy(url.pathname, init?.method ?? request?.method ?? "GET", init?.body) : null;
  const signal = init?.signal ?? request?.signal;
  const session = aiConsentGate.sessionId;
  if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
  if (policy && !(await aiConsentGate.ensure(policy === "tap" || new Headers(init?.headers ?? request?.headers).get("x-sureword-ai-consent") === "ask", signal))) {
    if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
    return Response.json({ error: CONSENT_DECLINED_NOTICE, code: "AI_CONSENT_REQUIRED" }, { status: 403 });
  }
  if (policy && (session !== aiConsentGate.sessionId || !aiConsentGate.isCurrentAccount())) return Response.json({ error: "Your account changed. Try again." }, { status: 403 });
  if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
  return fetch(input, init);
}
