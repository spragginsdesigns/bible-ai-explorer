import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
	try {
		const userId = await getAuthUser();
		const folders = await prisma.folder.findMany({
			where: { userId },
			orderBy: { sortOrder: "asc" },
		});
		return NextResponse.json(folders);
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}

export async function POST(req: Request) {
	try {
		const userId = await getAuthUser();
		const { name } = await req.json();
		const count = await prisma.folder.count({ where: { userId } });
		const folder = await prisma.folder.create({
			data: {
				name: name || "New Folder",
				userId,
				sortOrder: count,
			},
		});
		return NextResponse.json(folder, { status: 201 });
	} catch (err) {
		if (err instanceof Response) return err;
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
