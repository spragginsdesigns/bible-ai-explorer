import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
	try {
		const userId = await getAuthUser();
		const tags = await prisma.tag.findMany({
			where: { userId },
			orderBy: { createdAt: "asc" },
		});
		return NextResponse.json(tags);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const { name, color } = await req.json();
		const tag = await prisma.tag.create({
			data: {
				name: name || "New Tag",
				color: color || "#6b7280",
				userId,
			},
		});
		return NextResponse.json(tag, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
