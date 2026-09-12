import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

const { localDayKey, resolveReadingTimezone, shiftDayKey } = loadModule(
	"../src/lib/reading-history.ts",
	["localDayKey", "resolveReadingTimezone", "shiftDayKey"]
);

// The real ladder, so the queue is tested against the schedule that ships.
const schedule = loadModule(
	"../src/lib/learn-schedule.ts",
	["LEARN_DAILY_LIMIT", "reviewCard", "startOfToday", "startOfTomorrow", "toLearnStage"],
	{ localDayKey, resolveReadingTimezone, shiftDayKey }
);

const LA = "America/Los_Angeles";
const JOHN_3 = [
	"There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:",
	"The same came to Jesus by night...",
];
const JOHN_3_16 =
	"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

/**
 * A verse store standing in for Prisma: only the queries src/lib/learn.ts
 * actually issues, with every call recorded so a test can prove what was NOT
 * written as well as what was.
 */
function makeDb({ cards = [], timezone = LA } = {}) {
	const state = {
		cards: cards.map((card, index) => ({
			id: `card-${index + 1}`,
			translation: "KJV",
			source: "sheet",
			stage: 0,
			intervalDays: 0,
			lastReviewedAt: null,
			knownAt: null,
			createdAt: new Date("2026-09-01T00:00:00Z"),
			updatedAt: new Date("2026-09-01T00:00:00Z"),
			...card,
		})),
		calls: [],
		nextId: cards.length + 1,
	};

	const matches = (row, where) => {
		if (where.userId !== undefined && row.userId !== where.userId) return false;
		if (where.id !== undefined && row.id !== where.id) return false;
		if (where.dueAt?.lt !== undefined && !(row.dueAt.getTime() < where.dueAt.lt.getTime())) {
			return false;
		}
		if (where.knownAt?.not === null && row.knownAt === null) return false;
		return true;
	};
	const sorted = (rows, orderBy) =>
		[...rows].sort((a, b) => {
			for (const clause of orderBy ?? []) {
				const [field, direction] = Object.entries(clause)[0];
				const delta = a[field].getTime() - b[field].getTime();
				if (delta !== 0) return direction === "desc" ? -delta : delta;
			}
			return 0;
		});

	const prisma = {
		pushToken: {
			findFirst: async () => {
				state.calls.push(["pushToken.findFirst"]);
				return timezone === null ? null : { timezone };
			},
		},
		verseMemory: {
			findMany: async ({ where, orderBy, take }) => {
				state.calls.push(["verseMemory.findMany", where]);
				return sorted(state.cards.filter((row) => matches(row, where)), orderBy).slice(0, take);
			},
			count: async ({ where }) => {
				state.calls.push(["verseMemory.count", where]);
				return state.cards.filter((row) => matches(row, where)).length;
			},
			findFirst: async ({ where }) => {
				state.calls.push(["verseMemory.findFirst", where]);
				return state.cards.find((row) => matches(row, where)) ?? null;
			},
			findUnique: async ({ where }) => {
				const key = where.userId_book_chapter_verse;
				state.calls.push(["verseMemory.findUnique", key]);
				return (
					state.cards.find(
						(row) =>
							row.userId === key.userId &&
							row.book === key.book &&
							row.chapter === key.chapter &&
							row.verse === key.verse
					) ?? null
				);
			},
			create: async ({ data }) => {
				state.calls.push(["verseMemory.create", data]);
				const row = {
					id: `card-${state.nextId++}`,
					stage: 0,
					intervalDays: 0,
					lastReviewedAt: null,
					knownAt: null,
					createdAt: new Date("2026-09-12T00:00:00Z"),
					updatedAt: new Date("2026-09-12T00:00:00Z"),
					...data,
				};
				state.cards.push(row);
				return row;
			},
			update: async ({ where, data }) => {
				state.calls.push(["verseMemory.update", where, data]);
				const row = state.cards.find((entry) => entry.id === where.id);
				Object.assign(row, data);
				return row;
			},
			deleteMany: async ({ where }) => {
				state.calls.push(["verseMemory.deleteMany", where]);
				const doomed = state.cards.filter((row) => matches(row, where));
				state.cards = state.cards.filter((row) => !doomed.includes(row));
				return { count: doomed.length };
			},
		},
	};
	return { prisma, state };
}

