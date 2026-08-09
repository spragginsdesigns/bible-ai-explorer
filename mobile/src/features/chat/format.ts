/** Short relative timestamp for conversation rows ("3h ago", "2d ago"). */
export function formatRelativeDate(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";

	const minutes = Math.round((Date.now() - then) / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;

	return new Date(then).toLocaleDateString();
}
