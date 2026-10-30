"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { consentFetch } from "@/lib/ai-consent-gate";
import { createNoteAIOperation, type NoteOperationReceipt, type NoteOperationState } from "@/lib/notes/note-ai-operation";

export function useNoteAIOperation(noteId: string, options: {
	prepare: () => Promise<boolean>;
	canonical: () => Promise<string | null>;
	adopt: (content: string) => Promise<boolean>;
	lock: (locked: boolean) => void;
}) {
	const { userId, sessionId } = useAuth();
	const latest = useRef({ userId, sessionId, options }); latest.current = { userId, sessionId, options };
	const [state, setState] = useState<NoteOperationState>("checking");
	const [error, setError] = useState<string | null>(null);
	const controller = useMemo(() => {
		const identityCurrent = () => !!userId && !!sessionId && latest.current.userId === userId && latest.current.sessionId === sessionId;
		const receipt = async (path: string, body?: Record<string, unknown>): Promise<NoteOperationReceipt> => {
			if (!identityCurrent()) throw new Error("The reading account changed.");
			const response = await consentFetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
			if (!identityCurrent()) throw new Error("The reading account changed.");
			if (!response.ok) throw new Error("The note safety status could not be checked. Editing remains paused.");
			const value = await response.json() as NoteOperationReceipt;
			if (!identityCurrent()) throw new Error("The reading account changed.");
			return value;
		};
		return createNoteAIOperation({
			accountId: userId ?? "signed-out", noteId, newId: () => crypto.randomUUID(), isCurrent: identityCurrent,
			storage: {
				getItem: async key => window.localStorage.getItem(key),
				setItem: async (key, value) => { window.localStorage.setItem(key, value); },
				removeItem: async key => { window.localStorage.removeItem(key); },
			},
			prepare: () => latest.current.options.prepare(),
			reserve: body => receipt("/api/note-ai/operations", body),
			read: id => receipt(`/api/note-ai/operations/${id}?noteId=${encodeURIComponent(noteId)}`),
			cancel: id => receipt(`/api/note-ai/operations/${id}/cancel`, { noteId }),
			canonical: () => latest.current.options.canonical(), adopt: content => latest.current.options.adopt(content),
			changed: (next, notice) => { latest.current.options.lock(next !== "editable"); setState(next); setError(notice); },
		});
	}, [userId, sessionId, noteId]);
	useEffect(() => { void controller.initialize(); return () => controller.dispose(); }, [controller]);
	return { controller, state, error, locked: state !== "editable" || !controller.canEdit(), accountId: userId ?? "", identity: `${userId ?? ""}:${sessionId ?? ""}:${noteId}` };
}
