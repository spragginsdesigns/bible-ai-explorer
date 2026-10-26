/**
 * "Walk with me", the guided first run (docs/onboarding/PLAN.md): the pure
 * vocabulary every part of it agrees on. The server decides the order and
 * owns the scripted copy; each client only knows how to draw a card and how
 * to light up its own screens.
 *
 * Import-free on purpose, like `preferences-contract.ts`, so the logic suite
 * can load it under `node --test` and the client mirrors can be checked
 * against it (`tests/onboarding-rules.test.mjs`). The web client imports it
 * directly; it is mirrored by hand in
 * `mobile/src/features/onboarding/onboardingRules.ts` and
 * `macos/Shared/Onboarding/OnboardingRules.swift`.
 *
 * Every string here is spoken as well as read (voice mode), and the spoken
 * copy is generated once and shared by every account, which is why the
 * questions are fixed text rather than whatever the model writes that day.
 */

/** The cards SureWord can put under a message, one per step of the first run. */
export const ONBOARDING_STEPS = [
	"textScale",
	"name",
	"faith",
	"church",
	"prayer",
	"dailyTime",
	"tour",
	"aboutMe",
	"other",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: unknown): value is OnboardingStep {
	return typeof value === "string" && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/** SureWord's first message, seeded by POST /api/onboarding/start. */
export const WELCOME_TEXT =
	"Welcome to SureWord. I'm here to walk with you in God's Word, wherever you are with Him. This takes about five minutes, and you can skip anything. If you would rather listen, turn on Read it to me at the top, and I will read each message to you.";

/** The conversation's title in history. */
export const WELCOME_TITLE = "Welcome to SureWord";

export interface StepCard {
	question: string;
	/** Fixed answers. `null` means the model supplies them (the name step). */
	options: readonly string[] | null;
	/** "Type my own" and the microphone. */
	allowOther: boolean;
	/** The quiet way past the card. Always present: nothing is required. */
	skipLabel: string;
}

/** The faith step's six answers, from the original "Getting to know you" list. */
export const FAITH_OPTIONS = [
	"A pastor, elder or preacher",
	"Serving in ministry",
	"A Bible teacher or group leader",
	"Saved and growing in the Word",
	"Newly saved",
	"Still seeking, or not sure where I stand with God",
] as const;

/** The daily word's hour chips; "Pick a time" opens the client's hour picker. */
export const DAILY_TIME_OPTIONS = ["6 am", "7 am", "8 am", "Noon", "7 pm", "Pick a time"] as const;

/** The local hour each fixed chip means. */
export const DAILY_TIME_HOURS: Readonly<Record<string, number>> = {
	"6 am": 6,
	"7 am": 7,
	"8 am": 8,
	Noon: 12,
	"7 pm": 19,
};

export const TEXT_SCALE_OPTIONS = ["Standard", "Large", "Largest"] as const;

/** The stored `User.textScale` each text size chip means. */
export const TEXT_SCALE_VALUES: Readonly<Record<(typeof TEXT_SCALE_OPTIONS)[number], "standard" | "large" | "largest">> = {
	Standard: "standard",
	Large: "large",
	Largest: "largest",
};

/**
 * How much bigger each text size draws everything, on every client. Applied
 * on top of the system font scale, never instead of it (Apple maps these to
 * Dynamic Type steps).
 */
export const TEXT_SCALE_FACTORS: Readonly<Record<"standard" | "large" | "largest", number>> = {
	standard: 1,
	large: 1.15,
	largest: 1.3,
};

/** The scripted card for each step. `other` has no script: the model writes it. */
export const STEP_CARDS: Readonly<Record<Exclude<OnboardingStep, "other">, StepCard>> = {
	textScale: {
		question: "First, is this easy to read? Pick the size that feels best.",
		options: TEXT_SCALE_OPTIONS,
		allowOther: false,
		skipLabel: "Skip for now",
	},
	name: {
		question: "What should I call you?",
		options: null,
		allowOther: true,
		skipLabel: "Skip for now",
	},
	faith: {
		question: "Which of these sounds most like you?",
		options: FAITH_OPTIONS,
		allowOther: true,
		skipLabel: "Skip for now",
	},
	church: {
		question: "Do you have a home church? Search for it here, and I will remember it.",
		options: [],
		allowOther: false,
		skipLabel: "Not right now",
	},
	prayer: {
		question: "Is there anything you would like me to pray about with you, or anything you are walking through right now?",
		options: ["Pray for my family", "Pray for my health", "Help me grow closer to God"],
		allowOther: true,
		skipLabel: "Not today",
	},
	dailyTime: {
		question: "Every morning I can send you a verse and a short devotional made for where you are. What time works for you?",
		options: DAILY_TIME_OPTIONS,
		allowOther: false,
		skipLabel: "Not now",
	},
	tour: {
		question: "Would you like me to show you around? It takes about a minute.",
		options: ["Show me around"],
		allowOther: false,
		skipLabel: "Later",
	},
	aboutMe: {
		question: "Would you like me to save a short About me from what you have told me, so I always remember?",
		options: ["Yes, save it"],
		allowOther: false,
		skipLabel: "Not now",
	},
};

/** What a presentChoices card resolves to, after the server fills in the script. */
export interface ChoiceCardOutput {
	step: OnboardingStep;
	question: string;
	options: string[];
	allowOther: boolean;
	skipLabel: string;
}

const MAX_OPTION_LENGTH = 80;

/**
 * The card the client draws. For a scripted step the question and fixed
 * options always come from the script, whatever the model sent, so the
 * spoken copy matches the shared audio and a faith answer is always one of
 * the six. The name step keeps the model's prefilled option ("Call me Kim");
 * `other` keeps everything the model wrote, within bounds.
 */
export function resolveChoiceCard(input: {
	step: OnboardingStep;
	question?: string | null;
	options?: readonly string[] | null;
	allowOther?: boolean | null;
}): ChoiceCardOutput {
	const cleanOptions = (input.options ?? [])
		.map((option) => option.trim().slice(0, MAX_OPTION_LENGTH))
		.filter((option, index, all) => option && all.indexOf(option) === index)
		.slice(0, 6);
	if (input.step === "other") {
		return {
			step: "other",
			question: (input.question ?? "").trim().slice(0, 300),
			options: cleanOptions,
			allowOther: input.allowOther !== false,
			skipLabel: "Skip for now",
		};
	}
	const card = STEP_CARDS[input.step];
	return {
		step: input.step,
		question: card.question,
		options: card.options ? [...card.options] : cleanOptions.slice(0, 2),
		allowOther: card.allowOther,
		skipLabel: card.skipLabel,
	};
}

/** The scripted steps, in the order the welcome walks them. */
export const WELCOME_STEP_ORDER: readonly Exclude<OnboardingStep, "other">[] = [
	"textScale",
	"name",
	"faith",
	"church",
	"prayer",
	"dailyTime",
	"tour",
	"aboutMe",
];

/**
 * The card the welcome should show after they reply to `lastStep`'s card.
 * A question from them gets the same card again once it is answered, since
 * they have not answered the step yet. Null where no card is owed: after an
 * `other` card, after the last step, and after "Still seeking", where the
 * Gospel comes first and is never hurried toward the next step.
 */
export function expectedStep(lastStep: OnboardingStep | null, reply: string): Exclude<OnboardingStep, "other"> | null {
	if (!lastStep || lastStep === "other") return null;
	const text = reply.trim();
	if (lastStep === "faith" && /^still seeking/i.test(text)) return null;
	if (text.endsWith("?")) return lastStep;
	const index = WELCOME_STEP_ORDER.indexOf(lastStep);
	return index >= 0 && index < WELCOME_STEP_ORDER.length - 1 ? WELCOME_STEP_ORDER[index + 1] : null;
}

/**
 * The card a welcome turn still owes when the model ended it without one. A
 * step answered with nothing after it leaves the person with no button and
 * no question (seen on the name step, 2026-10-25), so the server adds the
 * expected card itself. Nothing is owed when the turn showed a card, finished
 * the welcome, or ended by asking them something.
 */
export function owedStep(input: {
	lastStep: OnboardingStep | null;
	reply: string;
	calledTools: readonly string[];
	answerText: string;
}): Exclude<OnboardingStep, "other"> | null {
	if (input.calledTools.includes("presentChoices") || input.calledTools.includes("finishOnboarding")) return null;
	if (/\?["'”’)]*$/.test(input.answerText.trim())) return null;
	return expectedStep(input.lastStep, input.reply);
}

/**
 * Every line whose narration is generated once and shared by every account:
 * the welcome and each scripted question. Anything else SureWord says is a
 * dynamic reply, generated only on demand and counted against the account.
 */
export const SCRIPTED_LINES: readonly string[] = [
	WELCOME_TEXT,
	...Object.values(STEP_CARDS).map((card) => card.question),
];

/**
 * The places SureWord can light up, by stable name. A client that cannot show
 * one skips it silently. The descriptions are what the model reads.
 */
export const APP_TARGETS = {
	"tab.today": "The Today tab, where each day starts: Pick Up Your Cross, the reading plan and Learn.",
	"tab.bible": "The Bible tab: the whole Bible, any chapter, offline.",
	"tab.chat": "The Chat tab, where they talk with you.",
	"tab.study": "The Study tab: notes, word studies, quizzes and sermon studies.",
	"tab.connections": "The Connections tab: how Scripture ties together across people, places and events.",
	"today.cross": "Today's Pick Up Your Cross card, the personalized daily word.",
	"today.learn": "The Learn card on Today, for memorizing verses.",
	"today.plan": "The Reading plan card on Today.",
	"reader.verse": "A verse in the Bible reader. Tapping any verse explains it.",
	"study.sermons": "Sermon studies from their church, on the Study tab.",
	"study.notes": "Their notes, on the Study tab.",
	"settings.church": "My church, in Settings.",
	"settings.textSize": "Text size, in Settings.",
	"chat.mic": "The microphone in the chat box, for speaking instead of typing.",
	tour: "The whole tour: each tab lit up in turn with one sentence, ending on tapping a verse.",
} as const;
export type AppTarget = keyof typeof APP_TARGETS;
export const APP_TARGET_KEYS = Object.keys(APP_TARGETS) as AppTarget[];

export function isAppTarget(value: unknown): value is AppTarget {
	// Own keys only: `"constructor" in APP_TARGETS` is true through the prototype.
	return typeof value === "string" && Object.prototype.hasOwnProperty.call(APP_TARGETS, value);
}

export interface TourStop {
	target: AppTarget;
	caption: string;
}

/** The tour, in order, in SureWord's voice. Every client plays these stops. */
export const TOUR_STOPS: readonly TourStop[] = [
	{ target: "tab.today", caption: "Today is where each day starts: your Pick Up Your Cross, your reading plan and the verses you are learning." },
	{ target: "tab.bible", caption: "Here is the whole Bible. Read any chapter, any time, even offline." },
	{ target: "tab.chat", caption: "Chat is where we talk. Ask me anything about Scripture, whenever you like." },
	{ target: "tab.study", caption: "Study keeps your notes, word studies and the sermon studies from your church." },
	{ target: "tab.connections", caption: "Connections shows how Scripture ties together: its people, places and events." },
	{ target: "reader.verse", caption: "Last one. Tap any verse in the Bible and I will explain it to you. Try this one." },
];

/** The Getting started card's rows, each ticked only by real use. */
export const GETTING_STARTED_ITEMS = [
	{ key: "readChapter", label: "Read a chapter", target: "tab.bible", ask: "How do I read a chapter in the Bible?" },
	{ key: "tapVerse", label: "Tap a verse", target: "reader.verse", ask: "How do I tap a verse to have it explained?" },
	{ key: "dailyWord", label: "Your daily word", target: "today.cross", ask: "What is Pick Up Your Cross?" },
	{ key: "learnVerse", label: "Learn a verse", target: "today.learn", ask: "How do I learn a verse by heart?" },
	{ key: "church", label: "Your church", target: "settings.church", ask: "How do I add my home church?" },
] as const;
export type GettingStartedKey = (typeof GETTING_STARTED_ITEMS)[number]["key"];

/** The text a "?" help button sends, by screen. */
export const HELP_SCREENS = {
	today: "Help me with the Today screen.",
	bible: "Help me with the Bible reader.",
	chat: "Help me with Chat.",
	study: "Help me with the Study tab.",
	connections: "Help me with Connections.",
} as const;
export type HelpScreen = keyof typeof HELP_SCREENS;

/** The user message "Walk me through SureWord" sends to pick the welcome back up. */
export const RESUME_MESSAGE = "Walk me through SureWord.";

/** Default ceilings, overridable by env (see `src/lib/onboarding.ts`). */
export const DEFAULT_ONBOARDING_TURN_CEILING = 60;
export const DEFAULT_ONBOARDING_VOICE_CHAR_CEILING = 12000;

/** Read a positive integer env value, falling back to the default. */
export function readCeiling(raw: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The words that get spoken for a message: markdown and follow-up markers
 * removed, links reduced to their text, whitespace folded. Shared so a
 * replayed message hashes to the same cached audio.
 */
export function spokenText(markdown: string): string {
	return markdown
		.replace(/^[ \t]*\[FOLLOWUP\][^\r\n]*$/gm, "")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
		.replace(/^[ \t]*>[ \t]?/gm, "")
		.replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, "")
		.replace(/[*_`~]/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
