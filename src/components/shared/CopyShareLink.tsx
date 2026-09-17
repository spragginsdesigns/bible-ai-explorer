"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";

export default function CopyShareLink() {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [manualUrl, setManualUrl] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const busy = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    setState("copying");
    // Query strings and fragments are not part of a shared answer's identity.
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setManualUrl("");
      timer.current = setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
      setManualUrl(url);
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => void copy()} disabled={state === "copying"} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-control text-neutral-600 transition-colors hover:bg-amber-500/10 hover:text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:opacity-60 dark:text-neutral-400 dark:hover:text-amber-300 dark:focus-visible:outline-amber-400">
        {state === "copied" ? <Check aria-hidden="true" className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> : <Link2 aria-hidden="true" className="h-4 w-4" />}
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "copying" ? "Copying…" : "Copy link"}</span>
      </button>
      {manualUrl && (
        <div className="absolute right-0 top-full z-10 mt-2 w-64 max-w-[80vw] rounded-xl border border-border bg-background p-4 shadow-lg">
          <label className="block text-support" htmlFor="shared-link-fallback" role="status">Couldn’t copy automatically. Select and copy this link:</label>
          <input id="shared-link-fallback" readOnly value={manualUrl} onFocus={(event) => event.currentTarget.select()} className="mt-3 min-h-11 w-full rounded-md border border-border bg-background px-2 text-support focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600" />
          <button type="button" onClick={() => { setManualUrl(""); setState("idle"); }} className="mt-2 min-h-11 rounded-md px-2 text-control underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600">Dismiss</button>
        </div>
      )}
    </div>
  );
}
