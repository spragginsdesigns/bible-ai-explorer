"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Loader2, Paperclip, X, RefreshCw } from "lucide-react";
import {
	matchSlashCommands,
	parseSlashCommand,
	type LocalCommandAction,
	type SlashCommand,
} from "@/lib/chat/slashCommands";
import type { ClassifiedChatError } from "@/lib/chat/chatErrors";
import type { VerseAttachment } from "@/lib/chat/verseActions";
import type { ChatAttachmentDescriptor } from "@/lib/chat-attachment-types";
import ChatFileAttachments from "./ChatFileAttachments";
import ModelPicker from "./ModelPicker";

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
	fileAttachments?: ChatAttachmentDescriptor[];
	uploadingAttachments?: boolean;
	attachmentError?: string | null;
	/** Classified send/stream failure, rendered as an inline error card. */
	error?: ClassifiedChatError | null;
	/** Retries the failed send; shown as "Try again" when the error is retryable. */
	onRetry?: () => void;
	onFilesSelected?: (files: File[]) => void;
	onRemoveFileAttachment?: (id: string) => void;
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
	fileAttachments = [],
	uploadingAttachments = false,
	attachmentError = null,
	error = null,
	onRetry,
	onFilesSelected,
	onRemoveFileAttachment,
	value,
	onChangeText,
	focusSignal,
}) => {
	const [innerText, setInnerText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const text = value ?? innerText;
	const setText = useCallback(
		(next: string) => {
			if (onChangeText) onChangeText(next);
			else setInnerText(next);
		},
		[onChangeText]
	);
	const disabled = externallyDisabled || loading || isStreaming || uploadingAttachments;

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
		if ((!trimmed && !attachment && fileAttachments.length === 0) || disabled) return;

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

	const handleFiles = useCallback((files: FileList | File[]) => {
		onFilesSelected?.(Array.from(files));
	}, [onFilesSelected]);

	const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
		if (files.length > 0) {
			event.preventDefault();
			handleFiles(files);
		}
	}, [handleFiles]);

	const canSend = Boolean(text.trim()) || Boolean(attachment) || fileAttachments.length > 0;

	// Attachment failures keep their string shape; they get the same card
	// treatment as send errors, minus the retry (re-pick the file instead).
	const shownError: ClassifiedChatError | null = attachmentError
		? { code: "invalid_input", title: "Couldn't attach that file", message: attachmentError, retryable: false }
		: error;

	return (
		<div
			className={`border-t glass pb-safe transition-colors ${dragging ? "border-amber-500 bg-amber-500/[0.05]" : "border-black/[0.08] dark:border-white/[0.06]"}`}
			onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
			onDragOver={(event) => event.preventDefault()}
			onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				if (!disabled) handleFiles(event.dataTransfer.files);
			}}
		>
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
				{fileAttachments.length > 0 && (
					<div className="mb-2">
						<ChatFileAttachments attachments={fileAttachments} onRemove={onRemoveFileAttachment} />
					</div>
				)}
				{shownError && (
					<div
						role="alert"
						className="mb-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="text-xs font-semibold text-red-700 dark:text-red-400">
									{shownError.title}
								</p>
								<p className="mt-0.5 text-xs leading-5 text-neutral-600 dark:text-neutral-400">
									{shownError.message}
								</p>
								<p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-600">
									ref: {shownError.code}
								</p>
							</div>
							{shownError.retryable && onRetry && (
								<button
									type="button"
									onClick={onRetry}
									className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/[0.05]"
								>
									<RefreshCw className="h-3 w-3" />
									Try again
								</button>
							)}
						</div>
					</div>
				)}
				{dragging && (
					<p className="mb-2 text-center text-xs font-medium text-amber-700 dark:text-amber-400">Drop files to attach</p>
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
					<div className="flex items-end gap-1 gradient-border liquid-glass rounded-xl px-2 py-2">
						<ModelPicker />
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.markdown,.csv,.json,image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json"
							className="sr-only"
							onChange={(event) => {
								if (event.target.files) handleFiles(event.target.files);
								event.target.value = "";
							}}
						/>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							disabled={disabled}
							aria-label="Attach files"
							className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-amber-700 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-amber-400"
						>
							{uploadingAttachments ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
						</button>
						<textarea
							ref={textareaRef}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={handleKeyDown}
							onPaste={handlePaste}
							placeholder="Ask a question about the Bible..."
							rows={1}
							disabled={disabled}
							className="flex-1 bg-transparent text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 resize-none outline-none py-1.5 max-h-[200px] text-sm sm:text-base"
						/>
						<button
							type="button"
							aria-label="Send message"
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
					SureWord uses AI grounded in Scripture and the Bible translation you select. Use with discernment. Created by{" "}
					<a href="https://www.spragginsdesigns.xyz" target="_blank" rel="noopener noreferrer" className="text-neutral-500 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-400 transition-colors">
						Austin Spraggins
					</a>
				</p>
			</div>
		</div>
	);
};

export default ChatInput;
