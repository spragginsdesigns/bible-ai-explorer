"use client";

import { useState, useRef, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { notesDb } from "@/lib/notesDb";
import type { NoteAIMessage } from "@/types/notes";

export function useNoteAI(noteId: string) {
	const [isStreaming, setIsStreaming] = useState(false);
	const [loading, setLoading] = useState(false);
	const abortControllerRef = useRef<AbortController | null>(null);

	const messages = useLiveQuery(
		() =>
			notesDb.noteAIMessages
				.where("noteId")
				.equals(noteId)
				.sortBy("timestamp"),
		[noteId]
	);

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
				timestamp: Date.now(),
			};

			const assistantMsg: NoteAIMessage = {
				id: crypto.randomUUID(),
				noteId,
				role: "assistant",
				content: "",
				timestamp: Date.now() + 1,
				isStreaming: true,
			};

			await notesDb.noteAIMessages.bulkAdd([userMsg, assistantMsg]);

			// Build history from existing messages
			const existingMsgs = await notesDb.noteAIMessages
				.where("noteId")
				.equals(noteId)
				.sortBy("timestamp");

			const history = existingMsgs
				.filter((m) => m.content.trim() && m.id !== assistantMsg.id)
				.map((m) => ({ role: m.role, content: m.content }));

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

					await notesDb.noteAIMessages.update(assistantMsg.id, {
						content: displayContent,
					});
				}

				accumulated += decoder.decode();
				accumulated = accumulated.replace(/<!--SOURCES:.*?-->/, "");

				// Parse follow-ups and clean content
				const cleanContent = accumulated
					.replace(/\[FOLLOWUP\]\s*.+/g, "")
					.trimEnd();

				await notesDb.noteAIMessages.update(assistantMsg.id, {
					content: cleanContent,
					isStreaming: false,
				});
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") return;
				console.error("Note AI error:", err);
				const errorContent =
					err instanceof Error ? err.message : "An error occurred";
				await notesDb.noteAIMessages.update(assistantMsg.id, {
					content: `Error: ${errorContent}`,
					isStreaming: false,
				});
			} finally {
				setLoading(false);
				setIsStreaming(false);
			}
		},
		[noteId]
	);

	const clearHistory = useCallback(async () => {
		await notesDb.noteAIMessages.where("noteId").equals(noteId).delete();
	}, [noteId]);

	return {
		messages: messages ?? [],
		isStreaming,
		loading,
		sendMessage,
		clearHistory,
	};
}
