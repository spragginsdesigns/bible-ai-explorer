import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gettingStartedProgress } from "@/lib/onboarding";

/**
 * The Getting started card on Today ("Walk with me"): five rows, each ticked
 * only by real use. `show` is false for anyone who never had the welcome, so
 * existing members never see it. PATCH `{ dismissed: true }` hides it for good.
 */
export async function GET(): Promise<Response> {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await gettingStartedProgress(userId), {
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/onboarding/progress] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function PATCH(req: Request): Promise<Response> {
	try {
		const userId = await getAuthUser();
		const body: unknown = await req.json().catch(() => null);
		if (typeof body !== "object" || body === null || (body as Record<string, unknown>).dismissed !== true) {
			return NextResponse.json({ error: "Body must be { dismissed: true }" }, { status: 400 });
		}
		await prisma.user.update({ where: { id: userId }, data: { gettingStartedDismissedAt: new Date() } });
		return NextResponse.json(await gettingStartedProgress(userId));
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/onboarding/progress] PATCH failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
