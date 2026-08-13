const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

function pastedImageExtension(uri: string): string {
	const path = uri.split(/[?#]/, 1)[0];
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_MEDIA_TYPE_BY_EXTENSION[extension] ? extension : "png";
}

export function pastedImageMediaType(uri: string): string {
	return IMAGE_MEDIA_TYPE_BY_EXTENSION[pastedImageExtension(uri)];
}

export function pastedImageFilename(
	uri: string,
	index: number,
	timestamp = Date.now(),
): string {
	const suffix = index === 0 ? "" : `-${index + 1}`;
	return `clipboard-${timestamp}${suffix}.${pastedImageExtension(uri)}`;
}
