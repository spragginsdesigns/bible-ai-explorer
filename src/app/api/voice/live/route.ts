import { readLiveBody } from "@/lib/voice/live-http";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getUserPlan } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { hasCurrentAiConsent } from "@/lib/preferences-contract";
import { canUseLiveVoice } from "@/lib/voice/live-access";
import { liveLimits, liveRelayUrl, liveSecret, signLiveTicket } from "@/lib/voice/live-policy";
import { liveConfigured, liveLedger } from "@/lib/voice/live-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
	const { userId } = await auth();
	if (!userId) return NextResponse.json({ error: "Sign in to use voice." }, { status: 401, headers: noStore });
	if (!await canUseLiveVoice(userId)) return NextResponse.json({ error: "Live voice is not enabled for this account.", code: "live_account_required" }, { status: 403, headers: noStore });
	const pro = await getUserPlan(userId) === "pro";
	const available = liveConfigured();
	const limits = liveLimits(process.env);
	return NextResponse.json({ available, pro, limits,
		...(available && pro ? { remainingSeconds: liveLedger().remaining(userId, limits), relayUrl: liveRelayUrl(process.env) } : {}),
		message: !pro ? "Live voice requires SureWord Pro, with usage limits." : !available ? "Live voice is not available on this server." : undefined,
	}, { headers: noStore });
}

export async function POST(req: Request) {
	try {
		if (!liveConfigured()) return NextResponse.json({ error: "Live voice is unavailable." }, { status: 503, headers: noStore });
		// Keep credentials and paid startup protected against cross-site requests.
		if (req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "Unexpected request origin." }, { status: 403, headers: noStore });
		const { userId, sessionId } = await auth();
		if (!userId || !sessionId) return NextResponse.json({ error: "Sign in to use voice." }, { status: 401, headers: noStore });
		if (!await canUseLiveVoice(userId)) return NextResponse.json({ error: "Live voice is not enabled for this account.", code: "live_account_required" }, { status: 403, headers: noStore });
		if (await getUserPlan(userId) !== "pro") return NextResponse.json({ error: "Live voice requires SureWord Pro.", code: "pro_required" }, { status: 403, headers: noStore });
		const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiConsentVersion: true, aiConsentAt: true } });
		if (!hasCurrentAiConsent(user)) return NextResponse.json({ error: "Allow AI data sharing before starting voice.", code: "ai_consent_required" }, { status: 403, headers: noStore });
		if (Number(req.headers.get("content-length")) > 4096) return NextResponse.json({ error: "Request too large." }, { status: 413 });
		const raw = await readLiveBody(req, 4096);
		if (raw === null) return NextResponse.json({ error: "Request too large." }, { status: 413 });
		const body = JSON.parse(raw) as { conversationId?: unknown };
		if (!body || typeof body !== "object" || (body.conversationId !== undefined && (typeof body.conversationId !== "string" || body.conversationId.length > 128))) return NextResponse.json({ error: "Invalid conversation." }, { status: 400 });
		let conversationId = body.conversationId as string | undefined;
		if (conversationId && !await prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
		// Quota reservation precedes creating a chat, so denied starts leave no empty threads.
		const grant = liveLedger().reserve({ userId, clerkSessionId: sessionId, conversationId: conversationId || "", limits: liveLimits(process.env) });
		try {
			if (!conversationId) {
				const conversation = await prisma.conversation.create({ data: { userId, title: "Voice conversation" } });
				conversationId = conversation.id;
				liveLedger().setConversation(grant.id, conversationId);
			}
		} catch (error) {
			liveLedger().settle(grant.id, 0, true);
			throw error;
		}
		return NextResponse.json({ ticket: signLiveTicket({ sessionId: grant.id, userId, expiresAt: Math.min(grant.expiresAt, Date.now() + 30_000) }, liveSecret(process.env)), relayUrl: liveRelayUrl(process.env) }, { status: 201, headers: noStore });
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "live_session_active" || code === "live_limit_reached") return NextResponse.json({ error: code === "live_session_active" ? "End your other voice conversation first." : "You have reached your voice allowance. You can still type in chat.", code }, { status: 429, headers: noStore });
		if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
		console.error("[live-voice] startup failed", { code: code || "internal" });
		return NextResponse.json({ error: "Voice could not start. Please try again." }, { status: 500, headers: noStore });
	}
}
