import SettingsShell from "@/components/settings/SettingsShell";

/**
 * Settings shell: docked app sidebar on desktop, drawer plus a top bar on
 * mobile. The interactive parts live in SettingsShell so this stays a server
 * component.
 */
export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return <SettingsShell>{children}</SettingsShell>;
}
