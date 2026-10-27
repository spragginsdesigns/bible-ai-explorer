import SectionShell from "@/components/SectionShell";

/** Ways to Serve is reached from Today, so Today stays selected. */
export default function ServeLayout({ children }: { children: React.ReactNode }) {
	return <SectionShell active="today">{children}</SectionShell>;
}
