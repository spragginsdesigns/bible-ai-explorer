import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Pirata_One, Cormorant_Garamond } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "../components/ThemeProvider";
import MobileBottomNav from "../components/MobileBottomNav";
import ReadingLogSync from "../components/bible/readingLogClient";
import PreferencesSync from "../components/PreferencesSync";

const atkinsonHyperlegible = Atkinson_Hyperlegible({
	subsets: ["latin"],
	weight: ["400", "700"],
	style: ["normal", "italic"],
	display: "swap",
	variable: "--font-body",
});
const pirataOne = Pirata_One({ subsets: ["latin"], weight: "400", variable: "--font-pirata" });
const cormorantGaramond = Cormorant_Garamond({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	style: ["normal", "italic"],
	variable: "--font-cormorant",
});
const hack = localFont({
	src: [
		{ path: "./fonts/hack-regular.woff2", weight: "400", style: "normal" },
		{ path: "./fonts/hack-italic.woff2", weight: "400", style: "italic" },
		{ path: "./fonts/hack-bold.woff2", weight: "700", style: "normal" },
		{ path: "./fonts/hack-bolditalic.woff2", weight: "700", style: "italic" },
	],
	display: "swap",
	variable: "--font-mono",
});

const SITE_TITLE = "SureWord: KJV Bible Study App with AI";
// Keep "Come hungry for the Word" and "personal Bible study companion" here:
// tests/welcome-copy-parity.test.mjs pins every release-facing surface to them.
const SITE_DESCRIPTION =
	"Come hungry for the Word. SureWord is a KJV Bible study app and personal Bible study companion with AI. Ask any Bible question and get answers grounded in Scripture.";
const OG_IMAGE_ALT = "SureWord, a KJV Bible study app with AI";

export const metadata: Metadata = {
	metadataBase: new URL("https://sureword.app"),
	title: {
		default: SITE_TITLE,
		template: "%s | SureWord",
	},
	description: SITE_DESCRIPTION,
	keywords: [
		"KJV Bible app",
		"Bible study app",
		"AI Bible study",
		"AI Bible study assistant",
		"Bible questions",
		"Bible chat",
		"Scripture study",
		"daily devotional",
		"Bible reading plan",
		"Strong's concordance",
		"KJV",
		"Christian",
		"SureWord",
	],
	category: "religion",
	alternates: {
		canonical: "https://sureword.app",
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	authors: [
		{ name: "Austin Spraggins", url: "https://sureword.app" }
	],
	creator: "Austin Spraggins",
	publisher: "Spraggins Designs",
	openGraph: {
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		url: "https://sureword.app",
		siteName: "SureWord",
		images: [
			{
				url: "/og-image.png",
				width: 1200,
				height: 630,
				alt: OG_IMAGE_ALT
			}
		],
		locale: "en_US",
		type: "website"
	},
	twitter: {
		card: "summary_large_image",
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		creator: "@spragginsdesign",
		images: [
			{
				url: "/og-image.png",
				width: 1200,
				height: 630,
				alt: OG_IMAGE_ALT
			}
		]
	},
	icons: {
		icon: [
			{ url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
			{ url: "/favicon.svg", type: "image/svg+xml" },
		],
		apple: [
			{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
		],
		shortcut: "/favicon.ico"
	},
	appleWebApp: {
		title: "SureWord",
	},
	manifest: "/site.webmanifest"
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	themeColor: "#0a0a0a",
};

export default function RootLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta name="google-site-verification" content="Oz-B3ljjCVJn4t_50kIHVJxEct57K1FqysvU8ZU3beI" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
			</head>
			<body className={`${atkinsonHyperlegible.variable} ${pirataOne.variable} ${cormorantGaramond.variable} ${hack.variable} font-body text-body`}>
				<ClerkProvider
					appearance={{
						variables: {
							fontFamily: "var(--font-body), system-ui, sans-serif",
						},
					}}
				>
					<ThemeProvider
						attribute="class"
						defaultTheme="system"
						enableSystem
						disableTransitionOnChange
					>
						{children}
						<MobileBottomNav />
						{/* One mount for the whole app: hydrates the account
						    preferences and reports a write that did not stick. */}
						<PreferencesSync />
						<ReadingLogSync />
					</ThemeProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
