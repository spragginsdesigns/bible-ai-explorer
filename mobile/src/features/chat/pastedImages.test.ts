import { describe, expect, it } from "vitest";
import {
	pastedImageFilename,
	pastedImageMetadata,
	pastedImageMediaType,
} from "./pastedImages";

describe("Gboard pasted image metadata", () => {
	it.each([
		["file:///cache/gboard.png", "image/png", "clipboard-1720000000000.png"],
		["file:///cache/photo.JPG", "image/jpeg", "clipboard-1720000000000.jpg"],
		["file:///cache/sticker.webp", "image/webp", "clipboard-1720000000000.webp"],
		["file:///cache/animation.gif", "image/gif", "clipboard-1720000000000.gif"],
	])("normalizes %s for the attachment validator", (uri, mediaType, filename) => {
		expect(pastedImageMediaType(uri)).toBe(mediaType);
		expect(pastedImageFilename(uri, 0, 1720000000000)).toBe(filename);
	});

	it("gives extensionless native cache files a supported PNG fallback", () => {
		const uri = "file:///cache/keyboard-content";
		expect(pastedImageMediaType(uri)).toBe("image/png");
		expect(pastedImageFilename(uri, 1, 1720000000000)).toBe(
			"clipboard-1720000000000-2.png",
		);
	});

	it("uses the native MIME type instead of guessing from a content URI", () => {
		expect(pastedImageMetadata({
			uri: "content://com.google.android.inputmethod.latin/clipboard/42",
			fileName: "42",
			fileSize: 4096,
			type: "image/jpeg",
		}, 0, 1720000000000)).toEqual({
			uri: "content://com.google.android.inputmethod.latin/clipboard/42",
			filename: "clipboard-1720000000000.jpg",
			mediaType: "image/jpeg",
			size: 4096,
		});
	});

	it("normalizes Android's image/jpg alias", () => {
		expect(pastedImageMetadata({
			uri: "file:///cache/gboard-image",
			type: "image/jpg",
		}, 1, 1720000000000)).toMatchObject({
			filename: "clipboard-1720000000000-2.jpg",
			mediaType: "image/jpeg",
		});
	});
});
