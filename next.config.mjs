import withPWA from "next-pwa";
import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
	// An isolated QA build can coexist with the normal local server.
	distDir: process.env.SUREWORD_BUILD_DIR || ".next",
	outputFileTracingIncludes: {
		"/api/**": ["./src/data/kjv/*.json"],
		// Share-card fonts and art, read from disk by src/lib/share-cards/render.tsx.
		"/api/cards/**": ["./src/assets/share-cards/**/*"],
		"/api/shared/*/image": ["./src/assets/share-cards/**/*"],
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
	// Precache was ~28 MB per first visit, signed-out visitors included: every
	// per-book Bible data chunk plus raw art PNGs the app only shows through
	// next/image. Large files now load on demand and land in the runtime caches
	// below, so a book someone has opened still reads offline.
	publicExcludes: [
		"!noprecache/**/*",
		"!browserconfig.xml",
		"!chat-home/**/*",
		"!textures/**/*",
		"!splash/**/*",
		"!og-image.png",
		"!sureword-guide.png",
	],
	maximumFileSizeToCacheInBytes: 200 * 1024,
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
				// Room for the on-demand Bible book chunks the precache no longer carries.
				expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
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
