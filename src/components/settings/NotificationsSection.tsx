"use client";

import React, { useEffect, useState } from "react";
import { Bell, MessageSquare } from "lucide-react";
import {
	checkWebPushAvailability,
	notificationPermission,
	requestWebNotificationPermission,
	setWebChatRepliesEnabled,
	setWebVerseOfDayEnabled,
	setWebVerseOfDayHour,
	syncWebPushRegistration,
	useWebNotificationSettings,
	type WebPushAvailability,
} from "@/lib/web-notifications";
import { formatNotifyHour, stepHour } from "@/lib/web-notification-rules";

const CARD_CLASS = "glass-card gradient-border rounded-2xl p-4 flex flex-col gap-3";
const LABEL_CLASS = "text-metadata font-bold tracking-[0.15em] text-neutral-500 dark:text-neutral-500 px-1";
const ICON_CLASS =
	"flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.1] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400";
const STEP_CLASS =
	"flex h-11 w-11 items-center justify-center rounded-lg border border-black/[0.1] dark:border-white/[0.12] bg-white/60 dark:bg-white/[0.03] text-base font-bold text-neutral-600 dark:text-neutral-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] disabled:opacity-50";

function Switch({
	checked,
	label,
	disabled,
	onChange,
}: {
	checked: boolean;
	label: string;
	disabled: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
				checked ? "bg-amber-500 dark:bg-amber-400" : "bg-black/[0.15] dark:bg-white/[0.15]"
			}`}
		>
			<span
				className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
					checked ? "translate-x-[22px]" : "translate-x-0.5"
				}`}
			/>
		</button>
	);
}

/**
 * Settings -> NOTIFICATIONS: the web side of Android's Notifications screen
 * (mobile/app/(app)/settings/notifications.tsx). Same two streams and copy:
 * "your answer is ready" and the morning verse with its hour. Switching a
 * stream on asks the browser for permission inside the click; blocked and
 * unsupported browsers, and deploys without VAPID keys, say so instead of
 * offering switches that cannot work.
 */
const NotificationsSection: React.FC = () => {
	const settings = useWebNotificationSettings();
	const [availability, setAvailability] = useState<WebPushAvailability>({ status: "checking" });
	const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

	useEffect(() => {
		let cancelled = false;
		const refreshPermission = () => setPermission(notificationPermission());
		refreshPermission();
		void checkWebPushAvailability().then((next) => {
			if (cancelled) return;
			setAvailability(next);
			// Each visit refreshes the registration the morning cron reads.
			if (next.status === "ready" && notificationPermission() === "granted") {
				void syncWebPushRegistration();
			}
		});
		// The user can change the site permission in browser settings and come back.
		window.addEventListener("focus", refreshPermission);
		document.addEventListener("visibilitychange", refreshPermission);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", refreshPermission);
			document.removeEventListener("visibilitychange", refreshPermission);
		};
	}, []);

	const ready = availability.status === "ready";
	const controlsDisabled = !ready;
	// The permission dialog resolves after the click; read the outcome then.
	const afterToggle = (settled: Promise<unknown>) => {
		void settled.finally(() => setPermission(notificationPermission()));
	};

	const wantsAny = settings.enabled || settings.chatReplies;
	let notice: string | null = null;
	if (availability.status === "unsupported") {
		notice =
			"This browser can't show notifications. On iPhone or iPad, add SureWord to your Home Screen first, or use the Android app.";
	} else if (availability.status === "unavailable") {
		notice = "Notifications aren't available on this site right now.";
	} else if (ready && permission === "denied" && wantsAny) {
		notice =
			"Notifications are blocked for SureWord in this browser. Allow them in your browser's site settings, then come back.";
	}

	return (
		<section id="notifications" className="flex flex-col gap-2 scroll-mt-20 lg:scroll-mt-6">
			<h2 className={LABEL_CLASS}>CHAT</h2>
			<div className={CARD_CLASS}>
				<div className="flex items-center gap-3">
					<span className={ICON_CLASS}>
						<MessageSquare className="w-5 h-5" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
							Notify when an answer is ready
						</p>
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							Leave the app while SureWord is answering and it keeps working. This tells you when
							the answer has landed.
						</p>
					</div>
					<Switch
						checked={settings.chatReplies}
						label="Notify when an answer is ready"
						disabled={controlsDisabled}
						onChange={(next) => {
							afterToggle(setWebChatRepliesEnabled(next));
						}}
					/>
				</div>
			</div>

			<h2 className={`${LABEL_CLASS} mt-4`}>VERSE OF THE DAY</h2>
			<div className={CARD_CLASS}>
				<div className="flex items-center gap-3">
					<span className={ICON_CLASS}>
						<Bell className="w-5 h-5" />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
							Daily verse notification
						</p>
						<p className="text-[13px] text-neutral-400 dark:text-neutral-500">
							An AI-picked verse each morning, shaped by what you&apos;ve been reading and asking
							about.
						</p>
					</div>
					<Switch
						checked={settings.enabled}
						label="Daily verse notification"
						disabled={controlsDisabled}
						onChange={(next) => {
							afterToggle(setWebVerseOfDayEnabled(next));
						}}
					/>
				</div>
				{settings.enabled ? (
					<div className="flex items-center justify-between gap-3 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
						<p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">Arrives at</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								aria-label="One hour earlier"
								disabled={controlsDisabled}
								onClick={() => setWebVerseOfDayHour(stepHour(settings.hour, -1))}
								className={STEP_CLASS}
							>
								&minus;
							</button>
							<span
								aria-live="polite"
								className="min-w-[72px] text-center text-sm font-semibold text-neutral-900 dark:text-neutral-100"
							>
								{formatNotifyHour(settings.hour)}
							</span>
							<button
								type="button"
								aria-label="One hour later"
								disabled={controlsDisabled}
								onClick={() => setWebVerseOfDayHour(stepHour(settings.hour, 1))}
								className={STEP_CLASS}
							>
								+
							</button>
						</div>
					</div>
				) : null}
			</div>

			{notice ? (
				<p role="status" className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
					{notice}
				</p>
			) : null}
			{ready && permission === "default" && wantsAny ? (
				<div className="flex items-center justify-between gap-3 px-1">
					<p className="text-xs text-neutral-500 dark:text-neutral-400">
						This browser hasn&apos;t been allowed to show notifications yet.
					</p>
					<button
						type="button"
						onClick={() => {
							void requestWebNotificationPermission("settings-enabled").then(setPermission);
						}}
						className="flex-shrink-0 text-xs font-bold text-amber-600 dark:text-amber-400"
					>
						Allow
					</button>
				</div>
			) : null}
		</section>
	);
};

export default NotificationsSection;
