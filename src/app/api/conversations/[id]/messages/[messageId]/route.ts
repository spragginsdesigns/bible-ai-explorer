import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function PATCH(
	req: Request,
	{ params }: { params: { id: string; messageId: string } }
) {
	try {
		const userId = await getAuthUser();
		// Verify ownership via conversation
		const conversation = await prisma.conversation.findFirst({
			where: { id: params.id, userId },
		});
		if (!conversation) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		const message = await prisma.message.update({
			where: { id: params.messageId, conversationId: params.id },
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
