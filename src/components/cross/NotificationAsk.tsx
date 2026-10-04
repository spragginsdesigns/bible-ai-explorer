"use client";

import React, { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import {
	checkWebPushAvailability,
	dismissPermissionAsk,
	notificationPermission,
	requestWebNotificationPermission,
	syncWebPushRegistration,
	wouldAskForPermission,
} from "@/lib/web-notifications";

/**
 * The web form of Android's Cross-visit permission moment
 * (mobile/app/(app)/bible/cross.tsx signals "cross-visit"): the first visit to
 * Pick Up Your Cross is when a morning notification explains itself. Browsers
 * only honour a permission request made inside a click, so instead of opening
 * the dialog unprompted this offers it once per browser, under the same rules
 * (shouldRequestWebPermission). "Not now" uses up the once.
 *
 * A browser that already granted just refreshes its registration here.
 */
const NotificationAsk: React.FC = () => {
	const [visible, setVisible] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void checkWebPushAvailability().then((availability) => {
			if (cancelled || availability.status !== "ready") return;
			if (notificationPermission() === "granted") {
				void syncWebPushRegistration();
				return;
			}
			setVisible(wouldAskForPermission("cross-visit"));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!visible) return null;

	return (
		<div className="glass-card gradient-border my-4 flex flex-col gap-3 rounded-2xl p-4">
			<div className="flex items-center gap-3">
				<span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-amber-600 dark:text-amber-400">
					<Bell className="w-5 h-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
						Get tomorrow&apos;s word as a notification
					</p>
					<p className="text-[13px] text-neutral-500 dark:text-neutral-400">
						An AI-picked verse each morning, shaped by what you&apos;ve been reading and asking about.
					</p>
				</div>
			</div>
			<div className="flex gap-2">
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						setBusy(true);
						void requestWebNotificationPermission("cross-visit").finally(() => {
							setBusy(false);
							setVisible(false);
						});
					}}
					className="min-h-11 flex-1 rounded-lg border border-amber-500/40 dark:border-amber-400/30 bg-amber-500/10 dark:bg-amber-400/10 text-support font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors disabled:opacity-50"
				>
					Turn on notifications
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						dismissPermissionAsk();
						setVisible(false);
					}}
					className="min-h-11 flex-1 rounded-lg border border-black/[0.08] dark:border-white/[0.08] text-support font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
				>
					Not now
				</button>
			</div>
		</div>
	);
};

export default NotificationAsk;
