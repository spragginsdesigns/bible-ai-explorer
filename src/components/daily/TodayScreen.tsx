"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, BookOpen, CalendarDays, ChevronRight, Footprints, Layers, Mail } from "lucide-react";
import { useReadingPlan } from "@/components/plan/useReadingPlan";
import { planCardSubtitle } from "@/components/plan/planView";
import SendWordDialog from "@/components/share/SendWordDialog";
import DestinationCard, { destinationClass } from "./DestinationCard";
import { useContinueReading } from "./useContinueReading";

export default function TodayScreen() {
  const { userId } = useAuth();
  // A new account must get its own plan hook, even during a client-side switch.
  return <TodayContent key={userId ?? "guest"} />;
}

function TodayContent() {
  const { userId } = useAuth();
  const continueTarget = useContinueReading();
  const { plan, loading, error } = useReadingPlan();
  const [sendOpen, setSendOpen] = useState(false);
  const [preview, setPreview] = useState<{ reference: string; text: string } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let current: AbortController | null = null;
    const load = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      try {
        const response = await fetch("/api/verse-of-day/preview", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted) setPreview(typeof data?.cross?.reference === "string" && typeof data.cross.text === "string" ? data.cross : null);
      } catch { /* The devotional remains directly reachable when its preview is offline. */ }
    };
    void load();
    const wake = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    const timer = window.setInterval(wake, 15 * 60 * 1000);
    return () => { current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); };
  }, [userId]);
  return <main className="mx-auto w-full max-w-5xl px-5 pb-28 pt-6 lg:px-8 lg:pb-16 lg:pt-10">
    <header className="mb-6"><p className="text-xs font-bold uppercase tracking-[.28em] text-neutral-600 dark:text-[#b3ad9e]">Your daily walk</p><h1 className="mt-3 text-[clamp(2rem,6vw,3.25rem)] font-bold leading-[1.1] tracking-[-.035em]">Begin with the Word.</h1></header>
    <div className="grid gap-7 lg:grid-cols-[1.08fr_1fr] lg:items-start lg:gap-8">
      <section aria-labelledby="daily-cross-title" className="overflow-hidden rounded-[28px] border border-amber-900/10 bg-white/25 dark:border-amber-200/10 dark:bg-white/[.015]">
        <div className="relative h-40 overflow-hidden sm:h-44 lg:h-56"><Image src="/daily-walk-dawn.jpg" alt="Sunrise over a quiet valley, with a wooden cross on the hillside" fill priority sizes="(min-width: 1024px) 420px, 100vw" className="object-cover object-[65%_52%]" /><div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" /></div>
        <div className="p-5 sm:p-6"><h2 id="daily-cross-title" className="font-[family-name:var(--font-cormorant)] text-[35px] font-semibold leading-tight text-amber-900 dark:text-[#efc574]">Pick Up Your Cross</h2>
          <p className="mt-4 text-xs font-bold uppercase tracking-[.15em] text-neutral-600 dark:text-[#b3ad9e]">{preview ? "Today’s word" : "A light for your walk"}</p>
          <blockquote className="mt-2 line-clamp-3 font-[family-name:var(--font-cormorant)] text-[25px] leading-[1.28] lg:line-clamp-none">&ldquo;{preview?.text ?? "Thy word is a lamp unto my feet, and a light unto my path."}&rdquo;</blockquote>
          <p className="mt-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">{preview?.reference ?? "Psalm 119:105"} · KJV</p>
          <p className="mt-5 text-sm leading-6 text-neutral-600 dark:text-[#bbb3a7]">A verse, a reflection, and a path through Scripture for today.</p>
          <Link href="/cross" className="mt-5 flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-[#e5b664] px-5 font-bold text-[#1c2118] transition-colors hover:bg-[#f0c77f] focus-visible:outline-amber-600">Read today&apos;s word<ArrowRight size={22} aria-hidden /></Link>
        </div>
      </section>
      <section aria-label="Continue your daily walk" className="flex flex-col gap-3">
        <DestinationCard href={continueTarget?.href ?? "/bible"} title={continueTarget ? "Continue reading" : "Open your Bible"} description={continueTarget?.label ?? "Find a book and spend time in Scripture"} Icon={BookOpen} />
        <DestinationCard href="/bible/plan" title={plan?.title ?? "Reading plan"} description={loading ? "Open your reading plan" : error ? "Choose or continue a reading plan" : planCardSubtitle(plan)} Icon={CalendarDays} />
        <DestinationCard href="/bible/learn" title="Learn a verse" description="Keep Scripture in your heart, one verse at a time" Icon={Layers} />
        <Link href="/bible/history" className="flex min-h-14 items-center gap-3 rounded-xl px-2 text-amber-900 transition-colors hover:bg-amber-500/5 dark:text-[#e5b664]"><Footprints size={23} aria-hidden /><span className="flex-1 font-bold">Your walk &amp; reading log</span><ChevronRight size={20} aria-hidden /></Link>
        <div className="border-t border-black/10 pt-3 dark:border-white/10"><button type="button" onClick={() => setSendOpen(true)} className={destinationClass}><Mail size={27} strokeWidth={1.5} className="shrink-0 text-amber-800 dark:text-[#e5b664]" aria-hidden /><span className="flex-1"><span className="block text-lg font-bold">Send a word</span><span className="mt-1 block text-sm text-neutral-600 dark:text-[#bbb3a7]">Encourage someone with Scripture</span></span><ChevronRight size={22} className="shrink-0 text-neutral-500" aria-hidden /></button></div>
      </section>
    </div>
    {sendOpen && <SendWordDialog onClose={() => setSendOpen(false)} />}
  </main>;
}
