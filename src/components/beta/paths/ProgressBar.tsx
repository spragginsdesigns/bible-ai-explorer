import { BAR_FILL, BAR_TRACK } from "./ui";

/** A path's gold progress bar, with its percent read out. */
export default function ProgressBar({ percent, label, className = "" }: { percent: number; label: string; className?: string }) {
	const value = Math.max(0, Math.min(100, Math.round(percent)));
	return (
		<div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className={`${BAR_TRACK} ${className}`}>
			<div className={BAR_FILL} style={{ width: `${value}%` }} />
		</div>
	);
}
