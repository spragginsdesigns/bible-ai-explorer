"use client";

import React from "react";
import { readTextScalePref } from "@/lib/preferences";
import { setTextScalePreference, usePreference } from "@/lib/preferencesSync";
import { spotlightTarget } from "@/lib/spotlight";
import { DEFAULT_TEXT_SCALE, TEXT_SCALES, TEXT_SCALE_FACTORS, TEXT_SCALE_LABELS, stepTextScale } from "@/lib/text-scale";

/** One bounded account preference, shared by Settings and the welcome card. */
export default function TextSizeControl({ mounted }: { mounted: boolean }) {
 const scale = usePreference(readTextScalePref, DEFAULT_TEXT_SCALE);
 const sectionRef = React.useRef<HTMLDivElement>(null);
 React.useEffect(() => {
  if (window.location.hash !== "#text-size") return;
  const frame = requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "start" }));
  return () => cancelAnimationFrame(frame);
 }, []);
 const [pending, setPending] = React.useState(false);
 const pick = async (next: typeof scale) => {
  if (pending || next === scale) return;
  setPending(true);
  try { await setTextScalePreference(next); } finally { setPending(false); }
 };
 const buttonClass = "flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl border border-black/15 px-[16px] py-[8px] font-bold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/15";
 return (
  <div ref={sectionRef} id="text-size" {...spotlightTarget("settings.textSize")} className="flex min-w-0 scroll-mt-24 flex-col gap-[12px] p-[16px] [overflow-wrap:anywhere]">
   <div className="flex flex-wrap items-center justify-between gap-[8px]">
    <h3 className="text-body font-semibold">Text size</h3>
    <output aria-live="polite" className="text-support text-neutral-500 dark:text-neutral-400">{TEXT_SCALE_LABELS[scale]} ({Math.round(TEXT_SCALE_FACTORS[scale] * 100)}%)</output>
   </div>
   <div role="group" aria-label="Adjust text size" className="flex flex-wrap items-center gap-[12px]">
    <button type="button" className={`${buttonClass} text-xl`} aria-label="Decrease text size" disabled={!mounted || pending || scale === TEXT_SCALES[0]} onClick={() => void pick(stepTextScale(scale, -1))}>A-</button>
    <button type="button" className={`${buttonClass} text-2xl`} aria-label="Increase text size" disabled={!mounted || pending || scale === TEXT_SCALES[TEXT_SCALES.length - 1]} onClick={() => void pick(stepTextScale(scale, 1))}>A+</button>
    <button type="button" className={`${buttonClass} text-support`} disabled={!mounted || pending || scale === DEFAULT_TEXT_SCALE} onClick={() => void pick(DEFAULT_TEXT_SCALE)}>Reset</button>
   </div>
   <div role="radiogroup" aria-label="Text size" className="flex flex-wrap gap-[8px]">
    {TEXT_SCALES.map(option => <button key={option} type="button" role="radio" aria-checked={mounted && scale === option} disabled={!mounted || pending} onClick={() => void pick(option)} className={`min-h-[48px] flex-1 rounded-xl border px-[12px] py-[8px] text-support font-semibold disabled:opacity-50 ${scale === option ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-black/10 dark:border-white/10"}`}>{TEXT_SCALE_LABELS[option]}</button>)}
   </div>
   <p className="text-support text-neutral-500 dark:text-neutral-400">Applies throughout SureWord and syncs with your account. Your browser text size and zoom still apply.</p>
   <blockquote aria-label="Text size preview" className="rounded-xl bg-black/[0.03] p-[12px] text-body leading-relaxed dark:bg-white/[0.03]">Thy word is a lamp unto my feet, and a light unto my path.<cite className="mt-1 block text-support not-italic">Psalm 119:105 (KJV)</cite></blockquote>
  </div>
 );
}
