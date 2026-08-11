"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Loader2, X } from "lucide-react";
import {
	matchSlashCommands,
	parseSlashCommand,
	type LocalCommandAction,
	type SlashCommand,
} from "@/lib/chat/slashCommands";
import type { VerseAttachment } from "@/lib/chat/verseActions";

interface ChatInputProps {
	onSend: (text: string) => void;
	loading: boolean;
	isStreaming: boolean;
	disabled?: boolean;
	commands?: SlashCommand[];
	onLocalCommand?: (action: LocalCommandAction, args: string) => void;
	/** Verse/chapter context attached to the next message (dismissible pill). */
	attachment?: VerseAttachment | null;
	onClearAttachment?: () => void;
	/** Controlled mode: when both are provided they replace the internal state. */
	value?: string;
	onChangeText?: (text: string) => void;
	/** Bump this number to focus the input (e.g. after a ?prompt= prefill). */
	focusSignal?: number;
}

const ChatInput: React.FC<ChatInputProps> = ({
	onSend,
	loading,
	isStreaming,
	disabled: externallyDisabled = false,
	commands = [],
	onLocalCommand,
	attachment = null,
	onClearAttachment,
	value,
	onChangeText,
	focusSignal,
}) => {
	const [innerText, setInnerText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const text = value ?? innerText;
	const setText = useCallback(
		(next: string) => {
			if (onChangeText) onChangeText(next);
			else setInnerText(next);
		},
		[onChangeText]
	);
	const disabled = externallyDisabled || loading || isStreaming;

	useEffect(() => {
		if (focusSignal) textareaRef.current?.focus();
	}, [focusSignal]);

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
		}
	}, [text]);

	const suggestions = useMemo(
		() => (commands.length > 0 ? matchSlashCommands(text, commands) : []),
		[text, commands]
	);

	const runCommand = useCallback(
		(def: SlashCommand, args: string) => {
			if (def.kind === "local" && def.localAction) {
				onLocalCommand?.(def.localAction, args);
				return;
			}
			onSend(args ? `${def.command} ${args}` : def.command);
		},
		[onLocalCommand, onSend]
	);

	const selectSuggestion = useCallback(
		(def: SlashCommand) => {
			if (def.requiresArgs || def.hint) {
				setText(`${def.command} `);
				textareaRef.current?.focus();
				return;
			}
			setText("");
			runCommand(def, "");
		},
		[runCommand, setText]
	);

	const handleSubmit = () => {
		const trimmed = text.trim();
		if ((!trimmed && !attachment) || disabled) return;

		const parsed = commands.length > 0 ? parseSlashCommand(trimmed, commands) : null;
		if (parsed) {
			if (parsed.def.requiresArgs && !parsed.args) return; // keep typing the argument
			setText("");
			runCommand(parsed.def, parsed.args);
			return;
		}

		onSend(trimmed);
		setText("");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const canSend = Boolean(text.trim()) || Boolean(attachment);

	return (
		<div className="border-t border-black/[0.08] dark:border-white/[0.06] glass pb-safe">
			<div className="max-w-3xl mx-auto px-4 py-3">
				{attachment && (
					<div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/[0.07] py-1 pl-3 pr-2">
						<span className="text-[11px] text-amber-600 dark:text-amber-400">✦</span>
						<span className="truncate text-xs font-semibold text-amber-700 dark:text-amber-400">
							{attachment.reference} · {attachment.translation}
						</span>
						<button
							type="button"
							aria-label="Remove attachment"
							onClick={onClearAttachment}
							className="flex items-center justify-center rounded-full p-0.5 text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				)}
				<div className="relative">
					{suggestions.length > 0 && !disabled && (
						<div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-lg dark:border-white/[0.08] dark:bg-neutral-900">
							<div className="max-h-64 overflow-y-auto custom-scrollbar">
								{suggestions.map((def) => (
									<button
										type="button"
										key={def.command}
										onClick={() => selectSuggestion(def)}
										className="block w-full border-b border-black/[0.05] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-black/[0.03] dark:border-white/[0.05] dark:hover:bg-white/[0.05]"
									>
										<span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
											{def.command}
											{def.hint && (
												<span className="font-normal text-neutral-400 dark:text-neutral-500">
													{" "}
													{def.hint}
												</span>
											)}
										</span>
										<span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">
											{def.description}
										</span>
									</button>
								))}
							</div>
						</div>
					)}
					<div className="flex items-end gap-2 gradient-border rounded-xl bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2">
						<textarea
							ref={textareaRef}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask a question about the Bible..."
							rows={1}
							disabled={disabled}
							className="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 resize-none outline-none py-1.5 max-h-[200px] text-sm sm:text-base"
						/>
						<button
							onClick={handleSubmit}
							disabled={disabled || !canSend}
							className="flex-shrink-0 p-2.5 rounded-lg bg-gradient-to-b from-neutral-800 to-neutral-900 hover:from-neutral-700 hover:to-neutral-800 dark:from-white/15 dark:to-white/5 dark:hover:from-white/20 dark:hover:to-white/10 text-white border border-neutral-700 dark:border-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
						>
							{loading || isStreaming ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<Send className="w-4 h-4" />
							)}
						</button>
					</div>
				</div>
				<p className="text-center text-xs text-neutral-400 dark:text-neutral-700 mt-2">
					SureWord uses AI trained on the KJV Bible. Use with discernment. Created by{" "}
					<a href="https://www.spragginsdesigns.xyz" target="_blank" rel="noopener noreferrer" className="text-neutral-500 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-400 transition-colors">
						Austin Spraggins
					</a>
				</p>
			</div>
		</div>
	);
};

export default ChatInput;
