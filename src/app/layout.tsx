import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	metadataBase: new URL("https://bible-ai-explorer.vercel.app"),
	title: "VerseMind",
	description: "Explore the Bible with AI-powered insights and answers",
	keywords: ["Bible", "AI", "Christian", "Theology", "Scripture", "Explorer"],
	authors: [
		{ name: "Austin Spraggins", url: "https://bible-ai-explorer.vercel.app" }
	],
	creator: "Austin Spraggins",
	publisher: "Spraggins Designs",
	openGraph: {
		title: "Bible AI Explorer",
		description: "Explore the Bible with AI-powered insights and answers",
		url: "https://bible-ai-explorer.vercel.app",
		siteName: "Bible AI Explorer",
		images: [
			{
				url: "/android-chrome-512x512.png",
				width: 512,
				height: 512,
				alt: "Verse Mind Logo"
			}
		],
		locale: "en_US",
		type: "website"
	},
	twitter: {
		card: "summary_large_image",
		title: "VerseMind",
		description: "Explore the Bible with AI-powered insights and answers",
		creator: "@spragginsdesign",
		images: ["/android-chrome-512x512.png"]
	},
	icons: {
		icon: [
			{ url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
			{
				url: "/android-chrome-192x192.png",
				sizes: "192x192",
				type: "image/png"
			},
			{
				url: "/android-chrome-512x512.png",
				sizes: "512x512",
				type: "image/png"
			}
		],
		apple: [
			{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
		],
		shortcut: "/favicon.ico"
	},
	manifest: "/site.webmanifest"
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1
};

export default function RootLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
				<head>
				<meta
					name="google-site-verification"
					content="google031a11ddf3eae0eb.html"
				/>
			</head>
			<body className={inter.className}>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					{children}
				</ThemeProvider>
			</body>
		</html>
	);
}
