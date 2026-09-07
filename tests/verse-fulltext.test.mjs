import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

// verse-fulltext.ts imports the Prisma client, which this logic test must not
// pull in; strip the imports and evaluate the module for its pure half, the
// same way tests/memory-tools.test.mjs loads its builder.
const source = readFileSync(
	fileURLToPath(new URL("../src/lib/bible/verse-fulltext.ts", import.meta.url)),
	"utf8"
)
	.replace(/^import[^\r\n]*(?:\r?\n|$)/gm, "")
	.replace(/^export\s+/gm, "");

const buildVerseTsQuery = new Function(
	`${stripTypeScriptTypes(source)}\nreturn buildVerseTsQuery;`
)();

test("bare words become prefix matches joined by AND", () => {
	assert.equal(buildVerseTsQuery("loveth neighbour"), "'loveth':* & 'neighbour':*");
});

// The 'simple' dictionary has no stopword list, so "and" is a real lexeme in
// the indexed tsvector and has to stay in the phrase or it would not match.
test("a quoted phrase becomes an ordered phrase of exact lexemes", () => {
	assert.equal(
		buildVerseTsQuery('"be still and know"'),
		"'be' <-> 'still' <-> 'and' <-> 'know'"
	);
});

test("a phrase and bare words combine, phrase first", () => {
	assert.equal(buildVerseTsQuery('"be still" god'), "'be' <-> 'still' & 'god':*");
});

test("punctuation is stripped rather than reaching tsquery", () => {
	assert.equal(
		buildVerseTsQuery("Be still, and know! (Psalms)"),
		"'be':* & 'still':* & 'and':* & 'know':* & 'psalms':*"
	);
});

test("tsquery operators in the input cannot escape into the query", () => {
	assert.equal(buildVerseTsQuery("faith & !hope | <->"), "'faith':* & 'hope':*");
});

test("apostrophes survive inside a lexeme, doubled for Postgres", () => {
	assert.equal(buildVerseTsQuery("lord's"), "'lord''s':*");
	assert.equal(buildVerseTsQuery('"the lord\'s day"'), "'the' <-> 'lord''s' <-> 'day'");
});

test("a stray apostrophe never becomes an empty lexeme", () => {
	assert.equal(buildVerseTsQuery("' faith '"), "'faith':*");
});

test("digits are kept as searchable tokens", () => {
	assert.equal(buildVerseTsQuery("threescore and 10"), "'threescore':* & 'and':* & '10':*");
});

test("queries with nothing searchable return null", () => {
	assert.equal(buildVerseTsQuery(""), null);
	assert.equal(buildVerseTsQuery("   "), null);
	assert.equal(buildVerseTsQuery("!!! ??? ---"), null);
	assert.equal(buildVerseTsQuery('""'), null);
});

test("an unterminated quote degrades to bare words instead of breaking", () => {
	assert.equal(buildVerseTsQuery('he said "be still'), "'he':* & 'said':* & 'be':* & 'still':*");
});

test("case is folded to match the simple dictionary's lexemes", () => {
	assert.equal(buildVerseTsQuery("LOVETH"), "'loveth':*");
});
