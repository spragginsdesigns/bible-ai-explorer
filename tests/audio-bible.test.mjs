import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import {
	ALIVE_ASV_BASE_URL,
	ALIVE_BASE_URL,
	AUDIO_BIBLE_BASE_URL,
	DRAMATIZED_BASE_URL,
	EDITION_DETAILS,
	STILL_LISTENING_AFTER_MS,
	adjacentVerse,
	aliveSources,
	editionDetail,
	hasNarration,
	needsStillListening,
	parseEdition,
	parseChapterTiming,
	verseAt,
	verseStart,
	chapterAudioUrl,
	chapterTimingUrl,
} from "../src/lib/bible/audioBible.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/** John 3's first verses as the render writes them. */
const TIMING = {
	book: 43,
	chapter: 3,
	duration: 262.7,
	verses: [
		{ verse: 1, start: 6.1, end: 11.4 },
		{ verse: 2, start: 11.75, end: 20.3 },
		{ verse: 3, start: 20.65, end: 27.0 },
	],
};

test("every book from Genesis to Revelation is narrated", () => {
	assert.equal(hasNarration(0), false);
	assert.equal(hasNarration(1), true);
	assert.equal(hasNarration(39), true);
	assert.equal(hasNarration(40), true);
	assert.equal(hasNarration(66), true);
	assert.equal(hasNarration(67), false);
});

test("Matthew plays the full-cast production, every other book the narration", () => {
	assert.equal(chapterAudioUrl(40, 2), `${DRAMATIZED_BASE_URL}/40/2.mp3`);
	assert.equal(chapterTimingUrl(40, 28), `${DRAMATIZED_BASE_URL}/40/28.json`);
	assert.equal(chapterAudioUrl(41, 1), `${AUDIO_BIBLE_BASE_URL}/41/1.mp3`);
	assert.equal(chapterTimingUrl(66, 22), `${AUDIO_BIBLE_BASE_URL}/66/22.json`);
	assert.notEqual(DRAMATIZED_BASE_URL, AUDIO_BIBLE_BASE_URL);
});

test("Alive is looked for in the ASV folder first, then the LC Greek folder for Matthew to John (LC-17800)", () => {
	for (const book of [40, 41, 42, 43]) assert.deepEqual(aliveSources(book), ["ASV", "LC Greek"], String(book));
	for (const book of [1, 39, 44, 45, 66]) assert.deepEqual(aliveSources(book), ["ASV"], String(book));
	assert.equal(chapterAudioUrl(1, 1, "alive", "ASV"), `${ALIVE_ASV_BASE_URL}/1/1.mp3`);
	assert.equal(chapterTimingUrl(41, 9, "alive", "ASV"), `${ALIVE_ASV_BASE_URL}/41/9.json`);
	assert.equal(chapterAudioUrl(41, 1, "regular", "ASV"), `${AUDIO_BIBLE_BASE_URL}/41/1.mp3`, "text only picks an Alive folder");
	assert.notEqual(ALIVE_ASV_BASE_URL, ALIVE_BASE_URL, "never uploaded over the live LC Greek files");
});

test("Listen names the text each Alive recording reads", () => {
	assert.equal(editionDetail("alive", "ASV"), "Full cast, in the American Standard Version");
	assert.equal(editionDetail("alive", "LC Greek"), "Full cast, in our LC Greek translation");
	assert.equal(editionDetail("alive", undefined), EDITION_DETAILS["LC Greek"], "a server before LC-17800 only had the LC Greek");
	assert.equal(editionDetail("regular", "ASV"), "The King James Version, read aloud");
});

test("Mark has an Alive recording in its own folder beside the narration (LC-15532)", () => {
	assert.equal(chapterAudioUrl(41, 16, "alive"), `${ALIVE_BASE_URL}/41/16.mp3`);
	assert.equal(chapterTimingUrl(41, 1, "alive"), `${ALIVE_BASE_URL}/41/1.json`);
	assert.equal(chapterAudioUrl(41, 1, "regular"), `${AUDIO_BIBLE_BASE_URL}/41/1.mp3`);
	assert.equal(chapterAudioUrl(41, 1), `${AUDIO_BIBLE_BASE_URL}/41/1.mp3`, "regular is the default");
	assert.notEqual(ALIVE_BASE_URL, DRAMATIZED_BASE_URL);
	assert.notEqual(ALIVE_BASE_URL, AUDIO_BIBLE_BASE_URL);
});

