"use client";

import { Fragment, useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import type { KidsAdventureView } from "@/lib/beta/kids/kids-rules";
import type { PassageAudio } from "./usePassageAudio";

const CARD = "rounded-[22px] border border-black/[.09] bg-white/60 p-5 dark:border-white/[.09] dark:bg-white/[.04]";
const LABEL = "text-xs font-bold uppercase tracking-[.2em] text-neutral-600 dark:text-[#b3ad9e]";
/** A scroll this recent means the reader is looking elsewhere; the highlight does not pull them back. */
const FOLLOW_PAUSE_MS = 5000;

/** "12", or "7:12" when the passage spans chapters. */
export function verseLabel(adventure: Pick<KidsAdventureView, "multiChapter">, verse: { chapter: number; verse: number }): string {
	return adventure.multiChapter ? `${verse.chapter}:${verse.verse}` : `${verse.verse}`;
}

function citedLabel(adventure: KidsAdventureView, key: string): string {
	const verse = adventure.verses.find((item) => item.key === key);
	return verse ? verseLabel(adventure, verse) : key;
}

/**
 * The story step: the passage read aloud from the audio Bible, the retelling
 * for the child's age band, and the KJV text beside it with the verse being
 * read highlighted. Each retelling line shows the verse it comes from.
 */
export default function KidsStory({ adventure, audio }: { adventure: KidsAdventureView; audio: PassageAudio }) {
	const lastScroll = useRef(0);
	const reading = audio.current ? adventure.verses.find((verse) => verse.key === audio.current) : undefined;

	useEffect(() => {
		const onScroll = () => {
			lastScroll.current = Date.now();
		};
		const options = { capture: true, passive: true } as const;
		window.addEventListener("wheel", onScroll, options);
		window.addEventListener("touchmove", onScroll, options);
		return () => {
			window.removeEventListener("wheel", onScroll, options);
			window.removeEventListener("touchmove", onScroll, options);
		};
	}, []);

	const { current, playing } = audio;
	useEffect(() => {
		if (!playing || !current || Date.now() - lastScroll.current < FOLLOW_PAUSE_MS) return;
		document.getElementById(`kids-verse-${current}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [current, playing]);

	return (
		<div className="flex flex-col gap-5">
			<section aria-label="Listen" className={`${CARD} flex items-center gap-4`}>
				<button
					type="button"
					onClick={audio.toggle}
					disabled={audio.status !== "ready"}
					aria-label={audio.playing ? "Pause the story" : "Listen to the story"}
					className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[#e5b664] text-[#1c2118] disabled:opacity-40"
				>
					{audio.playing ? <Pause size={32} fill="currentColor" aria-hidden /> : <Play size={32} fill="currentColor" className="ml-1" aria-hidden />}
				</button>
				<div className="min-w-0">
					<p className="text-lg font-bold leading-6">{audio.playing ? "Listening" : "Listen to the story"}</p>
					<p className="text-[15px] leading-6 text-neutral-700 dark:text-[#d9d1c3]">The King James Bible, read aloud</p>
					<p className="mt-0.5 text-sm font-semibold text-amber-900 dark:text-[#e5b664]" aria-live="polite">
						{audio.status === "loading"
							? "Getting the story ready…"
							: audio.status === "unavailable"
								? "Listening is not available right now. You can still read it."
								: reading
									? `Reading verse ${verseLabel(adventure, reading)}`
									: `${adventure.verses.length} verses`}
					</p>
				</div>
			</section>

			<div className="grid gap-5 lg:grid-cols-2 lg:items-start">
				<section aria-labelledby={`kids-retelling-${adventure.id}`} className={CARD}>
					<h3 id={`kids-retelling-${adventure.id}`} className={LABEL}>The story</h3>
					<ol className="mt-4 flex flex-col gap-4">
						{adventure.retelling.map((line) => (
							<li key={line.text} className="flex gap-3">
								<span className="mt-1 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border border-black/[.12] px-1.5 text-xs font-bold text-neutral-600 dark:border-white/[.14] dark:text-[#b3ad9e]" title="The verse this comes from">
									{citedLabel(adventure, line.verses[0])}
								</span>
								<span className="text-[19px] leading-8">{line.text}</span>
							</li>
						))}
					</ol>
				</section>

				<section aria-labelledby={`kids-kjv-${adventure.id}`} className={CARD}>
					<h3 id={`kids-kjv-${adventure.id}`} className={LABEL}>From the King James Bible</h3>
					<p className="mt-1 font-[family-name:var(--font-cormorant)] text-2xl font-semibold">{adventure.reference}</p>
					<div className="mt-3 flex flex-col gap-1">
						{adventure.verses.map((verse, index) => {
							const previous = adventure.verses[index - 1];
							const skipped = previous && (previous.chapter !== verse.chapter || previous.verse + 1 !== verse.verse);
							const active = audio.current === verse.key;
							return (
								<Fragment key={verse.key}>
									{skipped ? <p className="py-1 text-center text-neutral-500" aria-hidden>· · ·</p> : null}
									<p
										id={`kids-verse-${verse.key}`}
										className={`rounded-[12px] border-l-4 px-3 py-1.5 font-[family-name:var(--font-cormorant)] text-[21px] leading-8 transition-colors ${
											active ? "border-[#e5b664] bg-[#e5b664]/25" : "border-transparent"
										}`}
									>
										<sup className="mr-1 font-sans text-xs font-bold text-amber-800 dark:text-[#e5b664]">{verseLabel(adventure, verse)}</sup>
										{verse.text}
									</p>
								</Fragment>
							);
						})}
					</div>
				</section>
			</div>
		</div>
	);
}