function loadLearn(prisma) {
	return loadModule(
		"../src/lib/learn.ts",
		["addCard", "formatLearnReference", "learnVerseText", "removeCard", "reviewCardById", "todayCards"],
		{
			prisma,
			bookByOrder: (order) => (order === 43 ? { name: "John" } : null),
			getKjvChapter: async (book, chapter) => {
				if (book !== 43 || chapter !== 3) throw new Error("no such chapter");
				return [...JOHN_3, ...Array(13).fill("filler"), JOHN_3_16];
			},
			getChapter: async () => {
				throw new Error("network is not available in tests");
			},
			...schedule,
		}
	);
}

const alice = "user-alice";
const at = (value) => new Date(value);
// 11:00 on 2026-09-12 in Los Angeles.
const NOW = at("2026-09-12T18:00:00Z");

const john = (verse, extra = {}) => ({
	userId: alice,
	book: 43,
	chapter: 3,
	verse,
	...extra,
});

test("today's session is the three oldest due cards, newest added first among ties", async () => {
	const { prisma } = makeDb({
		cards: [
			john(1, { id: "overdue", dueAt: at("2026-09-09T07:00:00Z") }),
			john(2, {
				id: "today-old",
				dueAt: at("2026-09-12T07:00:00Z"),
				createdAt: at("2026-09-02T00:00:00Z"),
			}),
			john(16, {
				id: "today-new",
				dueAt: at("2026-09-12T07:00:00Z"),
				createdAt: at("2026-09-12T16:00:00Z"),
			}),
			john(3, { id: "tomorrow", dueAt: at("2026-09-13T07:00:00Z") }),
			john(4, { id: "someone-else", userId: "user-bob", dueAt: at("2026-09-01T07:00:00Z") }),
		],
	});
	const { todayCards } = loadLearn(prisma);

	const today = await todayCards(alice, NOW);
	assert.deepEqual(
		today.cards.map((card) => card.id),
		["overdue", "today-new", "today-old"]
	);
	// Three cards are due; the one scheduled for tomorrow and Bob's are not.
	assert.equal(today.queueCount, 3);
	assert.equal(today.knownCount, 0);
	assert.equal(today.cards[1].text, JOHN_3_16);
	assert.equal(today.cards[1].reference, "John 3:16");
	assert.equal(today.cards[1].dueAt, "2026-09-12T07:00:00.000Z");
	assert.equal(today.cards[1].knownAt, null);
});

test("the session is capped at three even with a backlog, and known verses are counted", async () => {
	const { prisma } = makeDb({
		cards: [
			john(1, { dueAt: at("2026-09-05T07:00:00Z") }),
			john(2, { dueAt: at("2026-09-06T07:00:00Z") }),
			john(3, { dueAt: at("2026-09-07T07:00:00Z") }),
			john(4, { dueAt: at("2026-09-08T07:00:00Z") }),
			john(5, { dueAt: at("2026-09-09T07:00:00Z"), knownAt: at("2026-09-01T00:00:00Z") }),
			john(6, { dueAt: at("2026-11-09T07:00:00Z"), knownAt: at("2026-09-01T00:00:00Z") }),
		],
	});
	const { todayCards } = loadLearn(prisma);

	const today = await todayCards(alice, NOW);
	assert.equal(today.cards.length, 3);
	assert.equal(today.queueCount, 5);
	// knownCount counts every known verse, not only the ones due today.
	assert.equal(today.knownCount, 2);
});

test("a card due later today in the user's zone is still today's card", async () => {
	// 23:30 on 2026-09-12 in Los Angeles, already the 13th in UTC.
	const lateEvening = at("2026-09-13T06:30:00Z");
	const { prisma } = makeDb({ cards: [john(16, { dueAt: at("2026-09-12T07:00:00Z") })] });
	const { todayCards } = loadLearn(prisma);

	assert.equal((await todayCards(alice, lateEvening)).cards.length, 1);
	// Half an hour later it is the 13th for them too, and a card due on the
	// 14th is still not offered.
	const { prisma: tomorrow } = makeDb({ cards: [john(16, { dueAt: at("2026-09-14T07:00:00Z") })] });
	assert.equal((await loadLearn(tomorrow).todayCards(alice, at("2026-09-13T07:30:00Z"))).cards.length, 0);
});

