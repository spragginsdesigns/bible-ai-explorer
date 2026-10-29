import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readLiveBody } from "@/lib/voice/live-http";
import { liveSecret, validRelaySignature } from "@/lib/voice/live-policy";
import { liveConfigured, liveLedger } from "@/lib/voice/live-runtime";
import { authorizeLiveGrant, delegateLiveTurn, liveHistory, saveLiveTranscript } from "@/lib/voice/live-backend";

export const runtime = "nodejs";
export const maxDuration = 360;
const bodySchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("authorize"), sessionId: z.string().uuid() }),
	z.object({ op: z.literal("delegate"), sessionId: z.string().uuid(), turnId: z.string().uuid(), userMessageId: z.string().uuid(), text: z.string().trim().min(1).max(20_000) }),
	z.object({ op: z.literal("transcript"), sessionId: z.string().uuid(), messageId: z.string().uuid(), role: z.enum(["user", "assistant"]), text: z.string().min(1).max(50_000), assistantMessageId: z.string().optional(), complete: z.boolean(), startMs: z.number().finite().min(0).optional(), endMs: z.number().finite().min(0).optional() }),
]);

export async function POST(req: Request) {
	if (!liveConfigured()) return new Response(null, { status: 404 });
	if (Number(req.headers.get("content-length")) > 128_000) return new Response(null, { status: 413 });
	const stamp = req.headers.get("x-live-timestamp");
	const signature = req.headers.get("x-live-signature");
	if (!stamp || !/^\d{13}$/.test(stamp) || Math.abs(Date.now() - Number(stamp)) > 30_000 || !signature || !/^[a-f0-9]{64}$/.test(signature)) return new Response(null, { status: 404 });
	const raw = await readLiveBody(req, 128_000);
	if (raw === null) return new Response(null, { status: 413 });
	if (raw.length > 128_000 || !validRelaySignature(raw, req.headers.get("x-live-timestamp"), req.headers.get("x-live-signature"), liveSecret(process.env))) return new Response(null, { status: 404 });
	try {
		const body = bodySchema.parse(JSON.parse(raw));
		const grant = liveLedger().get(body.sessionId);
		const { userId } = await auth();
		if (!grant || !userId || grant.userId !== userId) return new Response(null, { status: 404 });
		if (body.op === "transcript") {
			// A closed voice transport can still drain its own final captured transcript.
			if (Date.now() > grant.expiresAt + 30_000) return new Response(null, { status: 410 });
			await saveLiveTranscript(grant, body);
			return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
		}
		await authorizeLiveGrant(grant);
		if (body.op === "authorize") {
			const history = await liveHistory(grant);
			return NextResponse.json({ history: history.slice(-12).map(row => ({ role: row.role, text: row.content.slice(0, 4000) })) }, { headers: { "Cache-Control": "no-store" } });
		}
		return NextResponse.json(await delegateLiveTurn(grant, body), { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid voice request." }, { status: 400 });
		console.error("[live-voice] relay request failed", { operation: "private-rpc" });
		return NextResponse.json({ error: "SureWord could not complete or confirm that voice request. Check the saved chat before repeating an action." }, { status: 502 });
	}
}
