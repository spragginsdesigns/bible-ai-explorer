import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import {
	AUDIO_BIBLE_BASE_URL,
	DRAMATIZED_BASE_URL,
	STILL_LISTENING_AFTER_MS,
	hasNarration,
	needsStillListening,
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
		parseChapterTiming({ ...TIMING, verses: [TIMING.verses[1]] }, 43, 3),
		null,
		"verses must run 1..n"
	);
	assert.equal(parseChapterTiming(null, 43, 3), null);
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
		chapterTimingUrl,
		hasNarration,
		parseChapterTiming,
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
	for (const query of ["book=43&chapter=22", "book=0&chapter=1", "book=x&chapter=1", "book=43"]) {
		assert.equal((await call(GET, query)).status, 400, query);
	}
});
