/**
 * Shrink oversized photos before they are uploaded as chat attachments.
 *
 * Web port of mobile/src/features/chat/imageDownscale.ts: same 2048px long
 * edge, same JPEG quality, same "leave it alone when in doubt" rule. It runs
 * before the 10MB size check, so a 14MB phone photo dropped on the composer is
 * attached instead of rejected.
 *
 * The plan and the filename helper are pure so tests can import them; the
 * canvas half only runs in a browser.
 */

/**
 * Longest edge we upload. A modern phone camera hands back 4000px+ frames that
 * cost seconds of upload for detail no vision model reads; 2048 still keeps the
 * text in a screenshot legible.
 */
export const MAX_UPLOAD_IMAGE_EDGE = 2048;

/** JPEG quality for a re-encoded upload. Visually lossless at this scale. */
export const UPLOAD_JPEG_QUALITY = 0.85;

/**
 * Raster types a canvas can decode and re-encode. GIF is left out on purpose:
 * drawing it to a canvas keeps only the first frame. SVG and everything else
 * are not photos and ship untouched.
 */
const DOWNSCALABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Types that can carry transparency, so a flattening JPEG could ruin them. */
const ALPHA_CAPABLE_TYPES = new Set(["image/png", "image/webp"]);

export interface ImageDownscalePlan {
	width: number;
	height: number;
	/**
	 * "jpeg" for photos. An alpha-capable source is re-checked after decoding:
	 * if it really has transparent pixels it is kept as PNG instead, since a
	 * JPEG would paint the transparent area black.
	 */
	format: "jpeg";
	quality: number;
	/** True when the source type could hold transparency worth checking for. */
	checkAlpha: boolean;
}

/**
 * Decide what an image needs before upload, or `null` when it needs nothing.
 * An image already inside the budget ships untouched, PNG included:
 * re-encoding a small screenshot to JPEG trades crisp text for artifacts and
 * saves nothing.
 */
export function planImageDownscale(
	source: { width: number; height: number; mediaType: string },
	maxEdge: number = MAX_UPLOAD_IMAGE_EDGE,
): ImageDownscalePlan | null {
	const { width, height, mediaType } = source;
	if (!DOWNSCALABLE_TYPES.has(mediaType.toLowerCase())) return null;
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return null;
	}
	if (width <= maxEdge && height <= maxEdge) return null;
	const scale = maxEdge / Math.max(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
		format: "jpeg",
		quality: UPLOAD_JPEG_QUALITY,
		checkAlpha: ALPHA_CAPABLE_TYPES.has(mediaType.toLowerCase()),
	};
}

/**
 * The uploader validates that a filename's extension matches its media type, so
 * a re-encoded `screenshot.png` has to arrive as `screenshot.jpg` or the whole
 * attachment is rejected as unsupported.
 */
export function renameForType(original: string, format: "jpeg" | "png"): string {
	const ext = format === "jpeg" ? "jpg" : "png";
	const base = original.trim();
	if (!base) return `image-${Date.now()}.${ext}`;
	const dot = base.lastIndexOf(".");
	return `${dot > 0 ? base.slice(0, dot) : base}.${ext}`;
}

/** True when any pixel is less than fully opaque. */
function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
	const { data } = context.getImageData(0, 0, width, height);
	for (let index = 3; index < data.length; index += 4) {
		if (data[index] < 255) return true;
	}
	return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize one oversized image to {@link MAX_UPLOAD_IMAGE_EDGE} and re-encode it.
 * Returns the file unchanged when no work is needed, and also when anything
 * fails: a slow upload beats a send that cannot happen.
 */
export async function downscaleImageForUpload(file: File): Promise<File> {
	if (!DOWNSCALABLE_TYPES.has(file.type.toLowerCase())) return file;
	if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

	let bitmap: ImageBitmap | null = null;
	try {
		// "from-image" applies EXIF rotation, so a portrait phone photo is not
		// uploaded sideways once its orientation tag is dropped by the canvas.
		bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		const plan = planImageDownscale({
			width: bitmap.width,
			height: bitmap.height,
			mediaType: file.type,
		});
		if (!plan) return file;

		const canvas = document.createElement("canvas");
		canvas.width = plan.width;
		canvas.height = plan.height;
		const context = canvas.getContext("2d");
		if (!context) return file;
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(bitmap, 0, 0, plan.width, plan.height);

		const keepPng = plan.checkAlpha && hasTransparency(context, plan.width, plan.height);
		const blob = keepPng
			? await canvasToBlob(canvas, "image/png")
			: await canvasToBlob(canvas, "image/jpeg", plan.quality);
		if (!blob) return file;
		const format = keepPng ? "png" : "jpeg";
		return new File([blob], renameForType(file.name, format), {
			type: keepPng ? "image/png" : "image/jpeg",
			lastModified: file.lastModified,
		});
	} catch {
		return file;
	} finally {
		// Holds a decoded camera-sized bitmap; a burst of five picks should not
		// wait for the GC to free each one.
		bitmap?.close();
	}
}

/**
 * Downscale a picked batch. Sequential, not Promise.all: each image decodes a
 * full bitmap, and five camera-sized frames held at once is a lot of memory on
 * a phone browser. Non-images pass straight through.
 */
export async function prepareFilesForUpload(files: readonly File[]): Promise<File[]> {
	const prepared: File[] = [];
	for (const file of files) {
		prepared.push(await downscaleImageForUpload(file));
	}
	return prepared;
}
