import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImagePickerAsset } from "expo-image-picker";

// The module reaches for the native manipulator at import time; the planning
// rules under test never touch it.
const manipulator = vi.hoisted(() => {
	const rendered = {
		saveAsync: vi.fn(async () => ({ uri: "file:///cache/out.jpg", width: 2048, height: 1536 })),
		release: vi.fn(),
	};
	const context = {
		resize: vi.fn(),
		renderAsync: vi.fn(async () => rendered),
		release: vi.fn(),
	};
	return { rendered, context, manipulate: vi.fn(() => context) };
});

vi.mock("expo-image-manipulator", () => ({
	ImageManipulator: { manipulate: manipulator.manipulate },
	SaveFormat: { JPEG: "jpeg" },
}));

const { downscaleImageForUpload, jpegFileName, planImageDownscale } = await import("./imageDownscale");

function pickerAsset(overrides: Partial<ImagePickerAsset> = {}): ImagePickerAsset {
	return {
		uri: "file:///cache/in.png",
		width: 4032,
		height: 3024,
		mimeType: "image/png",
		fileName: "Screenshot.png",
		fileSize: 9_000_000,
		...overrides,
	};
}

describe("planImageDownscale", () => {
	it("resizes an oversized landscape photo on its width", () => {
		expect(planImageDownscale({ width: 4032, height: 3024 })).toEqual({
			resize: { width: 2048 },
			compress: 0.85,
			format: "jpeg",
		});
	});

	it("resizes an oversized portrait photo on its height", () => {
		expect(planImageDownscale({ width: 3024, height: 4032 })).toEqual({
			resize: { height: 2048 },
			compress: 0.85,
			format: "jpeg",
		});
	});

	it("leaves a JPEG that is already within budget alone", () => {
		expect(planImageDownscale({ width: 1600, height: 1200 })).toBeNull();
		expect(planImageDownscale({ width: 2048, height: 2048 })).toBeNull();
	});

	it("leaves a PNG that is already within budget alone", () => {
		expect(planImageDownscale({ width: 1080, height: 1920 })).toBeNull();
	});

	it("resizes an oversized PNG screenshot and re-encodes it as JPEG", () => {
		expect(planImageDownscale({ width: 1440, height: 3200 })).toEqual({
			resize: { height: 2048 },
			compress: 0.85,
			format: "jpeg",
		});
	});

	it("honours a caller-supplied max edge", () => {
		expect(planImageDownscale({ width: 1600, height: 1200 }, 1024)).toEqual({
			resize: { width: 1024 },
			compress: 0.85,
			format: "jpeg",
		});
	});

	it("skips assets whose dimensions the picker could not report", () => {
		expect(planImageDownscale({ width: 0, height: 0 })).toBeNull();
		expect(planImageDownscale({ width: Number.NaN, height: 4000 })).toBeNull();
	});
});

describe("jpegFileName", () => {
	it("swaps the extension so the uploader accepts the re-encoded file", () => {
		expect(jpegFileName("Screenshot_2026.png")).toBe("Screenshot_2026.jpg");
		expect(jpegFileName("holiday.photo.HEIC")).toBe("holiday.photo.jpg");
		expect(jpegFileName("no-extension")).toBe("no-extension.jpg");
	});

	it("falls back to a generated name when the picker gave none", () => {
		expect(jpegFileName(null)).toMatch(/^photo-\d+\.jpg$/);
		expect(jpegFileName("   ")).toMatch(/^photo-\d+\.jpg$/);
	});
});

describe("downscaleImageForUpload", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		manipulator.context.renderAsync.mockImplementation(async () => manipulator.rendered);
	});

	it("returns an in-bounds asset untouched without touching the manipulator", async () => {
		const asset = pickerAsset({ width: 1080, height: 1920 });
		await expect(downscaleImageForUpload(asset)).resolves.toBe(asset);
		expect(manipulator.manipulate).not.toHaveBeenCalled();
	});

	it("resizes, re-encodes as JPEG, renames, drops the stale byte count and releases both natives", async () => {
		const result = await downscaleImageForUpload(pickerAsset());

		expect(manipulator.manipulate).toHaveBeenCalledWith("file:///cache/in.png");
		expect(manipulator.context.resize).toHaveBeenCalledWith({ width: 2048 });
		expect(manipulator.rendered.saveAsync).toHaveBeenCalledWith({ compress: 0.85, format: "jpeg" });
		expect(result).toMatchObject({
			uri: "file:///cache/out.jpg",
			width: 2048,
			height: 1536,
			mimeType: "image/jpeg",
			fileName: "Screenshot.jpg",
			fileSize: undefined,
		});
		expect(manipulator.rendered.release).toHaveBeenCalledTimes(1);
		expect(manipulator.context.release).toHaveBeenCalledTimes(1);
	});

	it("falls back to the original asset when the native step fails, still releasing the context", async () => {
		manipulator.context.renderAsync.mockRejectedValueOnce(new Error("decode failed"));
		const asset = pickerAsset();
		await expect(downscaleImageForUpload(asset)).resolves.toBe(asset);
		expect(manipulator.context.release).toHaveBeenCalledTimes(1);
		expect(manipulator.rendered.release).not.toHaveBeenCalled();
	});
});
