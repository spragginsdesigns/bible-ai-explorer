import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ipAddress, waitUntil } from "@vercel/functions";
import { checkBotId } from "botid/server";
import { createTextStreamResponse, streamText, isStepCount, type ModelMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { buildSureWordTools } from "@/lib/ai-tools";
import { resolveGuestModel } from "@/lib/ai/provider";
import { plainDashes } from "@/lib/ai/plain-dashes";
import { chatSystemPrompt } from "@/utils/systemPrompt";
import { stripFollowUpMarkers } from "@/utils/assistantMarkdown";
import {
	GUEST_COOKIE,
	GUEST_RETENTION_DAYS,
	GUEST_SYSTEM_GUIDANCE,
	GUEST_WINDOW_MS,
	createGuestId,
	guestDailyCap,
	guestIpHash,
	guestQuotaDecision,
	isGuestId,
	normalizeGuestQuestion,
} from "@/lib/guest-rules";

/**
 * Try before you sign up (docs/FEATURES.md).
 *
 * A signed-out visitor asks from the landing page and gets a real SureWord
 * answer: the chat persona and system prompt, the house model, and the
 * read-only Scripture tools. Nothing that reads or writes an account exists
 * here: no memory, notes, highlights, reading history, church or web search.
 *
 * Order of work, and why:
 *  1. The kill switch and BotID, before any database write.
 *  2. RESERVE a GuestTurn row, then count. Writing first is what makes the
 *     ceilings hold under concurrency and across serverless instances, which
 *     the in-memory limiter in src/lib/rateLimit.ts cannot promise.
 *  3. History comes from this guest's stored turns, never from the request
 *     body, so a caller cannot put words in the assistant's mouth.
 *  4. The finished answer is written to the reserved row; a failed answer
 *     deletes it, so an outage never spends somebody's three answers.
 */

export const maxDuration = 120;

// Four reads cover every question a first answer needs; each is instant or a
// vector lookup, and none can touch a user row.
const GUEST_TOOL_NAMES = ["searchScripture", "findVerses", "getPassage", "getCrossReferences"] as const;
const GUEST_STEP_LIMIT = 5;
const GUEST_MAX_OUTPUT_TOKENS = 4000;

function utcDayStart(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function hashSecret(): string | null {
	return process.env.GUEST_HASH_SECRET || process.env.CLERK_SECRET_KEY || null;
}

function limitResponse(reason: string) {
	return NextResponse.json(
		{
			error:
				reason === "global"
					? "SureWord has answered all the guest questions it can today. Create a free account to keep going."
					: "You've used your free guest answers. Create a free account to keep asking and save this study.",
			code: "guest_limit",
			reason,
		},
		{ status: 429 },
	);
}

export async function POST(req: Request) {
	const cap = guestDailyCap(process.env.GUEST_DAILY_CAP);
	if (cap === 0) return limitResponse("global");

	const verification = await checkBotId();
	if (verification.isBot) {
		// A real visitor lands here when a blocker strips BotID's script, so the
		// message offers the way in that needs no challenge.
		return NextResponse.json(
			{
				error: "We couldn't verify this browser for a guest answer. Create a free account to ask SureWord anything.",
				code: "bot",
			},
			{ status: 403 },
		);
	}

	const secret = hashSecret();
	if (!secret) {
		console.error("Guest answers need GUEST_HASH_SECRET or CLERK_SECRET_KEY.");
		return NextResponse.json({ error: "Guest answers are unavailable." }, { status: 503 });
	}

	const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
	const question = normalizeGuestQuestion(body?.question);
	if (!question) {
		return NextResponse.json({ error: "Ask a question of up to 1,000 characters." }, { status: 400 });
	}

	const jar = await cookies();
	const existingId = jar.get(GUEST_COOKIE)?.value;
	const guestId = isGuestId(existingId) ? existingId : createGuestId();
	const ip = ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
	const ipHash = guestIpHash(ip, secret);

	const now = new Date();
	const windowStart = new Date(now.getTime() - GUEST_WINDOW_MS);
	const reservation = await prisma.guestTurn.create({
		data: { guestId, ipHash, question },
		select: { id: true },
	});
	const [guestCount, addressCount, globalCount] = await Promise.all([
		prisma.guestTurn.count({ where: { guestId, createdAt: { gte: windowStart } } }),
		prisma.guestTurn.count({ where: { ipHash, createdAt: { gte: windowStart } } }),
		prisma.guestTurn.count({ where: { createdAt: { gte: utcDayStart(now) } } }),
	]);
	const quota = guestQuotaDecision({ guest: guestCount, address: addressCount, global: globalCount, cap });
	if (!quota.allowed) {
		await prisma.guestTurn.delete({ where: { id: reservation.id } }).catch(() => undefined);
		return limitResponse(quota.reason ?? "guest");
	}

	// Earlier answered turns in this window, oldest first, as the conversation.
	const earlier = await prisma.guestTurn.findMany({
		where: {
			guestId,
			answer: { not: null },
			claimedAt: null,
			createdAt: { gte: windowStart },
			NOT: { id: reservation.id },
		},
		orderBy: { createdAt: "asc" },
		select: { question: true, answer: true },
	});
	const messages: ModelMessage[] = [
		...earlier.flatMap((turn): ModelMessage[] => [
			{ role: "user", content: turn.question },
			{ role: "assistant", content: turn.answer ?? "" },
		]),
		{ role: "user", content: question },
	];

	const releaseReservation = () =>
		prisma.guestTurn.delete({ where: { id: reservation.id } }).catch(() => undefined);

	let resolved: ReturnType<typeof resolveGuestModel>;
	try {
		resolved = resolveGuestModel();
	} catch (error) {
		await releaseReservation();
		console.error("Guest model unavailable:", error);
		return NextResponse.json({ error: "Guest answers are unavailable right now." }, { status: 503 });
	}

	const allTools = buildSureWordTools({ userId: "guest", translation: "KJV", webSearchEnabled: false });
	const tools = Object.fromEntries(GUEST_TOOL_NAMES.map((name) => [name, allTools[name]]));

	const result = streamText({
		model: resolved.model,
		system: `${chatSystemPrompt("KJV")}\n\n${GUEST_SYSTEM_GUIDANCE}`,
		messages,
		tools,
		stopWhen: isStepCount(GUEST_STEP_LIMIT),
		// Per step, reasoning included. The prompt asks for under 400 words;
		// this is what holds when a guest asks for a book instead.
		maxOutputTokens: GUEST_MAX_OUTPUT_TOKENS,
		experimental_transform: plainDashes(),
		providerOptions: resolved.providerOptions,
		onError: ({ error }) => console.error("Guest answer failed:", error),
	});

	// Settle the reserved row whether or not the browser stays to read it: a
	// visitor who closes the tab mid-answer has still spent the turn, and the
	// answer is what they would claim on sign-up.
	waitUntil(
		Promise.resolve(result.text)
			.then(async (text) => {
				const answer = stripFollowUpMarkers(text, { streaming: false }).trim();
				if (!answer) {
					await releaseReservation();
					return;
				}
				await prisma.guestTurn.update({ where: { id: reservation.id }, data: { answer } });
			})
			.catch(async (error) => {
				console.error("Guest answer did not complete:", error);
				await releaseReservation();
			}),
	);

	const response = createTextStreamResponse({
		stream: result.textStream,
		headers: {
			"Cache-Control": "no-store",
			"X-Guest-Remaining": String(quota.remaining),
		},
	});
	const cookie = [
		`${GUEST_COOKIE}=${guestId}`,
		"Path=/",
		`Max-Age=${GUEST_RETENTION_DAYS * 24 * 60 * 60}`,
		"HttpOnly",
		"SameSite=Lax",
		...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
	].join("; ");
	response.headers.append("Set-Cookie", cookie);
	return response;
}
