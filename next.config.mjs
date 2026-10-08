import withPWA from "next-pwa";
import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
	outputFileTracingIncludes: {
		"/api/ask-question": ["./biblical-texts/kjv.json"],
		"/api/note-ai": ["./biblical-texts/kjv.json"],
	},
	// Analytics ingestion, served from our own origin so an ad blocker cannot
	// silently delete half the numbers. The two asset rewrites must stay above
	// the catch-all, and /ingest is listed as a public route in
	// src/middleware.ts or signed-out visitors get redirected to /sign-in
	// instead of being counted.
	async rewrites() {
		return [
			{
				source: "/ingest/static/:path*",
				destination: "https://us-assets.i.posthog.com/static/:path*",
			},
			{
				source: "/ingest/:path*",
				destination: "https://us.i.posthog.com/:path*",
			},
		];
	},
	// Android's routes put the cross and sermon studies inside the Bible stack
	// (bible/cross, bible/sermons, bible/sermon?id=), and shared links or push
	// payloads can carry those paths. The web pages live at the top level.
	async redirects() {
		return [
			{ source: "/bible/cross", destination: "/cross", permanent: false },
			{ source: "/bible/sermons", destination: "/sermons", permanent: false },
			{
				source: "/bible/sermon",
				has: [{ type: "query", key: "id", value: "(?<id>[A-Za-z0-9_-]+)" }],
				destination: "/sermons/:id",
				permanent: false,
			},
			{ source: "/bible/sermon", destination: "/sermons", permanent: false },
		];
	},
	skipTrailingSlashRedirect: true,
};

// withBotId adds the rewrites Vercel BotID's client challenge talks through;
// its path prefix is public in src/middleware.ts. It guards the signed-out
// guest answers (src/app/api/guest/ask/route.ts).
export default withBotId(withPWA({
	dest: "public",
	register: true,
	skipWaiting: true,
	disable: process.env.NODE_ENV === "development",
	// Push + notificationclick handlers for web notifications.
	importScripts: ["/push-handlers.js"],
	// One failed precache request aborts the service worker install. Next 15
	// never serves app-build-manifest.json, and middleware redirects .xml to
	// sign-in, so precaching either one meant the worker (and with it web push)
	// never activated.
	buildExcludes: [/app-build-manifest\.json$/],
	publicExcludes: ["!noprecache/**/*", "!browserconfig.xml"],
	runtimeCaching: [
		{
			urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i,
			handler: "CacheFirst",
			options: {
				cacheName: "google-fonts",
				expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
			},
		},
		{
			urlPattern: /\.(?:js|css)$/i,
			handler: "StaleWhileRevalidate",
			options: {
				cacheName: "static-resources",
				expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
			},
		},
		{
			urlPattern: /\.(?:png|jpg|jpeg|svg|gif|ico|webp)$/i,
			handler: "CacheFirst",
			options: {
				cacheName: "images",
				expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
			},
		},
		{
			urlPattern: /\/api\/.*$/i,
			handler: "NetworkOnly",
		},
	],
})(nextConfig));
