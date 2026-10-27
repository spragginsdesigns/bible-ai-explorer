/**
 * SureWord Beta's map (LC-17631, docs/beta/README.md): the six destinations
 * of the founders-only beta and every module being built into them. Together
 * and the six SureWord products (Family, Kids, Groups, Churches, Pastor,
 * Academy) came with LC-17639 (docs/beta/expansion.md).
 *
 * This file is the beta's single source of truth. The shell's navigation, the
 * destination pages, Home's "In the workshop" list and the placeholder page a
 * module shows until it ships all read it. A module's own run owns its entry:
 * it flips `status` (planned -> building -> live) and sets `issue`, and touches
 * no other entry. Each entry spans several lines on purpose, so two modules
 * shipping in parallel never edit adjacent lines.
 *
 * No imports on purpose: `tests/beta-access.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths.
 */

export type BetaDestinationId = "bible" | "study" | "library" | "learn" | "together";
export type BetaSectionId = "home" | BetaDestinationId;
export type BetaModuleStatus = "planned" | "building" | "live";
export type BetaPriority = "P0" | "P1" | "P2" | "P3";

export interface BetaDestination {
	id: BetaSectionId;
	href: string;
	label: string;
	/** One line under the label on Home and on the destination page. */
	blurb: string;
}

export const BETA_ROOT = "/beta";

export const BETA_DESTINATIONS: readonly BetaDestination[] = [
	{ id: "home", href: "/beta", label: "Home", blurb: "Your study today" },
	{ id: "bible", href: "/beta/bible", label: "Bible", blurb: "Read, compare, explore" },
	{ id: "study", href: "/beta/study", label: "Study", blurb: "AI and study projects" },
	{ id: "library", href: "/beta/library", label: "Library", blurb: "Notes and connections" },
	{ id: "learn", href: "/beta/learn", label: "Learn", blurb: "Courses and review" },
	{ id: "together", href: "/beta/together", label: "Together", blurb: "Family, groups and church" },
];

export interface BetaModule {
	/** URL segment under its destination: /beta/<destination>/<slug>. */
	slug: string;
	destination: BetaDestinationId;
	title: string;
	/** One line, shown on cards. */
	tagline: string;
	inspiredBy: string;
	priority: BetaPriority;
	status: BetaModuleStatus;
	/** The Linear issue building it, set by that run (for example "LC-12345"). */
	issue?: string;
	/** What it is, in two or three sentences. */
	summary: string;
	/** What a founder will be able to do. */
	capabilities: readonly string[];
	/** The SureWord pieces it builds on instead of duplicating. */
	builtOn: readonly string[];
}

