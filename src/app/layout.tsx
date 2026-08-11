import type { Metadata } from "next";
import { Inter, Pirata_One, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "../components/ThemeProvider";
import MobileBottomNav from "../components/MobileBottomNav";

const inter = Inter({ subsets: ["latin"] });
const pirataOne = Pirata_One({ subsets: ["latin"], weight: "400", variable: "--font-pirata" });
const cormorantGaramond = Cormorant_Garamond({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	style: ["normal", "italic"],
	variable: "--font-cormorant",
});

export const metadata: Metadata = {
	metadataBase: new URL("https://sureword.app"),
	title: "SureWord",
	description: "Explore the Bible with AI-powered insights and answers",
	keywords: ["Bible", "AI", "Christian", "Theology", "Scripture", "KJV", "SureWord"],
	authors: [
		{ name: "Austin Spraggins", url: "https://sureword.app" }
	],
	creator: "Austin Spraggins",
	publisher: "Spraggins Designs",
	openGraph: {
		title: "SureWord",
		description: "Explore the Bible with AI-powered insights and answers",
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
		title: "SureWord",
		description: "Explore the Bible with AI-powered insights and answers",
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
			<body className={`${inter.className} ${pirataOne.variable} ${cormorantGaramond.variable}`}>
				<ClerkProvider>
					<ThemeProvider
						attribute="class"
						defaultTheme="system"
						enableSystem
						disableTransitionOnChange
					>
						{children}
						<MobileBottomNav />
					</ThemeProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
