#!/usr/bin/env node
/**
 * Turn thumbs-down answers into candidate eval fixtures. Run by hand, never in
 * CI. The contract is docs/FEATURES.md, "Answer feedback, and how it reaches
 * the doctrinal eval harness".
 *
 *   node scripts/feedback-to-fixtures.mjs --since 2026-09-01
 *   node scripts/feedback-to-fixtures.mjs --since 2026-09-01 --until 2026-09-15
 *
 * It PRINTS candidates to stdout in the scripts/fixtures/answer-evals.json
 * shape and never writes that file. Each one carries an empty `expectation`
 * on purpose: a thumb is a human judgment, not a score, so a person reads the
 * answer against DOCTRINE_REVIEW_DIMENSIONS (src/lib/ai/answer-eval.ts) and
 * decides what the expectation actually is before pasting anything in.
 *
 * Diagnostics go to stderr, so `> candidates.json` yields clean JSON.
 *
 * Database: read-only, but pin the URL explicitly. A DATABASE_URL inherited
 * from the shell beats every .env file and has already aimed Prisma at an
 * unrelated database (see CLAUDE.md), so this script ignores it and reads
 * .env.local unless FEEDBACK_DATABASE_URL is set. It prints
 * current_database() before it reads anything.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function readArg(name) {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		console.error(`--${name} needs a value, for example --${name} 2026-09-01`);
		process.exit(1);
	}
	return value;
}

/** A bare YYYY-MM-DD is read as UTC midnight; anything else must be a full ISO stamp. */
function parseDate(value, label) {
	const stamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
	const date = new Date(stamp);
	if (Number.isNaN(date.getTime())) {
		console.error(`--${label} is not a date: ${value}`);
		process.exit(1);
	}
	return date;
}

const sinceArg = readArg("since");
if (!sinceArg) {
	console.error("Usage: node scripts/feedback-to-fixtures.mjs --since YYYY-MM-DD [--until YYYY-MM-DD]");
	process.exit(1);
}
const since = parseDate(sinceArg, "since");
const untilArg = readArg("until");
const until = untilArg ? parseDate(untilArg, "until") : undefined;
if (until && until <= since) {
	console.error("--until must be after --since");
	process.exit(1);
}

function envFromDotLocal() {
	const file = path.join(root, ".env.local");
	if (!fs.existsSync(file)) return {};
	const env = {};
	for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
		if (match) env[match[1]] = match[2].trim();
	}
	return env;
}

const dotLocal = envFromDotLocal();
const databaseUrl =
	process.env.FEEDBACK_DATABASE_URL || dotLocal.DATABASE_URL_UNPOOLED || dotLocal.DATABASE_URL;
if (!databaseUrl) {
	console.error(
		"No database URL. Set FEEDBACK_DATABASE_URL, or put DATABASE_URL_UNPOOLED in .env.local.\n" +
			"An inherited DATABASE_URL is deliberately ignored: it has pointed at the wrong database before."
	);
	process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
	const [identity] = await prisma.$queryRawUnsafe(
		'SELECT current_database() AS db, current_user AS "user", (SELECT count(*)::int FROM "Message") AS messages'
	);
	console.error(
		`Reading ${identity.db} as ${identity.user} (${identity.messages} messages). Read-only; nothing is written.`
	);

	const rated = await prisma.message.findMany({
		where: {
			role: "assistant",
			feedback: "down",
			feedbackAt: until ? { gte: since, lt: until } : { gte: since },
		},
		select: {
			id: true,
			conversationId: true,
			feedbackReason: true,
			feedbackAt: true,
			metadata: true,
		},
		orderBy: { feedbackAt: "asc" },
	});

	// The prompt is the user message immediately before the answer. Walking an
	// ordered conversation is exact where a timestamp comparison is not: two
	// rows written in the same millisecond would otherwise pick the wrong one.
	const conversationIds = [...new Set(rated.map((row) => row.conversationId))];
	const turns = conversationIds.length
		? await prisma.message.findMany({
				where: { conversationId: { in: conversationIds } },
				select: { id: true, conversationId: true, role: true, content: true, createdAt: true },
				orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }],
			})
		: [];
	const byConversation = new Map();
	for (const turn of turns) {
		const list = byConversation.get(turn.conversationId) ?? [];
		list.push(turn);
		byConversation.set(turn.conversationId, list);
	}

	/** The translation the answer was written in, if the row remembers it. */
	function translationOf(row) {
		const metadata = row.metadata;
		if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
			const value = metadata.translation;
			if (value === "KJV" || value === "NKJV" || value === "BSB") return value;
		}
		return "KJV";
	}

	const candidates = [];
	const skipped = [];
	for (const row of rated) {
		const thread = byConversation.get(row.conversationId) ?? [];
		const index = thread.findIndex((turn) => turn.id === row.id);
		let prompt;
		for (let i = index - 1; i >= 0; i -= 1) {
			if (thread[i].role === "user") {
				prompt = thread[i].content;
				break;
			}
		}
		if (!prompt || !prompt.trim()) {
			skipped.push(row.id);
			continue;
		}
		candidates.push({
			id: `feedback-${row.id}`,
			category: "feedback",
			prompt: prompt.trim(),
			translation: translationOf(row),
			expectation: {},
			sideEffects: "read",
			note: row.feedbackReason ?? null,
		});
	}

	for (const id of skipped) {
		console.error(`Skipped ${id}: no user message before the answer.`);
	}
	if (rated.length === 0) console.error("No thumbs-down answers in that window.");
	console.error(
		`${candidates.length} candidate(s). Fill in each "expectation" by hand, then paste into ` +
			"scripts/fixtures/answer-evals.json. This script never writes that file."
	);
	console.log(JSON.stringify(candidates, null, 2));
} finally {
	await prisma.$disconnect();
}
