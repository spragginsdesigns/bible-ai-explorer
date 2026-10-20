import SectionShell from "@/components/SectionShell";

/**
 * Bible section shell: the persistent app sidebar is fixed on desktop and
 * absent on mobile (MobileBottomNav carries navigation there), so pages keep
 * natural document scrolling and Next's scroll restoration.
 */
export default function BibleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<SectionShell active="bible">{children}</SectionShell>
	);
}
