"use client";

import React, { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Trash2 } from "lucide-react";
import NoteAIMessage from "./NoteAIMessage";
import { useNoteAI } from "@/hooks/useNoteAI";

interface NoteAIPanelProps {
	noteId: string;
	noteTitle: string;
	noteContent: string;
	onClose: () => void;
}

const NoteAIPanel: React.FC<NoteAIPanelProps> = ({
	noteId,
	noteTitle,
	noteContent,
	onClose,
}) => {
	const { messages, isStreaming, loading, sendMessage, clearHistory } =
		useNoteAI(noteId);
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSend = () => {
		const text = input.trim();
		if (!text || loading || isStreaming) return;
		setInput("");
		sendMessage(text, noteContent, noteTitle);
	};

	const handleSuggestVerses = () => {
		if (loading || isStreaming) return;
		sendMessage(
			"Suggest the most relevant KJV Bible verses for this note and explain how each relates to the content.",
			noteContent,
			noteTitle
		);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="flex flex-col h-full border-l border-white/[0.06] glass">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-amber-400" />
					<span className="text-neutral-300 text-xs font-medium">
						AI Assistant
					</span>
				</div>
				<div className="flex items-center gap-0">
					{messages.length > 0 && (
						<button
							onClick={clearHistory}
							title="Clear chat"
							className="text-neutral-600 hover:text-red-400 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
					<button
						onClick={onClose}
						className="text-neutral-500 hover:text-neutral-300 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
			</div>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto custom-scrollbar p-3">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full text-center px-4">
						<Sparkles className="w-8 h-8 text-amber-400/40 mb-3" />
						<p className="text-neutral-500 text-xs mb-1">
							Ask about your note
						</p>
						<p className="text-neutral-600 text-[11px] mb-4">
							The AI can see your note content and suggest relevant Bible verses
						</p>
						<button
							onClick={handleSuggestVerses}
							className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-amber-400 bg-amber-400/10 hover:bg-amber-400/15 transition-colors border border-amber-400/20"
						>
							<Sparkles className="w-3.5 h-3.5" />
							Suggest Verses
						</button>
					</div>
				) : (
					<>
						{messages.map((msg) => (
							<NoteAIMessage key={msg.id} message={msg} />
						))}
						<div ref={messagesEndRef} />
					</>
				)}
			</div>

			{/* Suggest button (when messages exist) */}
			{messages.length > 0 && (
				<div className="px-3 pb-1">
					<button
						onClick={handleSuggestVerses}
						disabled={loading || isStreaming}
						className="flex items-center gap-1 text-[11px] text-amber-400/70 hover:text-amber-400 transition-colors disabled:opacity-50"
					>
						<Sparkles className="w-3 h-3" />
						Suggest Verses
					</button>
				</div>
			)}

			{/* Input */}
			<div className="p-3 border-t border-white/[0.06]">
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask about your note..."
						rows={1}
						className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-neutral-200 text-xs resize-none outline-none focus:border-amber-400/30 transition-colors placeholder:text-neutral-600"
						style={{
							minHeight: "36px",
							maxHeight: "100px",
						}}
					/>
					<button
						onClick={handleSend}
						disabled={!input.trim() || loading || isStreaming}
						className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl bg-amber-400/20 text-amber-400 hover:bg-amber-400/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Send className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
};

export default NoteAIPanel;
