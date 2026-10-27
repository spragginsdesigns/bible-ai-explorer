"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAuth, useClerk } from "@clerk/nextjs";
import { aiConsentGate, type ConsentDocument } from "@/lib/ai-consent-gate";
import * as copy from "@/lib/ai-consent";
import { Button } from "@/components/ui/button";

async function preferences(version?: number | null): Promise<ConsentDocument> {
  const response = await fetch("/api/preferences", version === undefined ? { cache: "no-store" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aiConsent: version === null ? null : { version } }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Your choice wasn't saved. Try again.");
  return data as ConsentDocument;
}
export default function AIConsentPresenter() {
  const { userId, isLoaded } = useAuth();
  const clerk = useClerk();
  const account = useRef(userId); account.current = userId;
  const state = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot, aiConsentGate.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!dialog.current) return;
    if (state.prompt && !dialog.current.open) dialog.current.showModal();
    else if (!state.prompt && dialog.current.open) dialog.current.close();
  }, [state.prompt, mounted]);
  useEffect(() => {
    if (!isLoaded) return;
    const owner = userId ?? null;
    const key = `sureword.aiConsent.${owner ?? "guest"}`;
    const isCurrentAccount = () => (account.current ?? null) === owner && (clerk.user?.id ?? null) === owner;
    const requireAccount = () => { if (!isCurrentAccount()) throw new Error("Your account changed. Try again."); };
    const cache = (doc: ConsentDocument) => { try { sessionStorage.setItem(key, JSON.stringify({ aiConsent: doc.aiConsent, aiConsentDeclined: doc.aiConsentDeclined, aiConsentRequired: doc.aiConsentRequired })); } catch { /* Consent on the server remains authoritative. */ } };
    const cached = (): ConsentDocument => { try { return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? {}; } catch { return {}; } };
    aiConsentGate.configure({
      isCurrentAccount,
      // Not over the policy pages the sheet itself links to.
      askOnLaunch: !!owner && !/^\/(privacy|terms|support)(\/|$)/.test(window.location.pathname),
      load: async () => {
        requireAccount();
        if (!owner) return cached();
        try { const doc = await preferences(); requireAccount(); cache(doc); return doc; }
        catch (error) { requireAccount(); const doc = cached(); if (doc.aiConsent) return { ...doc, stale: true }; throw error; }
      },
      save: async version => {
        requireAccount();
        const doc = owner ? await preferences(version) : { aiConsent: version === null ? null : { version, acceptedAt: new Date().toISOString() }, aiConsentDeclined: version === null, aiConsentRequired: copy.AI_CONSENT_VERSION };
        requireAccount(); cache(doc); return doc;
      },
    });
    const onFocus = () => { void aiConsentGate.refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); aiConsentGate.configure(null); };
  }, [clerk, isLoaded, userId]);
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} aria-labelledby="ai-consent-title" aria-describedby="ai-consent-body" onCancel={event => { event.preventDefault(); if (state.confirming) aiConsentGate.back(); else aiConsentGate.decline(); }} onClose={() => {
    // Chrome force-closes a modal on a repeated Escape without a user gesture,
    // ignoring preventDefault; the question is asked once, so put it back.
    if (!aiConsentGate.getSnapshot().prompt) return;
    aiConsentGate.decline();
    if (aiConsentGate.getSnapshot().prompt) dialog.current?.showModal();
  }} className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/70">
    {state.confirming ? <div className="flex flex-col gap-4">
      <h2 id="ai-consent-title" className="text-xl font-semibold">{copy.AI_CONSENT_CONFIRM_TITLE}</h2>
      <p id="ai-consent-body" className="text-sm leading-6 text-foreground">{copy.AI_CONSENT_CONFIRM_BODY}</p>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <Button disabled={state.saving} onClick={() => void aiConsentGate.agree()}>{copy.AI_CONSENT_CONFIRM_ALLOW}</Button>
      <Button variant="outline" disabled={state.saving} onClick={() => void aiConsentGate.confirmDecline()} className="text-destructive">{state.saving ? "Saving…" : copy.AI_CONSENT_CONFIRM_DECLINE}</Button>
    </div> : <div className="flex flex-col gap-4">
      <h2 id="ai-consent-title" className="text-xl font-semibold">{copy.AI_CONSENT_TITLE}</h2>
      <p id="ai-consent-body" className="text-sm leading-6 text-foreground">{copy.AI_CONSENT_BODY}</p>
      <a href={copy.AI_CONSENT_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">{copy.AI_CONSENT_PRIVACY_LABEL}</a>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <Button disabled={state.saving} onClick={() => void aiConsentGate.agree()}>{state.saving ? "Saving…" : copy.AI_CONSENT_AGREE}</Button>
      <Button variant="outline" disabled={state.saving} onClick={aiConsentGate.decline}>{copy.AI_CONSENT_DECLINE}</Button>
    </div>}
  </dialog>, document.body);
}

export function AIConsentSettingsSection() {
  const state = useSyncExternalStore(aiConsentGate.subscribe, aiConsentGate.getSnapshot, aiConsentGate.getSnapshot);
  const current = !!state.record;
  return <div className="glass-card gradient-border flex flex-col items-start gap-3 rounded-2xl p-4">
    <h3 className="text-[0.9375rem] font-semibold text-neutral-900 dark:text-neutral-100">{copy.AI_CONSENT_SETTINGS_TITLE}</h3>
    <p className="text-[0.8125rem] leading-[1.125rem] text-neutral-500 dark:text-neutral-400">{current ? copy.aiConsentStatusLabel(state.record) : copy.AI_CONSENT_OFF_LABEL}</p>
    {state.error && !state.prompt ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <Button variant="outline" disabled={state.saving} onClick={() => {
      if (!current) { aiConsentGate.reconsider(); return; }
      if (window.confirm("Turn off AI? Chat, verse explanations and the other AI features stop working until you turn AI back on here. Your study data is kept.")) void aiConsentGate.withdraw();
    }}>{current ? copy.AI_CONSENT_WITHDRAW : copy.AI_CONSENT_ENABLE}</Button>
  </div>;
}
