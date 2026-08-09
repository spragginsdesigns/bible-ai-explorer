import { NextResponse } from "next/server";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

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

		const data: unknown = await apiRes.json();
		if (!isRecord(data)) {
			throw new Error("Bible API returned an invalid response.");
		}

		const verses = (Array.isArray(data.verses) ? data.verses : []).flatMap((verse) => {
			if (!isRecord(verse)) return [];

			return [{
				book: typeof verse.book_name === "string" ? verse.book_name : "",
				chapter: typeof verse.chapter === "number" ? verse.chapter : 0,
				verse: typeof verse.verse === "number" ? verse.verse : 0,
				text: typeof verse.text === "string" ? verse.text.trim() : "",
			}];
		});

		return NextResponse.json({
			reference: typeof data.reference === "string" ? data.reference : reference,
			text: typeof data.text === "string" ? data.text.trim() : "",
			verses,
			translation:
				typeof data.translation_name === "string"
					? data.translation_name
					: "King James Version",
		});
	} catch (error) {
		console.error("Error in get-verse API:", error);
		return NextResponse.json(
			{ error: "Failed to retrieve verse." },
			{ status: 500 }
		);
	}
}
