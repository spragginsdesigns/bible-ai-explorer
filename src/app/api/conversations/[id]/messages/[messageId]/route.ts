import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ id: string; messageId: string }> }
) {
	try {
		const userId = await getAuthUser();
		const { id, messageId } = await params;
		// Verify ownership via conversation
		const conversation = await prisma.conversation.findFirst({
			where: { id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		const message = await prisma.message.update({
			where: { id: messageId, conversationId: id },
			data: {
				...(body.content !== undefined && { content: body.content }),
				...(body.metadata !== undefined && { metadata: body.metadata }),
			},
		});

		return NextResponse.json(message);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
