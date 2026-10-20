import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { useFocusEffect } from "expo-router";
import { useStableGetToken } from "@/features/notes/useStableGetToken";
import { apiJson } from "@/lib/api";

interface DailyPreview { reference: string; text: string; sentAt: string }

/** This endpoint reads an existing day; opening home never prepares a new one. */
export function useDailyPreview() {
	const { userId, isLoaded, isSignedIn } = useAuth();
	const getToken = useStableGetToken();
	const [result, setResult] = useState<{ userId: string; cross: DailyPreview | null } | null>(null);
	useFocusEffect(useCallback(() => {
		if (!isLoaded || !isSignedIn || !userId) return;
		let active = true;
		let request = 0;
		const load = () => {
			const version = ++request;
			void apiJson<{ cross: DailyPreview | null }>(getToken, "/api/verse-of-day/preview")
				.then(({ cross }) => { if (active && version === request) setResult({ userId, cross }); })
				.catch(() => { if (active && version === request) setResult({ userId, cross: null }); });
		};
		load();
		const subscription = AppState.addEventListener("change", (state) => { if (state === "active") load(); });
		return () => { active = false; subscription.remove(); };
	}, [getToken, userId, isLoaded, isSignedIn]));
	return result?.userId === userId ? result?.cross ?? null : null;
}
