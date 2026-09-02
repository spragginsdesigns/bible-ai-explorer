import { describe, expect, it } from "vitest";
import {
	CANTILLATION_FIRST,
	CANTILLATION_LAST,
	isRightToLeft,
	stripCantillation,
} from "./originalText";

const ch = (code: number) => String.fromCharCode(code);

// Consonants and vowel points must survive; only the accents come off.
const ALEPH = ch(0x05d0);
const LAMED = ch(0x05dc);
const HATAF_SEGOL = ch(0x05b1); // vowel point, kept
const HOLAM = ch(0x05b9); // vowel point, kept
const ETNAHTA = ch(0x0591); // cantillation, stripped (range start)
const MERKHA = ch(0x05a5); // cantillation, stripped (mid range)
const MASORA_CIRCLE = ch(0x05af); // cantillation, stripped (range end)
const METEG = ch(0x05bd); // vowel-point block, kept

describe("stripCantillation", () => {
	it("removes the whole accent range and keeps consonants", () => {
		const marked = ALEPH + ETNAHTA + LAMED + MERKHA + MASORA_CIRCLE;
		expect(stripCantillation(marked)).toBe(ALEPH + LAMED);
	});

	it("keeps the vowel points that carry pronunciation", () => {
		const word = ALEPH + HATAF_SEGOL + MERKHA + LAMED + HOLAM + METEG;
		expect(stripCantillation(word)).toBe(ALEPH + HATAF_SEGOL + LAMED + HOLAM + METEG);
	});

	it("strips every mark in the range and nothing outside it", () => {
		for (let code = CANTILLATION_FIRST; code <= CANTILLATION_LAST; code += 1) {
			expect(stripCantillation(ALEPH + ch(code))).toBe(ALEPH);
		}
		expect(stripCantillation(ch(CANTILLATION_FIRST - 1))).toBe(ch(CANTILLATION_FIRST - 1));
		expect(stripCantillation(ch(CANTILLATION_LAST + 1))).toBe(ch(CANTILLATION_LAST + 1));
	});

	it("leaves Greek and its diacritics untouched", () => {
		const agape = "ἀγάπη";
		expect(stripCantillation(agape)).toBe(agape);
	});

	it("handles an empty string", () => {
		expect(stripCantillation("")).toBe("");
	});

	it("is not stateful across calls despite the shared global regex", () => {
		const word = ALEPH + ETNAHTA + LAMED;
		expect(stripCantillation(word)).toBe(ALEPH + LAMED);
		expect(stripCantillation(word)).toBe(ALEPH + LAMED);
		expect(stripCantillation(word)).toBe(ALEPH + LAMED);
	});
});

describe("isRightToLeft", () => {
	it("is true for Hebrew and false for Greek", () => {
		expect(isRightToLeft("Hebrew")).toBe(true);
		expect(isRightToLeft("Greek")).toBe(false);
	});
});
