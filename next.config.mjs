import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withPWA({
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
})(nextConfig);
