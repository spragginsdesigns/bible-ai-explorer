import AppSidebar from "@/components/AppSidebar";

/**
 * Pick Up Your Cross lives under the Bible section: same docked-sidebar
 * shell as /bible so desktop navigation stays persistent.
 */
export default function CrossLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="min-h-[100dvh] gradient-mesh">
			<AppSidebar active="bible" docked />
			<div className="lg:pl-[268px]">{children}</div>
		</div>
	);
}