test("adding a verse twice returns the same card and never resets the schedule", async () => {
	const { prisma, state } = makeDb({
		cards: [
			john(16, {
				id: "existing",
				stage: 3,
				intervalDays: 8,
				dueAt: at("2026-09-20T07:00:00Z"),
			}),
		],
	});
	const { addCard } = loadLearn(prisma);

	const first = await addCard(
		alice,
		{ book: 43, chapter: 3, verse: 16, translation: "KJV", source: "highlight" },
		NOW
	);
	assert.equal(first.created, false);
	assert.equal(first.card.id, "existing");
	assert.equal(first.card.stage, 3);
	assert.equal(first.card.intervalDays, 8);
	assert.equal(first.card.dueAt, "2026-09-20T07:00:00.000Z");
	assert.equal(state.calls.filter(([name]) => name === "verseMemory.create").length, 0);
	assert.equal(state.calls.filter(([name]) => name === "verseMemory.update").length, 0);

	// Re-adding from an NKJV chapter switches the translation on the one card.
	const second = await addCard(
		alice,
		{ book: 43, chapter: 3, verse: 16, translation: "NKJV", source: "sheet" },
		NOW
	);
	assert.equal(second.created, false);
	assert.equal(second.card.id, "existing");
	assert.equal(second.card.translation, "NKJV");
	assert.equal(second.card.stage, 3);
	assert.equal(state.cards.length, 1);
	const [, where, data] = state.calls.find(([name]) => name === "verseMemory.update");
	assert.deepEqual([where, data], [{ id: "existing" }, { translation: "NKJV" }]);
	// NKJV text is unreachable in this test, so the card falls back to the
	// bundled KJV rather than shipping an empty verse.
	assert.equal(second.card.text, JOHN_3_16);
});

test("a new card starts unread and due at the user's midnight today", async () => {
	const { prisma, state } = makeDb({});
	const { addCard } = loadLearn(prisma);

	const { card, created } = await addCard(
		alice,
		{ book: 43, chapter: 3, verse: 16, translation: "KJV", source: "chat" },
		NOW
	);
	assert.equal(created, true);
	assert.equal(card.stage, 0);
	assert.equal(card.intervalDays, 0);
	assert.equal(card.knownAt, null);
	assert.equal(card.dueAt, "2026-09-12T07:00:00.000Z");
	assert.equal(card.reference, "John 3:16");
	assert.equal(card.text, JOHN_3_16);
	const [, data] = state.calls.find(([name]) => name === "verseMemory.create");
	assert.equal(data.source, "chat");
	assert.equal(data.userId, alice);
});

test("a review moves the stored card and hands back what the client should show", async () => {
	const { prisma, state } = makeDb({
		cards: [john(16, { id: "existing", stage: 2, dueAt: at("2026-09-12T07:00:00Z") })],
	});
	const { reviewCardById } = loadLearn(prisma);

	const card = await reviewCardById(alice, "existing", "good", NOW);
	assert.equal(card.stage, 3);
	assert.equal(card.dueAt, "2026-09-12T07:00:00.000Z");
	assert.equal(state.cards[0].stage, 3);
	assert.equal(state.cards[0].lastReviewedAt.toISOString(), NOW.toISOString());
});

test("another user's card is invisible to review and to delete", async () => {
	const { prisma, state } = makeDb({
		cards: [john(16, { id: "bobs", userId: "user-bob", dueAt: at("2026-09-12T07:00:00Z") })],
	});
	const { removeCard, reviewCardById } = loadLearn(prisma);

	assert.equal(await reviewCardById(alice, "bobs", "good", NOW), null);
	assert.equal(await removeCard(alice, "bobs"), false);
	assert.equal(state.cards.length, 1);
	assert.equal(state.calls.filter(([name]) => name === "verseMemory.update").length, 0);

	assert.equal(await removeCard("user-bob", "bobs"), true);
	assert.equal(state.cards.length, 0);
});

test("a user with no push token still gets a due date, on the default zone", async () => {
	const { prisma } = makeDb({ timezone: null });
	const { addCard } = loadLearn(prisma);
	const { card } = await addCard(
		alice,
		{ book: 43, chapter: 3, verse: 16, translation: "KJV", source: "sheet" },
		NOW
	);
	assert.equal(card.dueAt, "2026-09-12T07:00:00.000Z");
});

test("a verse outside the bundled text resolves to nothing, so the route can refuse it", async () => {
	const { prisma } = makeDb({});
	const { formatLearnReference, learnVerseText } = loadLearn(prisma);
	assert.equal(await learnVerseText("KJV", 43, 3, 999), undefined);
	assert.equal(await learnVerseText("KJV", 43, 99, 1), undefined);
	assert.equal(formatLearnReference(43, 3, 16), "John 3:16");
});
