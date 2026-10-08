import { AI_CONSENT_VERSION } from "./ai-consent";

export interface ConsentRecord { version: number; acceptedAt: string }
export interface ConsentDocument { aiConsent?: ConsentRecord | null; aiConsentRequired?: number }
export interface ConsentTransport {
  isCurrentAccount?: () => boolean;
  load: () => Promise<ConsentDocument>;
  save: (version: number | null) => Promise<ConsentDocument>;
}
export const CONSENT_DECLINED_NOTICE = "Written by AI, which needs your permission first. Try again to choose.";

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
  if (route === "/api/suggested-questions") return "automatic";
  if (write && (route === "/api/ask-question" || route === "/api/guest/ask" || route === "/api/note-ai" || /^\/api\/notes\/[^/]+\/ai$/.test(route)
    || route === "/api/memories/summary" || route === "/api/verse-of-day/today"
    || route === "/api/verse-of-day/audio" || route === "/api/chat/attachments"
    || /^\/api\/chat\/attachments\/[^/]+\/complete$/.test(route))) return "tap";
  if (method.toUpperCase() === "GET" && route === "/api/verse-of-day/today") return "tap";
  return null;
}

export class ConsentGate {
  private state = { record: null as ConsentRecord | null, required: AI_CONSENT_VERSION, prompt: false, saving: false, error: null as string | null };
  private listeners = new Set<() => void>();
  private transport: ConsentTransport | null = null;
  private session = 0;
  private hydrated = false;
  private edits = 0;
  private waiting: ((granted: boolean) => void) | null = null;
  private promptSeq = 0;
  getSnapshot = () => this.state;
  get sessionId() { return this.session; }
  isCurrentAccount = () => !!this.transport && (this.transport.isCurrentAccount?.() ?? true);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  configure(transport: ConsentTransport | null) {
    this.finish(false); this.session++; this.transport = transport; this.hydrated = false;
    this.update({ record: null, required: AI_CONSENT_VERSION, prompt: false, saving: false, error: null });
    if (transport) void this.refresh();
  }
  private absorb(document: ConsentDocument) {
    this.hydrated = true;
    this.update({ record: document.aiConsent ?? null, required: Math.max(AI_CONSENT_VERSION, document.aiConsentRequired ?? AI_CONSENT_VERSION) });
  }
  async refresh() {
    const session = this.session; const transport = this.transport; const edits = this.edits;
    if (!transport) return;
    try { const doc = await transport.load(); if (session === this.session && edits === this.edits) this.absorb(doc); } catch { /* Keep the account's last known consent offline. */ }
  }
  async ensure(ask = true, signal?: AbortSignal | null): Promise<boolean> {
    const session = this.session;
    if (signal?.aborted) return false;
    if (!this.isCurrentAccount()) return false;
    if (this.state.record?.version === this.state.required) return true;
    if (!this.hydrated) await this.refresh();
    if (session !== this.session || signal?.aborted || !this.isCurrentAccount()) return false;
    if (this.state.record?.version === this.state.required) return true;
    if (!ask || this.waiting || this.state.prompt) return false;
    this.promptSeq++;
    return new Promise(resolve => {
      const finish = (granted: boolean) => { signal?.removeEventListener("abort", abort); resolve(granted); };
      const abort = () => { if (this.waiting === finish) this.finish(false); };
      this.waiting = finish;
      signal?.addEventListener("abort", abort, { once: true });
      this.update({ prompt: true, saving: false, error: null });
    });
  }
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
      if (this.state.record?.version !== this.state.required) throw new Error("SureWord needs an update before it can use AI. Update the app and try again.");
      this.finish(true);
    } catch (error) {
      if (session === this.session && prompt === this.promptSeq) this.update({ saving: false, error: error instanceof Error ? error.message : "Your choice wasn't saved. Try again." });
    }
  }
  decline = () => { if (!this.state.saving) this.finish(false); };
  private finish(granted: boolean) {
    this.promptSeq++;
    const resolve = this.waiting; this.waiting = null;
    this.update({ prompt: false, saving: false, error: null }); resolve?.(granted);
  }
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
