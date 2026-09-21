/* Sermon studies: what the chat tools are allowed to see, and how a study is
 * written out for a model.
 *
 * The formatter is where this feature's one doctrinal rule lives in words
 * rather than in typography - the preacher's own sentences and SureWord's
 * teaching must never read as the same voice - so it is tested the way the
 * screens are reviewed: by reading what comes out.
 *
 * src/lib/sermon-studies.ts imports Prisma and server-only, so it is
 * instantiated from the shipped source with those stubbed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const EXPORTS = [
	"SERMON_RECENT_DAYS",
	"channelIdFor",
	"formatSermonStudyForModel",
	"formatSermonStudyListForModel",
	"formatServiceDate",
	"formatTimestamp",
	"getSermonStudy",
	"latestSermonStudy",
	"listSermonStudies",
	"resolveSermonStudy",
	"watchUrl",
];

function loadSermonStudies({
	prisma = {},
	createAttachmentPreviewUrl = async () => ({ previewUrl: "signed" }),
} = {}) {
	const source = read("../src/lib/sermon-studies.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const factory = new Function(
		"prisma",
		"createAttachmentPreviewUrl",
		`${stripTypeScriptTypes(source)}\nreturn { ${EXPORTS.join(", ")} };`,
	);
	return factory(prisma, createAttachmentPreviewUrl);
}

const CHANNEL = "UCiTssyWZc2PJ25OAZOaN7Ag";

const SECTION = {
	heading: "The call that costs you something",
	startMs: 1_867_000,
	pastorQuote: "He did not say it would be easy. He said follow me.",
	passage: "Luke 9:57-58",
	passageText: [
		{
			verse: 57,
			text: "And it came to pass, that, as they went in the way, a certain man said unto him, Lord, I will follow thee whithersoever thou goest.",
		},
	],
	explanation: "SureWord's teaching: the cost is named before the call is answered.",
	reflection: "What has following Christ actually cost you this week?",
	imagePathname: "sermon/abc/1.png",
};

const STUDY_ROW = {
	id: "smn_1",
	videoId: "abcdefghijk",
	channelId: CHANNEL,
	title: "Follow Me",
	serviceTitle: "Sunday Morning Worship",
	serviceDate: new Date("2026-09-13T12:00:00.000Z"),
	preacher: "Pastor Ron Hess",
	preachingText: "Luke 9:57-62",
	bigIdea: "Christ calls before He comforts.",
	summary: "A walk through the three men who met Christ on the road.",
	application: "Name the one thing you have been holding back.",
	prayer: "Lord, make me willing.",
	sections: [SECTION],
	sermonStartMs: 1_867_000,
	durationSec: 4_560,
	createdAt: new Date("2026-09-13T18:00:00.000Z"),
};

/** Just enough of Prisma's `where` to exercise the lookups this module writes. */
function matches(row, where) {
	if (where.channelId !== undefined && row.channelId !== where.channelId) return false;
	if (where.id !== undefined && row.id !== where.id) return false;
	if (where.serviceDate !== undefined) {
		const at = row.serviceDate?.getTime();
		if (at === undefined) return false;
		const { gte, lt } = where.serviceDate;
		if (gte !== undefined && at < gte.getTime()) return false;
		if (lt !== undefined && at >= lt.getTime()) return false;
	}
	if (Array.isArray(where.OR)) {
		return where.OR.some((clause) =>
			Object.entries(clause).some(([field, rule]) =>
				String(row[field] ?? "")
					.toLowerCase()
					.includes(String(rule.contains).toLowerCase()),
			),
		);
	}
	return true;
}

/** A church with a channel and the studies on it; channelId null for none. */
function db(rows, { channelId = CHANNEL } = {}) {
	const newestFirst = [...rows].sort(
		(a, b) => (b.serviceDate?.getTime() ?? 0) - (a.serviceDate?.getTime() ?? 0),
	);
	return {
		userChurch: {
			findUnique: async () => (channelId ? { youtubeChannelId: channelId } : null),
		},
		sermonStudy: {
			findMany: async (args) =>
				newestFirst
					.filter((row) => row.channelId === args.where.channelId)
					.slice(0, args.take ?? newestFirst.length),
			findFirst: async (args) => newestFirst.find((row) => matches(row, args.where)) ?? null,
		},
	};
}

