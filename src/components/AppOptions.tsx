"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { Brain, Moon, Settings, Smartphone, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import BetaVersionSwitch from "./beta/BetaVersionSwitch";
import GetAppLink from "./GetAppLink";

/**
 * Whether each account may open SureWord Beta (GET /api/beta/access), kept for
 * the session so the menu asks at most once per account, and only after it is
 * first opened. Almost every account is not on the list and never sees a row.
 */
const betaAccess = new Map<string, boolean>();

/** The same explicit settings and memory path on every reading destination. */
export default function AppOptions() {
  const { setTheme } = useTheme();
  const { userId } = useAuth();
  const ref = useRef<HTMLDetailsElement>(null);
  const [, setBetaChecked] = useState(0);
  const asking = useRef<string | null>(null);
  const checkBeta = () => {
    if (!userId || betaAccess.has(userId) || asking.current === userId) return;
    asking.current = userId;
    fetch("/api/beta/access", { cache: "no-store" })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data) { betaAccess.set(userId, data.beta === true); setBetaChecked(n => n + 1); } })
      .catch(() => { /* No row; the next open asks again. */ })
      .finally(() => { if (asking.current === userId) asking.current = null; });
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) ref.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.removeAttribute("open");
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const row = "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-amber-600";
  return <details ref={ref} className="relative shrink-0" onToggle={event => { if (event.currentTarget.open) checkBeta(); }} onClick={event => { if ((event.target as HTMLElement).closest("a,button")) ref.current?.removeAttribute("open"); }}>
    <summary aria-label="Settings and app options" className="flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5 [&::-webkit-details-marker]:hidden"><Settings size={23} aria-hidden /></summary>
    <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-2xl border border-black/10 bg-[#faf7ef] p-2 text-neutral-900 shadow-xl dark:border-white/10 dark:bg-[#171b16] dark:text-neutral-100">
      <Link href="/settings" className={row}><Settings size={19} aria-hidden /> Settings</Link>
      <Link href="/settings#memory" className={row}><Brain size={19} aria-hidden /> Memories</Link>
      <button type="button" className={`${row} w-full`} onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}><Sun size={19} className="hidden dark:block" aria-hidden /><Moon size={19} className="dark:hidden" aria-hidden /> Toggle theme</button>
      <GetAppLink source="daily-walk-options" className={row}><Smartphone size={19} aria-hidden /> Get the app</GetAppLink>
      {userId && betaAccess.get(userId) && <div className="mt-1 border-t border-black/10 px-1 pb-1 pt-2 dark:border-white/10">
        <p className="px-2 pb-1.5 text-xs font-bold uppercase tracking-[.16em] text-neutral-500 dark:text-neutral-400">Version</p>
        <BetaVersionSwitch current="regular" className="w-full" />
      </div>}
    </div>
  </details>;
}
