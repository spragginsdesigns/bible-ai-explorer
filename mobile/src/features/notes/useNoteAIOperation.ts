import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/expo";
import { randomUUID } from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GetToken } from "@/lib/api";
import * as api from "./api";
import { createNoteAIOperation, type NoteOperationState } from "./noteAIOperation";
import { useStableGetToken } from "./useStableGetToken";

export function useNoteAIOperation(noteId: string, options: {
	prepare: () => Promise<boolean>;
	canonical: () => Promise<string | null>;
	adopt: (html: string) => boolean | Promise<boolean>;
	lock: (locked: boolean) => void;
}) {
	const { userId, sessionId } = useAuth();
	const getToken = useStableGetToken();
	const latest = useRef({ userId, sessionId, options });
	latest.current = { userId, sessionId, options };
	const [state, setState] = useState<NoteOperationState>("checking");
	const [error, setError] = useState<string | null>(null);
	const boundToken = useMemo<GetToken>(() => async flags => {
		if (!userId || !sessionId || latest.current.userId !== userId || latest.current.sessionId !== sessionId) throw new Error("The reading account changed.");
		const token = await getToken(flags);
		if (latest.current.userId !== userId || latest.current.sessionId !== sessionId) throw new Error("The reading account changed.");
		return token;
	}, [getToken, userId, sessionId]);
	const controller = useMemo(() => createNoteAIOperation({
		accountId: userId ?? "signed-out", noteId, newId: randomUUID,
		isCurrent: () => !!userId && !!sessionId && latest.current.userId === userId && latest.current.sessionId === sessionId,
		storage: AsyncStorage,
		prepare: () => latest.current.options.prepare(),
		reserve: body => api.reserveNoteAIOperation(boundToken, body),
		read: id => api.readNoteAIOperation(boundToken, id, noteId),
		cancel: id => api.cancelNoteAIOperation(boundToken, id, noteId),
		canonical: () => latest.current.options.canonical(),
		adopt: html => latest.current.options.adopt(html),
		changed: (next, notice) => {
			latest.current.options.lock(next !== "editable");
			setState(next); setError(notice);
		},
	}), [noteId, userId, sessionId, boundToken]);
	useEffect(() => {
		void controller.initialize();
		return () => controller.dispose();
	}, [controller]);
	return { controller, state, error, locked: state !== "editable" || !controller.canEdit() };
}
