"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { BookOpen, CalendarDays, Compass, FileText, Languages, MapPin, Users } from "lucide-react";
import DestinationCard from "./DestinationCard";

export default function StudyScreen() {
  const { userId, isLoaded } = useAuth();
  const [church, setChurch] = useState<{ userId: string; studies: boolean; events: boolean } | null>(null);
  useEffect(() => {
    if (!isLoaded || !userId) return;
    const controller = new AbortController();
    const load = () => fetch("/api/sermon-studies", { cache: "no-store", signal: controller.signal }).then(response => response.ok ? response.json() : null).then(data => {
      if (!controller.signal.aborted) setChurch({ userId, studies: Array.isArray(data?.studies) && data.studies.length > 0, events: Array.isArray(data?.events) && data.events.length > 0 });
    }).catch(() => undefined);
    void load();
    const wake = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", wake);
    return () => { controller.abort(); window.removeEventListener("focus", wake); };
  }, [isLoaded, userId]);
  const churchAvailable = church?.userId === userId && (church?.studies || church?.events);
  return <main className="mx-auto w-full max-w-5xl px-5 pb-28 pt-6 lg:px-8 lg:pb-16 lg:pt-10">
    <header className="mb-7"><p className="text-xs font-bold uppercase tracking-[.25em] text-amber-800 dark:text-[#e5b664]">Go deeper in the Word</p><h1 className="mt-2 font-[family-name:var(--font-cormorant)] text-5xl font-semibold">Your study desk.</h1><p className="mt-3 max-w-xl text-base leading-6 text-neutral-600 dark:text-[#bbb3a7]">Keep what you discover. Explore the people, places, and passages that bring Scripture into focus.</p></header>
    <section aria-label="Your notes" className="mb-8"><DestinationCard href="/notes" title="Notes" description="Your saved verses, reflections, folders, and studies" Icon={FileText} spotlight="study.notes" /></section>
    <section aria-labelledby="study-explore"><h2 id="study-explore" className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">Explore Scripture</h2><div className="grid gap-3 sm:grid-cols-2">
      <DestinationCard href="/bible/timeline" title="Bible timeline" description="Follow the turning points of Scripture" Icon={Compass} />
      <DestinationCard href="/bible/timeline?mode=people" title="People" description="Discover their lives, families, and journeys" Icon={Users} />
      <DestinationCard href="/bible/timeline?mode=places" title="Places & atlas" description="Explore the places recorded in the Bible" Icon={MapPin} />
      <DestinationCard href="/study/words" title="Word study" description="Explore Hebrew, Greek, and Strong’s verse by verse" Icon={Languages} />
    </div></section>
    {churchAvailable && <section aria-labelledby="study-church" className="mt-8"><h2 id="study-church" className="mb-3 text-xs font-bold uppercase tracking-[.18em] text-neutral-600 dark:text-[#b3ad9e]">From your church</h2><DestinationCard href="/sermons" title={church?.events ? "Sermon studies & announcements" : "Sermon studies"} description="Return to your church’s messages and gatherings" Icon={church?.events ? CalendarDays : BookOpen} spotlight="study.sermons" /></section>}
  </main>;
}
