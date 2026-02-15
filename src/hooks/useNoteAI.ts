"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { NoteAIMessage } from "@/types/notes";

export function useNoteAI(noteId: string) {
	const [messages, setMessages] = useState<NoteAIMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [loading, setLoading] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const loadedNoteId = useRef<string | null>(null);

	// Load AI messages from API when noteId changes
	useEffect(() => {
		if (!noteId || loadedNoteId.current === noteId) return;
		loadedNoteId.current = noteId;

		(async () => {
			try {
				const res = await fetch(`/api/notes/${noteId}/ai-messages`);
				if (res.ok) {
					const data = await res.json();
					setMessages(data);
				}
			} catch {
				// Silent fail
			}
		})();
	}, [noteId]);

	const sendMessage = useCallback(
		async (
			text: string,
			noteContent: string,
			noteTitle: string
		) => {
			if (!text.trim()) return;

			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			setLoading(true);

			const userMsg: NoteAIMessage = {
				id: crypto.randomUUID(),
				noteId,
				role: "user",
				content: text,
				createdAt: new Date().toISOString(),
			};

			const assistantMsg: NoteAIMessage = {
				id: crypto.randomUUID(),
				noteId,
				role: "assistant",
				content: "",
				createdAt: new Date().toISOString(),
				isStreaming: true,
			};

			setMessages((prev) => [...prev, userMsg, assistantMsg]);

			// Save user message to DB in background
			fetch(`/api/notes/${noteId}/ai-messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role: "user", content: text }),
			}).then((res) => {
				if (res.ok) {
					res.json().then((saved) => {
						if (saved?.id) {
							setMessages((prev) =>
								prev.map((m) =>
									m.id === userMsg.id ? { ...m, id: saved.id } : m
								)
							);
						}
					});
				}
			}).catch(() => {});

			// Build history from current messages
			const history = messages
				.filter((m) => m.content.trim())
				.map((m) => ({ role: m.role, content: m.content }))
				.concat({ role: "user", content: text });

			try {
				const res = await fetch("/api/note-ai", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						question: text,
						noteContent,
						noteTitle,
						history,
					}),
					signal: abortController.signal,
				});

				if (!res.ok) {
					const contentType = res.headers.get("content-type");
					if (contentType?.includes("application/json")) {
						const data = await res.json();
						throw new Error(data.error || `API error: ${res.status}`);
					}
					throw new Error(`API error: ${res.status}`);
				}

				const reader = res.body?.getReader();
				if (!reader) throw new Error("No response body");

				setLoading(false);
				setIsStreaming(true);

				const decoder = new TextDecoder();
				let accumulated = "";
				let sourcesParsed = false;

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					accumulated += decoder.decode(value, { stream: true });

					if (!sourcesParsed && accumulated.includes("-->")) {
						accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");
						sourcesParsed = true;
					}

					const displayContent = sourcesParsed
						? accumulated
						: accumulated.replace(/<!--SOURCES:.*/, "");

					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantMsg.id
								? { ...m, content: displayContent }
								: m
						)
					);
				}

				accumulated += decoder.decode();
				accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");

				const cleanContent = accumulated
					.replace(/\[FOLLOWUP\]\s*.+/g, "")
					.trimEnd();

				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsg.id
							? { ...m, content: cleanContent, isStreaming: false }
							: m
					)
				);

				// Save assistant message to DB
				fetch(`/api/notes/${noteId}/ai-messages`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ role: "assistant", content: cleanContent }),
				}).then((res) => {
					if (res.ok) {
						res.json().then((saved) => {
							if (saved?.id) {
								setMessages((prev) =>
									prev.map((m) =>
										m.id === assistantMsg.id ? { ...m, id: saved.id } : m
									)
								);
							}
						});
					}
				}).catch(() => {});
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") return;
				console.error("Note AI error:", err);
				const errorContent =
					err instanceof Error ? err.message : "An error occurred";
				setMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsg.id
							? { ...m, content: `Error: ${errorContent}`, isStreaming: false }
							: m
					)
				);
			} finally {
				setLoading(false);
				setIsStreaming(false);
			}
		},
		[noteId, messages]
	);

	const clearHistory = useCallback(async () => {
		setMessages([]);
		await fetch(`/api/notes/${noteId}/ai-messages`, { method: "DELETE" });
	}, [noteId]);

	return {
		messages,
		isStreaming,
		loading,
		sendMessage,
		clearHistory,
	};
}
