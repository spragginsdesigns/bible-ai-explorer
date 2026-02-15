import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
	try {
		const userId = await getAuthUser();
		const conversations = await prisma.conversation.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			select: { id: true, title: true, createdAt: true, updatedAt: true },
		});
		return NextResponse.json(conversations);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const { title } = await req.json();
		const conversation = await prisma.conversation.create({
			data: { title: title || "New Conversation", userId },
		});
		return NextResponse.json(conversation, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
