import { useEffect, useRef } from "react";
import { useSegments } from "expo-router";

import { ANALYTICS_EVENTS, track } from "@/lib/analytics";

/**
 * Send `screen_viewed` when the route changes.
 *
 * This exists because the SDK's own screen autocapture measured nothing. It
 * hooks a React Navigation container, expo-router owns its container below
 * `PostHogProvider`, and the result was exactly zero screen events across the
 * first two days of measurement while the app had 32 screens. Web gets page
 * views for free from the browser SDK; Android had the catalog entry for this
 * and no call site.
 *
 * It reports the route PATTERN, never the resolved path, and that is a privacy
 * property rather than a convenience: `useSegments()` hands back the segments
 * as declared, so a chapter reads `/bible/chapter` and an atlas entry reads
 * `/bible/atlas/[id]`. The id never arrives to be dropped. Which book someone
 * opened is study content under the rule in src/lib/analytics/events.ts, and
 * this is the mechanism that keeps it out rather than a promise to be careful.
 *
 * Group segments are dropped, so `(app)` and `(auth)` do not split one screen
 * into two rows when a route moves between them.
 */
export function useScreenTracking(): void {
	const segments = useSegments();
	const lastScreen = useRef<string | null>(null);

	useEffect(() => {
		const screen = `/${segments
			.filter((segment) => !segment.startsWith("("))
			.join("/")}`;

		// The hook re-runs on every navigation state change, including ones that
		// land on the screen already showing. Without this a single tab could
		// report itself several times and look like the most used screen in the
		// app.
		if (screen === lastScreen.current) return;
		lastScreen.current = screen;

		track(ANALYTICS_EVENTS.screenViewed, { screen });
	}, [segments]);
}
