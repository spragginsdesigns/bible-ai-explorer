"use client";

import React from "react";
import type { ChurchApp, ChurchEventView } from "@/lib/church-events-rules";
import { AppleLogo, GoogleCalendarLogo } from "./CalendarLogos";

/**
 * Gatherings announced from the pulpit, each with Add to Google Calendar and
 * Apple Calendar. Renders nothing when there are none, so a church with no
 * announcements (or no ingest) shows no empty card.
 *
 * A time the recording left unclear is never dressed up as certain: it says
 * so and sends the reader to the church's own app, which has the real time.
 * Android mirror: `mobile/src/features/sermons/ChurchEventsCard.tsx`.
 */
export function ChurchEventsCard({
	events,
	churchApp,
	title,
	eyebrow,
}: {
	events: ChurchEventView[];
	churchApp: ChurchApp | null;
	title: string;
	eyebrow: string;
}) {
	if (events.length === 0) return null;
	return (
		<section
			aria-label={title}
			className="mb-8 rounded-2xl border border-black/[0.08] bg-black/[0.03] p-4 sm:p-5 dark:border-white/[0.06] dark:bg-white/[0.03]"
		>
			<p className="text-metadata font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
				{eyebrow}
			</p>
			<h2 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
			<ul className="mt-4 divide-y divide-black/[0.08] dark:divide-white/[0.06]">
				{events.map((event) => (
					<li key={event.id} className="py-4 first:pt-0 last:pb-0">
						<EventRow event={event} churchApp={churchApp} />
					</li>
				))}
			</ul>
		</section>
	);
}

function EventRow({ event, churchApp }: { event: ChurchEventView; churchApp: ChurchApp | null }) {
	const meta = [event.location, event.audience ? `For ${event.audience}` : null].filter(Boolean);
	return (
		<div>
			<p className="font-semibold text-neutral-900 dark:text-neutral-50">{event.title}</p>
			<p className="mt-0.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
				{event.when}
				{!event.certain && (
					<span className="ml-2 rounded-full border border-amber-600/30 px-1.5 py-0.5 text-metadata font-bold uppercase tracking-[0.06em] dark:border-amber-400/30">
						Time not confirmed
					</span>
				)}
			</p>
			{meta.length > 0 && (
				<p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{meta.join(" · ")}</p>
			)}
			{event.details && (
				<p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{event.details}</p>
			)}
			<blockquote className="mt-2 border-l-2 border-amber-500/60 pl-3 text-sm italic text-neutral-600 dark:text-neutral-300">
				&ldquo;{event.sourceQuote}&rdquo;{" "}
				<a
					href={event.sourceUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="not-italic font-semibold text-amber-600 hover:underline dark:text-amber-400"
				>
					Hear the announcement
				</a>
			</blockquote>

			{!event.certain && (
				<p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200">
					The time was not clear in the recording.{" "}
					{churchApp ? (
						<>
							Check the {churchApp.name} app for the exact time:{" "}
							<a
								href={churchApp.androidUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="font-semibold text-amber-700 hover:underline dark:text-amber-400"
							>
								Google Play
							</a>{" "}
							or{" "}
							<a
								href={churchApp.iosUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="font-semibold text-amber-700 hover:underline dark:text-amber-400"
							>
								App Store
							</a>
							.
						</>
					) : (
						"Check with the church for the exact time."
					)}
				</p>
			)}

			<div className="mt-3 flex flex-wrap gap-2">
				<a
					href={event.googleCalendarUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Add ${event.title} to Google Calendar`}
					className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-black/[0.1] bg-white px-3.5 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 dark:border-white/[0.1] dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
				>
					<GoogleCalendarLogo className="h-[18px] w-[18px]" />
					Google Calendar
				</a>
				<a
					href={event.icsPath}
					aria-label={`Add ${event.title} to Apple Calendar`}
					className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-black/[0.1] bg-white px-3.5 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 dark:border-white/[0.1] dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
				>
					<AppleLogo className="h-[17px] w-[17px] -mt-0.5" />
					Apple Calendar
				</a>
			</div>
		</div>
	);
}
