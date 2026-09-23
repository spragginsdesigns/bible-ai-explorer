import withPWA from "next-pwa";
import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
	outputFileTracingIncludes: {
		"/api/ask-question": ["./biblical-texts/KJV-Bible.txt"],
		"/api/note-ai": ["./biblical-texts/KJV-Bible.txt"],
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
