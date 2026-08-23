import {
	createDownload,
	type Experimental_DownloadFunction,
	type UIMessage,
	type UIMessageStreamWriter,
} from "ai";
import type { SureWordUIMessage } from "@/lib/ai-tools";

const download = createDownload();

export type StatusWriter = (label: string) => void;

/**
 * Every status write reuses one part id, so the client reconciles them into a
 * single line that updates in place instead of a growing list.
 */
export function createStatusWriter(
	writer: UIMessageStreamWriter<SureWordUIMessage>
): StatusWriter {
	return (label) => writer.write({ type: "data-status", id: "status", data: { label } });
}

/**
 * The SDK's default downloader, wrapped so the pause while a model pulls an
 * attachment is narrated with the file's own name.
 */
export function createNarratedDownload(options: {
	writeStatus: StatusWriter;
	messages: SureWordUIMessage[];
}): Experimental_DownloadFunction {
	const filenamesByUrl = new Map<string, string>();
	for (const message of options.messages) {
		for (const part of message.parts) {
			if (part.type === "file" && part.filename) filenamesByUrl.set(part.url, part.filename);
		}
	}

	return async (requested) => {
		const pending = requested.filter((item) => !item.isUrlSupportedByModel);
		if (pending.length === 0) return requested.map(() => null);

		const filename = pending
			.map((item) => filenamesByUrl.get(item.url.toString()))
			.find((name): name is string => Boolean(name));
		options.writeStatus(filename ? `Reading ${filename}` : "Reading your document");

		const downloaded = await Promise.all(
			requested.map(async (item) => (item.isUrlSupportedByModel ? null : download(item)))
		);
		options.writeStatus("Thinking");
		return downloaded;
	};
}

/**
 * Status parts narrate the wait and must not outlive the stream: replaying a
 * stored one would show a finished answer as though it were still working.
 */
export function persistableParts<PART extends { type: string }>(parts: PART[]): PART[] {
	return parts.filter((part) => !part.type.startsWith("data-"));
}

/**
 * A run that failed before the model wrote anything still reaches the
 * persistence callback, carrying nothing but the status part. Storing that
 * would leave a blank assistant turn in the user's history.
 */
export function hasPersistableContent(message: UIMessage): boolean {
	return message.parts.some((part) => {
		if (part.type === "text") return part.text.trim().length > 0;
		return part.type.startsWith("tool-") || part.type === "dynamic-tool";
	});
}