test("a study written for the model keeps the preacher's words and SureWord's apart", () => {
	const { formatSermonStudyForModel } = loadSermonStudies();
	const text = formatSermonStudyForModel(
		{
			...STUDY_ROW,
			serviceDate: "2026-09-13",
			sections: [{ ...SECTION, imagePathname: undefined, imageUrl: null }],
			imageUrl: null,
		},
		"id",
	);

	assert.match(text, /Sermon study: "Follow Me" \(study id smn_1\)/);
	assert.match(text, /Sunday Morning Worship, preached Sunday, 13 September 2026, by Pastor Ron Hess\./);
	assert.match(text, /Announced text: Luke 9:57-62\./);
	assert.match(
		text,
		/What the preacher said here, word for word from the recording: "He did not say it would be easy/,
	);
	assert.match(
		text,
		/SureWord's own teaching on this part \(written by SureWord, not said from the pulpit\)/,
	);
	assert.match(text, /Only the lines marked as his own words are the preacher's/);
	assert.match(text, /Part 1 of 1 - The call that costs you something \(from 31:07 in the recording/);
	assert.match(text, /youtube\.com\/watch\?v=abcdefghijk&t=1867s/);
	assert.match(text, /^ {2}57 And it came to pass/m, "the passage keeps its verse numbers");
});

test("the teaching label stored in the prose is not printed twice", async () => {
	const { resolveSermonStudy, formatSermonStudyForModel } = loadSermonStudies({
		prisma: db([STUDY_ROW]),
	});
	const result = await resolveSermonStudy("user_1", { studyId: "smn_1" });
	assert.equal(
		result.study.sections[0].explanation,
		"the cost is named before the call is answered.",
	);
	assert.doesNotMatch(
		formatSermonStudyForModel(result.study, "id"),
		/pulpit\): SureWord's teaching:/,
	);
});

test("a part with nothing quotable says so rather than leaving a gap", () => {
	const { formatSermonStudyForModel } = loadSermonStudies();
	const text = formatSermonStudyForModel(
		{
			...STUDY_ROW,
			serviceDate: null,
			preacher: null,
			preachingText: null,
			sections: [
				{ ...SECTION, pastorQuote: null, passage: null, passageText: null, imageUrl: null },
			],
			imageUrl: null,
		},
		"latest",
	);
	assert.match(text, /^This is the most recent study their church has\./);
	assert.match(text, /No quotable line was verified for this part/);
	assert.doesNotMatch(text, /preached |by null|Announced text/);
});

test("a study found near a date says it is not the one that was asked for", () => {
	const { formatSermonStudyForModel } = loadSermonStudies();
	const text = formatSermonStudyForModel(
		{ ...STUDY_ROW, serviceDate: "2026-09-13", sections: [], imageUrl: null },
		"nearest-date",
	);
	assert.match(text, /^NOTE: there is no study for the exact date asked about/);
	assert.match(text, /say which service it is before answering from it/);
});

test("the list for the model names every study and holds none of the preaching", () => {
	const { formatSermonStudyListForModel } = loadSermonStudies();
	assert.match(
		formatSermonStudyListForModel([]),
		/no sermon studies\. Either they have not chosen a home church/,
	);
	const text = formatSermonStudyListForModel([
		{
			id: "smn_1",
			title: "Follow Me",
			serviceDate: "2026-09-13",
			preacher: "Pastor Ron Hess",
			preachingText: "Luke 9:57-62",
			bigIdea: "Christ calls before He comforts.",
		},
		{
			id: "smn_0",
			title: "The Waiting Room",
			serviceDate: null,
			preacher: null,
			preachingText: null,
			bigIdea: "God is not slow.",
		},
	]);
	assert.match(text, /newest first \(2\)/);
	assert.match(
		text,
		/- "Follow Me" \(study id smn_1\), Sunday, 13 September 2026, preached by Pastor Ron Hess, text Luke 9:57-62\./,
	);
	assert.match(text, /- "The Waiting Room" \(study id smn_0\), date unknown\. Big idea: God is not slow\./);
	assert.match(text, /read one in full with getSermonStudy before answering from it/);
	assert.doesNotMatch(text, /word for word|pulpit/, "the list carries no sermon content");
});

test("a reader whose church has no channel is told that, not that nothing matched", async () => {
	const { resolveSermonStudy, listSermonStudies, latestSermonStudy } = loadSermonStudies({
		prisma: db([STUDY_ROW], { channelId: null }),
	});
	assert.deepEqual(await resolveSermonStudy("user_1"), { found: false, reason: "no-channel" });
	assert.deepEqual(await listSermonStudies("user_1"), []);
	assert.equal(await latestSermonStudy("user_1", new Date("2026-09-14T12:00:00.000Z")), null);
});

test("a study id from another congregation is not readable", async () => {
	const other = { ...STUDY_ROW, id: "smn_other", channelId: "UCsomeoneelse" };
	const { resolveSermonStudy, getSermonStudy } = loadSermonStudies({
		prisma: db([STUDY_ROW, other]),
	});
	assert.deepEqual(await resolveSermonStudy("user_1", { studyId: "smn_other" }), {
		found: false,
		reason: "no-match",
	});
	assert.equal(await getSermonStudy("user_1", "smn_other"), null);
	const mine = await resolveSermonStudy("user_1", { studyId: "smn_1" });
	assert.equal(mine.found, true);
	assert.equal(mine.matchedBy, "id");
});

test("a date finds that service, and a date with no service finds the one before it", async () => {
	const older = {
		...STUDY_ROW,
		id: "smn_0",
		videoId: "olderolderx",
		title: "The Waiting Room",
		serviceDate: new Date("2026-09-06T12:00:00.000Z"),
	};
	const { resolveSermonStudy } = loadSermonStudies({ prisma: db([STUDY_ROW, older]) });

	const exact = await resolveSermonStudy("user_1", { date: "2026-09-13" });
	assert.equal(exact.matchedBy, "date");
	assert.equal(exact.study.id, "smn_1");

	const near = await resolveSermonStudy("user_1", { date: "2026-09-10" });
	assert.equal(near.matchedBy, "nearest-date");
	assert.equal(near.study.id, "smn_0", "the service before the date they guessed");

	assert.deepEqual(await resolveSermonStudy("user_1", { date: "2026-08-01" }), {
		found: false,
		reason: "no-match",
	});
});

test("wording finds a study, and common words alone do not", async () => {
	const { resolveSermonStudy } = loadSermonStudies({ prisma: db([STUDY_ROW]) });

	const byTitle = await resolveSermonStudy("user_1", { query: "Follow Me" });
	assert.equal(byTitle.matchedBy, "query");
	assert.equal(byTitle.study.id, "smn_1");

	const byWord = await resolveSermonStudy("user_1", { query: "the one about comforts" });
	assert.equal(byWord.found, true, "a word out of the big idea still finds it");

	assert.deepEqual(
		await resolveSermonStudy("user_1", { query: "the sermon message study" }),
		{ found: false, reason: "no-match" },
		"stop words alone match nothing",
	);
});

test("no arguments reads the newest study", async () => {
	const { resolveSermonStudy } = loadSermonStudies({ prisma: db([STUDY_ROW]) });
	const latest = await resolveSermonStudy("user_1");
	assert.equal(latest.matchedBy, "latest");
	assert.equal(latest.study.serviceDate, "2026-09-13", "dates reach the model as YYYY-MM-DD");
});

test("the chat tools never pay to sign a picture they cannot see", async () => {
	let signed = 0;
	const { resolveSermonStudy, listSermonStudies, getSermonStudy } = loadSermonStudies({
		prisma: db([STUDY_ROW]),
		createAttachmentPreviewUrl: async () => {
			signed += 1;
			return { previewUrl: "https://blob.example/signed" };
		},
	});

	const result = await resolveSermonStudy("user_1");
	assert.equal(signed, 0);
	assert.equal(result.study.sections[0].imageUrl, null);
	assert.equal(
		"imagePathname" in result.study.sections[0],
		false,
		"a blob pathname never leaves the server",
	);

	await listSermonStudies("user_1", { images: false });
	assert.equal(signed, 0);

	const forAScreen = await getSermonStudy("user_1", "smn_1");
	assert.equal(signed, 1, "a screen still gets its picture");
	assert.equal(forAScreen.sections[0].imageUrl, "https://blob.example/signed");
});

test("the day block only names a study recent enough to be this week's", async () => {
	const { latestSermonStudy, SERMON_RECENT_DAYS } = loadSermonStudies({ prisma: db([STUDY_ROW]) });
	assert.equal(SERMON_RECENT_DAYS, 10);

	assert.deepEqual(await latestSermonStudy("user_1", new Date("2026-09-16T12:00:00.000Z")), {
		id: "smn_1",
		title: "Follow Me",
		serviceDate: "2026-09-13",
		preacher: "Pastor Ron Hess",
		preachingText: "Luke 9:57-62",
		bigIdea: "Christ calls before He comforts.",
	});

	assert.equal(
		await latestSermonStudy("user_1", new Date("2026-10-30T12:00:00.000Z")),
		null,
		"a church that stopped ingesting does not get a stale study named every turn",
	);
});

test("dates and timestamps read the same wherever the server is", () => {
	const { formatServiceDate, formatTimestamp, watchUrl } = loadSermonStudies();
	assert.equal(formatServiceDate("2026-09-13"), "Sunday, 13 September 2026");
	assert.equal(formatServiceDate(null), null);
	assert.equal(formatServiceDate("last Sunday"), null);
	assert.equal(formatTimestamp(1_867_000), "31:07");
	assert.equal(formatTimestamp(3_784_000), "1:03:04");
	assert.equal(formatTimestamp(-5), "0:00");
	assert.equal(watchUrl("abcdefghijk"), "https://www.youtube.com/watch?v=abcdefghijk");
});
