import type { Config } from "tailwindcss";

const config = {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}"
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: "2rem",
			screens: {
				"2xl": "1400px"
			}
		},
		extend: {
			fontFamily: {
				// The root layout supplies --font-body with Atkinson Hyperlegible.
				// Keep the fallback here so utility classes are also readable in
				// isolated renders and during the font's loading window.
				sans: ["var(--font-body)", "system-ui", "sans-serif"],
				body: ["var(--font-body)", "system-ui", "sans-serif"],
				mono: ["var(--font-mono)", "Hack", "ui-monospace", "monospace"],
			},
			fontSize: {
				// Raise Tailwind's smallest stock role so legacy `text-xs`
				// remains readable while it is migrated to semantic names.
				xs: ["0.8125rem", { lineHeight: "1.125rem" }],
				// Named type roles keep the web scale consistent across screens.
				chat: ["1.0625rem", { lineHeight: "1.75rem" }],
				body: ["1rem", { lineHeight: "1.5rem" }],
				control: ["0.9375rem", { lineHeight: "1.375rem" }],
				support: ["0.875rem", { lineHeight: "1.25rem" }],
				metadata: ["0.8125rem", { lineHeight: "1.125rem" }],
				"section-title": ["1.125rem", { lineHeight: "1.625rem" }],
				"screen-title": ["1.375rem", { lineHeight: "1.875rem" }],
			},
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))"
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))"
				},
				destructive: {
					DEFAULT: "hsl(var(--destructive))",
					foreground: "hsl(var(--destructive-foreground))"
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))"
				},
				accent: {
					DEFAULT: "hsl(var(--accent))",
					foreground: "hsl(var(--accent-foreground))"
				},
				popover: {
					DEFAULT: "hsl(var(--popover))",
					foreground: "hsl(var(--popover-foreground))"
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))"
				}
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)"
			},
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" }
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" }
				},
				fadeIn: {
					"0%": { opacity: "0" },
					"100%": { opacity: "1" }
				}
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
				"fade-in": "fadeIn 0.5s ease-out forwards"
			}
		}
	},
	plugins: [require("tailwindcss-animate")]
} satisfies Config;

export default config;
