import { NextResponse } from "next/server";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/auth";
import { MAX_MEMORIES_PER_USER } from "@/lib/memory";

export const maxDuration = 60;

const summarySchema = z.object({
	overview: z
		.string()
		.describe("One short paragraph, second person ('You are…'), capturing who the user is overall."),
	sections: z
		.array(
			z.object({
				title: z.string().describe("Short section heading, e.g. 'Faith' or 'Family'."),
				content: z
					.string()
					.describe("One short second-person paragraph grouping the related facts."),
			})
		)
		.max(5)
		.describe("Topical groupings of the memories. Empty when the overview says it all."),
});

const SUMMARY_INSTRUCTIONS = `You write the "memory summary" for SureWord, a KJV Bible study assistant: a warm, honest overview of what the app has learned about one user from their saved memories. Write in second person, the way a pastor who knows his congregation might describe them. Group related facts into a few short headed sections rather than listing every memory; merge duplicates; never invent facts that are not in the memories; never recite the memories verbatim as a bulleted list.`;

/**
 * ChatGPT-style memory summary, generated on demand (nothing is persisted;
 * "regenerate" is simply another POST). Works while memory is disabled so the
 * manage screen can still show what is stored.
 */
export async function POST() {
	try {
		const userId = await getAuthUserId();
		const memories = await prisma.userMemory.findMany({
			where: { userId },
			orderBy: { updatedAt: "desc" },
			take: MAX_MEMORIES_PER_USER,
			select: { content: true, category: true },
		});

		if (memories.length === 0) {
			return NextResponse.json({ summary: null, generatedAt: null });
		}

		const { output } = await generateText({
			model: openai("gpt-5.6-terra"),
			providerOptions: { openai: { reasoningEffort: "low" } },
			output: Output.object({ schema: summarySchema }),
			instructions: SUMMARY_INSTRUCTIONS,
			prompt: `Saved memories:\n${memories.map((m) => `(${m.category}) ${m.content}`).join("\n")}`,
		});

		if (!output) {
			return NextResponse.json({ error: "Could not generate a summary" }, { status: 500 });
		}
		return NextResponse.json({ summary: output, generatedAt: new Date().toISOString() });
	} catch (err) {
		if (err instanceof Response) return err;
		console.error("[api/memories/summary] POST failed", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
