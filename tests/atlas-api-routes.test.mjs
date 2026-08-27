import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import {
	ATLAS_ERAS,
	getEntityView,
	listEntities as listEntitiesData,
	searchAtlasDataWithCounts,
	selectTimelineEvents,
	groupEventsByEra,
	whoIsInChapter,
	toEventView,
	shortestPersonConnectionPath,
} from "../src/lib/bible/atlas-core.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const books = JSON.parse(read("../src/data/books.json"));
const atlas = {
	events: JSON.parse(read("../src/data/bible-atlas/events.json")),
	people: JSON.parse(read("../src/data/bible-atlas/people.json")),
	places: JSON.parse(read("../src/data/bible-atlas/places.json")),
	relations: JSON.parse(read("../src/data/bible-atlas/relations.json")),
};

const bookByOrder = (order) => books.find((book) => book.order === order);
const getEntity = async (id) => getEntityView(atlas, id);
const listEntities = async (query) => listEntitiesData(atlas, query);
const whoIsIn = async (book, chapter) => whoIsInChapter(atlas, books, book, chapter);
const searchAtlasResult = async (query, limit) =>
	searchAtlasDataWithCounts(atlas, query, limit);
const getTimeline = async (query) => {
	const events = selectTimelineEvents(atlas, books, query);
	return {
		eras: groupEventsByEra(atlas, events),
		events: events.map((event) => toEventView(atlas, event)),
	};
};
const getEvent = async (id) => {
	const event = atlas.events.find((candidate) => candidate.id === id);
	return event ? toEventView(atlas, event) : null;
};
const tracePersonConnection = async (fromId, toId) =>
	shortestPersonConnectionPath(atlas, fromId, toId);

const NextResponse = {
	json(value, init = {}) {
		return new Response(JSON.stringify(value), {
			status: init.status ?? 200,
			headers: { "content-type": "application/json" },
		});
	},
};

function loadRoute(relativePath, dependencies) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const names = Object.keys(dependencies);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn GET;`
	);
	return factory(...names.map((name) => dependencies[name]));
}

function makeAuth() {
	let denied = false;
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		deny() {
			denied = true;
		},
		allow() {
			denied = false;
		},
		async getAuthUserId() {
			calls += 1;
			if (denied) {
				throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
			}
			return "test-user";
		},
	};
}

const routeDefinitions = {
	atlas: {
		path: "../src/app/api/bible/atlas/route.ts",
		dependencies: {
			NextResponse,
			bookByOrder,
			ATLAS_ERAS,
			getEntity,
			listEntities,
			whoIsIn,
			searchAtlasResult,
		},
	},
	timeline: {
		path: "../src/app/api/bible/atlas/timeline/route.ts",
		dependencies: { NextResponse, ATLAS_ERAS, getTimeline, bookByOrder },
	},
	event: {
		path: "../src/app/api/bible/atlas/event/route.ts",
		dependencies: { NextResponse, getEvent },
	},
	connection: {
		path: "../src/app/api/bible/atlas/connection/route.ts",
		dependencies: { NextResponse, tracePersonConnection },
	},
};

function loadHandlers(auth) {
	return Object.fromEntries(
		Object.entries(routeDefinitions).map(([name, definition]) => [
			name,
			loadRoute(definition.path, {
				...definition.dependencies,
				getAuthUserId: auth.getAuthUserId.bind(auth),
			}),
		])
	);
}

async function json(response) {
	return response.json();
}

test("all atlas routes preserve the signed-in guard", async () => {
	const auth = makeAuth();
	const handlers = loadHandlers(auth);
	auth.deny();

	for (const [name, handler] of Object.entries(handlers)) {
		const response = await handler(new Request(`https://example.test/api/bible/atlas/${name}`));
		assert.equal(response.status, 401, `${name} must reject unauthenticated callers`);
	}
	assert.equal(auth.calls, 4, "each route must call getAuthUserId before serving data");
});

test("atlas rejects malformed and out-of-range book/chapter parameters", async () => {
	const auth = makeAuth();
	const { atlas: handler } = loadHandlers(auth);
	const cases = [
		["?book=Genesis&chapter=1", 400],
		["?book=1&chapter=nope", 400],
		["?book=1", 400],
		["?book=1&chapter=51", 400],
		["?book=999&chapter=1", 400],
	];

	for (const [query, status] of cases) {
		const response = await handler(new Request(`https://example.test/api/bible/atlas${query}`));
		assert.equal(response.status, status, query);
		assert.equal((await json(response)).error, "That is not a chapter of the Bible.", query);
	}
});

