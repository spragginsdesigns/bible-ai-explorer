/** Final human utterances only. Select from the current visible options, never model text. */
export type VoiceDestination = "today" | "bible" | "chat" | "connections" | "study" | "notes" | "settings";
export type VoiceCommand =
	| { type: "choose"; index: number; label: string }
	| { type: "navigate"; destination: VoiceDestination }
	| { type: "back" | "repeat" | "stop" | "ambiguous" | "unmatched" };

export const VOICE_PLAYBACK_RATE = 1.15;

function normalized(text: string): string {
	return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
		.replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

const NUMBERS: Readonly<Record<string, number>> = {
	zero: 0,
	one: 1, first: 1, "1st": 1, two: 2, second: 2, "2nd": 2,
	three: 3, third: 3, "3rd": 3, four: 4, fourth: 4, "4th": 4,
	five: 5, fifth: 5, "5th": 5, six: 6, sixth: 6, "6th": 6,
	seven: 7, seventh: 7, "7th": 7, eight: 8, eighth: 8, "8th": 8,
	nine: 9, ninth: 9, "9th": 9, ten: 10, tenth: 10, "10th": 10,
	eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, thirteenth: 13,
	fourteen: 14, fourteenth: 14, fifteen: 15, fifteenth: 15, sixteen: 16, sixteenth: 16,
	seventeen: 17, seventeenth: 17, eighteen: 18, eighteenth: 18, nineteen: 19, nineteenth: 19,
	twenty: 20, twentieth: 20, "twenty one": 21, "twenty first": 21,
	"twenty two": 22, "twenty second": 22, "twenty three": 23, "twenty third": 23,
	"twenty four": 24, "twenty fourth": 24, "twenty five": 25, "twenty fifth": 25,
	"twenty six": 26, "twenty sixth": 26, "twenty seven": 27, "twenty seventh": 27,
	"twenty eight": 28, "twenty eighth": 28, "twenty nine": 29, "twenty ninth": 29,
	thirty: 30, thirtieth: 30,
};

const DESTINATIONS: Readonly<Record<string, VoiceDestination>> = {
	today: "today", home: "today", "daily walk": "today",
	bible: "bible", reader: "bible", "bible reader": "bible",
	chat: "chat", conversations: "chat", "my conversations": "chat",
	connections: "connections", "bible connections": "connections",
	study: "study", "study tools": "study",
	notes: "notes", "my notes": "notes",
	settings: "settings", preferences: "settings",
};

export function resolveVoiceCommand(text: string, context: { options: readonly string[] }): VoiceCommand {
	if (text.length > 1024) return { type: "unmatched" };
	if (/^(?:please\s+)?(?:(?:choose|select|pick)\s+)?(?:(?:option|number)\s+)?[-−]\s*\d+\s*(?:please)?$/i.test(text.trim())) return { type: "ambiguous" };
	const words = normalized(text).replace(/^please\s+/, "").replace(/\s+please$/, "");
	if (!words) return { type: "unmatched" };
	const candidate = words.replace(/^(?:choose|select|pick)(?:\s+the)?\s+/, "")
		.replace(/^(?:i am|i m|im)\s+/, "");
	const labels = context.options.map(normalized);
	const matches = labels.map((label, index) => label && (label === words || label === candidate) ? index : -1).filter(index => index >= 0);
	if (matches.length > 1) return { type: "ambiguous" };
	if (matches.length === 1) return { type: "choose", index: matches[0], label: context.options[matches[0]] };

	if (/^(?:stop|stop listening|stop voice(?: controls?)?|turn voice off|end voice(?: controls?)?|cancel voice)$/.test(words)) return { type: "stop" };
	if (/^(?:back|go back|take me back)$/.test(words)) return { type: "back" };
	if (/^(?:read (?:my |the )?(?:options|choices)|what are (?:my |the )?(?:options|choices)|repeat(?: (?:that|(?:the |my )?(?:options|choices)))?|say that again)$/.test(words)) return { type: "repeat" };
	const destination = words.match(/^(?:open|go to|take me to|show me|navigate to|switch to) (?:the )?(.+)$/)?.[1];
	if (destination && DESTINATIONS[destination]) return { type: "navigate", destination: DESTINATIONS[destination] };

	const numberWords = words.replace(/^(?:choose|select|pick)\s+/, "")
		.replace(/^the\s+/, "").replace(/^(?:option|number)\s+/, "").replace(/\s+(?:option|one)$/, "");
	const digits = numberWords.match(/^(\d+)(?:st|nd|rd|th)?$/)?.[1];
	const number = digits !== undefined ? Number(digits) : NUMBERS[numberWords];
	if (number !== undefined && (context.options.length > 0 || /\b(?:choose|select|pick|option|number)\b/.test(words))) {
		if (!Number.isSafeInteger(number) || number < 1 || number > context.options.length) return { type: "ambiguous" };
		return { type: "choose", index: number - 1, label: context.options[number - 1] };
	}
	// "Saved" matches both "newly saved" and "saved and growing". Ask rather than guess.
	if (candidate && labels.filter(label => ` ${label} `.includes(` ${candidate} `)).length > 1) return { type: "ambiguous" };
	return { type: "unmatched" };
}
