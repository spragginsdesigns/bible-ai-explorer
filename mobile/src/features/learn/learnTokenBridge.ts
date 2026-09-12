import type { GetToken } from "@/lib/api";

type ClerkGetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

/** Keeps the sync store stable when Clerk refreshes its hook callback. */
export class LearnTokenBridge {
	private current: ClerkGetToken;

	constructor(getToken: ClerkGetToken) {
		this.current = getToken;
	}

	readonly getToken: GetToken = (options) =>
		this.current(options?.fresh ? { skipCache: true } : undefined);

	update(getToken: ClerkGetToken): void {
		this.current = getToken;
	}
}
