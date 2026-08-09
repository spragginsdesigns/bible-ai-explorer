import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

export const API_URL: string =
	typeof extra.apiUrl === "string" ? extra.apiUrl : "https://bible-ai-explorer.vercel.app";

export const CLERK_PUBLISHABLE_KEY: string =
	typeof extra.clerkPublishableKey === "string" ? extra.clerkPublishableKey : "";

export type GetToken = () => Promise<string | null>;

/**
 * Build a fetch function that injects the Clerk session token as a Bearer
 * header. Based on expo/fetch so streaming responses work (the AI SDK chat
 * transport requires it on native).
 */
export function makeAuthedFetch(getToken: GetToken) {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const token = await getToken();
		const headers = new Headers(init?.headers as HeadersInit | undefined);
		if (token) headers.set("Authorization", `Bearer ${token}`);
		const url =
			typeof input === "string" || input instanceof URL ? input.toString() : input.url;
		return expoFetch(url, {
			...(init as object),
			headers: Object.fromEntries(headers.entries()),
		} as Parameters<typeof expoFetch>[1]) as unknown as Response;
	};
}

/** JSON helper for the REST endpoints (conversations, notes, folders, tags). */
export async function apiJson<T>(
	getToken: GetToken,
	path: string,
	init?: { method?: string; body?: unknown }
): Promise<T> {
	const token = await getToken();
	const res = await fetch(`${API_URL}${path}`, {
		method: init?.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
	});
	if (!res.ok) {
		let message = `Request failed: ${res.status}`;
		try {
			const data = (await res.json()) as { error?: string };
			if (data?.error) message = data.error;
		} catch {
			// keep default message
		}
		throw new Error(message);
	}
	return (await res.json()) as T;
}
