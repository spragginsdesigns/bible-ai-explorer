import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/** A bounded copy's outcome: the cached file, or how far it got past the cap. */
export type SharedFileCopy =
	| { tooLarge: false; uri: string; size: number }
	| { tooLarge: true; size: number };

interface SureWordShareNativeModule {
	copySharedFileAsync(uri: string, maxBytes: number): Promise<SharedFileCopy>;
}

const androidShare = Platform.OS === "android"
	? requireOptionalNativeModule<SureWordShareNativeModule>("SureWordShare")
	: null;

/**
 * Copies a shared content:// file into the cache, stopping at the first byte
 * past maxBytes (modules/sureword-share). null when the native module is not
 * in this build.
 */
export async function copySharedFileBounded(uri: string, maxBytes: number): Promise<SharedFileCopy | null> {
	if (!androidShare) return null;
	return androidShare.copySharedFileAsync(uri, maxBytes);
}
