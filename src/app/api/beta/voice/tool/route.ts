import { NextResponse } from "next/server";
import { BETA_PRIVATE_HEADERS, requireBetaApi } from "@/lib/beta/access";
import { READ_SCRIPTURE_TOOL, isVoiceScriptureTool } from "@/lib/beta/voice/voice-rules";
import { planVoiceReading, runVoiceScriptureTool } from "@/lib/beta/voice/tools";

/**
 * POST /api/beta/voice/tool { name, arguments }: one tool call the realtime
 * model made, relayed by the browser (docs/beta/voice.md). The Scripture
 * tools answer `{ output }`, the text handed back to the model; readScripture
 * answers `{ reading }`, the verses the browser shows while the narrated KJV
 * plays them.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 8 * 1024;

function parseArguments(raw: unknown): unknown {
	if (typeof raw !== "string") return raw ?? {};
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const text = await req.text();
	let body: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = text.length <= MAX_BODY ? JSON.parse(text) : null;
		body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		body = null;
	}
	const args = body ? parseArguments(body.arguments) : null;
	if (!body || args === null || typeof args !== "object") {
		return NextResponse.json({ error: "Send { name, arguments }." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	if (body.name === READ_SCRIPTURE_TOOL) {
		const reading = await planVoiceReading((args as Record<string, unknown>).reference);
		return NextResponse.json({ reading }, { headers: BETA_PRIVATE_HEADERS });
	}
	if (!isVoiceScriptureTool(body.name)) {
		return NextResponse.json({ error: "Unknown tool." }, { status: 400, headers: BETA_PRIVATE_HEADERS });
	}
	const output = await runVoiceScriptureTool(gate.userId, body.name, args, req.signal);
	return NextResponse.json({ output }, { headers: BETA_PRIVATE_HEADERS });
}
