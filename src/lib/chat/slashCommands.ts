/**
 * Slash commands for the chat input, ported from the Android app
 * (mobile/src/features/chat/slashCommands.ts). "local" commands are handled
 * by the app itself; "ai" commands are sent to the model verbatim - the
 * backend system prompt teaches it how to execute each one with its tools.
 */
export type LocalCommandAction = "new" | "clear" | "history";

export interface SlashCommand {
	command: string;
	aliases?: string[];
	/** Argument hint shown in the palette, e.g. "<reference>". */
	hint?: string;
	description: string;
	kind: "ai" | "local";
	localAction?: LocalCommandAction;
	/** When true, selecting the command fills the input instead of sending. */
	requiresArgs?: boolean;
}

export const CHAT_SLASH_COMMANDS: SlashCommand[] = [
	{
		command: "/note",
		aliases: ["/add"],
		hint: "[what to save]",
		description: "Save the last answer (or what you describe) to your notes",
		kind: "ai",
	},
	{
		command: "/verse",
		hint: "<reference>",
		description: "Quote a passage word-for-word, e.g. /verse John 3:16-18",
		kind: "ai",
		requiresArgs: true,
	},
	{
		command: "/search",
		hint: "<topic>",
		description: "Search the Scriptures for a topic",
		kind: "ai",
		requiresArgs: true,
	},
	{
		command: "/web",
		hint: "<query>",
		description: "Search the web - history, archaeology, apologetics",
		kind: "ai",
		requiresArgs: true,
	},
	{
		command: "/memory",
		description: "What VerseMind remembers about you",
		kind: "ai",
	},
	{
		command: "/new",
		description: "Start a new conversation",
		kind: "local",
		localAction: "new",
	},
	{
		command: "/clear",
		description: "Delete this conversation and start fresh",
		kind: "local",
		localAction: "clear",
	},
	{
		command: "/history",
		description: "Open conversation history",
		kind: "local",
		localAction: "history",
	},
];

function matchesPrefix(candidate: string, typed: string): boolean {
	return candidate.startsWith(typed.toLowerCase());
}

/** Commands whose name or alias starts with the typed "/..." token. */
export function matchSlashCommands(
	input: string,
	commands: SlashCommand[]
): SlashCommand[] {
	if (!input.startsWith("/") || /\s/.test(input.trimEnd())) {
		// Only suggest while the first token is being typed.
		const firstToken = input.split(/\s/, 1)[0];
		if (firstToken !== input.trimEnd()) return [];
	}
	const typed = input.trim();
	if (!typed.startsWith("/")) return [];
	return commands.filter(
		(c) =>
			matchesPrefix(c.command, typed) ||
			(c.aliases ?? []).some((a) => matchesPrefix(a, typed))
	);
}

/** Exact command match on the first token of a submitted message. */
export function parseSlashCommand(
	text: string,
	commands: SlashCommand[]
): { def: SlashCommand; args: string } | null {
	if (!text.startsWith("/")) return null;
	const [token, ...rest] = text.split(/\s+/);
	const lower = token.toLowerCase();
	const def = commands.find(
		(c) => c.command === lower || (c.aliases ?? []).includes(lower)
	);
	return def ? { def, args: rest.join(" ").trim() } : null;
}
