import { describe, expect, it } from "vitest";
import {
	pastedImageFilename,
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
});
