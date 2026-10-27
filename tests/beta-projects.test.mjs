/**
 * Study Projects (LC-17642, docs/beta/projects.md): the pure rules in
 * src/lib/beta/projects/projects-rules.ts, and the source contracts its
 * routes and AI must keep.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	COVER_IDS,
	applySectionChange,
	bookSections,
	checkProjectCreate,
	chunkText,
	defaultCoverFor,
	findQuote,
	normalizeSourceText,
	parseProjectData,
	passageLabel,
	passageVerseKeys,
	projectHref,
	projectProgress,
	questionItemText,
	quotedSpans,
	rankPieces,
	readHref,
	sectionAfter,
	studyMarkdown,
	titleFromFilename,
} from "../src/lib/beta/projects/projects-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");
const BOOKS = [
	{ order: 44, name: "Acts", chapters: 28 },
	{ order: 45, name: "Romans", chapters: 16 },
];
const NOW = "2026-10-26T12:00:00.000Z";

test("a book study's sections are its chapters, keyed to each chapter", () => {
	const sections = bookSections(BOOKS[1]);
	assert.equal(sections.length, 16);
	assert.deepEqual(sections[4], { id: "c5", title: "Romans 5", ref: "45.5", done: false, doneAt: null });
});

test("a new project is validated and defaulted", () => {
	const book = checkProjectCreate({ scope: { type: "book", book: 45 } }, BOOKS);
	assert.equal(book.ok, true);
	assert.equal(book.value.title, "The Book of Romans");
	assert.equal(book.value.data.sections.length, 16);
	assert.ok(COVER_IDS.includes(book.value.data.cover));
	assert.equal(book.value.data.archived, false);

	const topic = checkProjectCreate({ title: "  The Life   of Paul ", scope: { type: "topic" }, sections: ["Conversion", { title: "First journey", ref: "44.13" }] }, BOOKS);
	assert.equal(topic.ok, true);
	assert.equal(topic.value.title, "The Life of Paul");
	assert.deepEqual(topic.value.data.sections.map((s) => [s.id, s.title, s.ref]), [["s1", "Conversion", null], ["s2", "First journey", "44.13"]]);

	for (const [input, why] of [
		[{ scope: { type: "book", book: 99 } }, "unknown book"],
		[{ scope: { type: "topic" } }, "a topic study needs a name"],
		[{ title: "x".repeat(121), scope: { type: "topic" } }, "name too long"],
		[{ title: "Ok", scope: { type: "nope" } }, "unknown scope"],
		[{ title: "Ok", scope: { type: "topic" }, cover: "neon" }, "unknown cover"],
		[{ title: "Ok", scope: { type: "topic" }, sections: [{ title: "Bad", ref: "Acts 9" }] }, "section ref must be a key"],
		[{ title: "Ok", scope: { type: "topic" }, description: "x".repeat(1001) }, "description too long"],
	]) {
		assert.equal(checkProjectCreate(input, BOOKS).ok, false, why);
	}
	assert.equal(defaultCoverFor("The Book of Romans"), defaultCoverFor("The Book of Romans"), "stable");
});

test("progress counts done sections and Continue goes to the first one not done", () => {
	let data = checkProjectCreate({ scope: { type: "book", book: 45 } }, BOOKS).value.data;
	assert.deepEqual(projectProgress(data.sections), { done: 0, total: 16, percent: 0, next: data.sections[0] });
	for (const id of ["c1", "c2", "c3", "c4", "c5", "c6"]) data = applySectionChange(data, { op: "done", id, done: true }, NOW).value;
	const progress = projectProgress(data.sections);
	assert.equal(progress.done, 6);
	assert.equal(progress.percent, 37, "rounded down");
	assert.equal(progress.next.title, "Romans 7");
	data = applySectionChange(data, { op: "done", id: "c2", done: false }, NOW).value;
	assert.equal(projectProgress(data.sections).next.id, "c2", "a skipped chapter comes first");
	assert.equal(data.sections[0].doneAt, NOW);
	assert.equal(data.sections[1].doneAt, null);
	assert.equal(sectionAfter(data.sections, "c2").id, "c7", "after c2, the next undone is c7");
	assert.equal(sectionAfter(data.sections, "c16").id, "c2", "past the end, wrap to the first undone");
	const all = data.sections.reduce((d, s) => applySectionChange(d, { op: "done", id: s.id, done: true }, NOW).value, data);
	assert.deepEqual(projectProgress(all.sections), { done: 16, total: 16, percent: 100, next: null });
	assert.deepEqual(projectProgress([]), { done: 0, total: 0, percent: 0, next: null });
});

test("book chapters cannot be renamed or removed; topic sections can", () => {
	const book = checkProjectCreate({ scope: { type: "book", book: 45 } }, BOOKS).value.data;
	assert.equal(applySectionChange(book, { op: "add", title: "Extra" }, NOW).ok, false);
	assert.equal(applySectionChange(book, { op: "remove", id: "c1" }, NOW).ok, false);
	assert.equal(applySectionChange(book, { op: "done", id: "c99", done: true }, NOW).ok, false, "unknown section");
	let topic = checkProjectCreate({ title: "Paul", scope: { type: "topic" } }, BOOKS).value.data;
	topic = applySectionChange(topic, { op: "add", title: "Damascus", ref: "44.9" }, NOW).value;
	topic = applySectionChange(topic, { op: "add", title: "Antioch" }, NOW).value;
	topic = applySectionChange(topic, { op: "rename", id: "s2", title: "Antioch in Pisidia" }, NOW).value;
	topic = applySectionChange(topic, { op: "remove", id: "s1" }, NOW).value;
	assert.deepEqual(topic.sections.map((s) => s.title), ["Antioch in Pisidia"]);
	topic = applySectionChange(topic, { op: "add", title: "Rome" }, NOW).value;
	assert.notEqual(topic.sections[1].id, topic.sections[0].id, "ids stay unique after a removal");
	assert.equal(applySectionChange(topic, { op: "add", title: "Bad", ref: "Romans 5" }, NOW).ok, false);
});

test("stored project data is read defensively", () => {
	assert.equal(parseProjectData(null), null);
	assert.equal(parseProjectData({ sections: [] }), null, "no scope means not a project");
	const parsed = parseProjectData({ scope: { type: "book", book: 45 }, cover: "neon", archived: "yes", sections: [{ id: "c1", title: "Romans 1", ref: "45.1", done: true, doneAt: NOW }, { id: "c1", title: "dup" }, { id: "BAD ID", title: "x" }, { id: "c2", title: "Romans 2", ref: "Romans 2" }] });
	assert.equal(parsed.cover, "parchment");
	assert.equal(parsed.archived, false);
	assert.deepEqual(parsed.sections.map((s) => s.id), ["c1"]);
});

test("passages, questions and sources are shaped for the store", () => {
	assert.equal(passageLabel("Romans", 5), "Romans 5");
	assert.equal(passageLabel("Romans", 5, 3), "Romans 5:3");
	assert.equal(passageLabel("Romans", 5, 1, 11), "Romans 5:1-11");
	assert.deepEqual(passageVerseKeys(45, 5, 1, 3), ["45.5.1", "45.5.2", "45.5.3"]);
	assert.deepEqual(questionItemText("  Why   tribulation? "), { ok: true, value: { title: "Why tribulation?", body: null } });
	const long = questionItemText(`${"word ".repeat(60)}end?`);
	assert.equal(long.ok, true);
	assert.ok(long.value.title.length <= 200 && long.value.title.endsWith("\u2026"));
	assert.ok(long.value.body.endsWith("end?"), "the whole question is kept");
	assert.equal(questionItemText("   ").ok, false);
	assert.equal(questionItemText("x".repeat(1001)).ok, false);
	assert.deepEqual(normalizeSourceText("a\r\n\r\n\r\n\r\nb\t\tc\u0000"), { text: "a\n\nb c", truncated: false });
	const big = normalizeSourceText("A sentence here. ".repeat(20_000));
	assert.equal(big.truncated, true);
	assert.ok(big.text.length <= 200_000);
	assert.equal(titleFromFilename("C:\\docs\\matthew_henry-romans.pdf"), "matthew henry-romans");
	assert.equal(titleFromFilename(".pdf"), "Uploaded source");
	assert.equal(projectHref("abc"), "/beta/study/projects/abc");
	assert.equal(readHref("abc", { section: "c5" }), "/beta/study/projects/abc/read?section=c5");
	assert.equal(readHref("abc", { book: 45, chapter: 5, section: "s1" }), "/beta/study/projects/abc/read?book=45&chapter=5&section=s1");
});

test("long sources are cut into pieces on paragraph breaks", () => {
	const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60)}.`).join("\n\n");
	const chunks = chunkText(text, 1_000);
	assert.ok(chunks.length >= 3);
	assert.ok(chunks.every((chunk) => chunk.length <= 1_000));
	assert.equal(chunks.join(" ").replace(/\s+/g, " ").includes("Paragraph 9"), true);
	assert.deepEqual(chunkText(""), []);
	const oneLong = chunkText("x".repeat(3_500), 1_000);
	assert.equal(oneLong.length, 4, "an unbroken run is still cut");
});

test("ranking keeps pinned pieces and favours rare words from the question", () => {
	const pieces = [
		{ id: "passage", text: "Therefore being justified by faith", pinned: true },
		{ id: "a", text: "A long note about grace and faith and works." },
		{ id: "b", text: "Propitiation through faith in his blood." },
		{ id: "c", text: "Notes on the weather in Corinth." },
	];
	const ranked = rankPieces("What is propitiation?", pieces, 1_000).map((p) => p.id);
	assert.equal(ranked[0], "passage");
	assert.equal(ranked[1], "b");
	const tight = rankPieces("What is propitiation?", pieces, 80).map((p) => p.id);
	assert.deepEqual(tight, ["passage", "b"], "the budget keeps the best");
	assert.deepEqual(rankPieces("the of and", pieces, 1_000).map((p) => p.id), ["passage", "a", "b", "c"], "no usable words keeps the order");
});

test("a quote counts only when its words are really in the source", () => {
	const source = "Justification is a forensic act of God, whereby He declares the sinner righteous; it is not an infusion.\nFaithful is he that calleth you.";
	assert.equal(findQuote(source, "declares the sinner righteous"), "declares the sinner righteous");
	assert.equal(findQuote(source, "“Justification is a FORENSIC act of God”"), "Justification is a forensic act of God");
	assert.equal(findQuote(source, "forensic act ... sinner righteous"), "forensic act of God, whereby He declares the sinner righteous");
	assert.equal(findQuote(source, "declares the believer righteous"), null, "a changed word fails");
	assert.equal(findQuote(source, "is he that"), "is he that");
	assert.equal(findQuote(source, "faith is he that"), null, "whole words only: faith is not Faithful");
	assert.equal(findQuote(source, "righteous"), null, "too short to prove anything");
	assert.equal(findQuote(source, "sinner righteous ... forensic act"), null, "parts must be in order");
});

test("quotations in the assistant's own prose are found for checking", () => {
	assert.deepEqual(quotedSpans('Paul says "we have peace with God" here, and “by whom also we have access” too.'), ["we have peace with God", "by whom also we have access"]);
	assert.deepEqual(quotedSpans('A "short" word and "two words".'), [], "fewer than three words is not a quotation to check");
});

test("an assembled study becomes Markdown with Scripture from the citations only", () => {
	const md = studyMarkdown({
		mode: "outline",
		title: "Peace with God",
		intro: "Romans 5 opens with the fruit of justification.",
		sections: [
			{
				heading: "Peace",
				points: [
					{ text: "Justified believers have peace with God.", basis: "scripture", citations: [{ type: "verse", reference: "Romans 5:1", href: "/bible/chapter?book=45&chapter=5", verses: [{ reference: "Romans 5:1", text: "Therefore being justified by faith, we have peace with God through our Lord Jesus Christ:" }] }] },
					{ text: "Peace here is a standing, not a feeling.", basis: "interpretation", citations: [{ type: "source", sourceId: "x", label: "S1", title: "Henry on Romans", quote: "a standing before God" }] },
				],
			},
		],
	});
	assert.match(md, /^# Peace with God\n/);
	assert.match(md, /- Justified believers have peace with God\. \(Romans 5:1\)\n  > Therefore being justified by faith/);
	assert.match(md, /\(Romans 5:1, KJV\)/);
	assert.match(md, /\*Interpretation:\* Peace here is a standing, not a feeling\. \(Henry on Romans\)/);
	assert.match(md, /> a standing before God\n  > \(Henry on Romans\)/);
	assert.equal(/[\u2013\u2014]/.test(md), false, "no dashes");
});

function filesUnder(relativeDir, name) {
	const root = join(repoRoot, relativeDir);
	if (!existsSync(root)) return [];
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry === name) out.push(relative(repoRoot, full));
		}
	};
	walk(root);
	return out;
}

test("every Study Projects route gates first, and the AI routes meter after the gate", () => {
	const routes = filesUnder("src/app/api/beta/projects", "route.ts");
	assert.ok(routes.length >= 9, `found ${routes.length}`);
	for (const route of routes) {
		const source = read(route);
		for (const handler of source.matchAll(/export async function (GET|POST|PATCH|DELETE)\([^)]*\) \{\n\tconst gate = await requireBetaApi\(\);\n\tif \(!gate\.ok\) return gate\.response;/g)) assert.ok(handler);
		const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)/g)].length;
		const gated = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\([^)]*\) \{\n\tconst gate = await requireBetaApi\(\);\n\tif \(!gate\.ok\) return gate\.response;/g)].length;
		assert.equal(gated, handlers, `${route}: every handler opens with the gate`);
		assert.equal(/export const (GET|POST|PATCH|DELETE) =/.test(source), false, `${route}: no wrapped export that could run before the gate`);
		assert.equal(/prisma\.betaItem/.test(source), false, `${route}: the store only`);
	}
	for (const name of ["ask", "overview", "study"]) {
		const source = read(`src/app/api/beta/projects/[projectId]/${name}/route.ts`);
		assert.match(source, /withIncludedAiRequest\(/, `${name} is metered`);
	}
	const lib = ["projects.ts", "ai.ts"].map((file) => read(`src/lib/beta/projects/${file}`)).join("\n");
	assert.equal(/prisma\.betaItem/.test(lib), false, "the module writes through store.ts only");
	assert.match(read("src/lib/beta/projects/ai.ts"), /doctrinalFoundation/, "every prompt carries the mission");
});

test("the registry says Study Projects is live and its pages gate themselves", () => {
	const registry = read("src/lib/beta/modules.ts");
	assert.match(registry, /slug: "projects",[\s\S]*?status: "live",\n\t\tissue: "LC-17642"/);
	for (const page of filesUnder("src/app/beta/study/projects", "page.tsx")) {
		assert.match(read(page), /await requireBetaPage\(\)/, page);
	}
	assert.ok(existsSync(join(repoRoot, "docs/beta/projects.md")));
});

test("whole-chapter references and project topics are found in a source's own words", async () => {
	const { chapterReferenceCandidates, topicsInText, quotedRange } = await import("../src/lib/beta/projects/projects-rules.ts");
	assert.deepEqual(chapterReferenceCandidates("Matthew Henry on Romans 5 (verses 1 to 9), compare 1 John 4 and Song of Solomon 2."), ["Romans 5", "1 John 4", "Song of Solomon 2"]);
	assert.deepEqual(chapterReferenceCandidates("Romans 5:1 is a verse, not a chapter; so is Rom. 5.1."), [], "a chapter followed by a verse is left to the verse detector");
	assert.deepEqual(topicsInText("Justification by faith brings peace; the Holy Spirit sheds love abroad.", ["justification", "holy spirit", "faith", "grace", "just"]), ["justification", "holy spirit", "faith"], "whole words only");
	assert.deepEqual(topicsInText("", ["faith"]), []);
	assert.equal(quotedRange([{ reference: "Romans 2:1", text: "a" }, { reference: "Romans 2:2", text: "b" }, { reference: "Romans 2:3", text: "c" }]), "Romans 2:1-3");
	assert.equal(quotedRange([{ reference: "Romans 2:1", text: "a" }]), "Romans 2:1");
	assert.equal(quotedRange([]), null);
});

test("a long citation is quoted in part and labelled as a part", () => {
	const verses = Array.from({ length: 6 }, (_, i) => ({ reference: `Romans 2:${i + 1}`, text: `verse ${i + 1}.` }));
	const md = studyMarkdown({ mode: "outline", title: "T", intro: "", sections: [{ heading: "H", points: [{ text: "Point.", basis: "scripture", citations: [{ type: "verse", reference: "Romans 2:1-16", href: "#", verses }] }] }] });
	assert.match(md, /  > verse 3\.\n  > \(Romans 2:1-3, KJV; the passage runs Romans 2:1-16\)/, "an outline quotes three verses and says the passage runs on");
	assert.equal(md.includes("verse 4."), false);
	const full = studyMarkdown({ mode: "study", title: "T", intro: "", sections: [{ heading: "H", points: [{ text: "Point.", basis: "scripture", citations: [{ type: "verse", reference: "Romans 2:1-6", href: "#", verses }] }] }] });
	assert.match(full, /> verse 6\.\n> \(Romans 2:1-6, KJV\)/, "a whole passage quoted is labelled as itself");
});

test("when gathered passages overflow the budget, the ones that speak to the question are sent", () => {
	const pieces = [
		{ id: "romans-1", pinned: true, text: `PASSAGE Romans 1 ${"wrath ungodliness ".repeat(30)}` },
		{ id: "romans-2", pinned: true, text: `PASSAGE Romans 2 ${"judgment circumcision ".repeat(30)}` },
		{ id: "romans-3", pinned: true, text: `PASSAGE Romans 3 ${"propitiation blood ".repeat(30)}` },
	];
	assert.deepEqual(rankPieces("What is propitiation?", pieces, 2_000).map((p) => p.id), ["romans-1", "romans-2", "romans-3"], "all fit: the order they were gathered in");
	assert.deepEqual(rankPieces("What is propitiation?", pieces, 700).map((p) => p.id), ["romans-3"], "too many: the passage the question names comes first");
});

test("single quotes count as quotations; apostrophes do not", async () => {
	const { quotedSpans, isSubstantialQuote } = await import("../src/lib/beta/projects/projects-rules.ts");
	assert.deepEqual(quotedSpans("Paul writes 'the just shall live by faith' to the Romans."), ["the just shall live by faith"]);
	assert.deepEqual(quotedSpans("It is the Lord's day and the saints' joy, God's own gift to us."), [], "possessives are not quotations");
	assert.deepEqual(quotedSpans("Jesus' words, 'Come unto me, all ye' are an invitation."), ["Come unto me, all ye"]);
	assert.equal(isSubstantialQuote("it is the"), false, "common words alone prove nothing");
	assert.equal(isSubstantialQuote("peace with God"), true);
	assert.equal(isSubstantialQuote("access by faith into this grace"), true);
});

test("sources added at the same moment still get labels of their own, and older labels never move", async () => {
	const { assignSourceLabels } = await import("../src/lib/beta/projects/projects-rules.ts");
	assert.deepEqual(assignSourceLabels(["S1", "S1", "S1", "S2", undefined]), ["S1", "S2", "S3", "S4", "S5"], "a clash takes the next free number");
	assert.deepEqual(assignSourceLabels(["S1", "S3"]), ["S1", "S3"], "a removed source leaves its gap; nothing shifts");
	assert.deepEqual(assignSourceLabels(["S1", "S1"]).slice(0, 1), assignSourceLabels(["S1", "S1", "S1"]).slice(0, 1), "adding a source never relabels an older one");
	assert.deepEqual(assignSourceLabels(["S2", "S1", "S2"]), ["S2", "S1", "S3"]);
});
