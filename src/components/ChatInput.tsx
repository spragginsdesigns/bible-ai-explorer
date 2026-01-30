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
		<div className="border-t border-amber-700/20 bg-black/80 backdrop-blur-sm">
			<div className="max-w-3xl mx-auto px-4 py-3">
				<div className="flex items-end gap-2 bg-gray-900/80 border border-amber-700/30 rounded-xl px-3 py-2">
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask a question about the Bible..."
						rows={1}
						disabled={disabled}
						className="flex-1 bg-transparent text-amber-100 placeholder:text-amber-100/40 resize-none outline-none py-1.5 max-h-[200px] text-sm sm:text-base"
					/>
					<button
						onClick={handleSubmit}
						disabled={disabled || !text.trim()}
						className="flex-shrink-0 p-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
					>
						{loading || isStreaming ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Send className="w-4 h-4" />
						)}
					</button>
				</div>
				<p className="text-center text-xs text-amber-100/30 mt-2">
					VerseMind uses AI trained on the KJV Bible. Use with discernment. Created by{" "}
					<a href="https://www.spragginsdesigns.xyz" target="_blank" rel="noopener noreferrer" className="text-amber-500/50 hover:text-amber-400 transition-colors">
						Austin Spraggins
					</a>
				</p>
			</div>
		</div>
	);
};

export default ChatInput;