export const BETA_MODULES: readonly BetaModule[] = [
	{
		slug: "atlas",
		destination: "bible",
		title: "Atlas & Timeline",
		tagline: "See the Bible's places and events come to life",
		inspiredBy: "Google Earth and historical timelines",
		priority: "P3",
		status: "planned",
		summary:
			"An immersive map and timeline of Scripture. Follow Paul's journeys, the Exodus and the kings of Israel and Judah step by step, with every place and event opening the passages that mention it.",
		capabilities: [
			"Play a journey stop by stop, with the verses for each stop",
			"Scrub a timeline of events, kings and prophets, with dates labelled as Ussher's",
			"Tap any place or event to read its passages and background",
			"Compare kingdoms and eras side by side",
		],
		builtOn: ["The atlas and timeline corpus (people, places, events, journeys)", "The Bible reader"],
	},
	{
		slug: "projects",
		destination: "study",
		title: "Study Projects",
		tagline: "A focused workspace for deeper study",
		inspiredBy: "NotebookLM and Notion",
		priority: "P0",
		status: "planned",
		summary:
			"A workspace for one study: its passages, your notes, sources you add and questions you are working through. The assistant answers from inside the project and cites the verse or source behind every claim.",
		capabilities: [
			"Create a project, such as The Book of Romans, and track progress through it",
			"Gather passages, notes, highlights, pasted or uploaded sources and questions in one place",
			"Ask the assistant questions answered only from the project's materials, with citations",
			"Assemble an outline or written study from what you have gathered",
		],
		builtOn: ["Notes (wikilinks, backlinks, properties)", "Scripture search", "The study assistant"],
	},
	{
		slug: "verify",
		destination: "study",
		title: "Scripture Check",
		tagline: "Check any teaching against the Word",
		inspiredBy: "Fact-checking tools",
		priority: "P0",
		status: "planned",
		summary:
			"Paste a sermon, devotional or AI answer and see every Scripture claim checked against the KJV: quotations matched word for word, references opened in context, and plain statements of Scripture kept apart from interpretation and history.",
		capabilities: [
			"Find every quotation and reference in a text and check it against the KJV",
			"Flag misquotes, wrong references and verses taken out of context",
			"Label each claim as Scripture, interpretation or a historical claim",
			"Open any cited passage in context",
		],
		builtOn: ["Exact-word search", "Scripture search", "The /check and /verify discernment guidance"],
	},
	{
		slug: "tutor",
		destination: "study",
		title: "Socratic Tutor",
		tagline: "Learn to read closely, one question at a time",
		inspiredBy: "Khan Academy's tutoring",
		priority: "P1",
		status: "planned",
		summary:
			"A study mode that asks before it tells. It walks you through a passage with questions (what does verse 4 say, how does the chapter before change it, what supports your answer) and helps you reach and test your own conclusion from the text.",
		capabilities: [
			"Start a guided close reading of any passage",
			"Answer step by step, with hints when you are stuck",
			"See your conclusion checked against the text, with the verses that support or correct it",
			"Save the session and what you learned as a note",
		],
		builtOn: ["The study assistant", "Scripture search", "Notes"],
	},
	{
		slug: "sermons",
		destination: "study",
		title: "Sermon to Study",
		tagline: "Turn a sermon into a study you can keep",
		inspiredBy: "Meeting-notes and transcription apps",
		priority: "P2",
		status: "planned",
		summary:
			"Record or upload a sermon you have permission to use. SureWord transcribes it, finds every passage it touches, and builds study notes, discussion questions and memory cards, with the sermon's words always kept apart from Scripture.",
		capabilities: [
			"Upload or record a sermon and get a transcript",
			"See every passage referenced, opened in context",
			"Get study notes, discussion questions and optional memory cards",
			"Save it as a study project and mark questions to research later",
		],
		builtOn: ["Voice transcription", "Sermon studies", "Study Projects", "Notes"],
	},
	{
		slug: "voice",
		destination: "study",
		title: "Voice Study",
		tagline: "Study hands-free, out loud",
		inspiredBy: "Voice assistants",
		priority: "P2",
		status: "planned",
		summary:
			"A spoken conversation about Scripture. Ask aloud, interrupt, ask for it another way, ask it to read a passage, and keep the conversation as a note when you are done.",
		capabilities: [
			"Talk with the study assistant by voice, and interrupt it naturally",
			"Ask it to read any passage aloud",
			"Get answers grounded in the KJV, with references read out",
			"Save the conversation as a note",
		],
		builtOn: ["The study assistant", "The narrated KJV", "Notes"],
	},
	{
		slug: "audio",
		destination: "study",
		title: "Audio Overviews",
		tagline: "Listen to your study on the go",
		inspiredBy: "NotebookLM and podcasts",
		priority: "P2",
		status: "planned",
		summary:
			"Turn a finished study into something to listen to: a narrated lesson, a question-and-answer review, or a short overview, each grounded in the passages and reading them in the KJV.",
		capabilities: [
			"Generate a narrated lesson or overview from a study",
			"Play it with chapters, speed control and the screen off",
			"Hear Scripture quoted exactly, with references",
			"Find every overview again in your Library",
		],
		builtOn: ["The spoken devotional (Listen)", "Study Projects", "Notes"],
	},
	{
		slug: "maps",
		destination: "study",
		title: "Concept Maps",
		tagline: "See how the doctrines fit together",
		inspiredBy: "Miro and mind maps",
		priority: "P2",
		status: "planned",
		summary:
			"Interactive diagrams of the great themes of Scripture (the Trinity, the covenants, salvation, prophecy, the order of the Gospels) where every node opens the verses behind it.",
		capabilities: [
			"Explore ready-made maps of core doctrines",
			"Generate a map for any theme, built from the verses",
			"Tap a node to read its passages",
			"See where Christians read a difficult passage differently, clearly labelled",
		],
		builtOn: ["Cross-references", "Scripture search", "The study assistant"],
	},
	{
		slug: "rooms",
		destination: "study",
		title: "Study Rooms",
		tagline: "Study the Word together",
		inspiredBy: "Google Docs and shared workspaces",
		priority: "P3",
		status: "planned",
		summary:
			"Shared rooms for a family, small group or class: passages, discussion questions, a reading plan and shared notes, while everyone keeps a private study of their own.",
		capabilities: [
			"Create a room and invite people with a link",
			"Share passages, questions and a reading plan",
			"Discuss and add shared notes, without exposing private ones",
			"See where the group is in the plan",
		],
		builtOn: ["Reading plans", "Notes", "Shared answers and cards"],
	},
	{
		slug: "vault",
		destination: "library",
		title: "Knowledge Vault",
		tagline: "Everything you have studied, in one place",
		inspiredBy: "Notion, Evernote and Readwise",
		priority: "P0",
		status: "planned",
		summary:
			"A searchable library of everything you have learned in SureWord: notes, highlights, conversations, studies and verses you are learning. Ask it what you have studied about the Holy Spirit in the last six months, see how your understanding of a passage has grown, and pick up where you left off.",
		capabilities: [
			"Search and filter everything you have studied, by passage, topic and date",
			"Ask questions of your own study history, answered with links to the source",
			"See your notes on one passage side by side over time",
			"Get a 'continue where you left off' that knows your last study",
		],
		builtOn: ["Notes and note search", "Highlights", "Conversations", "Reading history", "Memories"],
	},
	{
		slug: "graph",
		destination: "library",
		title: "Living Study Graph",
		tagline: "See how everything you study connects",
		inspiredBy: "Obsidian and Roam Research",
		priority: "P2",
		status: "planned",
		summary:
			"A connected map of your passages, notes, topics and studies that grows with every study. It notices when today's study touches an earlier one (justification in Romans, then Galatians) and offers to connect them.",
		capabilities: [
			"Explore a visual graph of your passages, notes and topics",
			"Get suggested connections between studies, with the reason",
			"Follow a topic across books and over time",
			"Search the graph and open any node",
		],
		builtOn: ["Knowledge Vault", "Note wikilinks and backlinks", "Cross-references", "The Connections ring"],
	},
	{
		slug: "paths",
		destination: "learn",
		title: "Learning Paths",
		tagline: "Guided journeys for every stage",
		inspiredBy: "Duolingo and Khan Academy",
		priority: "P1",
		status: "planned",
		summary:
			"Courses through Scripture, from Foundations of the Christian Faith to Mastering Romans and How to Read the Bible. Short lessons with questions that adapt to what you already understand, plus a personal curriculum that builds the foundations a hard topic needs first.",
		capabilities: [
			"Take short lessons with questions answered from the verse",
			"Follow a path, see your progress and pick up where you left off",
			"Get lessons that adapt to what you have shown you understand",
			"Ask for a curriculum around any topic, with foundations first",
		],
		builtOn: ["Quiz me", "Learn a verse", "Reading plans", "Scripture search"],
	},
	{
		slug: "memory",
		destination: "learn",
		title: "Scripture Memory",
		tagline: "Make God's Word stick",
		inspiredBy: "Anki and Readwise",
		priority: "P1",
		status: "planned",
		summary:
			"Memory cards made from your own studies: whole verses, fill in the blank, multiple choice and comprehension questions, brought back at the right time with spaced repetition.",
		capabilities: [
			"Turn verses and studies into cards automatically",
			"Practise with fill in the blank, multiple choice and type it out",
			"Review on a spaced-repetition schedule",
			"See what you know and what is due",
		],
		builtOn: ["Learn a verse (queue, reviews, masking ladder)", "Highlights", "Notes"],
	},
	{
		slug: "growth",
		destination: "learn",
		title: "Habits & Reflection",
		tagline: "Small steps, lasting impact",
		inspiredBy: "Todoist and habit trackers",
		priority: "P2",
		status: "planned",
		summary:
			"Habits you choose for time with God (Bible reading, prayer and reflection, Scripture memory) with gentle reminders, a private reflection journal, and follow-ups on the insights you chose to put into practice. Never a score for your walk with God.",
		capabilities: [
			"Set your own reading, prayer and memory habits",
			"See a simple week view of what you kept",
			"Write private reflections, and get a follow-up when you ask for one",
			"Revisit what you decided to put into practice",
		],
		builtOn: ["Your walk and reading log", "Reading plans", "Prayer requests", "Learn a verse"],
	},
	// The six SureWord products from LC-17639 (docs/beta/expansion.md): one app
	// with many experiences, each built by its own run on the modules above.
	{
		slug: "family",
		destination: "together",
		title: "SureWord Family",
		tagline: "Grow in the Word together as a household",
		inspiredBy: "Family discipleship and shared family plans",
		priority: "P1",
		status: "planned",
		summary:
			"One space for a household: a family devotion for the day explained for every age at the table, a family memory verse, shared prayer requests, and guidance for parents from Scripture. Each person's own chats, notes and prayer journal stay private unless they choose to share.",
		capabilities: [
			"Start a family, invite the other parent, and add your children as profiles you manage",
			"Read a family devotion together, explained for little ones, children, teens and adults",
			"Learn a family memory verse each week and see who has it by heart",
			"Keep a family prayer list and mark prayers answered together",
			"Ask for parenting guidance rooted in Scripture",
		],
		builtOn: ["Study Rooms (members and invites)", "SureWord Kids (child profiles)", "Learn a verse", "Prayer requests", "Today's word"],
	},
	{
		slug: "kids",
		destination: "together",
		title: "SureWord Kids",
		tagline: "Bible adventures for children, guided by a parent",
		inspiredBy: "Children's Bible apps with parental controls",
		priority: "P2",
		status: "planned",
		summary:
			"A child-safe space a parent opens on their own device: Bible adventures read aloud from the KJV, questions and quizzes pitched to the child's age, and a verse to learn, with a star for each one finished. Children never get an account or chat freely with the assistant, and a child's profile holds only a first name and an age band.",
		capabilities: [
			"Add a child profile, just a first name and an age band, on a parent's account",
			"Go on Bible adventures: the story read aloud from the KJV, with a simple retelling beside it",
			"Answer questions and quizzes made for the child's age, with the answer always in the verse",
			"Learn a short verse with a memory game made for children",
			"Leave Kids only after a parent's check",
		],
		builtOn: ["The audio Bible", "Quiz me", "Learn a verse"],
	},
	{
		slug: "groups",
		destination: "together",
		title: "SureWord Groups",
		tagline: "Study, pray and grow as a small group",
		inspiredBy: "Small-group study guides and group chats",
		priority: "P1",
		status: "planned",
		summary:
			"A home for a small group or Bible class: a shared reading plan with each week's passage, discussion questions, guided sessions a leader can run, and a prayer circle. One member can bring a whole group into SureWord, and everyone keeps a private study of their own.",
		capabilities: [
			"Start a group, invite members with a link, and name its leaders",
			"Follow a group reading plan and see where the group is",
			"Discuss each week's passage around questions SureWord helps the leader prepare",
			"Run a guided session step by step: read, observe, discuss, pray",
			"Share prayer requests in a prayer circle and mark them answered",
		],
		builtOn: ["Study Rooms", "Reading plans", "Prayer requests"],
	},
	{
		slug: "churches",
		destination: "together",
		title: "SureWord Churches",
		tagline: "A discipleship home for a church and its groups",
		inspiredBy: "Church discipleship platforms, not church management",
		priority: "P3",
		status: "planned",
		summary:
			"A church space where pastors assign study journeys, share sermon follow-up and resources, and support the church's small groups. Members keep their private prayers and conversations their own. Scheduling, attendance and giving stay with the church's own management software.",
		capabilities: [
			"Set up a church space from My church, with pastors and group leaders",
			"Assign a study journey to the whole church or one group, and see who has started it",
			"Share each Sunday's sermon follow-up: the passages, questions and a study to keep",
			"Gather the church's small groups in one place",
		],
		builtOn: ["SureWord Groups", "My church", "Sermon studies", "SureWord Pastor"],
	},
	{
		slug: "pastor",
		destination: "study",
		title: "SureWord Pastor",
		tagline: "Prepare sermons and teaching from the text out",
		inspiredBy: "Sermon-preparation software such as Logos",
		priority: "P2",
		status: "planned",
		summary:
			"A preparation workspace for pastors and teachers: research a passage in its context and original languages, build an outline, plan a teaching series, gather references, and turn the finished sermon into study material for the congregation. Every quotation comes from the KJV text, and interpretation stays labelled as interpretation.",
		capabilities: [
			"Research a passage: its context, cross-references, Hebrew and Greek words, and other passages on the theme",
			"Build a sermon outline point by point, each point tied to its verses",
			"Plan a teaching series across weeks and books",
			"Turn a finished sermon into a study guide and discussion questions to share",
		],
		builtOn: ["Study Projects", "Words: Hebrew & Greek", "Cross-references", "Scripture Check"],
	},
	{
		slug: "academy",
		destination: "learn",
		title: "SureWord Academy",
		tagline: "Courses that teach the Bible and its doctrine",
		inspiredBy: "Online course platforms and Duolingo",
		priority: "P2",
		status: "planned",
		summary:
			"Courses with a beginning and an end: surveys of the Old and New Testaments, the doctrines of the faith, and how to study the Bible, taught in lessons that combine reading, the Socratic tutor, quizzes and Scripture memory, with milestones along the way. A course is a longer, deeper learning path, not a second learning engine.",
		capabilities: [
			"Enroll in a course and follow its lessons week by week",
			"Read each lesson, then work through it with the tutor and a short quiz",
			"Memorize each course's key verses along the way",
			"Reach milestones and keep a record of what you have completed",
			"Take a course together with your group or church class",
		],
		builtOn: ["Learning Paths", "Socratic Tutor", "Scripture Memory", "Quiz me"],
	},
];

