import SectionShell from "@/components/SectionShell";

/**
 * The legacy devotional URL keeps the Today section selected.
 */
export default function CrossLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<SectionShell active="today">{children}</SectionShell>
	);
}
