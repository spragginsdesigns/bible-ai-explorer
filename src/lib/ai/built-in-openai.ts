import "server-only";

import { createOpenAI } from "@ai-sdk/openai";

/**
 * Product-owned OpenAI model used by scheduled/background Pro experiences.
 * This deliberately does not read a user's BYOK credential: a Daily Cross
 * must still be prepared when a personal key is absent, revoked or rotated.
 */
export const DAILY_CROSS_MODEL_ID = "gpt-5.6-sol";
export const DAILY_CROSS_MODEL_NAME = `openai/${DAILY_CROSS_MODEL_ID}`;

export type DailyCrossReasoningEffort = "high" | "xhigh";

export function builtInDailyCrossModel() {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is required for Pick Up Your Cross generation.");
	}

	return createOpenAI({ apiKey })(DAILY_CROSS_MODEL_ID);
}
