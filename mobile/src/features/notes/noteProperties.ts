import type { NoteProperties, NotePropertyValue } from "./types";

/**
 * Editing helpers for note metadata - the custom key/value properties and the
 * alias list. Every value the UI produces goes through `parsePropertyValue`,
 * so a malformed number or an empty list never reaches the PATCH body.
 */

export type NotePropertyType = "text" | "number" | "checkbox" | "list";

export const PROPERTY_TYPES: NotePropertyType[] = ["text", "number", "checkbox", "list"];

export const PROPERTY_TYPE_LABELS: Record<NotePropertyType, string> = {
	text: "Text",
	number: "Number",
	checkbox: "Checkbox",
	list: "List",
};

export function propertyTypeOf(value: NotePropertyValue): NotePropertyType {
	if (Array.isArray(value)) return "list";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "checkbox";
	return "text";
}

/** Read-only rendering of a value. */
export function formatPropertyValue(value: NotePropertyValue): string {
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "boolean") return value ? "Yes" : "No";
	return String(value);
}

/** Seeds the text input when an existing property is reopened for editing. */
export function propertyValueToInput(value: NotePropertyValue): string {
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

/**
 * Parse raw input for a chosen type. Returns null when the input cannot make a
 * valid value, which is what disables the save action in the UI.
 */
export function parsePropertyValue(
	type: NotePropertyType,
	raw: string
): NotePropertyValue | null {
	switch (type) {
		case "number": {
			const trimmed = raw.trim();
			if (!trimmed) return null;
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : null;
		}
		case "checkbox": {
			const trimmed = raw.trim().toLowerCase();
			if (trimmed === "true") return true;
			if (trimmed === "false") return false;
			return null;
		}
		case "list": {
			const items = raw
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
			return items.length > 0 ? items : null;
		}
		default: {
			const trimmed = raw.trim();
			return trimmed ? trimmed : null;
		}
	}
}

/** Keys are compared case-insensitively, so only whitespace is normalized here. */
export function normalizePropertyKey(raw: string): string {
	return raw.replace(/\s+/g, " ").trim();
}

/** True when `key` would collide with an existing one, ignoring `ignoreKey` (the row being edited). */
export function propertyKeyTaken(
	properties: NoteProperties | null,
	key: string,
	ignoreKey?: string
): boolean {
	const needle = normalizePropertyKey(key).toLowerCase();
	if (!needle) return false;
	return Object.keys(properties ?? {}).some(
		(existing) => existing !== ignoreKey && existing.toLowerCase() === needle
	);
}

/** Alphabetical so the sheet does not reshuffle rows after every edit. */
export function propertyEntries(
	properties: NoteProperties | null
): [string, NotePropertyValue][] {
	return Object.entries(properties ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

/** Writing under a renamed key drops the old one, so a rename is a single PATCH. */
export function setNoteProperty(
	properties: NoteProperties | null,
	key: string,
	value: NotePropertyValue,
	previousKey?: string
): NoteProperties {
	const next: NoteProperties = { ...(properties ?? {}) };
	if (previousKey && previousKey !== key) delete next[previousKey];
	next[key] = value;
	return next;
}

export function removeNoteProperty(
	properties: NoteProperties | null,
	key: string
): NoteProperties {
	const next: NoteProperties = { ...(properties ?? {}) };
	delete next[key];
	return next;
}

/** Trim, drop blanks, and keep the first spelling of any case-insensitive duplicate. */
export function normalizeAliases(aliases: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const alias of aliases) {
		const trimmed = alias.replace(/\s+/g, " ").trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}
