import { NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isProviderId } from "@/lib/ai/models";
import { DB_PROVIDER } from "@/lib/ai/provider";

export const maxDuration = 30;

/**
 * Personal API keys were removed on 2026-10-25 (Austin: "no more BYOK, its
 * either free or pay for pro"). Every account runs on SureWord's included AI,
 * so nothing reads a stored key any more.
 *
 * GET answers an empty list so an installed older client renders no key rows
 * instead of an error, POST refuses new keys, and DELETE keeps working so
 * anyone can still erase a key they stored before the change.
 */
const GONE = "Personal API keys are no longer supported. Every account is Free or Pro.";

export async function GET(): Promise<Response> {
	try {
		await getAuthUserId();
		return NextResponse.json({ serverCredentials: false, providers: [] });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/providers] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(): Promise<Response> {
	return NextResponse.json({ error: GONE }, { status: 410 });
}

export async function DELETE(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUserId();
		const body: unknown = await req.json().catch(() => null);
		const provider =
			typeof body === "object" && body !== null
				? (body as Record<string, unknown>).provider
				: undefined;
		await prisma.providerCredential.deleteMany({
			where: isProviderId(provider) ? { userId, provider: DB_PROVIDER[provider] } : { userId },
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/providers] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
