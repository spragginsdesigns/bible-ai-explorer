import { NextResponse } from "next/server";

export async function POST(req: Request) {
	try {
		const { reference } = await req.json();

		if (!reference || typeof reference !== "string") {
			return NextResponse.json(
				{ error: "Invalid input: 'reference' must be a non-empty string." },
				{ status: 400 }
			);
		}

		// Use bible-api.com to fetch actual KJV verse text
		const encoded = encodeURIComponent(reference.replace(/\s*KJV$/i, ""));
		const apiRes = await fetch(
			`https://bible-api.com/${encoded}?translation=kjv`,
			{ next: { revalidate: 86400 } } // Cache for 24h
		);

		if (!apiRes.ok) {
			return NextResponse.json({
				verses: [],
				reference,
				error: "Verse not found in KJV.",
			});
		}

		const data = await apiRes.json();

		const verses = (data.verses ?? []).map((v: any) => ({
			book: v.book_name ?? "",
			chapter: v.chapter ?? 0,
			verse: v.verse ?? 0,
			text: (v.text ?? "").trim(),
		}));

		return NextResponse.json({
			reference: data.reference ?? reference,
			text: (data.text ?? "").trim(),
			verses,
			translation: data.translation_name ?? "King James Version",
		});
	} catch (error) {
		console.error("Error in get-verse API:", error);
		return NextResponse.json(
			{ error: "Failed to retrieve verse." },
			{ status: 500 }
		);
	}
}
