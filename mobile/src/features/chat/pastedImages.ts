const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

const IMAGE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
};

export interface PastedImageFile {
	uri: string;
	fileName?: string;
	fileSize?: number;
	type?: string;
}

function pastedImageExtension(uri: string): string {
	const path = uri.split(/[?#]/, 1)[0];
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_MEDIA_TYPE_BY_EXTENSION[extension] ? extension : "png";
}

export function pastedImageMediaType(uri: string): string {
	return IMAGE_MEDIA_TYPE_BY_EXTENSION[pastedImageExtension(uri)];
}

export function pastedImageMetadata(
	file: PastedImageFile,
	index: number,
	timestamp = Date.now(),
): { uri: string; filename: string; mediaType: string; size?: number } {
	const declaredType = file.type?.toLowerCase().split(";", 1)[0].trim();
	const mediaType = declaredType && IMAGE_EXTENSION_BY_MEDIA_TYPE[declaredType]
		? declaredType === "image/jpg" ? "image/jpeg" : declaredType
		: pastedImageMediaType(file.fileName ?? file.uri);
	const extension = IMAGE_EXTENSION_BY_MEDIA_TYPE[mediaType];
	const suffix = index === 0 ? "" : `-${index + 1}`;
	return {
		uri: file.uri,
		filename: `clipboard-${timestamp}${suffix}.${extension}`,
		mediaType,
		size: Number.isSafeInteger(file.fileSize) && (file.fileSize ?? 0) > 0
			? file.fileSize
			: undefined,
	};
}

export function pastedImageFilename(
	uri: string,
	index: number,
	timestamp = Date.now(),
): string {
	const suffix = index === 0 ? "" : `-${index + 1}`;
	return `clipboard-${timestamp}${suffix}.${pastedImageExtension(uri)}`;
}
