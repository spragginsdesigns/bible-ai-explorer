"use client";

import { useEffect, useRef, useState } from "react";
import { hydratePreferences, savePersonalText, type PersonalTextField } from "@/lib/preferencesSync";

export interface PersonalTextSectionProps {
	field: PersonalTextField;
	/** Anchor id, also used by the Settings section nav. */
	id: string;
	title: string;
	/** What the box is for, shown above it. */
	description: string;
	placeholder: string;
	/** The noun in the loading messages ("Loading your testimony…"). */
	name: string;
	/** Screen-reader name of the box. */
	label: string;
	maxLength: number;
	rows: number;
	/** The cached value: null until the account document has been read. */
	value: string | null;
	/** Reads the cache directly, to tell a failed hydrate from a slow one. */
	readCached: () => string | null;
}

/**
 * A free-text box the user writes in their own words (About me, My testimony).
 * One field rather than a form on purpose, since the thing the assistant needs
 * is their own words, and saved explicitly rather than on every keystroke so a
 * paragraph in progress is never half-written to the account.
 */
export default function PersonalTextSection({
	field,
	id,
	title,
	description,
	placeholder,
	name,
	label,
	maxLength,
	rows,
	value,
	readCached,
}: PersonalTextSectionProps) {
	const [draft, setDraft] = useState("");
	const draftRef = useRef(draft);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	// The server value only replaces the box while the user has nothing unsaved
	// in it, so a hydrate on tab focus cannot swallow what they are typing.
	useEffect(() => {
		if (value === null) return;
		setLoadFailed(false);
		if (dirty) return;
		draftRef.current = value;
		setDraft(value);
	}, [value, dirty]);

	useEffect(() => {
		if (value !== null) return;
		let active = true;
		void hydratePreferences({ force: true }).then((ok) => {
			if (active && (!ok || readCached() === null)) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [value, readCached]);

	const change = (next: string) => {
		setSaved(false);
		setError(null);
		draftRef.current = next;
		setDraft(next);
		setDirty(true);
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		const ok = await hydratePreferences({ force: true });
		if (!ok || readCached() === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || !dirty) return;
		const submitted = draftRef.current;
		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await savePersonalText(field, submitted);
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		// Kept dirty when the user typed on while the save was in flight: what is
		// in the box then is newer than what the server just confirmed.
		if (draftRef.current === submitted) {
			draftRef.current = result.text;
			setDraft(result.text);
			setDirty(false);
		}
		setSaved(true);
	};

	return (
		<section id={id} className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				{title}
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">{description}</p>

				{value === null ? (
					<div className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3">
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							{loadFailed ? `Couldn't load ${name}.` : `Loading ${name}…`}
						</p>
						{loadFailed ? (
							<button
								type="button"
								onClick={() => void retryLoad()}
								className="min-h-11 px-3 text-xs font-bold text-amber-600 dark:text-amber-400"
							>
								Retry
							</button>
						) : null}
					</div>
				) : (
					<>
						<label className="min-w-0">
							<span className="sr-only">{label}</span>
							<textarea
								value={draft}
								onChange={(event) => change(event.target.value)}
								maxLength={maxLength}
								rows={rows}
								placeholder={placeholder}
								className="w-full resize-y rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 py-2 text-sm leading-6 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15"
							/>
						</label>

						{/* Its own line rather than the status slot below, so it keeps
						    counting while "Unsaved changes" is showing. */}
						<p className="text-right text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
							{draft.length} / {maxLength}
						</p>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
							<p
								aria-live="polite"
								className={`min-w-0 flex-1 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}
							>
								{error
									? error
									: saving
										? "Saving to your account…"
										: dirty
											? "Unsaved changes"
											: saved
												? "Saved to your account"
												: ""}
							</p>
							{/* Dark ink on the amber fill in both themes, for the contrast
							    reason documented on the highlight labels Save button. */}
							<button
								type="button"
								onClick={() => void save()}
								disabled={saving || !dirty}
								className="min-h-11 flex-shrink-0 rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
							>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