/** Features that already ship in SureWord, listed on each destination. */
export const BETA_CLASSIC_LINKS: Readonly<Record<BetaDestinationId, readonly { href: string; label: string }[]>> = {
	bible: [
		{ href: "/bible", label: "Bible reader" },
		{ href: "/bible/search", label: "Search Scripture" },
		{ href: "/connections", label: "Connections" },
		{ href: "/bible/atlas", label: "Atlas" },
		{ href: "/bible/timeline", label: "Timeline, people & places" },
	],
	study: [
		{ href: "/", label: "Ask SureWord" },
		{ href: "/study/words", label: "Words: Hebrew & Greek" },
		{ href: "/sermons", label: "Sermon studies" },
	],
	library: [
		{ href: "/notes", label: "Notes" },
		{ href: "/bible/history", label: "Your walk & reading log" },
		{ href: "/settings#memory", label: "Memories" },
	],
	learn: [
		{ href: "/bible/learn", label: "Learn a verse" },
		{ href: "/bible/quiz", label: "Quiz me" },
		{ href: "/bible/plan", label: "Reading plan" },
	],
	together: [
		{ href: "/settings#church", label: "My church" },
		{ href: "/sermons", label: "Sermon studies from your church" },
	],
};

export function betaModuleHref(entry: Pick<BetaModule, "destination" | "slug">): string {
	return `${BETA_ROOT}/${entry.destination}/${entry.slug}`;
}

