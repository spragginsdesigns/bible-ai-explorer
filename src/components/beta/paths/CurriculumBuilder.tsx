"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { TOPIC_MAX } from "@/lib/beta/paths/content-rules";
import { createCurriculum } from "./pathsClient";
import { FOCUS, GOLD_BUTTON, MUTED, pathHref } from "./ui";

const SUGGESTIONS = ["The Holy Spirit", "The covenants", "Eschatology", "Prayer", "The armour of God"];

/** Ask for a curriculum around any topic; the outline is built once, on this request. */
export default function CurriculumBuilder() {
	const router = useRouter();
	const [topic, setTopic] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const build = async (value: string) => {
		const text = value.trim();
		if (!text || busy) return;
		setBusy(text);
		setError(null);
		try {
			const { pathId } = await createCurriculum(text);
			router.push(pathHref(pathId));
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : "That curriculum could not be built right now. Please try again.");
			setBusy(null);
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		void build(topic);
	};

	return (
		<div className="mt-4">
			<form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
				<label htmlFor="paths-topic" className="sr-only">What do you want to understand?</label>
				<input
					id="paths-topic"
					value={topic}
					onChange={(event) => setTopic(event.target.value)}
					maxLength={TOPIC_MAX}
					placeholder="What do you want to understand? The covenants, the Holy Spirit..."
					autoComplete="off"
					enterKeyHint="go"
					disabled={Boolean(busy)}
					className={`min-h-12 min-w-0 flex-1 rounded-2xl border border-black/10 bg-white/80 px-4 text-base outline-none placeholder:text-neutral-500 focus:border-amber-700/40 disabled:opacity-60 dark:border-white/10 dark:bg-white/[.04] dark:placeholder:text-neutral-400 dark:focus:border-amber-300/40`}
				/>
				<button type="submit" disabled={!topic.trim() || Boolean(busy)} className={GOLD_BUTTON}>
					<Sparkles size={18} aria-hidden /> Build my path
				</button>
			</form>
			<div className="mt-3 flex flex-wrap gap-2" aria-label="Suggestions">
				{SUGGESTIONS.map((suggestion) => (
					<button
						key={suggestion}
						type="button"
						disabled={Boolean(busy)}
						onClick={() => {
							setTopic(suggestion);
							void build(suggestion);
						}}
						className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-black/10 px-4 text-sm font-bold transition-colors hover:border-amber-700/30 hover:bg-amber-500/5 disabled:opacity-50 dark:border-white/10 dark:hover:border-amber-300/30 ${FOCUS}`}
					>
						{suggestion} <ArrowRight size={14} aria-hidden />
					</button>
				))}
			</div>
			{busy && (
				<p role="status" aria-live="polite" className="mt-4 flex items-center gap-3 text-[15px]">
					<span className="h-5 w-5 shrink-0 rounded-full border-2 border-amber-500/30 border-t-amber-600 motion-safe:animate-spin dark:border-t-amber-300" aria-hidden />
					Building your path on {busy}, foundations first. This can take up to a minute.
				</p>
			)}
			{error && (
				<p role="alert" className="mt-4 text-[15px] text-red-700 dark:text-red-300">
					{error}
				</p>
			)}
			<p className={`mt-3 text-xs ${MUTED}`}>Built by AI from the King James Bible. Explanations are labelled as teaching; the verses are the authority.</p>
		</div>
	);
}
