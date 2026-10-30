import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const candidate = fileURLToPath(new URL("../", import.meta.url));
const root = existsSync(path.join(candidate, "src/data/books.json")) ? candidate : JSON.parse(readFileSync(path.join(candidate, "manifest.json"), "utf8")).applicationRoot;
const json = rel => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const books = json("src/data/books.json");
const names = json("src/data/book-names.json");
const localized = ["es", "de"].flatMap(language => [...names[language].names.map((name, index) => [name, index + 1]), ...Object.entries(names[language].aliases)]);
const cache = new Map();
async function getChapter(translation, order, chapter) {
	const key = translation + ":" + order;
	const filename = translation === "KJV" ? "src/data/kjv/" + books.find(book => book.order === order).file : "src/data/" + translation.toLowerCase() + "/" + String(order).padStart(2, "0") + ".json";
	if (!cache.has(key)) cache.set(key, json(filename));
	const verses = cache.get(key)[chapter - 1]; if (!verses) throw Error("Missing canonical chapter"); return verses;
}
function compile(source) {
	const plain = source.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	return new Function("normalizeAssistantMarkdown", "hasLiteralMarkdownUnderscore", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", stripTypeScriptTypes(plain) + "\nreturn { verifyScriptureDraft, hasCompletenessClaim };")(
		normalizeAssistantMarkdown, hasLiteralMarkdownUnderscore, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, books, localized, getChapter, value => ["KJV", "RV1909", "LUT1912", "ASV", "BSB", "NKJV"].includes(value), async () => null, async () => null);
}
const sourceRelative = "src/lib/ai/scripture-verification.ts";
const sourceFile = existsSync(path.join(candidate, sourceRelative)) ? path.join(candidate, sourceRelative) : path.join(root, sourceRelative);
const api = compile(readFileSync(sourceFile, "utf8"));
const check = (text, translation) => api.verifyScriptureDraft(text, { translation });
const editions = [
	{ translation: "RV1909", book: "Juan", fragment: "Porque de tal manera amó Dios al mundo", claims: ["Juan 3:16 completo dice", "El versículo completo de Juan 3:16 dice", "Juan 3:16 en su totalidad dice", "Juan 3:16 en su integridad dice", "Juan 3:16 palabra por palabra dice", "Juan 3:16 palabra-por-palabra dice", "Juan 3:16 íntegramente dice", "El texto entero de Juan 3:16 dice"] },
	{ translation: "LUT1912", book: "Johannes", fragment: "Also hat Gott die Welt geliebt", claims: ["Johannes 3:16 vollständig lautet", "Der vollständige Vers in Johannes 3:16 lautet", "Johannes 3:16 wörtlich sagt", "Johannes 3:16 Wort für Wort lautet", "Johannes 3:16 Wort-für-Wort lautet", "Johannes 3:16 in voller Länge lautet", "Der ganze Vers in Johannes 3:16 lautet"] },
];
// REPRO_PREFIX_END

for (const edition of editions) {
	for (const claim of edition.claims) {
		test("localized complete single-verse claim rejects an authentic fragment: " + claim, async () => {
			const short = await check(claim + ' "' + edition.fragment + '".', edition.translation);
			assert.equal(short.ok, false, JSON.stringify(short));
			assert.ok(short.issues.some(issue => issue.code === "quote_mismatch"));
			const full = (await getChapter(edition.translation, 43, 3))[15];
			const complete = await check(claim + ' "' + full + '".', edition.translation);
			assert.equal(complete.ok, true, JSON.stringify(complete.issues));
		});
	}
	test("existing range comparison already rejects missing verse17: " + edition.translation, async () => {
		const chapter = await getChapter(edition.translation, 43, 3);
		const missing = await check(edition.book + ' 3:16-18\n> ' + chapter[15] + '\n> ' + chapter[17], edition.translation);
		assert.equal(missing.ok, false); assert.ok(missing.issues.some(issue => issue.code === "quote_mismatch"));
		const complete = await check(edition.book + ' 3:16-18\n> ' + chapter.slice(15, 18).join('\n> '), edition.translation);
		assert.equal(complete.ok, true, JSON.stringify(complete.issues));
	});
	test("ordinary authentic fragment and source case remain unchanged: " + edition.translation, async () => {
		assert.equal((await check(edition.book + ' 3:16: "' + edition.fragment + '".', edition.translation)).ok, true);
		assert.equal((await check(edition.book + ' 3:16: "' + edition.fragment.toLowerCase() + '".', edition.translation)).ok, false);
	});
	test("complete claim after the quotation also requires every source word: " + edition.translation, async () => {
		const suffix = edition.translation === "RV1909" ? "este es el versículo completo" : "dies ist der vollständige Vers";
		assert.equal((await check(edition.book + ' 3:16 dice "' + edition.fragment + '"; ' + suffix + '.', edition.translation)).ok, false);
	});
}

for (const [translation, text] of [
	["RV1909", 'Juan 3:16-18\n\nEl pasaje completo dice "Porque de tal manera amó Dios al mundo".'],
	["LUT1912", 'Johannes 3:16-18\n\nDie Passage lautet vollständig "Also hat Gott die Welt geliebt".'],
]) test("localized full-range claim cannot fall back to an ordinary ambiguous quote: " + translation, async () => {
	const result = await check(text, translation); assert.equal(result.ok, false); assert.ok(result.issues.some(issue => issue.severity === "error"));
});

for (const [translation, text] of [
	["RV1909", 'Mateo 5:48 usa "perfectos"; la palabra significa completo.'],
	["RV1909", 'Mateo 5:48 usa "perfectos"; es una palabra completa.'],
	["LUT1912", 'Matthäus 5:48 verwendet "vollkommen"; das Wort bedeutet vollständig.'],
	["LUT1912", 'Matthäus 5:48 verwendet "vollkommen"; es ist ein vollständiges Wort.'],
]) test("localized lexical gloss does not promise the complete verse: " + text, async () => {
	const result = await check(text, translation); assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("English completeness behavior remains intact with selected Spanish and German source", async () => {
	for (const edition of editions) {
		assert.equal((await check(edition.book + ' 3:16 in full says "' + edition.fragment + '".', edition.translation)).ok, false);
		const full = (await getChapter(edition.translation, 43, 3))[15];
		assert.equal((await check(edition.book + ' 3:16 in full says "' + full + '".', edition.translation)).ok, true);
	}
});

test("localized completeness recognizes decomposed accents and capitalization without changing source case", async () => {
	for (const [translation, claim, fragment] of [["RV1909", "Juan 3:16 ÍNTEGRAMENTE dice", editions[0].fragment], ["LUT1912", "Johannes 3:16 VOLLSTÄNDIG lautet", editions[1].fragment]]) {
		assert.equal((await check(claim.normalize("NFD") + ' "' + fragment + '".', translation)).ok, false);
	}
});

test("incomplete and unvollständig do not become substring completeness claims", async () => {
	assert.equal((await check('Juan 3:16 incompleto: "' + editions[0].fragment + '".', "RV1909")).ok, true);
	assert.equal((await check('Johannes 3:16 unvollständig: "' + editions[1].fragment + '".', "LUT1912")).ok, true);
});
