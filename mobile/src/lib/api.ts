import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

export const API_URL: string =
	typeof extra.apiUrl === "string" ? extra.apiUrl : "https://bible-ai-explorer.vercel.app";

export const CLERK_PUBLISHABLE_KEY: string =
	typeof extra.clerkPublishableKey === "string" ? extra.clerkPublishableKey : "";

/**
 * Token getter. Pass `{ fresh: true }` to bypass the Clerk token cache - used
 * by the automatic 401 retry so an expired cached token never kills a request.
 * Zero-arg call sites remain valid.
 */
export type GetToken = (opts?: { fresh?: boolean }) => Promise<string | null>;

export interface ApiRequestOptions {
	/** Abort the request after this many ms. Default 30s (chat streams excluded). */
	timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Error with enough context for the UI to show offline vs server failures. */
export class ApiError extends Error {
	readonly status?: number;
	readonly isNetworkError: boolean;
	readonly isTimeout: boolean;

	constructor(
		message: string,
		opts: { status?: number; isNetworkError?: boolean; isTimeout?: boolean } = {}
	) {
		super(message);
		this.name = "ApiError";
		this.status = opts.status;
		this.isNetworkError = opts.isNetworkError ?? false;
		this.isTimeout = opts.isTimeout ?? false;
	}
}

export function isOfflineMessage(error: unknown): boolean {
	return error instanceof ApiError && (error.isNetworkError || error.isTimeout);
}

function isNetworkFailure(error: unknown): boolean {
	if (error instanceof ApiError) return error.isNetworkError;
	if (!(error instanceof Error)) return false;
	// React Native / undici network failures surface as TypeError("Network request failed").
	return error.name === "TypeError" || error.name === "AbortError";
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit | undefined,
	timeoutMs: number,
	doFetch: (url: string, init?: RequestInit) => Promise<Response>
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await doFetch(url, { ...(init as object), signal: controller.signal } as RequestInit);
	} catch (error) {
		if (controller.signal.aborted) {
			throw new ApiError(
				"The request timed out. Check your connection and try again.",
				{ isTimeout: true }
			);
		}
		if (isNetworkFailure(error)) {
			throw new ApiError(
				"You appear to be offline. Reconnect and try again.",
				{ isNetworkError: true }
			);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

async function buildHeaders(token: string | null, init?: RequestInit): Promise<Headers> {
	const headers = new Headers(init?.headers as HeadersInit | undefined);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	return headers;
}

/**
 * Build a fetch function that injects the Clerk session token as a Bearer
 * header. Based on expo/fetch so streaming responses work (the AI SDK chat
 * transport requires it on native).
 *
 * Retries exactly once with a fresh token when the server answers 401 - the
 * usual cause is an expired cached token, and the user should never see it.
 */
export function makeAuthedFetch(getToken: GetToken) {
	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url =
			typeof input === "string" || input instanceof URL ? input.toString() : input.url;

		const attempt = async (fresh: boolean): Promise<Response> => {
			const token = await getToken(fresh ? { fresh: true } : undefined);
			const headers = await buildHeaders(token, init);
			return expoFetch(url, {
				...(init as object),
				headers: Object.fromEntries(headers.entries()),
			} as Parameters<typeof expoFetch>[1]) as unknown as Response;
		};

		let res = await attempt(false);
		if (res.status === 401) res = await attempt(true);
		return res;
	};
}

/** JSON helper for the REST endpoints (conversations, notes, folders, tags). */
export async function apiJson<T>(
	getToken: GetToken,
	path: string,
	init?: { method?: string; body?: unknown },
	options?: ApiRequestOptions
): Promise<T> {
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const attempt = async (fresh: boolean): Promise<Response> => {
		const token = await getToken(fresh ? { fresh: true } : undefined);
		return fetchWithTimeout(
			`${API_URL}${path}`,
			{
				method: init?.method ?? "GET",
				headers: {
					"Content-Type": "application/json",
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
			},
			timeoutMs,
			(u, i) => fetch(u, i)
		);
	};

	let res = await attempt(false);
	if (res.status === 401) res = await attempt(true);

	if (!res.ok) {
		let message = `Request failed: ${res.status}`;
		try {
			const data = (await res.json()) as { error?: string };
			if (data?.error) message = data.error;
		} catch {
			// keep default message
		}
		throw new ApiError(message, { status: res.status });
	}
	return (await res.json()) as T;
}
