/**
 * Turns the morphology codes carried by the bundled original-language text
 * (src/data/originals/*.json, third element of each [text, strongs, morph]
 * word triple) into plain English, so a reader who has never parsed a verb can
 * still be told what one is.
 *
 * Two unrelated schemes share that one field:
 *
 *   OT  - OSHB (Open Scriptures Hebrew Bible) codes, e.g. "HC/Vqw3ms".
 *         A leading language letter, then "/"-separated morphemes: prefixes
 *         first, the head word, then any pronominal suffix.
 *         Tables transcribed from the published spec at
 *         https://hb.openscriptures.org/parsing/HebrewMorphologyCodes.html
 *   NT  - Robinson's parsing codes, e.g. "V-2AAP-NSM". A part-of-speech token,
 *         then a declension or a tense/voice/mood token, then modifiers.
 *
 * An unrecognised letter is skipped rather than thrown on. The bundled texts
 * carry a long tail of rare codes (and OSHB writes "x" wherever a slot is
 * genuinely unspecified), and a word with one puzzling slot is still worth
 * showing; refusing the whole word would blank the panel over a detail.
 */

export interface DecodedMorphology {
	/** e.g. "noun", "verb", "preposition", "definite article", "pronominal suffix" */
	partOfSpeech: string;
	/** Short lowercase feature chips in a sensible order, e.g. ["common", "masculine", "singular", "construct"] or ["qal", "perfect", "3rd person", "masculine", "singular"] */
	features: string[];
	/** One readable line, e.g. "noun, masculine singular, construct form" or "verb, qal perfect, third person masculine singular" */
	summary: string;
}

export interface DecodedWord {
	/** One entry per morpheme, in the order they appear in the code (prefixes first, suffix last). A one-morpheme word has one entry. */
	parts: DecodedMorphology[];
	/** The main (head) morpheme: the noun or verb rather than its prefix. Usually the first non-prefix, non-suffix part. */
	head: DecodedMorphology;
	/** Whole word in one line, e.g. "preposition + noun, masculine singular, construct form" */
	summary: string;
}

/**
 * Record lookups are typed as always-present without noUncheckedIndexedAccess,
 * which would quietly hand back `undefined` as `string`. Every table read goes
 * through here so a missing letter is an absent feature, not a phantom one.
 */
