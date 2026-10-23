import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_URL, boundedToken, type GetToken } from "@/lib/api";

/**
 * Share cards on Android: fetching the server's JPEG and handing it to the
 * system sheet (docs/FEATURES.md, "Share cards").
 *
 * React Native's `Share` cannot send a file on Android (its `url` field is
 * iOS-only), which is why expo-sharing is here: it serves the cached JPEG to
 * the receiving app through its own FileProvider.
 *
 * Cards are downloaded into the cache under a name derived from their path,
 * so a style the sheet already previewed is never fetched twice, and the OS
 * may clear them whenever it likes.
 */

function cardDirectory(): Directory {
	const directory = new Directory(Paths.cache, "share-cards");
	if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
	return directory;
}

/** djb2: a short, stable file name for a card path. Not security, just a key. */
function pathKey(path: string): string {
	let hash = 5381;
	for (let index = 0; index < path.length; index += 1) {
		hash = ((hash << 5) + hash + path.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36);
}

/**
 * Download one card. `getToken` is passed only for the personal cards; a
 * public verse card goes out with no session header at all.
 */
export async function downloadCard(
	path: string,
	options: { getToken?: GetToken; fileName?: string; signal?: AbortSignal } = {}
): Promise<File> {
	const directory = cardDirectory();
	const target = new File(directory, options.fileName ?? `card-${pathKey(path)}.jpg`);
	let headers: Record<string, string> | undefined;
	if (options.getToken) {
		const token = await boundedToken(options.getToken, false, path);
		if (!token) throw new Error("Sign in again to share this card.");
		headers = { Authorization: `Bearer ${token}` };
	}
	try {
		return await File.downloadFileAsync(`${API_URL}${path}`, target, {
			headers,
			idempotent: true,
			signal: options.signal,
		});
	} catch (error) {
		if (options.signal?.aborted) throw error;
		// The native error carries the HTTP status in its message; a 422 is the
		// server saying the passage cannot fit, which no retry will change.
		const message = error instanceof Error ? error.message : "";
		if (/\b422\b/.test(message)) {
			throw new Error("This passage is too long for this card size. Try another size, or choose fewer verses.");
		}
		throw new Error("The card didn't load. Check your connection and try again.");
	}
}

/** Open the system share sheet with a downloaded card. */
export async function shareCardImage(file: File, dialogTitle: string): Promise<void> {
	if (!(await Sharing.isAvailableAsync())) {
		throw new Error("Sharing isn't available on this device.");
	}
	await Sharing.shareAsync(file.uri, { mimeType: "image/jpeg", UTI: "public.jpeg", dialogTitle });
}
