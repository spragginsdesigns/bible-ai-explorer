"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { trackNativeDownload } from "@/lib/analytics/client";
import { ANDROID_APK_URL } from "@/lib/constants";
import { detectInstallPlatform, type InstallPlatform } from "@/lib/install-platform";

/**
 * The device this browser runs on, after mount. "other" during SSR and the
 * first render, so server and client markup agree.
 */
export function useInstallPlatform(): InstallPlatform {
	const [platform, setPlatform] = useState<InstallPlatform>("other");
	useEffect(() => {
		const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
		setPlatform(detectInstallPlatform(browser.userAgent, browser.userAgentData?.platform ?? browser.platform, browser.maxTouchPoints));
	}, []);
	return platform;
}

/** Add to Home Screen steps for iPhone and iPad, where the APK cannot install. */
export function IosInstallSteps({ onClose }: { onClose?: () => void }) {
	return (
		<div className="text-left">
			<div className="flex items-start justify-between gap-3">
				<p className="text-control font-semibold text-neutral-900 dark:text-neutral-100">SureWord on iPhone</p>
				{onClose && (
					<button type="button" onClick={onClose} aria-label="Close" className="-m-1 p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200">
						<X className="h-4 w-4" />
					</button>
				)}
			</div>
			<p className="mt-1 text-support text-neutral-600 dark:text-neutral-300">
				The iPhone app is on its way to the App Store. Until then, open sureword.app in Safari, tap Share, then Add to Home Screen. It opens like an app, signed in to the same account.
			</p>
		</div>
	);
}

/**
 * The "get the app" control in the top bars and sidebar. Everywhere but iOS it
 * is the Android APK link it always was; on an iPhone or iPad, where an APK
 * downloads and then does nothing, it shows the Add to Home Screen steps.
 */
export default function GetAppLink({
	className,
	source,
	children,
}: {
	className: string;
	source: string;
	children: ReactNode;
}) {
	const platform = useInstallPlatform();
	const [open, setOpen] = useState(false);

	if (platform !== "ios") {
		return (
			<a
				href={ANDROID_APK_URL}
				onClick={() => trackNativeDownload("android", source)}
				target="_blank"
				rel="noopener noreferrer"
				title="Get the Android app"
				aria-label="Get the Android app"
				className={className}
			>
				{children}
			</a>
		);
	}

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="Add SureWord to your Home Screen"
				aria-label="Add SureWord to your Home Screen"
				className={className}
			>
				{children}
			</button>
			{open && (
				<div
					role="dialog"
					aria-label="SureWord on iPhone"
					className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl border border-black/[0.08] bg-white p-4 shadow-xl dark:border-white/[0.08] dark:bg-neutral-900"
				>
					<IosInstallSteps onClose={() => setOpen(false)} />
				</div>
			)}
		</>
	);
}
