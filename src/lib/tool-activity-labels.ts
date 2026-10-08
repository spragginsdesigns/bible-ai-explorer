/**
 * What each tool is called while it runs, keyed by tool name. Mobile keeps its
 * own copy for tool parts it renders itself, so the wording a user sees must
 * not drift apart between here and `mobile/src/lib/chatView.ts`.
 */
export const TOOL_ACTIVITY_LABELS: Record<string, string> = {
	searchScripture: "Searching the Scriptures",
	findVerses: "Searching the Bible for those words",
	getPassage: "Opening the passage",
	webSearch: "Searching the web",
	readLink: "Reading the link",
	addToNote: "Writing to your note",
	readNote: "Reading your note",
	updateNote: "Rewriting your note",
	findNotes: "Looking through your notes",
	organizeNote: "Filing your note",
	getHighlights: "Reading your highlights",
	highlightVerse: "Marking your verse",
	listMemories: "Reading your memories",
	saveMemory: "Saving your memory",
	updateMemory: "Updating your memory",
	deleteMemories: "Deleting your memories",
	resolvePrayerRequest: "Updating that prayer request",
	findChurch: "Looking up your church",
	setChurch: "Saving your church",
	saveTestimony: "Saving your testimony",
	saveAboutMe: "Saving your About me",
	finishOnboarding: "Finishing getting to know you",
	getCrossReferences: "Tracing cross-references",
	getOriginalText: "Opening the original text",
	lookupStrongs: "Studying the original word",
	searchOriginalLanguage: "Searching the Hebrew and Greek",
	lookupBibleEntity: "Looking them up in Scripture",
	getBibleTimeline: "Walking the timeline",
	getDailyCross: "Opening today's cross",
	setDailyCross: "Preparing your new day",
	listSermonStudies: "Looking through your church's studies",
	getSermonStudy: "Opening the sermon study",
	getReadingPlan: "Opening your reading plan",
	startReadingPlan: "Setting up your reading plan",
	markReadingPlanDay: "Marking your reading",
	logReading: "Saving your reading",
	searchReadingHistory: "Checking your reading history",
	getReadingStats: "Checking your reading progress",
	correctReadingLog: "Correcting your reading log",
	removeReadingLog: "Removing the reading entry",
	learnVerse: "Adding that verse to Learn",
	getLearnVerses: "Opening your Learn verses",
	findStudies: "Finding your ongoing studies",
	readStudy: "Picking up your study",
	saveStudy: "Saving your study progress",
	requestActionApproval: "Preparing the proposed change",
};

export function toolActivityLabel(toolName: string): string {
	return TOOL_ACTIVITY_LABELS[toolName] ?? "Working";
}
