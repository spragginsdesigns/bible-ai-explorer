import type { VerseWordDetail, VerseWordRow } from "./verse-words-contract";

/**
 * The row half of the model's study output, before repair. This module has
 * no value imports so the plain-node logic tests can load it directly; the
 * caller strips dashes and trims after repair.
 */
export interface StudyRowOutput {
	wordIndexes: number[];
	translit: string;
	kjv: string;
	sense: string;
}

/**
 * The model may skip an index, double one, or return rows out of order.
 * Rather than fail the tap, rebuild a valid partition: keep the first row
 * that claims each index, keep only a row's first contiguous stretch, order
 * rows by their first index, and give every unclaimed word a row of its own
 * built from its gloss.
 */
export function repairRows(rows: StudyRowOutput[], details: VerseWordDetail[]): VerseWordRow[] {
	const claimed = new Set<number>();
	const kept: { first: number; indexes: number[]; row: StudyRowOutput }[] = [];
	for (const row of rows) {
		const indexes = [...new Set(row.wordIndexes)]
			.filter((index) => Number.isInteger(index) && index >= 0 && index < details.length && !claimed.has(index))
			.sort((a, b) => a - b);
		if (indexes.length === 0) continue;
		for (const index of indexes) claimed.add(index);
		// A row is a stretch of adjacent words. If the model bundled words
		// from two places, keep its text for the first stretch and let the
		// rest fall through as single-word rows so the script stays readable.
		const runs: number[][] = [];
		for (const index of indexes) {
			const run = runs[runs.length - 1];
			if (run && run[run.length - 1] === index - 1) run.push(index);
			else runs.push([index]);
		}
		kept.push({ first: runs[0][0], indexes: runs[0], row });
		for (const run of runs.slice(1)) {
			for (const index of run) claimed.delete(index);
		}
	}
	const singles = details
		.map((_, index) => index)
		.filter((index) => !claimed.has(index))
		.map((index) => ({
			first: index,
			indexes: [index],
			row: {
				wordIndexes: [index],
				translit: details[index].translit ?? "",
				kjv: "",
				sense: details[index].gloss ?? "",
			},
		}));
	return [...kept, ...singles]
		.sort((a, b) => a.first - b.first)
		.map(({ indexes, row }) => ({
			wordIndexes: indexes,
			original: indexes.map((index) => details[index].text).join(" "),
			translit: row.translit,
			kjv: row.kjv,
			sense: row.sense,
		}));
}
