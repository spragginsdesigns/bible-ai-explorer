import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ImageManipulatorContext, ImageRef } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

/**
 * Longest edge we upload. A modern phone camera hands back 4000px+ frames that
 * cost seconds of upload for detail no vision model reads; 2048 still keeps the
 * text in a screenshot legible.
 */
export const MAX_UPLOAD_IMAGE_EDGE = 2048;

/** JPEG quality for a re-encoded upload. Visually lossless at this scale. */
const UPLOAD_JPEG_COMPRESS = 0.85;

export interface ImageDownscaleSource {
	width: number;
	height: number;
}

export interface ImageDownscalePlan {
	/**
	 * Only the longer edge is given. The manipulator derives the other one, so
	 * the aspect ratio survives without us rounding it ourselves.
	 */
	resize: { width: number } | { height: number };
	compress: number;
	format: "jpeg";
}

/**
 * Decide what an asset needs before upload, or `null` when it needs nothing.
 *
 * Pure and synchronous so the rule is testable without the native module.
 */
export function planImageDownscale(
	source: ImageDownscaleSource,
	maxEdge: number = MAX_UPLOAD_IMAGE_EDGE,
): ImageDownscalePlan | null {
	const { width, height } = source;
	// Some Android content providers report no dimensions at all. Guessing would
	// mean re-encoding blind, which can only lose quality, so leave those alone.
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return null;
	}
	// An image already inside the budget ships untouched, PNG included: re-encoding
	// a small screenshot to JPEG trades crisp text for artifacts and saves nothing.
	if (width <= maxEdge && height <= maxEdge) return null;
	return {
		resize: width >= height ? { width: maxEdge } : { height: maxEdge },
		compress: UPLOAD_JPEG_COMPRESS,
		format: "jpeg",
	};
}

/**
 * The uploader validates that a filename's extension matches its media type, so
 * a re-encoded `screenshot.png` has to arrive as `screenshot.jpg` or the whole
 * attachment is rejected as unsupported.
 */
export function jpegFileName(original: string | null | undefined): string {
	const base = (original ?? "").trim();
	if (!base) return `photo-${Date.now()}.jpg`;
	const dot = base.lastIndexOf(".");
	return `${dot > 0 ? base.slice(0, dot) : base}.jpg`;
}

/**
 * Resize an oversized picker asset down to {@link MAX_UPLOAD_IMAGE_EDGE} and
 * re-encode it as JPEG. Returns the asset unchanged when no work is needed, and
 * also when the manipulation fails: a slow upload beats a send that cannot happen.
 */
export async function downscaleImageForUpload(
	asset: ImagePickerAsset,
): Promise<ImagePickerAsset> {
	const plan = planImageDownscale({ width: asset.width, height: asset.height });
	if (!plan) return asset;

	let context: ImageManipulatorContext | null = null;
	let rendered: ImageRef | null = null;
	try {
		context = ImageManipulator.manipulate(asset.uri);
		context.resize(plan.resize);
		rendered = await context.renderAsync();
		const saved = await rendered.saveAsync({
			compress: plan.compress,
			format: SaveFormat.JPEG,
		});
		return {
			...asset,
			uri: saved.uri,
			width: saved.width,
			height: saved.height,
			mimeType: "image/jpeg",
			fileName: jpegFileName(asset.fileName),
			// Dropped on purpose: the byte count belongs to the original file, and
			// the attachment normalizer measures the new one off disk instead.
			fileSize: undefined,
		};
	} catch {
		return asset;
	} finally {
		// Both hold a decoded camera-sized bitmap natively. The GC would free them
		// eventually, but a burst of five picks should not wait for it.
		rendered?.release();
		context?.release();
	}
}