test("timeline validates integer filters and always returns the complete era list", async () => {
	const auth = makeAuth();
	const { timeline: handler } = loadHandlers(auth);

	const malformed = await handler(
		new Request("https://example.test/api/bible/atlas/timeline?book=6&chapter=abc")
	);
	assert.equal(malformed.status, 400);
	assert.equal((await json(malformed)).error, "That is not a chapter of the Bible.");

	const missingBook = await handler(
		new Request("https://example.test/api/bible/atlas/timeline?chapter=2")
	);
	assert.equal(missingBook.status, 400);
	assert.equal((await json(missingBook)).error, "A chapter requires a book.");

	const response = await handler(new Request("https://example.test/api/bible/atlas/timeline"));
	assert.equal(response.status, 200);
	const body = await json(response);
	assert.deepEqual(body.allEras, ATLAS_ERAS);
	assert.ok(body.events.length > 0);
	assert.ok(body.eras.length > 0);
});

test("entity listing clamps limits and carries an opaque cursor payload", async () => {
	const auth = makeAuth();
	const { atlas: handler } = loadHandlers(auth);

	const firstResponse = await handler(
		new Request("https://example.test/api/bible/atlas?kind=person&limit=10000")
	);
	assert.equal(firstResponse.status, 200);
	const first = await json(firstResponse);
	assert.equal(first.kind, "person");
	assert.ok(first.results.length <= 100, "the route must cap a listing at 100 items");
	assert.equal(typeof first.nextCursor, "string");
	assert.ok(first.results.every((entity) => entity.kind === "person"));

	const secondResponse = await handler(
		new Request(
			`https://example.test/api/bible/atlas?kind=person&limit=3&cursor=${encodeURIComponent(first.nextCursor)}`
		)
	);
	const second = await json(secondResponse);
	assert.equal(second.results.length, 3);
	assert.equal(second.kind, "person");
	assert.ok(second.results.every((entity) => entity.kind === "person"));
	assert.notEqual(second.results[0].id, first.results[0].id);
	assert.equal(
		second.results.some((entity) => first.results.some((previous) => previous.id === entity.id)),
		false,
		"the cursor must advance beyond the first page"
	);
	assert.ok(Object.hasOwn(second, "nextCursor"));
	assert.equal(Object.hasOwn(first, "total"), false, "total is not part of the route payload");
});

test("search uses its default limit and reports untruncated per-kind counts", async () => {
	const auth = makeAuth();
	const { atlas: handler } = loadHandlers(auth);

	const response = await handler(new Request("https://example.test/api/bible/atlas?q=a"));
	assert.equal(response.status, 200);
	const body = await json(response);
	assert.equal(body.query, "a");
	assert.equal(body.results.length, 12, "default search limit is 12 for this broad query");
	assert.equal(body.counts.total, body.counts.person + body.counts.place + body.counts.event);
	assert.ok(body.counts.total > body.results.length);

	const limited = await handler(
		new Request("https://example.test/api/bible/atlas?q=a&limit=2")
	);
	const limitedBody = await json(limited);
	assert.equal(limitedBody.results.length, 2);
	assert.deepEqual(limitedBody.counts, body.counts);
});

test("event detail returns a resolved event and distinguishes missing ids", async () => {
	const auth = makeAuth();
	const { event: handler } = loadHandlers(auth);
	const knownId = atlas.events[0].id;

	const found = await handler(
		new Request(`https://example.test/api/bible/atlas/event?id=${knownId}`)
	);
	assert.equal(found.status, 200);
	const foundBody = await json(found);
	assert.equal(foundBody.event.id, knownId);
	assert.equal(typeof foundBody.event.title, "string");
	assert.ok(Array.isArray(foundBody.event.people));
	assert.ok(Array.isArray(foundBody.event.places));

	const missing = await handler(
		new Request("https://example.test/api/bible/atlas/event?id=not-an-event")
	);
	assert.equal(missing.status, 404);
	assert.equal((await json(missing)).error, "No such event.");

	const absent = await handler(new Request("https://example.test/api/bible/atlas/event"));
	assert.equal(absent.status, 400);
	assert.equal((await json(absent)).error, "An event id is required.");
});

test("connection requires both person ids and returns a cited reviewed path", async () => {
	const auth = makeAuth();
	const { connection: handler } = loadHandlers(auth);

	for (const query of ["", "?from=moses", "?to=aaron"]) {
		const response = await handler(
			new Request(`https://example.test/api/bible/atlas/connection${query}`)
		);
		assert.equal(response.status, 400, query || "missing query");
		assert.equal((await json(response)).error, "Both from and to person ids are required.");
	}

	const found = await handler(
		new Request("https://example.test/api/bible/atlas/connection?from=moses&to=aaron")
	);
	assert.equal(found.status, 200);
	const body = await json(found);
	assert.deepEqual(body.path.ids, ["moses", "aaron"]);
	assert.equal(body.path.relations.length, 1);
	assert.equal(body.path.relations[0].id, "moses-aaron-sibling");
	assert.ok(body.path.relations[0].refs.length > 0, "each relation step must carry citations");
});

test("connection returns 404 when no reviewed person path exists", async () => {
	const auth = makeAuth();
	const { connection: handler } = loadHandlers(auth);
	const response = await handler(
		new Request("https://example.test/api/bible/atlas/connection?from=moses&to=not-a-person")
	);
	assert.equal(response.status, 404);
	assert.equal((await json(response)).error, "No reviewed connection was found.");
});
