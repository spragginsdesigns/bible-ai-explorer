import { ChatOpenAI } from "@langchain/openai";

const VERSEMIND_CHAT_MODEL_CONFIG = {
	modelName: "gpt-5.6-terra",
	timeout: 60000,
	streaming: true,
	modelKwargs: {
		reasoning_effort: "high",
		max_completion_tokens: 2000,
	},
} as const;

export function createVerseMindChatModel(
	openAIApiKey: string | undefined = process.env.OPENAI_API_KEY
): ChatOpenAI {
	return new ChatOpenAI({
		openAIApiKey,
		...VERSEMIND_CHAT_MODEL_CONFIG,
	});
}