function look(table: Record<string, string>, key: string | undefined): string | undefined {
	if (key === undefined || key === "") return undefined;
	return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Feature chips say "3rd person"; prose summaries read "third person". */
const PERSON_CHIP: Record<string, string> = { "1": "1st person", "2": "2nd person", "3": "3rd person" };
const PERSON_WORD: Record<string, string> = { "1": "first person", "2": "second person", "3": "third person" };

function assemble(partOfSpeech: string, features: string[], clauses: string[]): DecodedMorphology {
	return {
		partOfSpeech,
		features,
		summary: [partOfSpeech, ...clauses.filter((clause) => clause.length > 0)].join(", "),
	};
}

/** Drops empties before joining, so an unspecified slot leaves no double space. */
function phrase(words: (string | undefined)[]): string {
	return words.filter((word): word is string => word !== undefined && word.length > 0).join(" ");
}

/* ------------------------------------------------------------------ Hebrew */

const HEBREW_POS: Record<string, string> = {
	A: "adjective",
	C: "conjunction",
	D: "adverb",
	N: "noun",
	P: "pronoun",
	R: "preposition",
	S: "suffix",
	T: "particle",
	V: "verb",
};

/**
 * Where a type letter creates a category a reader would name differently
 * ("definite article", not "particle of type d"), it replaces the bare part of
 * speech. Types that only narrow it (a common noun is still a noun) stay in
 * HEBREW_TYPE_CHIPS instead.
 */
const HEBREW_TYPE_LABELS: Record<string, Record<string, string>> = {
	A: { a: "adjective", c: "cardinal number", g: "gentilic adjective", o: "ordinal number" },
	N: { c: "noun", g: "gentilic noun", p: "proper noun" },
	P: {
		d: "demonstrative pronoun",
		f: "indefinite pronoun",
		i: "interrogative pronoun",
		p: "personal pronoun",
		r: "relative pronoun",
	},
	R: { d: "preposition with article" },
	S: { d: "directional he", h: "paragogic he", n: "paragogic nun", p: "pronominal suffix" },
	T: {
		a: "particle of affirmation",
		d: "definite article",
		e: "particle of exhortation",
		i: "interrogative particle",
		j: "interjection",
		m: "demonstrative particle",
		n: "negative particle",
		o: "direct object marker",
		r: "relative particle",
	},
};

const HEBREW_TYPE_CHIPS: Record<string, Record<string, string>> = {
	N: { c: "common" },
};

// OSHB "b" marks a noun that takes either gender (ruach, amal); "both" alone
// reads as a typo next to "singular", so it is spelled out.
const HEBREW_GENDER: Record<string, string> = { b: "masculine or feminine", c: "common", f: "feminine", m: "masculine" };
const HEBREW_NUMBER: Record<string, string> = { s: "singular", p: "plural", d: "dual" };
const HEBREW_STATE: Record<string, string> = { a: "absolute", c: "construct", d: "determined" };

const HEBREW_STEMS: Record<string, string> = {
	q: "qal",
	N: "niphal",
	p: "piel",
	P: "pual",
	h: "hiphil",
	H: "hophal",
	t: "hithpael",
	o: "polel",
	O: "polal",
	r: "hithpolel",
	m: "poel",
	M: "poal",
	k: "palel",
	K: "pulal",
	Q: "qal passive",
	l: "pilpel",
	L: "polpal",
	f: "hithpalpel",
	D: "nithpael",
	j: "pealal",
	i: "pilel",
	u: "hothpaal",
	c: "tiphil",
	v: "hishtaphel",
	w: "nithpalel",
	y: "nithpoel",
	z: "hithpoel",
};

const ARAMAIC_STEMS: Record<string, string> = {
	q: "peal",
	Q: "peil",
	u: "hithpeel",
	p: "pael",
	P: "ithpaal",
	M: "hithpaal",
	a: "aphel",
	h: "haphel",
	s: "saphel",
	e: "shaphel",
	H: "hophal",
	i: "ithpeel",
	t: "hishtaphel",
	v: "ishtaphel",
	w: "hithaphel",
	o: "polel",
	z: "ithpoel",
	r: "hithpolel",
	f: "hithpalpel",
	b: "hephal",
	c: "tiphel",
	m: "poel",
	l: "palpel",
	L: "ithpalpel",
	O: "ithpolel",
	G: "ittaphal",
};

const HEBREW_CONJUGATIONS: Record<string, string> = {
	p: "perfect",
	q: "sequential perfect",
	i: "imperfect",
	w: "sequential imperfect",
	h: "cohortative",
	j: "jussive",
	v: "imperative",
	r: "active participle",
	s: "passive participle",
	a: "infinitive absolute",
	c: "infinitive construct",
};

/** Participles inflect like nouns (gender, number, state); infinitives not at all. */
const HEBREW_PARTICIPLES = new Set(["r", "s"]);
const HEBREW_INFINITIVES = new Set(["a", "c"]);

/** Nominals carry gender, number and state; pronouns and suffixes carry person instead of state. */
const HEBREW_NOMINAL_POS = new Set(["A", "N"]);
const HEBREW_PERSONAL_POS = new Set(["P", "S"]);

function decodeHebrewVerb(rest: string, aramaic: boolean): DecodedMorphology {
	const stem = look(aramaic ? ARAMAIC_STEMS : HEBREW_STEMS, rest[0]);
	const conjugationLetter = rest[1];
	const conjugation = look(HEBREW_CONJUGATIONS, conjugationLetter);
	const slots = rest.slice(2);

	const features: string[] = [];
	if (stem !== undefined) features.push(stem);
	if (conjugation !== undefined) features.push(conjugation);

	const clauses: string[] = [phrase([stem, conjugation])];

	if (conjugationLetter !== undefined && HEBREW_INFINITIVES.has(conjugationLetter)) {
		return assemble("verb", features, clauses);
	}

	if (conjugationLetter !== undefined && HEBREW_PARTICIPLES.has(conjugationLetter)) {
		const gender = look(HEBREW_GENDER, slots[0]);
		const number = look(HEBREW_NUMBER, slots[1]);
		const state = look(HEBREW_STATE, slots[2]);
		for (const feature of [gender, number, state]) {
			if (feature !== undefined) features.push(feature);
		}
		clauses.push(phrase([gender, number]));
		if (state !== undefined) clauses.push(`${state} form`);
		return assemble("verb", features, clauses);
	}

	const person = slots[0];
	const gender = look(HEBREW_GENDER, slots[1]);
	const number = look(HEBREW_NUMBER, slots[2]);
	const personChip = look(PERSON_CHIP, person);
	if (personChip !== undefined) features.push(personChip);
	for (const feature of [gender, number]) {
		if (feature !== undefined) features.push(feature);
	}
	clauses.push(phrase([look(PERSON_WORD, person), gender, number]));
	return assemble("verb", features, clauses);
}

function decodeHebrewSegment(segment: string, aramaic: boolean): DecodedMorphology | null {
	const pos = segment[0];
	const base = look(HEBREW_POS, pos);
	if (pos === undefined || base === undefined) return null;

	const rest = segment.slice(1);
	if (pos === "V") return decodeHebrewVerb(rest, aramaic);

	// Every remaining part of speech spends its first letter on a type, even
	// when that type is unknown ("Nxxxa"), so the slots always start at index 1.
	const typeLetter = rest[0];
	const partOfSpeech = look(HEBREW_TYPE_LABELS[pos] ?? {}, typeLetter) ?? base;
	const typeChip = look(HEBREW_TYPE_CHIPS[pos] ?? {}, typeLetter);
	const slots = rest.slice(1);

	const features: string[] = [];
	if (typeChip !== undefined) features.push(typeChip);
	const clauses: string[] = [];

	if (HEBREW_NOMINAL_POS.has(pos)) {
		const gender = look(HEBREW_GENDER, slots[0]);
		const number = look(HEBREW_NUMBER, slots[1]);
		const state = look(HEBREW_STATE, slots[2]);
		for (const feature of [gender, number, state]) {
			if (feature !== undefined) features.push(feature);
		}
		clauses.push(phrase([gender, number]));
		if (state !== undefined) clauses.push(`${state} form`);
	} else if (HEBREW_PERSONAL_POS.has(pos)) {
		const person = slots[0];
		const gender = look(HEBREW_GENDER, slots[1]);
		const number = look(HEBREW_NUMBER, slots[2]);
		const personChip = look(PERSON_CHIP, person);
		if (personChip !== undefined) features.push(personChip);
		for (const feature of [gender, number]) {
			if (feature !== undefined) features.push(feature);
		}
		clauses.push(phrase([look(PERSON_WORD, person), gender, number]));
	}

	return assemble(partOfSpeech, features, clauses);
}

/** Conjunctions, prepositions and the article only ever attach to what follows. */
function isHebrewPrefix(segment: string): boolean {
	return segment[0] === "C" || segment[0] === "R" || segment === "Td";
}

function isHebrewSuffix(segment: string): boolean {
	return segment[0] === "S";
}

function decodeHebrew(code: string): DecodedWord | null {
	const aramaic = code[0] === "A";
	const decoded: { raw: string; part: DecodedMorphology }[] = [];
	for (const segment of code.slice(1).split("/")) {
		const part = decodeHebrewSegment(segment, aramaic);
		if (part !== null) decoded.push({ raw: segment, part });
	}
	if (decoded.length === 0) return null;

	let headIndex = decoded.findIndex((entry) => !isHebrewPrefix(entry.raw) && !isHebrewSuffix(entry.raw));
	if (headIndex < 0) {
		// An all-prefix word ("HC/R"): the last thing before any suffix leads.
		for (let index = decoded.length - 1; index >= 0; index -= 1) {
			if (!isHebrewSuffix(decoded[index].raw)) {
				headIndex = index;
				break;
			}
		}
	}
	if (headIndex < 0) headIndex = 0;

	const parts = decoded.map((entry) => entry.part);
	return {
		parts,
		head: parts[headIndex],
		summary: parts.map((part) => part.summary).join(" + "),
	};
}

/* ------------------------------------------------------------------- Greek */

const GREEK_POS: Record<string, string> = {
	N: "noun",
	A: "adjective",
	T: "definite article",
	P: "personal pronoun",
	R: "relative pronoun",
	C: "reciprocal pronoun",
	D: "demonstrative pronoun",
	K: "correlative pronoun",
	I: "interrogative pronoun",
	X: "indefinite pronoun",
	Q: "correlative or interrogative pronoun",
	F: "reflexive pronoun",
	S: "possessive pronoun",
	V: "verb",
	ADV: "adverb",
	CONJ: "conjunction",
	COND: "conditional particle",
	PRT: "particle",
	PREP: "preposition",
	INJ: "interjection",
	ARAM: "Aramaic transliteration",
	HEB: "Hebrew transliteration",
};

/** These never decline, so every tail token is a modifier rather than a case. */
const GREEK_INDECLINABLE_POS = new Set(["ADV", "CONJ", "COND", "PRT", "PREP", "INJ", "ARAM", "HEB"]);

/** Tail tokens that replace the part of speech outright: "N-PRI", "A-NUI". */
const GREEK_INDECLINABLE_TAILS: Record<string, string> = {
	PRI: "proper noun",
	NUI: "numeral",
	LI: "letter",
	OI: "noun",
};

const GREEK_MODIFIERS: Record<string, string> = {
	ATT: "Attic form",
	C: "comparative",
	S: "superlative",
	N: "negative",
	I: "interrogative",
	K: "crasis",
	P: "particle attached",
	ABB: "abbreviated",
};

const GREEK_CASE: Record<string, string> = {
	N: "nominative",
	G: "genitive",
	D: "dative",
	A: "accusative",
	V: "vocative",
};
const GREEK_NUMBER: Record<string, string> = { S: "singular", P: "plural" };
const GREEK_GENDER: Record<string, string> = { M: "masculine", F: "feminine", N: "neuter" };

const GREEK_TENSE: Record<string, string> = {
	P: "present",
	I: "imperfect",
	F: "future",
	"2F": "second future",
	A: "aorist",
	"2A": "second aorist",
	R: "perfect",
	"2R": "second perfect",
	L: "pluperfect",
	"2L": "second pluperfect",
	X: "no tense stated",
};

const GREEK_VOICE: Record<string, string> = {
	A: "active",
	M: "middle",
	P: "passive",
	E: "either middle or passive",
	D: "middle deponent",
	O: "passive deponent",
	N: "middle or passive deponent",
	Q: "impersonal active",
	X: "no voice stated",
};

const GREEK_MOOD: Record<string, string> = {
	I: "indicative",
	S: "subjunctive",
	O: "optative",
	M: "imperative",
	N: "infinitive",
	P: "participle",
	R: "imperative sense participle",
};

interface Declension {
	features: string[];
	clauses: string[];
}

/**
 * Decodes the one token that carries case, number and gender, in whichever of
 * Robinson's shapes it takes. Shapes are told apart by length and by whether
 * they open on a person digit, which never collides with a case letter.
 */
function decodeGreekDeclension(token: string): Declension | null {
	const possessive = /^([123])([SP])([NGDAV])([SP])([MFN])$/.exec(token);
	if (possessive !== null) {
		const [, person, possessorNumber, caseLetter, number, gender] = possessive;
		const owner = phrase([look(PERSON_CHIP, person), look(GREEK_NUMBER, possessorNumber), "possessor"]);
		const grammaticalCase = look(GREEK_CASE, caseLetter);
		const decodedNumber = look(GREEK_NUMBER, number);
		const decodedGender = look(GREEK_GENDER, gender);
		return {
			features: [owner, grammaticalCase, decodedNumber, decodedGender].filter(
				(feature): feature is string => feature !== undefined && feature.length > 0
			),
			clauses: [
				phrase([look(PERSON_WORD, person), look(GREEK_NUMBER, possessorNumber), "possessor"]),
				phrase([grammaticalCase, decodedNumber, decodedGender]),
			],
		};
	}

	const withPerson = /^([123])([NGDAV])([SP])([MFN])?$/.exec(token);
	if (withPerson !== null) {
		const [, person, caseLetter, number, gender] = withPerson;
		const grammaticalCase = look(GREEK_CASE, caseLetter);
		const decodedNumber = look(GREEK_NUMBER, number);
		const decodedGender = look(GREEK_GENDER, gender);
		return {
			features: [look(PERSON_CHIP, person), grammaticalCase, decodedNumber, decodedGender].filter(
				(feature): feature is string => feature !== undefined
			),
			clauses: [phrase([look(PERSON_WORD, person), grammaticalCase, decodedNumber, decodedGender])],
		};
	}

	const plain = /^([NGDAV])([SP])([MFN])?$/.exec(token);
	if (plain !== null) {
		const [, caseLetter, number, gender] = plain;
		const grammaticalCase = look(GREEK_CASE, caseLetter);
		const decodedNumber = look(GREEK_NUMBER, number);
		const decodedGender = look(GREEK_GENDER, gender);
		return {
			features: [grammaticalCase, decodedNumber, decodedGender].filter(
				(feature): feature is string => feature !== undefined
			),
			clauses: [phrase([grammaticalCase, decodedNumber, decodedGender])],
		};
	}

	return null;
}

/** Finite verbs end on person plus number ("3S") rather than a declension. */
function decodeGreekPersonNumber(token: string): Declension | null {
	const match = /^([123])([SP])$/.exec(token);
	if (match === null) return null;
	const [, person, number] = match;
	const decodedNumber = look(GREEK_NUMBER, number);
	return {
		features: [look(PERSON_CHIP, person), decodedNumber].filter(
			(feature): feature is string => feature !== undefined
		),
		clauses: [phrase([look(PERSON_WORD, person), decodedNumber])],
	};
}

function decodeGreekVerb(tokens: string[]): DecodedMorphology {
	const features: string[] = [];
	const clauses: string[] = [];
	let index = 0;

	const parsed = /^(2?[PIFARLX])([AMPEDONQX])([ISOMNPR])$/.exec(tokens[0] ?? "");
	if (parsed !== null) {
		index = 1;
		const [, tenseLetter, voiceLetter, moodLetter] = parsed;
		const tense = look(GREEK_TENSE, tenseLetter);
		const voice = look(GREEK_VOICE, voiceLetter);
		const mood = look(GREEK_MOOD, moodLetter);
		for (const feature of [tense, voice, mood]) {
			if (feature !== undefined) features.push(feature);
		}
		clauses.push(phrase([tense, voice, mood]));
	}

	const next = tokens[index];
	if (next !== undefined) {
		const inflection = decodeGreekPersonNumber(next) ?? decodeGreekDeclension(next);
		if (inflection !== null) {
			index += 1;
			features.push(...inflection.features);
			clauses.push(...inflection.clauses);
		}
	}

	for (const token of tokens.slice(index)) {
		const modifier = look(GREEK_MODIFIERS, token);
		if (modifier !== undefined) {
			features.push(modifier);
			clauses.push(modifier);
		}
	}

	return assemble("verb", features, clauses);
}

function decodeGreek(pos: string, tokens: string[]): DecodedWord | null {
	const base = look(GREEK_POS, pos);
	if (base === undefined) return null;

	const part = ((): DecodedMorphology => {
		if (pos === "V") return decodeGreekVerb(tokens);

		let partOfSpeech = base;
		const features: string[] = [];
		const clauses: string[] = [];
		let index = 0;

		if (!GREEK_INDECLINABLE_POS.has(pos)) {
			const first = tokens[0];
			const indeclinable = look(GREEK_INDECLINABLE_TAILS, first);
			if (indeclinable !== undefined) {
				index = 1;
				partOfSpeech = indeclinable;
				features.push("indeclinable");
				clauses.push("indeclinable");
			} else if (first !== undefined) {
				const inflection = decodeGreekDeclension(first);
				if (inflection !== null) {
					index = 1;
					features.push(...inflection.features);
					clauses.push(...inflection.clauses);
				}
			}
		}

		for (const token of tokens.slice(index)) {
			const modifier = look(GREEK_MODIFIERS, token);
			if (modifier !== undefined) {
				features.push(modifier);
				clauses.push(modifier);
			}
		}

		return assemble(partOfSpeech, features, clauses);
	})();

	return { parts: [part], head: part, summary: part.summary };
}

/* ----------------------------------------------------------------- Entry */

export function decodeMorphology(code: string): DecodedWord | null {
	const trimmed = code.trim();
	if (trimmed.length === 0) return null;

	// Greek is checked first because "HEB" and "ARAM" would otherwise be read as
	// a Hebrew or Aramaic language letter followed by nonsense.
	const tokens = trimmed.split("-");
	const pos = tokens[0];
	if (look(GREEK_POS, pos) !== undefined) return decodeGreek(pos, tokens.slice(1));

	if (trimmed[0] === "H" || trimmed[0] === "A") return decodeHebrew(trimmed);

	return null;
}
