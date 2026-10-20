import SectionShell from "@/components/SectionShell";

/**
 * Sermon studies and announcements share Study's persistent navigation.
 */
export default function SermonsLayout({ children }: { children: React.ReactNode }) {
	return (
		<SectionShell active="study">{children}</SectionShell>
	);
}
