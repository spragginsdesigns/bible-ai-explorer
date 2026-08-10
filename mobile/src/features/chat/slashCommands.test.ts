import { describe, expect, it } from "vitest";
import {
	CHAT_SLASH_COMMANDS,
	NOTE_SLASH_COMMANDS,
	matchSlashCommands,
	parseSlashCommand,
} from "./slashCommands";

describe("matchSlashCommands", () => {
	it("returns all commands for a bare slash", () => {
		expect(matchSlashCommands("/", CHAT_SLASH_COMMANDS)).toHaveLength(
			CHAT_SLASH_COMMANDS.length
		);
	});

	it("prefix-matches command names", () => {
		const matches = matchSlashCommands("/no", CHAT_SLASH_COMMANDS);
		expect(matches.map((c) => c.command)).toEqual(["/note"]);
	});

	it("matches aliases", () => {
		const matches = matchSlashCommands("/ad", CHAT_SLASH_COMMANDS);
		expect(matches.map((c) => c.command)).toEqual(["/note"]);
	});

	it("is case-insensitive on the typed token", () => {
		expect(matchSlashCommands("/VE", CHAT_SLASH_COMMANDS).map((c) => c.command)).toEqual([
			"/verse",
		]);
	});

	it("stops suggesting once the first token is complete", () => {
		expect(matchSlashCommands("/verse John", CHAT_SLASH_COMMANDS)).toEqual([]);
	});

	it("returns nothing for non-slash input", () => {
		expect(matchSlashCommands("hello", CHAT_SLASH_COMMANDS)).toEqual([]);
		expect(matchSlashCommands("", CHAT_SLASH_COMMANDS)).toEqual([]);
	});
});

describe("parseSlashCommand", () => {
	it("parses command and args", () => {
		const parsed = parseSlashCommand("/verse John 3:16-18", CHAT_SLASH_COMMANDS);
		expect(parsed?.def.command).toBe("/verse");
		expect(parsed?.args).toBe("John 3:16-18");
	});

	it("parses aliases", () => {
		expect(parseSlashCommand("/add this please", CHAT_SLASH_COMMANDS)?.def.command).toBe(
			"/note"
		);
	});

	it("returns null for unknown commands and plain text", () => {
		expect(parseSlashCommand("/bogus", CHAT_SLASH_COMMANDS)).toBeNull();
		expect(parseSlashCommand("just a question", CHAT_SLASH_COMMANDS)).toBeNull();
	});

	it("trims trailing args whitespace", () => {
		expect(parseSlashCommand("/memory   ", CHAT_SLASH_COMMANDS)?.args).toBe("");
	});
});

describe("command table integrity", () => {
	it("local commands declare a localAction and ai commands do not", () => {
		for (const cmd of [...CHAT_SLASH_COMMANDS, ...NOTE_SLASH_COMMANDS]) {
			if (cmd.kind === "local") {
				expect(cmd.localAction, cmd.command).toBeDefined();
			} else {
				expect(cmd.localAction, cmd.command).toBeUndefined();
			}
		}
	});

	it("commands with requiresArgs declare a hint", () => {
		for (const cmd of [...CHAT_SLASH_COMMANDS, ...NOTE_SLASH_COMMANDS]) {
			if (cmd.requiresArgs) expect(cmd.hint, cmd.command).toBeDefined();
		}
	});

	it("has no duplicate commands or aliases within each palette", () => {
		for (const commands of [CHAT_SLASH_COMMANDS, NOTE_SLASH_COMMANDS]) {
			const tokens = new Set<string>();
			for (const cmd of commands) {
				for (const token of [cmd.command, ...(cmd.aliases ?? [])]) {
					expect(tokens.has(token), token).toBe(false);
					tokens.add(token);
				}
			}
		}
	});
});
