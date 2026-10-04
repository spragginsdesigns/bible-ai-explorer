import assert from "node:assert/strict";
import test from "node:test";

import {
	MAX_UPLOAD_IMAGE_EDGE,
	UPLOAD_JPEG_QUALITY,
	planImageDownscale,
	renameForType,
} from "../src/lib/chat/imageDownscale.ts";

test("image downscale: an image inside the budget ships untouched", () => {
	assert.equal(planImageDownscale({ width: 2048, height: 1536, mediaType: "image/jpeg" }), null);
	assert.equal(planImageDownscale({ width: 1080, height: 1920, mediaType: "image/png" }), null);
});

test("image downscale: the long edge lands on 2048 and the aspect ratio survives", () => {
	const landscape = planImageDownscale({ width: 4032, height: 3024, mediaType: "image/jpeg" });
	assert.deepEqual(landscape, {
		width: MAX_UPLOAD_IMAGE_EDGE,
		height: 1536,
		format: "jpeg",
		quality: UPLOAD_JPEG_QUALITY,
		checkAlpha: false,
	});
	const portrait = planImageDownscale({ width: 3024, height: 4032, mediaType: "image/jpeg" });
	assert.equal(portrait?.width, 1536);
	assert.equal(portrait?.height, MAX_UPLOAD_IMAGE_EDGE);
});

test("image downscale: PNG and WebP are checked for transparency, JPEG is not", () => {
	assert.equal(planImageDownscale({ width: 5000, height: 3000, mediaType: "image/png" })?.checkAlpha, true);
	assert.equal(planImageDownscale({ width: 5000, height: 3000, mediaType: "image/webp" })?.checkAlpha, true);
	assert.equal(planImageDownscale({ width: 5000, height: 3000, mediaType: "image/jpeg" })?.checkAlpha, false);
});

test("image downscale: GIFs, non-raster types and unknown sizes are left alone", () => {
	assert.equal(planImageDownscale({ width: 5000, height: 5000, mediaType: "image/gif" }), null);
	assert.equal(planImageDownscale({ width: 5000, height: 5000, mediaType: "image/svg+xml" }), null);
	assert.equal(planImageDownscale({ width: 5000, height: 5000, mediaType: "application/pdf" }), null);
	assert.equal(planImageDownscale({ width: 0, height: 5000, mediaType: "image/jpeg" }), null);
	assert.equal(planImageDownscale({ width: Number.NaN, height: 5000, mediaType: "image/jpeg" }), null);
});

test("image downscale: re-encoded files get an extension that matches their type", () => {
	assert.equal(renameForType("screenshot.png", "jpeg"), "screenshot.jpg");
	assert.equal(renameForType("IMG_0001.HEIC.jpeg", "jpeg"), "IMG_0001.HEIC.jpg");
	assert.equal(renameForType("diagram.webp", "png"), "diagram.png");
	assert.equal(renameForType("noextension", "jpeg"), "noextension.jpg");
	assert.match(renameForType("  ", "jpeg"), /^image-\d+\.jpg$/);
});
