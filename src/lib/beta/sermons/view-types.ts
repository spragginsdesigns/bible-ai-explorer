/**
 * What the Sermon to Study pages hand the browser (LC-17643). Scripture text
 * here always comes from the bundled KJV on the server.
 */
import type { PassageComparison, PassageHow, SermonStatus, SermonStudyNotes, StudySection, TranscriptSegment } from "./sermons-rules";

export interface SermonCardView {
	id: string;
	title: string;
	preacher: string | null;
	status: SermonStatus;
	durationSec: number;
	passages: string[];
	passageCount: number;
	hasStudy: boolean;
	research: number;
	createdAt: string;
}

export interface PassageView {
	key: string;
	label: string;
	book: number;
	chapter: number;
	verse: number | null;
	how: PassageHow;
	times: number[];
	/** The sermon's words around its first mention. */
	excerpt: string;
	/** The KJV verse with a verse on either side (a chapter shows its opening verses). */
	verses: { n: number; text: string; focus: boolean }[];
	comparison: PassageComparison | null;
}

export interface StudySectionView extends StudySection {
	scripture: { label: string; book: number; chapter: number; verse: number; text: string } | null;
}

export interface MemoryVerseView {
	key: string;
	label: string;
	book: number;
	chapter: number;
	verse: number;
	text: string;
}

export interface SermonView {
	id: string;
	title: string;
	preacher: string | null;
	status: SermonStatus;
	source: "upload" | "recording";
	fileName: string | null;
	durationSec: number;
	permissionAt: string;
	createdAt: string;
	segments: TranscriptSegment[];
	passages: PassageView[];
	study: (Omit<SermonStudyNotes, "sections" | "memory"> & { sections: StudySectionView[]; memory: MemoryVerseView[] }) | null;
	research: string[];
	/** The Study Projects it was saved into that still exist, newest first. */
	savedProjects: SavedProjectView[];
	/** The founder's projects it can be saved into (not archived). */
	projectChoices: { id: string; title: string }[];
}

export interface SavedProjectView {
	projectId: string;
	title: string;
	href: string;
	/** The project was started from this sermon. */
	created: boolean;
	archived: boolean;
	savedAt: string;
}
