"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Brain, Moon, Settings, Smartphone, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import GetAppLink from "./GetAppLink";

/** The same explicit settings and memory path on every reading destination. */
export default function AppOptions() {
  const { setTheme } = useTheme();
  const ref = useRef<HTMLDetailsElement>(null);
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
  return <details ref={ref} className="relative shrink-0" onClick={event => { if ((event.target as HTMLElement).closest("a,button")) ref.current?.removeAttribute("open"); }}>
    <summary aria-label="Settings and app options" className="flex h-12 w-12 cursor-pointer list-none items-center justify-center rounded-full text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/5 [&::-webkit-details-marker]:hidden"><Settings size={23} aria-hidden /></summary>
    <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-2xl border border-black/10 bg-[#faf7ef] p-2 text-neutral-900 shadow-xl dark:border-white/10 dark:bg-[#171b16] dark:text-neutral-100">
      <Link href="/settings" className={row}><Settings size={19} aria-hidden /> Settings</Link>
      <Link href="/settings#memory" className={row}><Brain size={19} aria-hidden /> Memories</Link>
      <button type="button" className={`${row} w-full`} onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}><Sun size={19} className="hidden dark:block" aria-hidden /><Moon size={19} className="dark:hidden" aria-hidden /> Toggle theme</button>
      <GetAppLink source="daily-walk-options" className={row}><Smartphone size={19} aria-hidden /> Get the app</GetAppLink>
    </div>
  </details>;
}
