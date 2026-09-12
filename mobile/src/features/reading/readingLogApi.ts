import { ApiError, apiJson, type GetToken } from "@/lib/api";
import { withReadingDeadline } from "./readingDeadline";

/** Includes Clerk token refresh and JSON parsing, not just fetch headers. */
export async function fetchReadingHistory<T>(
	getToken: GetToken,
	path: string,
	active: () => boolean
): Promise<T> {
	try {
		return await withReadingDeadline(async (live) => {
			const guardedToken: GetToken = async (options) => {
				if (!live() || !active())
					throw new Error("Reading history request expired");
				const token = await getToken(options);
				if (!live() || !active())
					throw new Error("Reading history request expired");
				return token;
			};
			return apiJson<T>(guardedToken, path, undefined, { timeoutMs: 15_000 });
		});
	} catch (error) {
		if ((error as { isTimeout?: boolean })?.isTimeout)
			throw new ApiError(
				"Reading history could not be loaded. Check your connection and try again.",
				{ isTimeout: true }
			);
		throw error;
	}
}
