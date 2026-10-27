import { tool } from "ai";
import { z } from "zod";
import { addServeEntry, buildServeView, listServeEntries, resolveVerseRef } from "@/lib/serve";
import { MAX_ENTRY_LENGTH, parseVerseRef } from "@/lib/serve-rules";

/**
 * The chat side of Ways to Serve (docs/FEATURES.md). Serving is offered as the
 * fruit of faith, never a condition of salvation; these tools only read the
 * reader's ways and keep their private journal. The owner comes only from
 * authenticated server context, never model input.
 */
export function buildServeTools(userId: string) {
	return {
		getWaysToServe: tool({
			description:
				"Read the user's Ways to Serve: whether it is on (off, nearby, online or both), today's one suggested way with its KJV verse, every way they are offered, whether they already give to their church, and their church's name. Call it when they ask how they can serve, help, give or put their faith into action, or what today's way to serve is. Read-only.",
			inputSchema: z.object({}),
			execute: async () => {
				const view = await buildServeView(userId);
				return {
					mode: view.settings.mode,
					givesToChurch: view.settings.givesToChurch,
					church: view.church?.name ?? null,
					today: view.today ? { title: view.today.title, detail: view.today.detail, verse: view.today.verse } : null,
					ways: view.ways.map((way) => ({ title: way.title, kind: way.kind, verse: way.verse.reference })),
					nearbySearchAvailable: view.nearby.available,
				};
			},
		}),
		saveServeEntry: tool({
			description:
				"Write one entry in the user's private Ways to Serve journal (\"What I did\"): something they did to love or help someone, in their own first-person words, with an optional KJV reference. Only when they ask you to write it down or remember it there. Never invent or embellish what they did, never praise it as earning anything, and never mention counts.",
			inputSchema: z.object({
				text: z.string().trim().min(1).max(MAX_ENTRY_LENGTH),
				verseRef: z.string().trim().max(40).nullable(),
			}),
			execute: async ({ text, verseRef }) => {
				try {
					const entry = await addServeEntry(userId, text, await resolveVerseRef(parseVerseRef(verseRef)));
					return { success: true as const, entry: { id: entry.id, verseRef: entry.verseRef } };
				} catch (error) {
					console.error("[serve] saveServeEntry failed:", error);
					return { success: false as const, error: "Saving failed. Nothing was changed." };
				}
			},
		}),
		listServeEntries: tool({
			description:
				"Read the user's private Ways to Serve journal, newest first. Use it when they ask what they wrote there, or to remind them gently of a moment God gave them to love someone. Read-only.",
			inputSchema: z.object({}),
			execute: async () => {
				const entries = await listServeEntries(userId);
				return { entries: entries.slice(0, 30).map(({ text, verseRef, createdAt }) => ({ text, verseRef, createdAt })) };
			},
		}),
	};
}
