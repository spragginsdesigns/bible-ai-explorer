import BibleTopBar from "@/components/bible/BibleTopBar";

export default function BibleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<BibleTopBar />
			{children}
		</>
	);
}
