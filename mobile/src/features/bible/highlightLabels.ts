import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { apiJson, type GetToken } from "@/lib/api";
import { HIGHLIGHT_PRESETS } from "./highlights";

/**
 * B6: what the user calls each highlight colour ("Yellow" -> "Promises").
 * The synced preference document's `highlightLabels` map is the store of
 * record (the backend lane's field, keyed by the hue's lowercase name);
 * AsyncStorage is the first-paint cache so the reader's picker never waits
 * on the network. Mirrors src/components/settings/HighlightLabelsSection.tsx
 * on web.
 */

const LABELS_STORAGE_KEY = "sureword.highlight-labels.v1";
/** Mirrors MAX_HIGHLIGHT_LABEL_LENGTH in src/lib/preferences-contract.ts. */
export const MAX_HIGHLIGHT_LABEL_LENGTH = 24;

export type HighlightLabels = Record<string, string>;

export async function readHighlightLabels(): Promise<HighlightLabels> {
	try {
		const raw = await AsyncStorage.getItem(LABELS_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as HighlightLabels;
	} catch {
		return {};
	}
}

export async function writeHighlightLabels(labels: HighlightLabels): Promise<void> {
	await AsyncStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify(labels)).catch(() => undefined);
}

/** The custom label for a hex, or null when the hue name stands. */
export function presetLabelForHex(labels: HighlightLabels, hex: string): string | null {
	const preset = HIGHLIGHT_PRESETS.find(
		(entry) => entry.color.toLowerCase() === hex.toLowerCase()
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

/** Pull the account document's labels into the local cache. Best effort. */
export async function hydrateHighlightLabels(getToken: GetToken): Promise<HighlightLabels> {
	const local = await readHighlightLabels();
	try {
		const server = labelsFromDocument(await apiJson(getToken, "/api/preferences"));
		if (!server) return local;
		await writeHighlightLabels(server);
		return server;
	} catch {
		return local;
	}
}

/** Persist a full map: local cache first, then PATCH (which replaces the map). */
export async function saveHighlightLabels(
	getToken: GetToken,
	labels: HighlightLabels
): Promise<void> {
	await writeHighlightLabels(labels);
	await apiJson(getToken, "/api/preferences", {
		method: "PATCH",
		body: { highlightLabels: labels },
	});
}

/**
 * Reactive-enough read: the local cache paints first, then the account
 * document refreshes it. Without the second half a rename made on another
 * device shows hue names here until Settings is opened.
 */
export function useHighlightLabels(reloadKey?: unknown, getToken?: GetToken): HighlightLabels {
	const [labels, setLabels] = useState<HighlightLabels>({});
	useEffect(() => {
		let cancelled = false;
		void readHighlightLabels().then((stored) => {
			if (!cancelled) setLabels(stored);
		});
		if (getToken) {
			void hydrateHighlightLabels(getToken).then((synced) => {
				if (!cancelled) setLabels(synced);
			});
		}
		return () => {
			cancelled = true;
		};
	}, [reloadKey, getToken]);
	return labels;
}
