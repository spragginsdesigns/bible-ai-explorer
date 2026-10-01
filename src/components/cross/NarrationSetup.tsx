"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Headphones, Pause, Play } from "lucide-react";
import { NARRATION_STYLES, type NarrationOptions, type NarrationStyle, type NarrationVoices } from "@/lib/daily-cross-audio-options";

const PREF_KEY = "sureword.narrationOptions";
export default function NarrationSetup({ onGenerate }: { onGenerate: (options: NarrationOptions) => void }) {
	const [catalog, setCatalog] = useState<NarrationVoices | null>(null);
	const [voiceId, setVoiceId] = useState("");
	const [style, setStyle] = useState<NarrationStyle>("natural");
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [previewing, setPreviewing] = useState<string | null>(null);
	const preview = useRef<HTMLAudioElement | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		setError(null);
		void fetch("/api/verse-of-day/audio/voices", { signal: controller.signal }).then(async (res) => {
			if (!res.ok) throw new Error("Voices couldn't load.");
			const next = await res.json() as NarrationVoices;
			setCatalog(next);
			let saved: NarrationOptions = {};
			try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { /* Default choices. */ }
			setVoiceId(next.voices.some((v) => v.id === saved?.voiceId) ? saved.voiceId! : next.defaultVoiceId);
			if (NARRATION_STYLES.some((s) => s.id === saved?.style)) setStyle(saved.style!);
		}).catch(() => { if (!controller.signal.aborted) setError("Voices couldn't load. You can use the default narrator or try again."); });
		return () => { controller.abort(); preview.current?.pause(); };
	}, [attempt]);
	const selected = catalog?.voices.find((v) => v.id === voiceId);
	const stopPreview = () => { preview.current?.pause(); setPreviewing(null); };
	const sample = async (id: string, url: string) => {
		if (previewing === id) { stopPreview(); return; }
		stopPreview();
		const element = new Audio(url);
		preview.current = element;
		element.onended = () => setPreviewing(null);
		element.onerror = () => { setPreviewing(null); setError("This voice preview couldn't play. Try another voice."); };
		setPreviewing(id);
		try { await element.play(); } catch { setPreviewing(null); setError("This voice preview couldn't play. Try another voice."); }
	};
	return <div className="flex flex-col gap-4">
		<div className="flex items-start gap-3"><Headphones aria-hidden className="mt-1 h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" /><div><h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Let today&apos;s word meet you in audio</h3><p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Your verse, reflection, study path and prayer, narrated when you choose.</p></div></div>
		<div>
			<button type="button" aria-expanded={expanded} aria-controls="narration-voices" onClick={() => setExpanded(!expanded)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-neutral-300 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 dark:border-neutral-700">
				<span className="flex-1"><span className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Narrator</span><span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{selected?.name || "Default narrator"}</span></span>{expanded ? <ChevronUp aria-hidden size={18} /> : <ChevronDown aria-hidden size={18} />}
			</button>
			{expanded && <div id="narration-voices" className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-neutral-300 dark:border-neutral-700">
				{!catalog && !error && <p role="status" className="p-4 text-sm">Loading voices…</p>}
				{catalog?.voices.map((voice) => <div key={voice.id} className="flex items-center border-b border-neutral-200 last:border-0 dark:border-neutral-800">
					<button type="button" aria-pressed={voiceId === voice.id} onClick={() => { stopPreview(); setVoiceId(voice.id); }} className="flex min-h-16 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"><span className="flex-1"><span className="block text-sm font-semibold text-neutral-900 dark:text-neutral-100">{voice.name}</span><span className="block text-xs leading-5 text-neutral-600 dark:text-neutral-300">{voice.description}</span></span>{voiceId === voice.id && <Check aria-hidden size={18} className="text-amber-600 dark:text-amber-400" />}</button>
					{voice.previewUrl && <button type="button" aria-label={`${previewing === voice.id ? "Stop" : "Preview"} ${voice.name}`} onClick={() => void sample(voice.id, voice.previewUrl!)} className="mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-amber-600 hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 dark:text-amber-400">{previewing === voice.id ? <Pause size={18} /> : <Play size={18} />}</button>}
				</div>)}
			</div>}
		</div>
		<fieldset><legend className="mb-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">Delivery</legend><div className="grid grid-cols-3 gap-2">{NARRATION_STYLES.map((choice) => <button type="button" key={choice.id} aria-pressed={style === choice.id} onClick={() => setStyle(choice.id)} className={`min-h-12 rounded-xl border px-2 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${style === choice.id ? "border-amber-600 bg-amber-500/10 text-amber-700 dark:border-amber-400 dark:text-amber-400" : "border-neutral-300 text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"}`}>{choice.label}</button>)}</div><p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">{NARRATION_STYLES.find((s) => s.id === style)?.description}</p></fieldset>
		{error && <p role="status" className="text-sm leading-5 text-neutral-600 dark:text-neutral-300">{error} <button type="button" onClick={() => setAttempt(attempt + 1)} className="min-h-12 underline underline-offset-4">Reload voices</button></p>}
		<button type="button" onClick={() => { stopPreview(); const options = { ...(voiceId ? { voiceId } : {}), style }; try { localStorage.setItem(PREF_KEY, JSON.stringify(options)); } catch { /* Storage may be blocked. */ } onGenerate(options); }} className="min-h-12 rounded-xl bg-amber-700 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300">Generate audio narrative</button>
		<p className="text-xs leading-5 text-neutral-600 dark:text-neutral-300">Made only on your request. Today&apos;s audio is saved, so you can return and listen again.</p>
	</div>;
}
