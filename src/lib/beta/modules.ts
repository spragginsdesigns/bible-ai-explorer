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
		status: "live",
		issue: "LC-17655",
		summary:
			"An immersive map and timeline of Scripture. Play Paul's three journeys and the voyage to Rome, the Exodus, Abraham's travels and the Gospels' ministry stop by stop, scrub the centuries with the kings of Israel and Judah side by side, and open any place or event for its passages in the KJV.",
		capabilities: [
			"Play seven journeys stop by stop on the map, each stop with its verses from the KJV and a short note",
			"Scrub a timeline from Creation to Patmos, with patriarchs, judges, kings, prophets, the exile and the early church in lanes, every date labelled by its source",
			"Compare the kings of Israel and Judah side by side in any year, and zoom the timeline to one era",
			"Tap any place or event for its passages, how sure its site is, and a way into the reader",
			"From a verse in the reader, open the places it names in the atlas",
		],
		builtOn: ["The atlas and timeline corpus (people, places, events)", "The Ussher dating of the KJV margins", "The Bible reader"],
	},
	{
		slug: "projects",
		destination: "study",
		title: "Study Projects",
		tagline: "A focused workspace for deeper study",
		inspiredBy: "NotebookLM and Notion",
		priority: "P0",
		status: "live",
		issue: "LC-17642",
		summary:
			"A workspace for one study, such as The Book of Romans or The Life of Paul: its chapters or sections with Continue study, the passages you gather, your notes and highlights, sources you paste or upload, and the questions you are working through. The assistant answers only from the project and shows the verse or the source's own words behind every claim.",
		capabilities: [
			"Create, rename, archive and delete projects, each with a cover, a description and progress through its chapters or sections",
			"Gather passages from the reader or by reference, your notes and highlights, pasted text, and PDF or text files",
			"Ask questions answered only from the project, every claim cited and Scripture shown in the KJV",
			"Write an Overview of key themes, connected passages and study questions when you ask for it",
			"Assemble an outline or written study, then save it as a note or copy it as Markdown",
		],
		builtOn: ["The KJV reader", "Notes and highlights", "Cross-references", "The study assistant's model and doctrine"],
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
		status: "live",
		issue: "LC-17650",
		summary:
			"A study mode that asks before it tells. Pick any passage and read it in the KJV beside one question at a time, from what the verses say to what they mean and how they apply; the tutor affirms what the text supports, corrects with the verse that corrects, and checks your own conclusion against the passage, the chapter before and its cross-references.",
		capabilities: [
			"Start a close reading of any passage up to 30 verses: type it, tap a suggestion, or tap verses in a chapter",
			"Answer one question at a time, with up to three hints a question, never a lecture",
			"Ask for the tutor's own reading, labelled as interpretation, with the verses for it and against it",
			"See your conclusion checked against the text, the chapter before and cross-references",
			"Study at Beginner, Growing or Deep study; it adapts as you answer, and you can pause and pick up any session",
			"Save the session and what you learned as a note",
		],
		builtOn: ["The house AI model and SureWord's doctrinal foundation", "Cross-references", "Scripture search", "Notes"],
	},
	{
		slug: "sermons",
		destination: "study",
		title: "Sermon to Study",
		tagline: "Turn a sermon into a study you can keep",
		inspiredBy: "Meeting-notes and transcription apps",
		priority: "P2",
		status: "building",
		issue: "LC-17643",
		summary:
			"Record or upload a sermon you have permission to use. SureWord transcribes it with timestamps, finds every passage it names or quotes in the King James words, and on request writes study notes, discussion questions and verses to memorise, with the sermon's words always kept apart from Scripture. Saved sermons are searchable in the Knowledge Vault.",
		capabilities: [
			"Upload or record a sermon and get a timestamped transcript",
			"See every passage it names or quotes, in the KJV beside the sermon's words, opened in the reader",
			"Get study notes, discussion questions and memory verses for Learn a verse",
			"Compare the sermon with each passage's context and mark questions to research later",
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
		status: "live",
		issue: "LC-17653",
		summary:
			"A spoken conversation about Scripture. Ask aloud, talk over it to interrupt, ask for it another way, and ask it to read a passage, which plays from the narrated King James Bible word for word. A live transcript links every passage it cites, and each conversation is kept and can be saved as a note.",
		capabilities: [
			"Talk with the study assistant out loud, and interrupt it mid-answer just by speaking",
			"Ask it to read any chapter or verses, played from the narrated KJV, never a synthetic voice",
			"Get answers grounded in SureWord's Scripture search, with the references said and linked on screen",
			"Keep every conversation and save it as a note with the passages quoted in full",
		],
		builtOn: ["The study assistant's Scripture tools", "The narrated KJV (Audio Bible)", "Notes"],
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
		status: "live",
		issue: "LC-17654",
		summary:
			"Interactive diagrams of the great themes of Scripture where every idea and every connection opens the verses behind it: seven reviewed maps (the Trinity, the covenants, salvation, the order of the Gospels' events, the armour of God, the fall and redemption, and Christ in prophecy), plus a map of any theme built only from the verses SureWord retrieves for it.",
		capabilities: [
			"Explore seven ready-made maps of core doctrines, reviewed for doctrinal care",
			"Generate a map for any theme from the verses Scripture search retrieves, then edit its ideas, passages and links before saving",
			"Pan, zoom and tap an idea or a connection to read its passages in the KJV, open them in the reader, or focus one branch",
			"See where Christians read a passage differently, with the main readings side by side, each with its verses and none presented as settled",
			"Save maps to your Library, where the Vault and the Graph find them by passage and topic",
		],
		builtOn: ["The bundled KJV and the Bible reader", "Scripture search", "The study assistant's house model", "The shared study store"],
	},
	{
		slug: "rooms",
		destination: "study",
		title: "Study Rooms",
		tagline: "Study the Word together",
		inspiredBy: "Google Docs and shared workspaces",
		priority: "P3",
		status: "live",
		issue: "LC-17647",
		summary:
			"Shared rooms for a family, small group or class: passages in the KJV, discussion questions with replies, a reading plan the room keeps together and shared notes. Everyone keeps a private study of their own, and nothing private reaches the room unless its owner shares a copy.",
		capabilities: [
			"Create a room and invite people with a link you can replace or turn off",
			"Share passages, ask questions and talk them through in replies",
			"Read a plan together, and see which day everyone following it is on",
			"Add shared notes, or share a copy of one of your own notes, while the rest stay private",
			"As the owner, remove members, turn off the link, and archive or restore the room",
		],
		builtOn: ["Reading plans", "Notes", "The bundled KJV", "Shared answers' capability links"],
	},
	{
		slug: "vault",
		destination: "library",
		title: "Knowledge Vault",
		tagline: "Everything you have studied, in one place",
		inspiredBy: "Notion, Evernote and Readwise",
		priority: "P0",
		status: "live",
		issue: "LC-17645",
		summary:
			"One searchable library of everything you have studied in SureWord, read where it lives: notes with their links, highlights, chats, reading, verses you are learning by heart, memories, your church's sermon studies and every beta study. Ask what you have studied about the Holy Spirit in the last six months and get an answer drawn only from your own study, with every point linked to its source. See a passage or topic over time, pick up where you left off, and export it all.",
		capabilities: [
			"Search everything you have studied by words and by meaning, and filter by kind, passage, topic and date",
			"Ask questions of your own study history, answered only from it, every point linked to its source",
			"See one passage or topic over time, with an earlier and a later reading side by side",
			"Pick up where you left off across the reader, chats, notes, Learn a verse and every beta module",
			"Export the whole vault as Markdown or JSON",
		],
		builtOn: ["Notes, wikilinks and note search", "Highlights", "Conversations", "Reading log", "Learn a verse", "Memories", "Sermon studies", "The beta study store"],
	},
	{
		slug: "graph",
		destination: "library",
		title: "Living Study Graph",
		tagline: "See how everything you study connects",
		inspiredBy: "Obsidian and Roam Research",
		priority: "P2",
		status: "live",
		issue: "LC-17646",
		summary:
			"A connected map of your passages, topics, notes, chats, sermon studies and every beta study, with passages around a ring in Bible order. Wikilinks, your links and the cross-references between the passages you study join them, and when a study shares a topic, a passage or a cross-reference with an earlier one (justification in Romans, then Galatians) it offers to connect them, with the reason.",
		capabilities: [
			"Pan, zoom and tap a graph of your passages, topics, notes, chats and studies",
			"Ask for suggested connections between studies, each with its reason, and connect or dismiss them",
			"Follow a topic across books and over time",
			"Search the graph and open any node where it lives",
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
		status: "live",
		issue: "LC-17648",
		summary:
			"Courses through Scripture: Foundations of the Christian Faith, Mastering Romans, How to Read and Interpret Scripture and The Life of Paul, twelve short lessons each. Every lesson is a KJV reading and questions answered from the verse that adapt to what you have shown you understand, and a personal curriculum can be built around any topic, foundations first.",
		capabilities: [
			"Take short lessons: read the passage, then multiple choice, fill in the blank, put in order and match the verse, with the verse shown after every answer",
			"Follow a path map of units and lessons, pick up at the same question, and test your understanding at each unit's checkpoint",
			"Get questions that adapt: missed ones come back until they stick, and mastered truths move on to deeper questions",
			"Ask for a curriculum around any topic, foundations first, with each lesson written and checked against the KJV when you open it",
		],
		builtOn: ["Quiz me (its verse-grounding rules)", "Learn a verse", "Reading plans", "Notes", "Scripture search"],
	},
	{
		slug: "memory",
		destination: "learn",
		title: "Scripture Memory",
		tagline: "Make God's Word stick",
		inspiredBy: "Anki and Readwise",
		priority: "P1",
		status: "live",
		issue: "LC-17651",
		summary:
			"A daily review over your Learn a verse cards: multiple choice, fill in the blank, first letters, the whole verse typed from memory and comprehension questions answered from the verse. Every answer moves the same spaced-repetition schedule Learn a verse keeps, and new cards come from verses and passages in your own study.",
		capabilities: [
			"Review what is due today, with your progress, the right text after every answer and when the verse comes back",
			"Practise five ways: multiple choice, fill in the blank, first letters, type the whole verse and comprehension questions",
			"Make cards from your highlights, studies, notes, beta work and chats, or from any reference, with a preview first and passages like Ephesians 2:8-9",
			"See what you know, are learning and have due, by book and by verse",
		],
		builtOn: ["Learn a verse (cards, reviews, schedule, masking ladder)", "Quiz me's answer checks", "Highlights", "Notes", "Saved studies"],
	},
	{
		slug: "growth",
		destination: "learn",
		title: "Habits & Reflection",
		tagline: "Small steps, lasting impact",
		inspiredBy: "Todoist and habit trackers",
		priority: "P2",
		status: "live",
		issue: "LC-17652",
		summary:
			"Habits you choose for time with God (Bible reading, prayer and reflection, Scripture memory, study, or your own) with a weekly target; the ones SureWord can see are counted from what you already do, the rest you mark. A private reflection journal, and follow-ups on the insights you chose to put into practice. Never a streak or a score for your walk with God.",
		capabilities: [
			"Choose your own habits and how many days a week, with an optional in-app reminder time",
			"See the week at a glance: reading counted from your reading log, memory from Learn a verse, study from your Beta studies, the rest marked by you",
			"Look back over earlier weeks, gently: what you kept, never what you missed",
			"Write private reflections, with optional prompts, that no AI sees unless you choose Talk it over",
			"Put an insight into practice and get a follow-up when you asked for one",
		],
		builtOn: ["Your walk and reading log", "Learn a verse", "SureWord Beta's study store", "Ask SureWord (Talk it over)"],
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
		status: "live",
		issue: "LC-17657",
		summary:
			"A child-safe space a parent opens on their own device: twelve Bible adventures read aloud from the KJV, each retold for the child's age beside the text, with questions answered in the verse and a verse to learn, and a star for each one finished. Children never get an account, never chat with the assistant and never type anything, and a child's profile holds only a first name and an age band.",
		capabilities: [
			"Add a child profile, just a first name or nickname and an age band (3-5, 6-8 or 9-12), on a parent's account",
			"Go on twelve Bible adventures, from Creation to the Resurrection: the KJV passage read aloud with each verse highlighted, and a retelling for the child's age beside it",
			"Answer questions made for the child's age, with the answer always in the verse, and earn a star for each adventure",
			"Learn each adventure's verse with a memory game on Learn a verse's ladder",
			"Play full screen with no links out, and leave Kids only after a grown-up's check",
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
		status: "live",
		issue: "LC-17656",
		summary:
			"A home for a small group or Bible class, kept in a Study Room: the group's reading plan week by week, each week's passage in the KJV, discussion around questions a leader prepares with SureWord's help, a guided session the leader runs with its notes saved to the group, and a prayer circle. One member can bring a whole group into SureWord, and everyone keeps a private study of their own.",
		capabilities: [
			"Start a group, invite members with a link, and name its leaders",
			"Follow the group's reading plan week by week and see where everyone is",
			"Discuss each week's passage around questions a leader prepares with SureWord's help, with Scripture quoted from the KJV and interpretation labelled",
			"Run a guided session step by step: read the passage aloud or together, observe, discuss, pray, with the notes saved to the group",
			"Share prayer requests in a prayer circle, mark that you prayed, and mark your own answered",
		],
		builtOn: ["Study Rooms", "Reading plans", "Prayer requests", "The audio Bible", "SureWord Beta's study store"],
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
