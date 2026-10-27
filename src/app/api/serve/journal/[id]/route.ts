import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { deleteServeEntry } from "@/lib/serve";

/** Remove one of the reader's own journal entries. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		const userId = await getAuthUser();
		const { id } = await params;
		if (!(await deleteServeEntry(userId, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
		return NextResponse.json({ status: "ok" });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/serve/journal/[id]] DELETE failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
