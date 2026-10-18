import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_URL, type GetToken } from "@/lib/api";
import type { ChurchEvent } from "./sermonApi";

/**
 * "Other calendar" on Android: fetch the event's .ics from the server (the
 * same file Apple Calendar opens on web) and hand it to the system sheet, so
 * Samsung Calendar, Outlook or whatever the reader uses can import it. Google
 * Calendar has its own button and needs none of this.
 *
 * Saved under the event id in the cache, so a second tap reuses the file and
 * the OS may clear it whenever it likes.
 */

function calendarDirectory(): Directory {
	const directory = new Directory(Paths.cache, "church-events");
	if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
	return directory;
}

export async function shareEventFile(getToken: GetToken, event: ChurchEvent): Promise<void> {
	if (!(await Sharing.isAvailableAsync())) {
		throw new Error("Sharing isn't available on this device.");
	}
	const token = await getToken();
	if (!token) throw new Error("Sign in again to add this event.");
	const safeId = event.id.replace(/[^A-Za-z0-9_-]/g, "");
	const target = new File(calendarDirectory(), `${safeId || "event"}.ics`);
	let file: File;
	try {
		file = await File.downloadFileAsync(`${API_URL}${event.icsPath}`, target, {
			headers: { Authorization: `Bearer ${token}` },
			idempotent: true,
		});
	} catch {
		// Also what a changed or finished event looks like, so refreshing is
		// the advice that fits both.
		throw new Error("The calendar file didn't load. Refresh this page and try again.");
	}
	await Sharing.shareAsync(file.uri, {
		mimeType: "text/calendar",
		UTI: "com.apple.ical.ics",
		dialogTitle: `Add ${event.title} to your calendar`,
	});
}
