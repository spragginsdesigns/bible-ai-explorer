import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Pirata_One, Cormorant_Garamond } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "../components/ThemeProvider";
import MobileBottomNav from "../components/MobileBottomNav";
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

export const metadata: Metadata = {
	metadataBase: new URL("https://sureword.app"),
	title: "SureWord — Come hungry for the Word",
	description:
		"Come hungry for the Word. SureWord is your personal Bible study companion for Scripture, questions, notes, and a deeper daily walk.",
	keywords: ["Bible", "AI", "Christian", "Theology", "Scripture", "KJV", "SureWord"],
	authors: [
		{ name: "Austin Spraggins", url: "https://sureword.app" }
	],
	creator: "Austin Spraggins",
	publisher: "Spraggins Designs",
	openGraph: {
		title: "SureWord — Come hungry for the Word",
		description:
			"Come hungry for the Word. SureWord is your personal Bible study companion for Scripture, questions, notes, and a deeper daily walk.",
		url: "https://sureword.app",
		siteName: "SureWord",
		images: [
			{
				url: "/web-app-manifest-512x512.png",
				width: 512,
				height: 512,
				alt: "SureWord logo"
			}
		],
		locale: "en_US",
		type: "website"
	},
	twitter: {
		card: "summary_large_image",
		title: "SureWord — Come hungry for the Word",
		description:
			"Come hungry for the Word. SureWord is your personal Bible study companion for Scripture, questions, notes, and a deeper daily walk.",
		creator: "@spragginsdesign",
		images: ["/web-app-manifest-512x512.png"]
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
					</ThemeProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
