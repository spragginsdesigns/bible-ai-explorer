/** The context reader may select only these public spiritual themes, never free-text facts. */
export const WALK_THEMES = [
	"trust", "prayer", "patience", "grace", "obedience", "forgiveness", "humility", "hope",
	"love", "peace", "wisdom", "perseverance", "gratitude", "faithfulness", "Scripture", "service", "self-denial",
] as const;
export const WALK_POSTURES = ["studying", "seeking", "practicing", "giving-thanks"] as const;

/** A structural backstop; a separate model review also checks meaning and disclosure. */
export function reflectionSafetyProblem(text: string): string | null {
	if (!text.trim() || text.length > 200) return "Keep your reflection within 200 characters.";
	if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(text)) return "Use plain, visible text.";
	if (/\d|https?:|www\.|@|\b(?:sureword|AI|chatbot)\b/i.test(text)) return "The suggestion contains details that do not belong in a public reflection.";
	if (!/\b(?:I|I'm|I've|my|me)\b/.test(text)) return "The suggestion did not connect the verse to your walk.";
	return null;
}

export interface ReflectionReview {
	privacySafe: boolean;
	grounded: boolean;
	verseFaithful: boolean;
	noEmbarrassingDisclosure: boolean;
	noInventedTestimony: boolean;
}

/** Missing or malformed review results never become an approval. */
export function reflectionReviewPassed(value: unknown): value is ReflectionReview {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return ["privacySafe", "grounded", "verseFaithful", "noEmbarrassingDisclosure", "noInventedTestimony"]
		.every(key => row[key] === true);
}
