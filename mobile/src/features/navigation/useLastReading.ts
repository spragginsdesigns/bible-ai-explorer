import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { useFocusEffect } from "expo-router";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { apiJson } from "@/lib/api";
import { parseLastRead, type LastRead } from "./lastReading";

export function useLastReading() {
	const { userId, isLoaded, isSignedIn } = useAuth();
	const getToken = useStableGetToken();
	const [result, setResult] = useState<{ userId: string; value: LastRead | null } | null>(null);
	useFocusEffect(useCallback(() => {
		if (!isLoaded || !isSignedIn || !userId) return;
		let active = true;
		let request = 0;
		const load = () => {
			const version = ++request;
			void apiJson<{ lastRead?: unknown }>(getToken, "/api/reading-events")
				.then((data) => { if (active && version === request) setResult({ userId, value: parseLastRead(data.lastRead) }); })
				.catch(() => { if (active && version === request) setResult({ userId, value: null }); });
		};
		load();
		const subscription = AppState.addEventListener("change", (state) => { if (state === "active") load(); });
		return () => { active = false; subscription.remove(); };
	}, [getToken, userId, isLoaded, isSignedIn]));
	return result?.userId === userId ? result?.value ?? null : null;
}
