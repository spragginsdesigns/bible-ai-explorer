import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { removeCard } from "@/lib/learn";

/**
 * Drop a card from the caller's Learn queue. The delete is userId-scoped in the
 * query itself, so an id can never reach across accounts.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;

		if (!(await removeCard(userId, id))) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/learn/:id] DELETE failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
