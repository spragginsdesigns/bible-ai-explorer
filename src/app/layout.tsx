import type { Metadata } from "next";
import { Inter, Orbitron, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-orbitron" });
const cormorantGaramond = Cormorant_Garamond({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	style: ["normal", "italic"],
	variable: "--font-cormorant",
});

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
				url: "/web-app-manifest-512x512.png",
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
		title: "VerseMind",
	},
	manifest: "/site.webmanifest"
};

export const viewport = {
	width: "device-width",
	initialScale: 1,
	themeColor: "#000000",
};

export default function RootLayout({
	children
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<head>
				<meta name="google-site-verification" content="Oz-B3ljjCVJn4t_50kIHVJxEct57K1FqysvU8ZU3beI" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
			</head>
			<body className={`${inter.className} ${orbitron.variable} ${cormorantGaramond.variable}`}>
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
