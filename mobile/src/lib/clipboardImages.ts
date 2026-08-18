import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export interface ClipboardImageFile {
	uri: string;
	fileName?: string;
	fileSize?: number;
	type?: string;
}

interface SureWordClipboardNativeModule {
	getImageFilesAsync(): Promise<ClipboardImageFile[]>;
}

const androidClipboard = Platform.OS === "android"
	? requireOptionalNativeModule<SureWordClipboardNativeModule>("SureWordClipboard")
	: null;

export async function getAndroidClipboardImages(): Promise<ClipboardImageFile[] | null> {
	if (!androidClipboard) return null;
	return androidClipboard.getImageFilesAsync();
}
