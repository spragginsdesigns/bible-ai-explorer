"use client";

import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import {
	HIGHLIGHT_LABEL_IDS,
	HIGHLIGHT_LABEL_PRESETS,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	MAX_HIGHLIGHT_MEANING_LENGTH,
	readHighlightLabelsPref,
	readHighlightMeaningsPref,
	type HighlightLabelId,
	type HighlightLabels,
	type HighlightMeanings,
} from "@/lib/preferences";
import {
	hydratePreferences,
	saveHighlightLabelEdits,
	useHighlightLabelsPreference,
	useHighlightMeaningsPreference,
} from "@/lib/preferencesSync";

type ColorDraft = Record<HighlightLabelId, string>;

const INPUT_CLASS =
	"w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white/60 dark:bg-black/20 px-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 outline-none focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/15";

function draftFromMap(map: HighlightLabels | HighlightMeanings | null): ColorDraft {
	return Object.fromEntries(HIGHLIGHT_LABEL_IDS.map((id) => [id, map?.[id] ?? ""])) as ColorDraft;
}

export default function HighlightLabelsSection() {
	const labels = useHighlightLabelsPreference();
	const meanings = useHighlightMeaningsPreference();
	const [labelDraft, setLabelDraft] = useState<ColorDraft>(() => draftFromMap(labels));
	const [meaningDraft, setMeaningDraft] = useState<ColorDraft>(() => draftFromMap(meanings));
	const labelDraftRef = useRef(labelDraft);
	const meaningDraftRef = useRef(meaningDraft);
	const [dirtyLabelIds, setDirtyLabelIds] = useState<HighlightLabelId[]>([]);
	const [dirtyMeaningIds, setDirtyMeaningIds] = useState<HighlightLabelId[]>([]);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const activeRef = useRef(true);
	const [saved, setSaved] = useState(false);
	const [loadFailed, setLoadFailed] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Both maps ride the same account document, so the form waits for both and a
	// save sends both; a half-loaded editor could blank the half it never saw.
	const loaded = labels !== null && meanings !== null;
	const dirty = dirtyLabelIds.length > 0 || dirtyMeaningIds.length > 0;

	useEffect(() => {
		activeRef.current = true;
		return () => {
			activeRef.current = false;
		};
	}, []);

	useEffect(() => {
		if (labels === null) return;
		setLoadFailed(false);
		setLabelDraft((current) => {
			const next = { ...current };
			for (const id of HIGHLIGHT_LABEL_IDS) {
				if (!dirtyLabelIds.includes(id)) next[id] = labels[id] ?? "";
			}
			labelDraftRef.current = next;
			return next;
		});
	}, [dirtyLabelIds, labels]);

	useEffect(() => {
		if (meanings === null) return;
		setMeaningDraft((current) => {
			const next = { ...current };
			for (const id of HIGHLIGHT_LABEL_IDS) {
				if (!dirtyMeaningIds.includes(id)) next[id] = meanings[id] ?? "";
			}
			meaningDraftRef.current = next;
			return next;
		});
	}, [dirtyMeaningIds, meanings]);

	useEffect(() => {
		if (loaded) return;
		let active = true;
		void hydratePreferences({ force: true }).then((ok) => {
			if (!active) return;
			if (!ok || readHighlightLabelsPref() === null || readHighlightMeaningsPref() === null) {
				setLoadFailed(true);
			}
		});
		return () => {
			active = false;
		};
	}, [loaded]);

	const changeLabel = (id: HighlightLabelId, value: string) => {
		setSaved(false);
		setError(null);
		const next = { ...labelDraftRef.current, [id]: value };
		labelDraftRef.current = next;
		setLabelDraft(next);
		setDirtyLabelIds((current) => (current.includes(id) ? current : [...current, id]));
	};

	const changeMeaning = (id: HighlightLabelId, value: string) => {
		setSaved(false);
		setError(null);
		const next = { ...meaningDraftRef.current, [id]: value };
		meaningDraftRef.current = next;
		setMeaningDraft(next);
		setDirtyMeaningIds((current) => (current.includes(id) ? current : [...current, id]));
	};

	// The starter set only fills the form. Pressing Save stays the user's move,
	// so a mistaken tap costs a reload rather than their own labels.
	const applyPresets = () => {
		setSaved(false);
		setError(null);
		const nextLabels = { ...labelDraftRef.current };
		const nextMeanings = { ...meaningDraftRef.current };
		for (const preset of HIGHLIGHT_LABEL_PRESETS) {
			nextLabels[preset.id] = preset.label;
			nextMeanings[preset.id] = preset.meaning;
		}
		labelDraftRef.current = nextLabels;
		meaningDraftRef.current = nextMeanings;
		setLabelDraft(nextLabels);
		setMeaningDraft(nextMeanings);
		setDirtyLabelIds([...HIGHLIGHT_LABEL_IDS]);
		setDirtyMeaningIds([...HIGHLIGHT_LABEL_IDS]);
	};

	const retryLoad = async () => {
		setLoadFailed(false);
		setError(null);
		const ok = await hydratePreferences({ force: true });
		if (!ok || readHighlightLabelsPref() === null || readHighlightMeaningsPref() === null) {
			setLoadFailed(true);
		}
	};

	const save = async () => {
		if (savingRef.current || !dirty) return;
		const submittedLabelIds = [...dirtyLabelIds];
		const submittedMeaningIds = [...dirtyMeaningIds];
		const submittedLabels = { ...labelDraftRef.current };
		const submittedMeanings = { ...meaningDraftRef.current };
		const labelEdits: Partial<Record<HighlightLabelId, string>> = {};
		for (const id of submittedLabelIds) labelEdits[id] = submittedLabels[id];
		const meaningEdits: Partial<Record<HighlightLabelId, string>> = {};
		for (const id of submittedMeaningIds) meaningEdits[id] = submittedMeanings[id];

		savingRef.current = true;
		setSaving(true);
		setError(null);
		const result = await saveHighlightLabelEdits({ labels: labelEdits, meanings: meaningEdits });
		if (!activeRef.current) return;
		savingRef.current = false;
		setSaving(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}

		// A row retyped while the save was in flight keeps what the user typed and
		// stays dirty; every other submitted row takes the confirmed value.
		const currentLabels = labelDraftRef.current;
		const nextLabels = { ...currentLabels };
		for (const id of submittedLabelIds) {
			if (currentLabels[id] === submittedLabels[id]) nextLabels[id] = result.labels[id] ?? "";
		}
		labelDraftRef.current = nextLabels;
		setLabelDraft(nextLabels);
		setDirtyLabelIds((current) =>
			current.filter(
				(id) => !submittedLabelIds.includes(id) || currentLabels[id] !== submittedLabels[id]
			)
		);

		const currentMeanings = meaningDraftRef.current;
		const nextMeanings = { ...currentMeanings };
		for (const id of submittedMeaningIds) {
			if (currentMeanings[id] === submittedMeanings[id]) {
				nextMeanings[id] = result.meanings[id] ?? "";
			}
		}
		meaningDraftRef.current = nextMeanings;
		setMeaningDraft(nextMeanings);
		setDirtyMeaningIds((current) =>
			current.filter(
				(id) =>
					!submittedMeaningIds.includes(id) || currentMeanings[id] !== submittedMeanings[id]
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
					Name each colour for why you reach for it, and tell SureWord what it means to you.
					Yellow might be a favourite verse, blue a promise you lean on, red a warning or the
					words of Christ. The assistant reads these meanings, so a marked verse carries your
					reasons into chat. A blank label uses the colour name.
				</p>

				{!loaded ? (
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
										className="flex items-start gap-2 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] p-2"
									>
										<span
											className="mt-1.5 h-7 w-7 flex-shrink-0 rounded-full border border-black/15 shadow-sm"
											style={{ backgroundColor: hex }}
											aria-hidden
										/>
										<div className="flex min-w-0 flex-1 flex-col gap-1.5">
											<label className="min-w-0">
												<span className="sr-only">{name} highlight label</span>
												<input
													type="text"
													value={labelDraft[id]}
													onChange={(event) => changeLabel(id, event.target.value)}
													maxLength={MAX_HIGHLIGHT_LABEL_LENGTH}
													placeholder={name}
													className={`h-10 ${INPUT_CLASS}`}
												/>
											</label>
											<label className="min-w-0">
												<span className="sr-only">What {name} means to you</span>
												<input
													type="text"
													value={meaningDraft[id]}
													onChange={(event) => changeMeaning(id, event.target.value)}
													maxLength={MAX_HIGHLIGHT_MEANING_LENGTH}
													placeholder="What this colour means to you"
													className={`h-9 ${INPUT_CLASS}`}
												/>
											</label>
										</div>
										<button
											type="button"
											onClick={() => {
												changeLabel(id, "");
												changeMeaning(id, "");
											}}
											disabled={!labelDraft[id] && !meaningDraft[id]}
											aria-label={`Reset ${name} highlight label`}
											className="min-h-10 rounded-lg px-1.5 text-metadata font-bold text-neutral-500 hover:text-amber-700 disabled:opacity-35 dark:text-neutral-400 dark:hover:text-amber-300"
										>
											Reset
										</button>
									</div>
								);
							})}
						</div>

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
												: `${MAX_HIGHLIGHT_LABEL_LENGTH} characters for a label, ${MAX_HIGHLIGHT_MEANING_LENGTH} for a meaning`}
							</p>
							<div className="flex flex-shrink-0 items-center gap-2">
								<button
									type="button"
									onClick={applyPresets}
									disabled={saving}
									className="min-h-11 rounded-xl border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 text-sm font-bold text-neutral-600 transition-colors hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-45 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
								>
									Use suggested labels
								</button>
								{/* Dark ink on the amber fill in both themes: white on amber-500 is
								    only 2.15:1, well under the 4.5:1 WCAG AA floor for this 14px
								    bold label. neutral-950 gives 9.22:1 at rest, 6.21:1 on hover. */}
								<button
									type="button"
									onClick={() => void save()}
									disabled={saving || !dirty}
									className="min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-bold text-neutral-950 shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-400 dark:text-neutral-950 dark:hover:bg-amber-300"
								>
									{saving ? "Saving…" : "Save labels"}
								</button>
							</div>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