export function isBetaDestinationId(value: string): value is BetaDestinationId {
	return value === "bible" || value === "study" || value === "library" || value === "learn" || value === "together";
}

export function betaModulesFor(destination: BetaDestinationId): BetaModule[] {
	return BETA_MODULES.filter((entry) => entry.destination === destination);
}

export function findBetaModule(destination: string, slug: string): BetaModule | null {
	return BETA_MODULES.find((entry) => entry.destination === destination && entry.slug === slug) ?? null;
}

/** Which beta tab a pathname belongs to, or null outside /beta. */
export function betaSectionForPath(pathname: string): BetaSectionId | null {
	const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
	if (path === BETA_ROOT) return "home";
	if (!path.startsWith(`${BETA_ROOT}/`)) return null;
	const segment = path.slice(BETA_ROOT.length + 1).split("/")[0];
	return isBetaDestinationId(segment) ? segment : null;
}

const STATUS_ORDER: Record<BetaModuleStatus, number> = { live: 0, building: 1, planned: 2 };
const PRIORITY_ORDER: Record<BetaPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Live first, then building, then planned; by priority within each. */
export function betaModulesByProgress(modules: readonly BetaModule[] = BETA_MODULES): BetaModule[] {
	return [...modules].sort(
		(a, b) =>
			STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
			PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
			a.title.localeCompare(b.title),
	);
}

export const BETA_STATUS_LABEL: Record<BetaModuleStatus, string> = {
	live: "Live",
	building: "Building",
	planned: "Planned",
};
