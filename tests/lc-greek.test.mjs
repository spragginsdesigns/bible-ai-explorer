import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import {
	ALIVE_BOOKS,
	EDITION_CHOICES,
	LC_GREEK,
	LISTEN_ORDER,
	RECOMMENDED_EDITION,
	hasAlive,
	hasLcGreek,
	parseLcGreek,
} from "../src/lib/bible/audioBible.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const books = JSON.parse(read("../src/data/books.json"));
const kjvFile = (order) =>
	readdirSync(fileURLToPath(new URL("../src/data/kjv/", import.meta.url))).find((name) =>
		name.startsWith(`${String(order).padStart(2, "0")}-`)
	);

test("Listen lists Alive first and recommends it (LC-15842)", () => {
	assert.equal(RECOMMENDED_EDITION, "alive");
	assert.equal(LISTEN_ORDER[0], RECOMMENDED_EDITION);
	assert.deepEqual([...LISTEN_ORDER].sort(), ["alive", "regular"]);
	assert.match(EDITION_CHOICES.alive.detail, /LC Greek/);
});

test("every Alive book has its LC Greek text, and only those", () => {
	assert.equal(hasLcGreek(41), true);
	assert.equal(hasLcGreek(40), false);
	assert.equal(hasLcGreek(43), false);
	for (const order of [1, 39, 40, 41, 42, 43, 66]) assert.equal(hasLcGreek(order), hasAlive(order));
	assert.equal(LC_GREEK.label, "LC Greek");
	// The web loader names every book literally (webpack), so pin it to ALIVE_BOOKS.
	const loaderBooks = [...read("../src/lib/bible/lcGreek.ts").matchAll(/^\s*(\d+): async \(\) =>/gm)]
		.map((match) => Number(match[1]))
		.sort((a, b) => a - b);
	assert.deepEqual(loaderBooks, [...ALIVE_BOOKS].sort((a, b) => a - b));
});

test("each LC Greek book matches the KJV's chapters and verse numbering", () => {
	for (const order of ALIVE_BOOKS) {
		const text = JSON.parse(read(`../src/data/lc-greek/${order}.json`));
		const kjv = JSON.parse(read(`../src/data/kjv/${kjvFile(order)}`));
		const book = books.find((b) => b.order === order);
		assert.equal(text.length, book.chapters, `book ${order} chapters`);
		text.forEach((chapter, index) => {
			assert.equal(chapter.length, kjv[index].length, `${book.name} ${index + 1} verse count`);
			for (const [verse, words] of chapter.entries()) {
				assert.equal(typeof words, "string", `${book.name} ${index + 1}:${verse + 1}`);
				assert.notEqual(words.trim(), "", `${book.name} ${index + 1}:${verse + 1} is empty`);
			}
		});
	}
	const mark = JSON.parse(read("../src/data/lc-greek/41.json"));
	assert.equal(mark[0][0], "The beginning of the gospel of Jesus Christ, the Son of God.");
});

test("parseLcGreek accepts only a ready answer for the asked chapter", () => {
	const ready = { status: "ready", book: 41, chapter: 2, verses: ["One.", "Two."] };
	assert.deepEqual(parseLcGreek(ready, 41, 2), ["One.", "Two."]);
	assert.equal(parseLcGreek(ready, 41, 3), null, "another chapter");
	assert.equal(parseLcGreek(ready, 40, 2), null, "another book");
	assert.equal(parseLcGreek({ status: "unavailable" }, 41, 2), null);
	assert.equal(parseLcGreek({ ...ready, verses: [] }, 41, 2), null);
	assert.equal(parseLcGreek({ ...ready, verses: ["One.", 2] }, 41, 2), null);
	assert.equal(parseLcGreek({ ...ready, verses: ["One.", "  "] }, 41, 2), null);
	assert.equal(parseLcGreek(null, 41, 2), null);
	assert.equal(parseLcGreek("ready", 41, 2), null);
});

// The route with its imports replaced by injected doubles, as audio-bible.test.mjs does.
function loadRoute(loadLcGreekChapter) {
	const source = read("../src/app/api/bible/lc-greek/route.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
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
		loadLcGreekChapter,
	};
	const factory = new Function(...Object.keys(deps), `${stripTypeScriptTypes(source)}\nreturn GET;`);
	return factory(...Object.values(deps));
}

const call = (GET, query) => GET(new Request(`https://sureword.app/api/bible/lc-greek?${query}`));
const markText = JSON.parse(read("../src/data/lc-greek/41.json"));
const loader = async (book, chapter) => (book === 41 ? markText[chapter - 1] ?? null : null);

test("route: a Mark chapter returns its LC Greek verses", async () => {
	const response = await call(loadRoute(loader), "book=41&chapter=16");
	const body = await response.json();
	assert.equal(response.status, 200);
	assert.equal(body.status, "ready");
	assert.equal(body.verses.length, 20);
	assert.deepEqual(parseLcGreek(body, 41, 16), markText[15]);
	assert.match(response.headers.get("cache-control"), /s-maxage=86400/);
});

test("route: a book without LC Greek is unavailable, bad input is a 400", async () => {
	const GET = loadRoute(loader);
	assert.deepEqual(await (await call(GET, "book=40&chapter=1")).json(), { status: "unavailable" });
	assert.deepEqual(await (await call(GET, "book=43&chapter=3")).json(), { status: "unavailable" });
	for (const query of ["book=41&chapter=17", "book=41&chapter=0", "book=67&chapter=1", "book=41", "book=4x&chapter=1", "book=41&chapter=1.5"]) {
		assert.equal((await call(GET, query)).status, 400, query);
	}
});