test("parseEdition: absent or regular is regular, alive is alive, anything else is refused", () => {
	assert.equal(parseEdition(null), "regular");
	assert.equal(parseEdition("regular"), "regular");
	assert.equal(parseEdition("alive"), "alive");
	assert.equal(parseEdition("ALIVE"), null);
	assert.equal(parseEdition(""), null);
	assert.equal(parseEdition("drama"), null);
});

test("verseAt follows the reading, null over the opening cue and heading", () => {
	const { verses } = TIMING;
	assert.equal(verseAt(verses, 0), null);
	assert.equal(verseAt(verses, 6.09), null);
	assert.equal(verseAt(verses, 6.1), 1);
	// The pause between verses still belongs to the verse just read.
	assert.equal(verseAt(verses, 11.6), 1);
	assert.equal(verseAt(verses, 11.75), 2);
	assert.equal(verseAt(verses, 999), 3);
	assert.equal(verseStart(verses, 2), 11.75);
	assert.equal(verseStart(verses, 40), 0);
});

/** Matthew 17:20-22 in the ASV, which leaves verse 21 out: no timing for it. */
const SKIPPING = [
	{ verse: 20, start: 100, end: 110 },
	{ verse: 22, start: 111, end: 118 },
	{ verse: 23, start: 119, end: 125 },
];

test("a verse with no timing plays from the next verse read, and skipping steps over it", () => {
	assert.equal(verseStart(SKIPPING, 21), 111, "17:21 starts where 17:22 does");
	assert.equal(verseStart(SKIPPING, 24), 0);
	assert.equal(verseAt(SKIPPING, 110.5), 20);
	assert.equal(adjacentVerse(SKIPPING, 20, 1), 22);
	assert.equal(adjacentVerse(SKIPPING, 22, -1), 20);
	assert.equal(adjacentVerse(SKIPPING, 23, 1), 23, "the last verse is reachable and holds");
	assert.equal(adjacentVerse(SKIPPING, 20, -1), 20);
	assert.equal(adjacentVerse(SKIPPING, null, 1), 20, "before the first verse, next is the first verse");
	assert.equal(adjacentVerse(TIMING.verses, null, -1), 1);
	assert.equal(adjacentVerse(TIMING.verses, 1, 1), 2);
	assert.equal(adjacentVerse([], 3, 1), null);
});

test("still listening is asked after exactly an hour without an action", () => {
	assert.equal(STILL_LISTENING_AFTER_MS, 3_600_000);
	assert.equal(needsStillListening(0, 3_599_999), false);
	assert.equal(needsStillListening(0, 3_600_000), true);
});

test("parseChapterTiming accepts the render's file and rejects mismatches", () => {
	const audio = parseChapterTiming(TIMING, 43, 3);
	assert.equal(audio?.status, "ready");
	assert.equal(audio?.audioUrl, `${AUDIO_BIBLE_BASE_URL}/43/3.mp3`);
	assert.equal(audio?.verses.length, 3);
	assert.equal(parseChapterTiming(TIMING, 43, 4), null, "another chapter's file");
	assert.equal(parseChapterTiming({ ...TIMING, verses: [] }, 43, 3), null);
	assert.equal(
		parseChapterTiming({ ...TIMING, verses: [TIMING.verses[1], TIMING.verses[0]] }, 43, 3),
		null,
		"verse numbers must rise"
	);
	assert.equal(parseChapterTiming({ ...TIMING, verses: [TIMING.verses[0], TIMING.verses[0]] }, 43, 3), null, "no repeats");
	assert.equal(parseChapterTiming({ ...TIMING, verses: [{ verse: 0, start: 1, end: 2 }] }, 43, 3), null, "from verse 1");
	assert.equal(parseChapterTiming({ ...TIMING, verses: [{ verse: 1.5, start: 1, end: 2 }] }, 43, 3), null);
	assert.equal(parseChapterTiming({ ...TIMING, verses: [{ verse: "1", start: 1, end: 2 }] }, 43, 3), null);
	assert.equal(parseChapterTiming(null, 43, 3), null);
	// The ASV leaves Matthew 17:21 out, so its timings skip from 20 to 22 (LC-17800).
	const skipping = parseChapterTiming({ book: 40, chapter: 17, duration: 130, verses: SKIPPING }, 40, 17, "alive", "ASV");
	assert.deepEqual(skipping?.verses.map((timing) => timing.verse), [20, 22, 23]);
	assert.equal(skipping?.text, "ASV");
	assert.equal(skipping?.audioUrl, `${ALIVE_ASV_BASE_URL}/40/17.mp3`);
	assert.equal(audio?.text, undefined, "only an Alive recording names its text");
	const alive = parseChapterTiming({ ...TIMING, book: 41, chapter: 3 }, 41, 3, "alive");
	assert.equal(alive?.edition, "alive");
	assert.equal(alive?.text, "LC Greek");
	assert.equal(alive?.audioUrl, `${ALIVE_BASE_URL}/41/3.mp3`);
	assert.equal(audio?.edition, "regular");
});

