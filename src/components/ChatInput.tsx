"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

interface ChatInputProps {
	onSend: (text: string) => void;
	loading: boolean;
	isStreaming: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSend, loading, isStreaming }) => {
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const disabled = loading || isStreaming;

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
		}
	}, [text]);

	const handleSubmit = () => {
		if (!text.trim() || disabled) return;
		onSend(text.trim());
		setText("");
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<div className="border-t border-black/[0.08] dark:border-white/[0.06] glass pb-safe">
			<div className="max-w-3xl mx-auto px-4 py-3">
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
						disabled={disabled || !text.trim()}
						className="flex-shrink-0 p-2.5 rounded-lg bg-gradient-to-b from-neutral-800 to-neutral-900 hover:from-neutral-700 hover:to-neutral-800 dark:from-white/15 dark:to-white/5 dark:hover:from-white/20 dark:hover:to-white/10 text-white border border-neutral-700 dark:border-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
					>
						{loading || isStreaming ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Send className="w-4 h-4" />
						)}
					</button>
				</div>
				<p className="text-center text-xs text-neutral-400 dark:text-neutral-700 mt-2">
					VerseMind uses AI trained on the KJV Bible. Use with discernment. Created by{" "}
					<a href="https://www.spragginsdesigns.xyz" target="_blank" rel="noopener noreferrer" className="text-neutral-500 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-400 transition-colors">
						Austin Spraggins
					</a>
				</p>
			</div>
		</div>
	);
};

export default ChatInput;
