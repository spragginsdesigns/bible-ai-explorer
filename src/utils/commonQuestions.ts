/**
 * Suggested prompts for the empty chat state - the static six shown to a
 * brand-new account and whenever generation fails. Mirrored in
 * `mobile/src/features/chat/commonQuestions.ts`.
 *
 * Each carries the same gold label a generated question does. These are all
 * Scripture references on purpose: a fresh account has no memories, notes or
 * reading to honestly label a question with.
 */

export interface CommonQuestion {
	question: string;
	label: string;
}

export const commonQuestionSuggestions: readonly CommonQuestion[] = [
	{ question: "What is the story of creation?", label: "Genesis 1" },
	{ question: "What is the purpose of life according to the Bible?", label: "Ecclesiastes 12:13" },
	{ question: "Where was Jesus born?", label: "Luke 2:7" },
	{ question: "What does the Bible say about forgiveness?", label: "Ephesians 4:32" },
	{ question: "What does it mean to be born again?", label: "John 3:3" },
	{ question: "How should I pray according to Scripture?", label: "Matthew 6:9" },
];

export const commonQuestions: string[] = commonQuestionSuggestions.map((item) => item.question);