// The route with its imports replaced by injected doubles, as
// tests/bible-crossrefs-route.test.mjs does.
function loadRoute(fetchImpl) {
	const source = read("../src/app/api/bible/audio/route.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const books = JSON.parse(read("../src/data/books.json"));
	const NextResponse = {
		json(value, init = {}) {
			return new Response(JSON.stringify(value), {
				status: init.status ?? 200,
				headers: { "content-type": "application/json", ...(init.headers ?? {}) },
			});
		},
	};
	const deps = {
		NextResponse,
		bookByOrder: (order) => books.find((b) => b.order === order) ?? null,
		aliveSources,
		chapterTimingUrl,
		hasNarration,
		parseChapterTiming,
		parseEdition,
		fetch: fetchImpl,
		console: { error() {} },
	};
	const factory = new Function(...Object.keys(deps), `${stripTypeScriptTypes(source)}\nreturn GET;`);
	return factory(...Object.values(deps));
}

const call = (GET, query) => GET(new Request(`https://sureword.app/api/bible/audio?${query}`));

test("route: ready chapter returns the MP3 and verse timings", async () => {
	const requested = [];
	const GET = loadRoute(async (url) => {
		requested.push(url);
		return new Response(JSON.stringify(TIMING), { status: 200 });
	});
	const response = await call(GET, "book=43&chapter=3");
	const body = await response.json();
	assert.equal(response.status, 200);
	assert.deepEqual(requested, [`${AUDIO_BIBLE_BASE_URL}/43/3.json`]);
	assert.equal(body.status, "ready");
	assert.equal(body.audioUrl, `${AUDIO_BIBLE_BASE_URL}/43/3.mp3`);
	assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
});

test("route: Matthew reads its timings from the drama folder and returns the drama MP3", async () => {
	const requested = [];
	const GET = loadRoute(async (url) => {
		requested.push(url);
		return new Response(JSON.stringify({ ...TIMING, book: 40, chapter: 2 }), { status: 200 });
	});
	const body = await (await call(GET, "book=40&chapter=2")).json();
	assert.deepEqual(requested, [`${DRAMATIZED_BASE_URL}/40/2.json`]);
	assert.equal(body.status, "ready");
	assert.equal(body.audioUrl, `${DRAMATIZED_BASE_URL}/40/2.mp3`);
});

/** A bucket holding exactly these keys; any other key answers 403, as S3 does. */
function bucket(objects, requested) {
	return async (url) => {
		requested.push(url);
		const key = Object.keys(objects).find((base) => url === base);
		return key ? new Response(JSON.stringify(objects[key]), { status: 200 }) : new Response("<Error/>", { status: 403 });
	};
}

test("route: edition=alive on Mark with no ASV upload plays the LC Greek recording", async () => {
	const requested = [];
	const GET = loadRoute(bucket({
		[`${ALIVE_BASE_URL}/41/3.json`]: { ...TIMING, book: 41, chapter: 3 },
		[`${AUDIO_BIBLE_BASE_URL}/41/3.json`]: { ...TIMING, book: 41, chapter: 3 },
	}, requested));
	const response = await call(GET, "book=41&chapter=3&edition=alive");
	const body = await response.json();
	assert.deepEqual(requested, [`${ALIVE_ASV_BASE_URL}/41/3.json`, `${ALIVE_BASE_URL}/41/3.json`], "ASV first");
	assert.equal(body.status, "ready");
	assert.equal(body.edition, "alive");
	assert.equal(body.text, "LC Greek");
	assert.equal(body.audioUrl, `${ALIVE_BASE_URL}/41/3.mp3`);
	assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
	const regular = await (await call(GET, "book=41&chapter=3")).json();
	assert.equal(requested[2], `${AUDIO_BIBLE_BASE_URL}/41/3.json`, "no edition is the narration");
	assert.equal(regular.audioUrl, `${AUDIO_BIBLE_BASE_URL}/41/3.mp3`);
	assert.equal(regular.text, undefined);
});

test("route: an uploaded ASV chapter wins over the LC Greek one", async () => {
	const requested = [];
	const GET = loadRoute(bucket({
		[`${ALIVE_ASV_BASE_URL}/41/9.json`]: { book: 41, chapter: 9, duration: 130, verses: SKIPPING.map((t, i) => ({ ...t, verse: [43, 45, 47][i] })) },
		[`${ALIVE_BASE_URL}/41/9.json`]: { ...TIMING, book: 41, chapter: 9 },
	}, requested));
	const body = await (await call(GET, "book=41&chapter=9&edition=alive")).json();
	assert.deepEqual(requested, [`${ALIVE_ASV_BASE_URL}/41/9.json`], "the LC Greek folder is not asked");
	assert.equal(body.text, "ASV");
	assert.equal(body.audioUrl, `${ALIVE_ASV_BASE_URL}/41/9.mp3`);
	assert.deepEqual(body.verses.map((timing) => timing.verse), [43, 45, 47], "Mark 9:44 and 9:46 are skipped");
});

test("route: any book goes live in Alive by being uploaded to the ASV folder, with no list to edit", async () => {
	const requested = [];
	const GET = loadRoute(bucket({ [`${ALIVE_ASV_BASE_URL}/1/1.json`]: { ...TIMING, book: 1, chapter: 1 } }, requested));
	const genesis = await (await call(GET, "book=1&chapter=1&edition=alive")).json();
	assert.equal(genesis.status, "ready");
	assert.equal(genesis.text, "ASV");
	assert.equal(genesis.audioUrl, `${ALIVE_ASV_BASE_URL}/1/1.mp3`);
	const notYet = await call(GET, "book=1&chapter=2&edition=alive");
	assert.deepEqual(await notYet.json(), { status: "unavailable" });
	assert.equal(notYet.headers.get("cache-control"), "public, max-age=300, s-maxage=300", "an upload shows within minutes");
	const acts = await (await call(GET, "book=44&chapter=2&edition=alive")).json();
	assert.deepEqual(acts, { status: "unavailable" });
	assert.deepEqual(requested, [
		`${ALIVE_ASV_BASE_URL}/1/1.json`,
		`${ALIVE_ASV_BASE_URL}/1/2.json`,
		`${ALIVE_ASV_BASE_URL}/44/2.json`,
	], "outside Matthew to John only the ASV folder is asked");
});

test("route: a malformed ASV file falls back to the LC Greek recording on a Gospel", async () => {
	const requested = [];
	const GET = loadRoute(bucket({
		[`${ALIVE_ASV_BASE_URL}/43/3.json`]: { ...TIMING, book: 43, chapter: 4 },
		[`${ALIVE_BASE_URL}/43/3.json`]: TIMING,
	}, requested));
	const body = await (await call(GET, "book=43&chapter=3&edition=alive")).json();
	assert.equal(body.text, "LC Greek");
	assert.equal(requested.length, 2);
});

test("route: Old Testament is unavailable without touching the bucket", async () => {
	const GET = loadRoute(async () => assert.fail("no fetch for an unnarrated book"));
	const body = await (await call(GET, "book=19&chapter=23")).json();
	assert.deepEqual(body, { status: "unavailable" });
});

test("route: a missing key (S3 answers 403) and a bucket error are unavailable", async () => {
	const missing = loadRoute(async () => new Response("<Error/>", { status: 403 }));
	const notYet = await call(missing, "book=43&chapter=3");
	assert.deepEqual(await notYet.json(), { status: "unavailable" });
	// Short, so a chapter uploaded after someone looked shows up within minutes.
	assert.equal(notYet.headers.get("cache-control"), "public, max-age=300, s-maxage=300");
	const down = loadRoute(async () => {
		throw new Error("network");
	});
	const response = await call(down, "book=43&chapter=3");
	assert.deepEqual(await response.json(), { status: "unavailable" });
	assert.equal(response.headers.get("cache-control"), "no-store");
});

test("route: rejects bad input", async () => {
	const GET = loadRoute(async () => assert.fail("no fetch"));
	for (const query of ["book=43&chapter=22", "book=0&chapter=1", "book=x&chapter=1", "book=43", "book=41&chapter=1&edition=drama"]) {
		assert.equal((await call(GET, query)).status, 400, query);
	}
});
