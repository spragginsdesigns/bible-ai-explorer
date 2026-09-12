import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { correctReading, removeReading, ReadingLogError } from "@/lib/reading-log";
import { readingLogFailure } from "@/lib/reading-log-http";

export async function PATCH(request: Request, context: { params: Promise<{ eventId: string }> }) {
	try {
		const userId = await getAuthUser();
		const { eventId } = await context.params;
		const patch = await request.json().catch(() => null);
		if (!patch || typeof patch !== "object" || Array.isArray(patch))
			throw new ReadingLogError("Supply a reading correction.");
		return NextResponse.json(await correctReading(userId, eventId, patch));
	} catch (error) {
		return readingLogFailure(error);
	}
}
export async function DELETE(request: Request, context: { params: Promise<{ eventId: string }> }) {
	try {
		const userId = await getAuthUser();
		const { eventId } = await context.params;
		const revisionInput = new URL(request.url).searchParams.get("revision");
		const revision = revisionInput === null ? undefined : Number(revisionInput);
		if (revision !== undefined && (!Number.isInteger(revision) || revision < 1))
			throw new ReadingLogError("Invalid entry revision.");
		return NextResponse.json(await removeReading(userId, eventId, revision));
	} catch (error) {
		return readingLogFailure(error);
	}
}
