import { DAILY_TIME_HOURS } from "./onboardingRules";

/** "7 am", "Noon", "7 pm": the label a reminder hour chip shows and sends. */
export function hourLabel(hour: number): string {
	if (hour === 12) return "Noon";
	if (hour === 0) return "12 am";
	return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** The local hour a daily time answer means, or null for "Not now" and anything typed. */
export function hourForLabel(label: string): number | null {
	if (Object.prototype.hasOwnProperty.call(DAILY_TIME_HOURS, label)) return DAILY_TIME_HOURS[label];
	const match = /^(\d{1,2}) (am|pm)$/.exec(label);
	if (!match) return null;
	const value = Number(match[1]);
	if (value < 1 || value > 12) return null;
	if (match[2] === "am") return value === 12 ? 0 : value;
	return value === 12 ? 12 : value + 12;
}
