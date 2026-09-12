import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { todayCards } from "@/lib/learn";

/**
 * Today's Learn a verse session: at most three cards, due first and then the
 * newest verse the user added, plus how many are waiting and how many verses
 * they know.
 */
export async function GET() {
	try {
		const userId = await getAuthUser();
		return NextResponse.json(await todayCards(userId));
	} catch (error) {
		if (error instanceof Response) return error;
		console.error("[api/learn/today] GET failed", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
