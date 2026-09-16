"use client";

import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import {
	HIGHLIGHT_LABEL_IDS,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	readHighlightLabelsPref,
	type HighlightLabelId,
	type HighlightLabels,
} from "@/lib/preferences";
import {
	hydratePreferences,
	saveHighlightLabelEdits,
	useHighlightLabelsPreference,
} from "@/lib/preferencesSync";

type LabelDraft = Record<HighlightLabelId, string>;

function draftFromLabels(labels: HighlightLabels | null): LabelDraft {
	return Object.fromEntries(HIGHLIGHT_LABEL_IDS.map((id) => [id, labels?.[id] ?? ""])) as LabelDraft;
}

export default function HighlightLabelsSection() {
	const labels = useHighlightLabelsPreference();
	const [draft, setDraft] = useState<LabelDraft>(() => draftFromLabels(labels));
	const draftRef = useRef(draft);
	const [dirtyIds, setDirtyIds] = useState<HighlightLabelId[]>([]);
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

	useEffect(() => {
		if (labels === null) return;
		setLoadFailed(false);
		setDraft((current) => {
			const next = { ...current };
			for (const id of HIGHLIGHT_LABEL_IDS) {
				if (!dirtyIds.includes(id)) next[id] = labels[id] ?? "";
			}
			draftRef.current = next;
			return next;
		});
	}, [dirtyIds, labels]);

	useEffect(() => {
		if (labels !== null) return;
		let active = true;
		void hydratePreferences({ force: true }).then((ok) => {
			if (active && (!ok || readHighlightLabelsPref() === null)) setLoadFailed(true);
		});
		return () => {
			active = false;
		};
	}, [labels]);

	const changeLabel = (id: HighlightLabelId, value: string) => {
		setSaved(false);
		setError(null);
		const next = { ...draftRef.current, [id]: value };
		draftRef.current = next;
		setDraft(next);
		setDirtyIds((current) => (current.includes(id) ? current : [...current, id]));
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		const ok = await hydratePreferences({ force: true });
		if (!ok || readHighlightLabelsPref() === null) setLoadFailed(true);
	};

	const save = async () => {
		if (savingRef.current || dirtyIds.length === 0) return;
		const submittedIds = [...dirtyIds];
		const submittedDraft = { ...draftRef.current };
		const edits: Partial<Record<HighlightLabelId, string>> = {};
		for (const id of submittedIds) edits[id] = submittedDraft[id];

		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveHighlightLabelEdits(edits);
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}

		const currentDraft = draftRef.current;
		const nextDraft = { ...currentDraft };
		for (const id of submittedIds) {
			if (currentDraft[id] === submittedDraft[id]) nextDraft[id] = result.labels[id] ?? "";
		}
		draftRef.current = nextDraft;
		setDraft(nextDraft);
		setDirtyIds((current) =>
			current.filter(
				(id) => !submittedIds.includes(id) || currentDraft[id] !== submittedDraft[id]
			)
		);
		setSaved(true);
	};

	return (
		<section id="highlight-labels" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				HIGHLIGHT LABELS
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
					Name each color for the way you study, such as Promises or Prayer. A blank label uses
					the color name.
				</p>

				{labels === null ? (
					<div className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-3">
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							{loadFailed ? "Couldn't load your highlight labels." : "Loading highlight labels…"}
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
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
							{HIGHLIGHT_COLORS.map(({ name, hex }) => {
								const id = name.toLowerCase() as HighlightLabelId;
								return (
									<div
										key={id}
										className="flex items-center gap-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] p-2"
									>
										<span
											className="h-7 w-7 flex-shrink-0 rounded-full border border-black/15 shadow-sm"
											style={{ backgroundColor: hex }}
											aria-hidden
										/>
										<label className="min-w-0 flex-1">
											<span className="sr-only">{name} highlight label</span>
											<input
												type="text"
												value={draft[id]}
												onChange={(event) => changeLabel(id, event.target.value)}
												maxLength={MAX_HIGHLIGHT_LABEL_LENGTH}
												placeholder={name}
												className="h-10 w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15"
											/>
										</label>
										<button
											type="button"
											onClick={() => changeLabel(id, "")}
											disabled={!draft[id]}
											aria-label={`Reset ${name} highlight label`}
											className="min-h-10 rounded-lg px-1.5 text-metadata font-bold text-neutral-500 hover:text-amber-700 disabled:opacity-35 dark:text-neutral-400 dark:hover:text-amber-300"
										>
											Reset
										</button>
									</div>
								);
							})}
						</div>

						<div className="flex items-center justify-between gap-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
							<p
								aria-live="polite"
								className={`text-xs ${error ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500"}`}
							>
								{error
									? error
									: saving
										? "Saving to your account…"
										: dirtyIds.length > 0
											? "Unsaved changes"
											: saved
												? "Saved to your account"
												: `${MAX_HIGHLIGHT_LABEL_LENGTH} characters maximum`}
							</p>
							{/* Dark ink on the amber fill in both themes: white on amber-500 was 2.15:1
							    in light mode, under the 4.5:1 WCAG AA floor for this small bold text;
							    neutral-950 on amber-500 is 9.22:1, and 6.21:1 on the amber-600 hover. */}
							<button
								type="button"
								onClick={() => void save()}
								disabled={saving || dirtyIds.length === 0}
								className="min-h-11 flex-shrink-0 rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
							>
								{saving ? "Saving…" : "Save labels"}
							</button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
