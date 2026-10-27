/**
 * Habits & Reflection (LC-17652, docs/beta/growth.md): the week it counts in,
 * the habits a founder chooses, how each is kept, the journal and the
 * follow-ups, and the privacy contract on what the module writes.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	HABITS_MAX,
	HABIT_CHECKS_MAX,
	HISTORY_WEEKS,
	REFLECTION_PROMPTS,
	TALK_IT_OVER_MAX,
	WEEK_VERSES,
	addDays,
	applyPracticeAction,
	canCheckDay,
	checkHabitPatch,
	checkNewHabit,
	checkPracticeAction,
	checkReflectionPrompt,
	checkReflectionText,
	daysWithGod,
	dueReminders,
	earliestWeekStart,
	followUpDay,
	isDayKey,
	isFollowUpChoice,
	isFollowUpDue,
	isManualHabit,
	keptDays,
	parseHabitData,
	parsePracticeData,
	parseReflectionData,
	resolveWeekStart,
	ringFraction,
	setCheck,
	talkItOverPrompt,
	verseForWeek,
	weekDays,
	weekLine,
	weekMarks,
	weekStartOf,
	weekdayIndex,
} from "../src/lib/beta/growth/growth-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

// Monday 26 October 2026.
const MONDAY = "2026-10-26";

test("the week runs Monday to Sunday on the calendar, across months and DST", () => {
	assert.equal(weekdayIndex(MONDAY), 0);
	assert.equal(weekdayIndex("2026-11-01"), 6);
	assert.equal(weekStartOf("2026-11-01"), MONDAY);
	assert.equal(weekStartOf("2026-10-29"), MONDAY);
	assert.deepEqual(weekDays(MONDAY), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
	// US DST ends on 1 November 2026: still seven distinct days.
	assert.equal(new Set(weekDays(MONDAY)).size, 7);
	assert.equal(addDays("2026-03-08", 1), "2026-03-09");
	assert.equal(addDays("2024-02-28", 1), "2024-02-29");
	assert.equal(weekStartOf("2027-01-01"), "2026-12-28");
});

test("only real calendar days are day keys", () => {
	for (const day of ["2026-10-26", "2024-02-29"]) assert.equal(isDayKey(day), true, day);
	for (const day of ["2026-02-30", "2026-13-01", "26-10-26", "2026-10-26T00:00", "", null, 20261026]) assert.equal(isDayKey(day), false, String(day));
});

test("the shown week is clamped between the history's oldest week and this week", () => {
	assert.equal(resolveWeekStart(undefined, "2026-10-28"), MONDAY);
	assert.equal(resolveWeekStart("nonsense", "2026-10-28"), MONDAY);
	assert.equal(resolveWeekStart("2026-11-20", "2026-10-28"), MONDAY, "never a future week");
	assert.equal(resolveWeekStart("2026-10-21", "2026-10-28"), "2026-10-19", "any day picks its Monday");
	const earliest = earliestWeekStart("2026-10-28");
	assert.equal(earliest, addDays(MONDAY, -7 * HISTORY_WEEKS));
	assert.equal(resolveWeekStart("2020-01-01", "2026-10-28"), earliest);
});

test("a day can be marked from the oldest history week up to today, never ahead", () => {
	const today = "2026-10-28";
	assert.equal(canCheckDay(today, today), true);
	assert.equal(canCheckDay("2026-10-26", today), true);
	assert.equal(canCheckDay(earliestWeekStart(today), today), true);
	assert.equal(canCheckDay(addDays(earliestWeekStart(today), -1), today), false);
	assert.equal(canCheckDay("2026-10-29", today), false, "tomorrow");
	assert.equal(canCheckDay("2026-02-30", today), false);
});

test("habits: one of each kind SureWord can see, any number of custom ones, up to the cap", () => {
	const reading = checkNewHabit({ type: "reading" }, []);
	assert.deepEqual(reading, { ok: true, value: { type: "reading", name: "Bible reading", target: 5, reminder: null } });
	assert.equal(checkNewHabit({ type: "reading" }, ["reading"]).ok, false, "no second reading habit");
	assert.equal(checkNewHabit({ type: "custom", name: "Fasting", target: 1 }, ["custom"]).ok, true);
	assert.equal(checkNewHabit({ type: "custom", name: "  " }, []).ok, false, "a custom habit needs a name");
	assert.equal(checkNewHabit({ type: "custom", name: "x".repeat(61) }, []).ok, false);
	assert.equal(checkNewHabit({ type: "score" }, []).ok, false);
	assert.equal(checkNewHabit({ type: "custom", name: "Walk", target: 0 }, []).ok, false);
	assert.equal(checkNewHabit({ type: "custom", name: "Walk", target: 8 }, []).ok, false);
	assert.equal(checkNewHabit({ type: "custom", name: "Walk", target: 2.5 }, []).ok, false);
	assert.equal(checkNewHabit({ type: "prayer", reminder: "7:30" }, []).ok, false, "reminders are HH:MM");
	assert.equal(checkNewHabit({ type: "prayer", reminder: "24:00" }, []).ok, false);
	assert.equal(checkNewHabit({ type: "prayer", reminder: "07:30" }, []).value.reminder, "07:30");
	assert.equal(checkNewHabit({ type: "custom", name: "One more" }, Array(HABITS_MAX).fill("custom")).ok, false);
	assert.equal(checkNewHabit({ type: "custom", name: "  Morning   worship " }, []).value.name, "Morning worship");
});

test("a habit edit changes only what it names, and never its kind", () => {
	assert.deepEqual(checkHabitPatch({ target: 4 }), { ok: true, value: { target: 4 } });
	assert.deepEqual(checkHabitPatch({ reminder: null }), { ok: true, value: { reminder: null } });
	assert.deepEqual(checkHabitPatch({ reminder: "" }), { ok: true, value: { reminder: null } });
	assert.equal(checkHabitPatch({}).ok, false);
	assert.equal(checkHabitPatch({ type: "reading", target: 3 }).ok, false);
	assert.equal(checkHabitPatch({ name: "" }).ok, false);
});

test("only prayer and custom habits are marked by hand", () => {
	assert.equal(isManualHabit("prayer"), true);
	assert.equal(isManualHabit("custom"), true);
	for (const type of ["reading", "memory", "study"]) assert.equal(isManualHabit(type), false, type);
});

test("stored habit data is read defensively", () => {
	assert.equal(parseHabitData(null), null);
	assert.equal(parseHabitData({ type: "streak", target: 3 }), null);
	assert.equal(parseHabitData({ type: "custom", target: 9 }), null);
	assert.deepEqual(parseHabitData({ type: "custom", target: 3, reminder: null, checks: ["2026-10-27", "bad", "2026-10-26", "2026-10-27"], order: 5 }), {
		type: "custom",
		target: 3,
		reminder: null,
		checks: ["2026-10-26", "2026-10-27"],
		order: 5,
	});
});

test("marking a day is idempotent, and the oldest checks give way when full", () => {
	assert.deepEqual(setCheck([], MONDAY, true), [MONDAY]);
	assert.deepEqual(setCheck([MONDAY], MONDAY, true), [MONDAY], "a retried tap does not flip it back");
	assert.deepEqual(setCheck([MONDAY], MONDAY, false), []);
	assert.deepEqual(setCheck([], MONDAY, false), []);
	assert.deepEqual(setCheck(["2026-10-28", MONDAY], "2026-10-27", true), [MONDAY, "2026-10-27", "2026-10-28"]);
	const full = Array.from({ length: HABIT_CHECKS_MAX }, (_, index) => addDays("2010-01-01", index));
	const next = setCheck(full, "2030-01-01", true);
	assert.equal(next.length, HABIT_CHECKS_MAX);
	assert.equal(next.at(-1), "2030-01-01");
	assert.equal(next[0], "2010-01-02");
});

const ACTIVITY = {
	reading: new Set(["2026-10-19", "2026-10-20", "2026-10-22", "2026-10-26"]),
	memory: new Set(["2026-10-21", "2026-10-26"]),
	study: new Set(["2026-10-23"]),
	reflection: new Set(["2026-10-24"]),
};

test("what SureWord can see is counted from activity; typed checks never count for it", () => {
	assert.deepEqual([...keptDays({ type: "reading", checks: ["2026-10-25"] }, ACTIVITY)].sort(), [...ACTIVITY.reading].sort());
	assert.deepEqual([...keptDays({ type: "memory", checks: [] }, ACTIVITY)].sort(), ["2026-10-21", "2026-10-26"]);
	assert.deepEqual([...keptDays({ type: "study", checks: [] }, ACTIVITY)], ["2026-10-23"]);
	assert.deepEqual([...keptDays({ type: "prayer", checks: ["2026-10-20"] }, ACTIVITY)].sort(), ["2026-10-20", "2026-10-24"], "prayer: marked, or a reflection written");
	assert.deepEqual([...keptDays({ type: "custom", checks: ["2026-10-20"] }, ACTIVITY)], ["2026-10-20"], "custom: marked only");
});

test("the week marks never count a day still to come", () => {
	const kept = new Set(["2026-10-26", "2026-10-27", "2026-10-30"]);
	assert.deepEqual(weekMarks(kept, MONDAY, "2026-10-28"), [true, true, false, false, false, false, false]);
	assert.deepEqual(weekMarks(kept, MONDAY, "2026-11-01"), [true, true, false, false, true, false, false]);
});

test("a ring fills to the target and no further; there is no score to beat", () => {
	assert.equal(ringFraction(0, 5), 0);
	assert.equal(ringFraction(4, 5), 0.8);
	assert.equal(ringFraction(7, 5), 1);
	assert.equal(ringFraction(-1, 5), 0);
	assert.equal(ringFraction(3, 0), 0);
});

test("the day row is any day a habit was kept, or any activity before there are habits", () => {
	assert.deepEqual([...daysWithGod([new Set(["2026-10-20"]), new Set(["2026-10-20", "2026-10-21"])], ACTIVITY)].sort(), ["2026-10-20", "2026-10-21"]);
	assert.equal(daysWithGod([], ACTIVITY).size, 7);
});

test("the week line names what was kept and never what was not", () => {
	assert.equal(weekLine(1, true), "1 day with God so far this week");
	assert.equal(weekLine(4, false), "4 days with God that week");
	for (const line of [weekLine(0, true), weekLine(0, false), weekLine(3, true)]) {
		assert.doesNotMatch(line, /miss|behind|fail|streak|only|lost|broke/i, line);
	}
});

test("in-app reminders: a habit is due once its time has passed and until it is kept", () => {
	const habits = [
		{ id: "a", reminder: "07:00", keptToday: false },
		{ id: "b", reminder: "07:00", keptToday: true },
		{ id: "c", reminder: null, keptToday: false },
		{ id: "d", reminder: "21:30", keptToday: false },
	];
	assert.deepEqual(dueReminders(habits, 6 * 60 + 59).map((habit) => habit.id), []);
	assert.deepEqual(dueReminders(habits, 7 * 60).map((habit) => habit.id), ["a"]);
	assert.deepEqual(dueReminders(habits, 22 * 60).map((habit) => habit.id), ["a", "d"]);
});

test("reflections: text is required, prompts are optional and only the listed ones", () => {
	assert.equal(checkReflectionText("").ok, false);
	assert.equal(checkReflectionText("   \n ").ok, false);
	assert.equal(checkReflectionText(42).ok, false);
	assert.equal(checkReflectionText("x".repeat(10_001)).ok, false);
	assert.deepEqual(checkReflectionText("  Peace in Psalm 23.  "), { ok: true, value: "Peace in Psalm 23." });
	assert.deepEqual(checkReflectionPrompt(null), { ok: true, value: null });
	assert.deepEqual(checkReflectionPrompt(REFLECTION_PROMPTS[0]), { ok: true, value: REFLECTION_PROMPTS[0] });
	assert.equal(checkReflectionPrompt("Rate your faith from 1 to 10").ok, false);
	assert.equal(parseReflectionData({ text: "x", day: "2026-13-40" }), null);
	assert.equal(parseReflectionData({ text: "x", day: MONDAY, prompt: "made up" }).prompt, null);
	assert.equal(parseReflectionData({ text: "x", day: MONDAY }).private, true);
});

test("Talk it over prefills a chat only with what the founder chose, and keeps links short", () => {
	const short = talkItOverPrompt("reflection", "Rest is obedience.", "Psalm 23");
	assert.match(short, /on Psalm 23/);
	assert.match(short, /"Rest is obedience\."/);
	const long = talkItOverPrompt("practice", "a".repeat(5_000), null);
	assert.ok(long.length < TALK_IT_OVER_MAX + 200);
	assert.match(long, /…"$/);
});

const PRACTICE = parsePracticeData({ text: "Be swift to hear", passage: "James 1:19", day: "2026-10-19", followUpOn: "2026-10-26", status: "active", notes: [] });

test("follow-ups come back on the day the founder chose, and only while practising", () => {
	assert.equal(followUpDay("none", MONDAY), null);
	assert.equal(followUpDay("3d", MONDAY), "2026-10-29");
	assert.equal(followUpDay("1w", MONDAY), "2026-11-02");
	assert.equal(followUpDay("1m", MONDAY), "2026-11-25");
	assert.equal(isFollowUpDue(PRACTICE, "2026-10-25"), false);
	assert.equal(isFollowUpDue(PRACTICE, MONDAY), true);
	assert.equal(isFollowUpDue({ ...PRACTICE, followUpOn: null }, MONDAY), false);
	assert.equal(isFollowUpDue({ ...PRACTICE, status: "lived" }, MONDAY), false);
});

test("practice actions keep what was written and move the follow-up", () => {
	const followed = applyPracticeAction(PRACTICE, { action: "follow-up", note: "Better at dinner.", next: "2w" }, MONDAY);
	assert.equal(followed.ok, true);
	assert.deepEqual(followed.value.notes, [{ day: MONDAY, note: "Better at dinner." }]);
	assert.equal(followed.value.followUpOn, "2026-11-09");
	const quiet = applyPracticeAction(PRACTICE, { action: "follow-up", note: null, next: "none" }, MONDAY);
	assert.deepEqual(quiet.value.notes, []);
	assert.equal(quiet.value.followUpOn, null);
	assert.equal(applyPracticeAction(PRACTICE, { action: "later" }, MONDAY).value.followUpOn, "2026-10-27");
	const lived = applyPracticeAction(PRACTICE, { action: "lived", note: "It is how I listen now." }, MONDAY).value;
	assert.equal(lived.status, "lived");
	assert.equal(lived.followUpOn, null);
	assert.equal(applyPracticeAction(lived, { action: "later" }, MONDAY).ok, false);
	assert.equal(applyPracticeAction(lived, { action: "follow-up", note: null, next: "1w" }, MONDAY).ok, false);
	const reopened = applyPracticeAction(lived, { action: "reopen", next: "1w" }, MONDAY).value;
	assert.equal(reopened.status, "active");
	assert.equal(reopened.followUpOn, "2026-11-02");
});

test("practice PATCH bodies are read strictly", () => {
	assert.equal(checkPracticeAction(null).ok, false);
	assert.equal(checkPracticeAction({ action: "delete-everything" }).ok, false);
	assert.equal(checkPracticeAction({ action: "follow-up", next: "1y" }).ok, false);
	assert.equal(checkPracticeAction({ action: "follow-up", note: 7 }).ok, false);
	assert.deepEqual(checkPracticeAction({ action: "follow-up", note: "  ", next: "1w" }), { ok: true, value: { action: "follow-up", note: null, next: "1w" } });
	assert.deepEqual(checkPracticeAction({ action: "later" }), { ok: true, value: { action: "later" } });
	assert.equal(checkPracticeAction({ action: "edit", text: "Pray first" }).ok, false, "practices are not edited in place");
	for (const key of ["toString", "__proto__", "constructor", "valueOf", "hasOwnProperty"]) {
		assert.equal(checkPracticeAction({ action: "follow-up", next: key }).ok, false, `next: ${key}`);
		assert.equal(checkPracticeAction({ action: "reopen", next: key }).ok, false, `reopen next: ${key}`);
		assert.equal(isFollowUpChoice(key), false, key);
	}
});

test("one closing verse all week, from the bundled KJV list", () => {
	assert.equal(verseForWeek(MONDAY), verseForWeek(weekStartOf("2026-11-01")));
	assert.notEqual(verseForWeek(MONDAY), verseForWeek(addDays(MONDAY, 7)));
	assert.ok(WEEK_VERSES.includes(verseForWeek("1970-01-05")));
	const page = read("src/app/beta/learn/growth/page.tsx");
	assert.match(page, /getKjvChapter\(/, "the verse text is read from the bundled KJV, never typed in");
});

function sourcesUnder(dir) {
	const out = [];
	const walk = (path) => {
		for (const entry of readdirSync(join(repoRoot, path))) {
			const child = `${path}/${entry}`;
			if (statSync(join(repoRoot, child)).isDirectory()) walk(child);
			else if (/\.(ts|tsx)$/.test(entry)) out.push(child);
		}
	};
	walk(dir);
	return out;
}

test("nothing in the module talks to an AI, and the journal's words stay out of what other modules index", () => {
	const files = [...sourcesUnder("src/lib/beta/growth"), ...sourcesUnder("src/components/beta/growth"), ...sourcesUnder("src/app/api/beta/growth"), "src/app/beta/learn/growth/page.tsx"];
	assert.ok(files.length >= 15);
	for (const file of files) {
		const source = read(file);
		assert.doesNotMatch(source, /from "@\/lib\/ai|from "ai"|@ai-sdk|openai|scripture-search|note-embeddings|lib\/memory"/, `${file} must not reach an AI or embeddings`);
	}
	const server = read("src/lib/beta/growth/growth.ts");
	// Reflections and practice items are written with a fixed title and no body:
	// their words live in data only (the Vault indexes title and body).
	assert.equal(/\bbody:/.test(server), false, "growth items never set a body");
	assert.match(server, /kind: REFLECTION, title: REFLECTION_TITLE/);
	assert.match(server, /kind: PRACTICE, title: PRACTICE_TITLE/);
	assert.match(server, /private: true/);
	// "Talk it over" only prefills the chat; the founder sends it.
	for (const file of ["src/components/beta/growth/JournalCard.tsx", "src/components/beta/growth/PracticeCard.tsx"]) {
		assert.match(read(file), /<Link prefetch=\{false\} href=\{`\/\?prompt=\$\{encodeURIComponent\(talkItOverPrompt\(/, `${file}: a prefetch would send the entry in a URL before it is pressed`);
	}
});

test("the growth page and every growth route gate first", () => {
	assert.match(read("src/app/beta/learn/growth/page.tsx"), /await requireBetaPage\(\)/);
	for (const file of sourcesUnder("src/app/api/beta/growth").filter((path) => path.endsWith("route.ts"))) {
		const source = read(file);
		const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
		const gates = source.match(/const gate = await requireBetaApi\(\);\n\tif \(!gate\.ok\) return gate\.response;/g) ?? [];
		assert.ok(handlers.length >= 1, file);
		assert.equal(gates.length, handlers.length, `${file}: every handler gates before anything else`);
	}
});
