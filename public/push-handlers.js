/* eslint-env serviceworker */

// Served as-is and pulled into the generated sw.js through next-pwa's
// `importScripts` (next.config.mjs), so these handlers run inside the same
// service worker as the Workbox caching. Plain script, no imports: next-pwa's
// customWorkerDir route needs babel-loader, which this repo doesn't ship.

/** Only same-origin paths are opened, whatever a payload says. */
function safePath(value) {
	// A backslash is read as a slash by URL parsing, so "/\evil.com" would
	// leave the site just like "//evil.com".
	if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
	return value;
}

// Payloads come from src/lib/push-routing.ts (buildWebPushPayload) for server
// pushes: { title, body, url, tag, data }.
self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = { body: event.data ? event.data.text() : "" };
	}
	const title = typeof payload.title === "string" && payload.title ? payload.title : "SureWord";
	event.waitUntil(
		self.registration.showNotification(title, {
			body: typeof payload.body === "string" ? payload.body : "",
			tag: typeof payload.tag === "string" ? payload.tag : undefined,
			icon: "/icon-192.png",
			badge: "/favicon-96x96.png",
			data: { url: safePath(payload.url) },
		})
	);
});

// A tap focuses an open SureWord tab and moves it to the target, or opens one.
self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = safePath(event.notification.data && event.notification.data.url);
	const target = new URL(path, self.location.origin).href;
	event.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
			const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
			if (existing) {
				return existing.focus().then((focused) => {
					const client = focused || existing;
					if ("navigate" in client) return client.navigate(target).catch(() => self.clients.openWindow(target));
					return undefined;
				});
			}
			return self.clients.openWindow(target);
		})
	);
});
