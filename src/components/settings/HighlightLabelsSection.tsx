"use client";

import React, { useCallback, useEffect, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { notifyPreferencesChanged, subscribePreferences } from "@/lib/preferencesSync";

/**
 * B6: what the user calls each highlight colour ("Yellow" -> "Promises"), so
 * the reader, the assistant and the daily cross can say "you marked this as
 * a promise". Stored in the synced preference document's `highlightLabels`
 * map (the backend lane's field; keyed by the hue's lowercase name, empty
 * means the hue name stands). Local cache lives in localStorage so the
 * reader's picker paints before the account document does.
 *
 * This file also owns the readers other surfaces use: useHighlightLabels
 * (reactive) and highlightLabelForHex (the picker's "Marked as …" caption).
 */

const LABELS_PREF_KEY = "sureword-highlight-labels";
/** Mirrors MAX_HIGHLIGHT_LABEL_LENGTH in src/lib/preferences-contract.ts. */
const MAX_LABEL_LENGTH = 24;

export type HighlightLabels = Record<string, string>;

export function readHighlightLabels(): HighlightLabels {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(LABELS_PREF_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as HighlightLabels;
	} catch {
		return {};
	}
}

function writeHighlightLabels(labels: HighlightLabels) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(LABELS_PREF_KEY, JSON.stringify(labels));
}

/** Reactive read for the pickers; re-reads when any preference changes land. */
export function useHighlightLabels(): HighlightLabels {
	const [labels, setLabels] = useState<HighlightLabels>({});
	useEffect(() => {
		setLabels(readHighlightLabels());
		// The cache is this device's; the account is the record. Without this a
		// rename made on the phone shows hue names here until Settings is opened.
		fetch("/api/preferences", { credentials: "same-origin" })
			.then((res) => (res.ok ? res.json() : null))
			.then((doc: { highlightLabels?: HighlightLabels } | null) => {
				if (!doc?.highlightLabels) return;
				writeHighlightLabels(doc.highlightLabels);
				setLabels(doc.highlightLabels);
			})
			.catch(() => {});
		return subscribePreferences(() => setLabels(readHighlightLabels()));
	}, []);
	return labels;
}

/** The custom label for a hex, or null when the hue name stands. */
export function highlightLabelForHex(labels: HighlightLabels, hex: string): string | null {
	const preset = HIGHLIGHT_COLORS.find(
		(entry) => entry.hex.toLowerCase() === hex.toLowerCase()
	);
	if (!preset) return null;
	return labels[preset.name.toLowerCase()] ?? null;
}

/** The account document's labels, or null when the field is not deployed yet. */
function labelsFromDocument(document: unknown): HighlightLabels | null {
	const doc = document as { highlightLabels?: unknown } | null;
	if (!doc || !doc.highlightLabels || typeof doc.highlightLabels !== "object") return null;
	return doc.highlightLabels as HighlightLabels;
}

const HighlightLabelsSection: React.FC = () => {
	const [labels, setLabels] = useState<HighlightLabels>({});
	const [drafts, setDrafts] = useState<HighlightLabels>({});
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLabels(readHighlightLabels());
		// Hydrate from the account document; a 400/older deploy leaves the
		// local cache standing.
		fetch("/api/preferences", { credentials: "same-origin" })
			.then((res) => (res.ok ? res.json() : null))
			.then((document) => {
				const server = labelsFromDocument(document);
				if (!server) return;
				writeHighlightLabels(server);
				setLabels(server);
				notifyPreferencesChanged();
			})
			.catch(() => {});
	}, []);

	const save = useCallback(
		async (colorId: string, rawValue: string) => {
			const value = rawValue.trim().slice(0, MAX_LABEL_LENGTH);
			const previous = labels;
			const next = { ...labels };
			if (value) next[colorId] = value;
			else delete next[colorId];
			setLabels(next);
			writeHighlightLabels(next);
			notifyPreferencesChanged();
			setError(null);
			try {
				// PATCH replaces the whole map, so send all of it.
				const res = await fetch("/api/preferences", {
					method: "PATCH",
					credentials: "same-origin",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ highlightLabels: next }),
				});
				if (!res.ok) throw new Error(String(res.status));
			} catch {
				setLabels(previous);
				writeHighlightLabels(previous);
				notifyPreferencesChanged();
				setError("Couldn't save the name. Try again.");
			}
		},
		[labels]
	);

	return (
		<section id="highlight-names" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className="text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1">
				HIGHLIGHT NAMES
			</h2>
			<div className="glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3">
				<p className="text-xs leading-[17px] text-neutral-400 dark:text-neutral-500">
					Name a colour for what you mark with it — &ldquo;Promises&rdquo;,
					&ldquo;Commands&rdquo;. SureWord uses your names when it talks about your highlights.
					Leave blank to keep the colour&apos;s name.
				</p>
				<div className="flex flex-col gap-2">
					{HIGHLIGHT_COLORS.map((preset) => {
						const id = preset.name.toLowerCase();
						const shown = drafts[id] ?? labels[id] ?? "";
						return (
							<div key={preset.hex} className="flex items-center gap-3">
								<span
									aria-hidden
									className="h-6 w-6 flex-shrink-0 rounded-full border border-black/10 dark:border-white/15"
									style={{ backgroundColor: preset.hex }}
								/>
								<input
									value={shown}
									maxLength={MAX_LABEL_LENGTH}
									placeholder={preset.name}
									aria-label={`Name for the ${preset.name} highlight`}
									onChange={(event) =>
										setDrafts((prev) => ({ ...prev, [id]: event.target.value }))
									}
									onBlur={() => {
										if ((drafts[id] ?? labels[id] ?? "") !== (labels[id] ?? "")) {
											void save(id, drafts[id] ?? "");
										}
										setDrafts((prev) => {
											const next = { ...prev };
											delete next[id];
											return next;
										});
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") event.currentTarget.blur();
									}}
									className="min-w-0 flex-1 rounded-lg border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2 text-[14px] text-neutral-800 dark:text-neutral-200 outline-none focus:border-amber-600/50 dark:focus:border-amber-400/50"
								/>
							</div>
						);
					})}
				</div>
				{error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
			</div>
		</section>
	);
};

export default HighlightLabelsSection;
