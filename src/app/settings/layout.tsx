import AppSidebar from "@/components/AppSidebar";

/**
 * Settings shell: docked app sidebar on desktop; on mobile the page keeps
 * its own back-arrow header and MobileBottomNav.
 */
export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<AppSidebar active="settings" docked />
			<div className="lg:pl-[268px]">{children}</div>
		</div>
	);
}
