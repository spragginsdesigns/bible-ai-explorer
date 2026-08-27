export const GITHUB_RELEASES_URL =
	"https://api.github.com/repos/spragginsdesigns/bible-ai-explorer/releases?per_page=100";
export const GITHUB_CACHE_SECONDS = 300;

export type NativePlatform = "android" | "macos";

export interface NativeReleaseInfo {
	version: string;
	url: string;
}

export interface NativeReleases {
	android: NativeReleaseInfo;
	macos: NativeReleaseInfo;
}

export interface GitHubReleaseAsset {
	name?: string;
	browser_download_url?: string;
}

export interface GitHubRelease {
	id?: number;
	tag_name?: string;
	draft?: boolean;
	prerelease?: boolean;
	published_at?: string | null;
	created_at?: string | null;
	assets?: GitHubReleaseAsset[];
}

const PLATFORM_TAG_PREFIX: Record<NativePlatform, string> = {
	android: "android-v",
	macos: "macos-v",
};

const PLATFORM_ASSET: Record<NativePlatform, string> = {
	android: "SureWord.apk",
	macos: "SureWord.dmg",
};

export const FALLBACK_NATIVE_RELEASES: NativeReleases = {
	android: {
		version: "Latest",
		url: "https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.apk",
	},
	macos: {
		version: "Latest",
		url: "https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest/download/SureWord.dmg",
	},
};

function releaseTime(release: GitHubRelease): number {
	const value = release.published_at ?? release.created_at;
	if (!value) return 0;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function versionParts(version: string): number[] {
	return version.split(/[.+-]/, 3).map((part) => {
		const value = Number.parseInt(part, 10);
		return Number.isFinite(value) ? value : 0;
	});
}

function compareVersions(left: string, right: string): number {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return left.localeCompare(right);
}

function newestFirst(left: GitHubRelease, right: GitHubRelease): number {
	const timeDifference = releaseTime(right) - releaseTime(left);
	if (timeDifference !== 0) return timeDifference;

	const leftVersion = left.tag_name?.match(/-v(.+)$/)?.[1] ?? "";
	const rightVersion = right.tag_name?.match(/-v(.+)$/)?.[1] ?? "";
	const versionDifference = compareVersions(rightVersion, leftVersion);
	if (versionDifference !== 0) return versionDifference;
	return (right.id ?? 0) - (left.id ?? 0);
}

/** Extract a usable platform release only when its required asset is present. */
export function platformRelease(
	release: GitHubRelease,
	platform: NativePlatform,
): NativeReleaseInfo | null {
	if (release.draft || release.prerelease || !release.tag_name) return null;

	const prefix = PLATFORM_TAG_PREFIX[platform];
	if (!release.tag_name.startsWith(prefix)) return null;

	const asset = release.assets?.find(
		(candidate) =>
			candidate.name === PLATFORM_ASSET[platform] &&
			typeof candidate.browser_download_url === "string" &&
			candidate.browser_download_url.length > 0,
	);
	if (!asset?.browser_download_url) return null;

	return {
		version: release.tag_name.slice(prefix.length),
		url: asset.browser_download_url,
	};
}

/** Select the newest eligible release for one platform from any API ordering. */
export function selectLatestNativeRelease(
	releases: readonly GitHubRelease[],
	platform: NativePlatform,
): NativeReleaseInfo | null {
	return releases
		.filter((release) => platformRelease(release, platform))
		.sort(newestFirst)
		.map((release) => platformRelease(release, platform))
		.find((release): release is NativeReleaseInfo => release !== null) ?? null;
}

/** Build the public response, falling back independently when one platform is absent. */
export function selectNativeReleases(releases: readonly GitHubRelease[]): NativeReleases {
	return {
		android: selectLatestNativeRelease(releases, "android") ?? FALLBACK_NATIVE_RELEASES.android,
		macos: selectLatestNativeRelease(releases, "macos") ?? FALLBACK_NATIVE_RELEASES.macos,
	};
}

/** Read GitHub Releases with Next's five-minute data cache. */
export async function getNativeReleases(): Promise<NativeReleases> {
	const response = await fetch(GITHUB_RELEASES_URL, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "SureWord-native-release-check",
		},
		next: { revalidate: GITHUB_CACHE_SECONDS },
	});
	if (!response.ok) throw new Error(`GitHub releases request failed (${response.status})`);

	const releases: unknown = await response.json();
	if (!Array.isArray(releases)) throw new Error("GitHub releases response was not an array");
	return selectNativeReleases(releases as GitHubRelease[]);
}
