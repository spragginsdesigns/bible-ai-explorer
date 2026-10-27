/**
 * The ready-made Concept Maps (LC-17654, docs/beta/maps.md): written once,
 * reviewed for doctrinal care, and committed as data. Nothing here is
 * generated at runtime.
 *
 * How they are written:
 * - Every node names the KJV passages behind it, and every connection carries
 *   verses too (its own `viaRefs`, or the node's first passage).
 * - Labels and notes are SureWord's summary in plain words, never presented as
 *   Scripture; the sheet prints the verses themselves from the bundled KJV.
 * - Where Christians read a passage differently, a `question` holds the main
 *   readings side by side as `reading`s, each with its own verses, written
 *   fairly and none presented as settled. The settled doctrines of SureWord's
 *   foundation (one God in three persons, salvation by grace through faith,
 *   Christ's bodily return) are never put up as one reading among others.
 *
 * No imports on purpose: `tests/beta-maps.test.mjs` loads this file with
 * Node's type stripping and checks every passage against the bundled KJV.
 */

export interface LibraryNodeSource {
	/** Stable within its map; derived from the label when absent. Needed by links. */
	id?: string;
	label: string;
	note: string;
	refs: string[];
	kind?: "question" | "reading";
	/** The connection from the parent: a short relation ("fulfilled in"), or "" for none. */
	via?: string;
	/** Verses for that connection; the node's first passage when absent. */
	viaRefs?: string[];
	children?: LibraryNodeSource[];
}

export interface LibraryLinkSource {
	from: string;
	to: string;
	label: string;
	refs: string[];
}

export interface LibraryMapSource {
	slug: string;
	title: string;
	summary: string;
	topics: string[];
	root: LibraryNodeSource;
	links?: LibraryLinkSource[];
}

export const LIBRARY_MAP_SOURCES: readonly LibraryMapSource[] = [
	{
		slug: "trinity",
		title: "The Trinity",
		summary: "One God, and the Father, the Son and the Holy Ghost each God and distinct from one another: what the verses teach together.",
		topics: ["trinity", "god", "the father", "jesus christ", "holy spirit"],
		root: {
			label: "One God in three persons",
			note: "Scripture teaches that there is one God, and calls the Father, the Son and the Holy Ghost each God, distinct from one another. The word Trinity names what these verses teach together.",
			refs: ["Deuteronomy 6:4", "Matthew 28:19", "2 Corinthians 13:14"],
			children: [
				{
					id: "one-god",
					label: "There is one God",
					via: "first",
					note: "Israel's confession, repeated by Jesus and the apostles: not many gods, but one.",
					refs: ["Deuteronomy 6:4", "Isaiah 45:5", "Mark 12:29", "1 Corinthians 8:4-6"],
					children: [
						{ id: "hear-israel", label: "Hear, O Israel", via: "confessed", note: "The LORD our God is one LORD, to be loved with all the heart.", refs: ["Deuteronomy 6:4-5", "Mark 12:29-30"] },
						{ label: "Beside me there is no God", via: "declared", note: "God Himself declares that He is the first and the last, and there is none else.", refs: ["Isaiah 44:6", "Isaiah 45:5-6"] },
						{ label: "The devils also believe", via: "", note: "Believing that God is one is right, and not enough on its own.", refs: ["James 2:19"] },
					],
				},
				{
					label: "The Father is God",
					via: "the Father",
					note: "The Father sent the Son, and is the one God of whom are all things.",
					refs: ["John 6:27", "1 Corinthians 8:6", "Ephesians 4:6"],
					children: [
						{ label: "The Father sent the Son", via: "sent", note: "The Father gave His only begotten Son and sent Him to be the Saviour of the world.", refs: ["1 John 4:14", "John 3:16-17"] },
						{ label: "Chosen in Christ", via: "chose", note: "The Father blessed and chose His people in Christ before the foundation of the world.", refs: ["Ephesians 1:3-5"] },
					],
				},
				{
					label: "The Son is God",
					via: "the Son",
					note: "The Word who was with God and was God became flesh. The apostles call Jesus God, and He receives worship.",
					refs: ["John 1:1-3", "John 1:14", "Colossians 2:9"],
					children: [
						{ id: "word-was-god", label: "The Word was God", via: "in the beginning", note: "In the beginning the Word already was, was with God, and was God. All things were made by Him.", refs: ["John 1:1-3"] },
						{ label: "Before Abraham was, I am", via: "the name I AM", note: "Jesus takes the name God gave Moses at the bush, and His hearers took up stones.", refs: ["John 8:58-59", "Exodus 3:14"] },
						{ id: "my-lord-my-god", label: "My Lord and my God", via: "confessed", note: "Thomas worships the risen Christ as God, and Jesus receives it.", refs: ["John 20:28-29"] },
						{ label: "The fulness of the Godhead bodily", via: "dwells in Him", note: "All the fulness of the Godhead dwells in Christ, and the Father says to the Son, Thy throne, O God.", refs: ["Colossians 2:9", "Hebrews 1:8"] },
					],
				},
				{
					label: "The Holy Ghost is God",
					via: "the Holy Ghost",
					note: "The Spirit is called God, is present everywhere and eternal, and acts as a person who teaches and can be grieved.",
					refs: ["Acts 5:3-4", "1 Corinthians 3:16", "Hebrews 9:14"],
					children: [
						{ label: "Lying to the Holy Ghost is lying to God", via: "called God", note: "Peter says Ananias lied to the Holy Ghost, and then that he lied unto God.", refs: ["Acts 5:3-4"] },
						{ label: "Whither shall I go from thy spirit?", via: "everywhere present", note: "The Spirit is present everywhere, as only God is.", refs: ["Psalm 139:7-10"] },
						{ label: "He shall teach you all things", via: "a person", note: "The Comforter teaches, brings to remembrance and can be grieved: a person, not a force.", refs: ["John 14:26", "Ephesians 4:30"] },
						{ label: "The eternal Spirit", via: "eternal", note: "The Spirit is eternal and searches the deep things of God.", refs: ["Hebrews 9:14", "1 Corinthians 2:10-11"] },
					],
				},
				{
					label: "Three distinct persons",
					via: "and yet",
					note: "The Father, the Son and the Holy Ghost are each God, and Scripture never confuses one with another.",
					refs: ["Matthew 3:16-17", "John 14:16-17", "1 John 5:7"],
					children: [
						{ label: "At the Jordan", via: "seen together", note: "The Son is baptized, the Spirit descends like a dove, and the Father speaks from heaven, all at once.", refs: ["Matthew 3:16-17"] },
						{ label: "Another Comforter", via: "sent", note: "The Son prays the Father, and the Father gives the Spirit: three persons in one promise.", refs: ["John 14:16-17", "John 15:26"] },
						{ label: "In the name of the Father, Son and Holy Ghost", via: "baptized in", note: "One name and three persons, in the commission Jesus gave His church.", refs: ["Matthew 28:19"] },
						{ label: "These three are one", via: "bear record", note: "Three bear record in heaven, and these three are one; the apostle's blessing names all three.", refs: ["1 John 5:7", "2 Corinthians 13:14"] },
					],
				},
				{
					label: "Foreshadowed in the Old Testament",
					via: "foreshadowed",
					note: "Christians have long read these passages as early glimpses of the three persons, made plain in the New Testament.",
					refs: ["Genesis 1:26", "Isaiah 48:16"],
					children: [
						{ id: "let-us-make-man", label: "Let us make man", via: "at creation", note: "God speaks of Himself as us, and the Spirit of God moves upon the face of the waters.", refs: ["Genesis 1:26-27", "Genesis 1:1-2"] },
						{ label: "The Lord GOD, and his Spirit, hath sent me", via: "in the prophets", note: "The one sent speaks of the Lord GOD and His Spirit sending Him; Jesus read Isaiah 61 of Himself.", refs: ["Isaiah 48:16", "Isaiah 61:1", "Luke 4:18-21"] },
					],
				},
			],
		},
		links: [
			{ from: "hear-israel", to: "my-lord-my-god", label: "one God, one Lord", refs: ["1 Corinthians 8:6"] },
			{ from: "let-us-make-man", to: "word-was-god", label: "all things made by Him", refs: ["John 1:3", "Colossians 1:16"] },
		],
	},
	{
		slug: "covenants",
		title: "The covenants",
		summary: "God's covenants with Noah, Abraham, Israel at Sinai and David, and the new covenant in Christ's blood, each with its promise, its sign and its verses.",
		topics: ["covenants", "promise", "law", "new covenant", "kingdom of god"],
		root: {
			label: "The covenants of promise",
			note: "God binds Himself by covenant, from Noah to the new covenant in Christ's blood. Each promise opens onto the next.",
			refs: ["Ephesians 2:12", "Hebrews 8:6"],
			children: [
				{
					label: "Noahic covenant",
					via: "with Noah",
					note: "After the flood God promises every living creature that the waters shall never again destroy all flesh.",
					refs: ["Genesis 9:8-17"],
					children: [
						{ label: "With every living creature", via: "made with", note: "The promise covers Noah, his seed after him and every beast: a covenant with all the earth.", refs: ["Genesis 9:9-11"] },
						{ label: "The bow in the cloud", via: "its sign", note: "God sets His bow in the cloud as the token of the covenant, and will remember it.", refs: ["Genesis 9:12-16"] },
						{ label: "While the earth remaineth", via: "promised", note: "Seedtime and harvest, cold and heat, summer and winter, day and night shall not cease.", refs: ["Genesis 8:21-22"] },
					],
				},
				{
					label: "Abrahamic covenant",
					via: "with Abraham",
					note: "God calls Abram and promises a land, a seed as the stars, and blessing for all families of the earth through him.",
					refs: ["Genesis 12:1-3", "Genesis 15:5-6", "Genesis 17:7-8"],
					children: [
						{ label: "Land, seed and blessing", via: "promised", note: "A land to possess, a great nation and a great name, and in him all families of the earth blessed.", refs: ["Genesis 12:1-3", "Genesis 13:14-16"] },
						{ label: "Abram believed the LORD", via: "received by faith", note: "He believed in the LORD, and He counted it to him for righteousness.", refs: ["Genesis 15:5-6"] },
						{ label: "The covenant between the pieces", via: "sealed", note: "While a deep sleep is on Abram, a smoking furnace and a burning lamp pass between the pieces, and the LORD gives the land to his seed.", refs: ["Genesis 15:9-18"] },
						{ label: "The token of circumcision", via: "its sign", note: "Every male is circumcised as a token of the covenant between God and Abraham's seed.", refs: ["Genesis 17:9-11"] },
						{ id: "seed-is-christ", label: "In thy seed shall all nations be blessed", via: "fulfilled in", note: "God swears by Himself; Paul shows that the promised seed is Christ.", refs: ["Genesis 22:16-18", "Galatians 3:16"] },
					],
				},
				{
					id: "sinai",
					label: "Mosaic covenant at Sinai",
					via: "with Israel",
					note: "God brings Israel out of Egypt and gives His law at Sinai, and the people answer, All that the LORD hath said will we do.",
					refs: ["Exodus 19:5-6", "Exodus 24:7-8"],
					children: [
						{ label: "If ye will obey my voice", via: "offered", note: "Israel is to be a peculiar treasure, a kingdom of priests and an holy nation.", refs: ["Exodus 19:5-6"] },
						{ label: "The ten commandments", via: "its law", note: "God speaks the ten commandments from the mount.", refs: ["Exodus 20:1-17"] },
						{ label: "The blood of the covenant", via: "sealed with", note: "Moses sprinkles the people with blood: Behold the blood of the covenant.", refs: ["Exodus 24:7-8"] },
						{ label: "The sabbath as a sign", via: "its sign", note: "The sabbath is a sign between the LORD and the children of Israel for ever.", refs: ["Exodus 31:13", "Exodus 31:16-17"] },
						{ label: "Our schoolmaster to bring us unto Christ", via: "pointed to", note: "The law was added because of transgressions till the seed should come, to bring us to Christ.", refs: ["Galatians 3:19", "Galatians 3:24-25"] },
					],
				},
				{
					label: "Davidic covenant",
					via: "with David",
					note: "God promises David a house, a throne and a kingdom established for ever.",
					refs: ["2 Samuel 7:12-16", "Psalm 89:3-4"],
					children: [
						{ label: "A throne for ever", via: "promised", note: "David's seed will build a house for God's name, and his throne shall be established for ever.", refs: ["2 Samuel 7:12-16"] },
						{ label: "Sworn unto David", via: "sworn", note: "God swears by His holiness that He will not lie unto David.", refs: ["Psalm 89:3-4", "Psalm 89:34-37"] },
						{ id: "son-of-david", label: "The Son of David", via: "fulfilled in", note: "Jesus is born of David's line, and the angel promises Him the throne of His father David.", refs: ["Matthew 1:1", "Luke 1:31-33"] },
						{
							label: "How is David's throne fulfilled?",
							kind: "question",
							via: "Christians differ",
							note: "All agree that Jesus is the promised Son of David. They read differently when and how He sits on David's throne.",
							refs: ["Luke 1:32-33", "Acts 2:29-36"],
							children: [
								{ label: "Christ reigns on it now", kind: "reading", via: "one reading", note: "Raised from the dead and seated at God's right hand, Christ already reigns as David's heir; Peter applies God's oath to David to the resurrection.", refs: ["Acts 2:29-36", "Hebrews 1:3", "Ephesians 1:20-22"] },
								{ label: "Christ will reign on it on the earth", kind: "reading", via: "another reading", note: "The throne is a coming kingdom on the earth, when Christ returns and reigns over the house of Jacob.", refs: ["Luke 1:32-33", "Matthew 19:28", "Jeremiah 23:5-6", "Revelation 20:4-6"] },
								{ label: "Begun now, completed at His return", kind: "reading", via: "a third reading", note: "Christ reigns now, but we see not yet all things put under Him; the kingdom comes in full when He returns.", refs: ["1 Corinthians 15:24-25", "Hebrews 2:8-9", "Revelation 11:15"] },
							],
						},
					],
				},
				{
					id: "new-covenant",
					label: "The new covenant",
					via: "fulfilled in",
					note: "God promises a covenant not like Sinai: His law written in the heart and sins remembered no more, sealed in Christ's blood.",
					refs: ["Jeremiah 31:31-34", "Luke 22:20", "Hebrews 8:6-13"],
					children: [
						{ label: "My law in their inward parts", via: "promised", note: "God writes His law in their hearts and will be their God.", refs: ["Jeremiah 31:33", "Hebrews 8:10"] },
						{ label: "Their sins I will remember no more", via: "promised", note: "Full forgiveness: where remission of these is, there is no more offering for sin.", refs: ["Jeremiah 31:34", "Hebrews 10:16-18"] },
						{ label: "A new heart and a new spirit", via: "promised", note: "God gives a heart of flesh and puts His Spirit within, to walk in His statutes.", refs: ["Ezekiel 36:26-27"] },
						{ label: "The new testament in my blood", via: "sealed with", note: "At the last supper Jesus gives the cup: the new testament in His blood, shed for the remission of sins.", refs: ["Luke 22:20", "Matthew 26:28"] },
						{ label: "A better covenant", via: "mediated by", note: "Christ is the mediator of a better covenant, established upon better promises.", refs: ["Hebrews 8:6", "Hebrews 9:15"] },
					],
				},
			],
		},
		links: [
			{ from: "seed-is-christ", to: "new-covenant", label: "the blessing of Abraham", refs: ["Galatians 3:14", "Galatians 3:29"] },
			{ from: "sinai", to: "new-covenant", label: "not like Sinai", refs: ["Jeremiah 31:32", "Hebrews 8:9"] },
			{ from: "son-of-david", to: "seed-is-christ", label: "son of David, son of Abraham", refs: ["Matthew 1:1"] },
		],
	},
	{
		slug: "salvation",
		title: "Salvation",
		summary: "Our need, God's provision in Christ, repentance and faith, and the three tenses of salvation: justified, sanctified, glorified.",
		topics: ["salvation", "justification", "sanctification", "glorification", "grace", "faith"],
		root: {
			label: "Salvation in Christ",
			note: "Salvation is God's gracious gift through faith in Jesus Christ. Those He justifies He also sanctifies and will glorify.",
			refs: ["Ephesians 2:8-9", "Romans 8:29-30"],
			children: [
				{
					label: "Our need",
					via: "begins with",
					note: "Every descendant of Adam has sinned and stands under just condemnation, unable to save himself.",
					refs: ["Romans 3:23", "Romans 6:23", "Ephesians 2:1-3"],
					children: [
						{ label: "All have sinned", via: "", note: "There is none righteous, no, not one.", refs: ["Romans 3:10-12", "Romans 3:23"] },
						{ label: "The wages of sin is death", via: "", note: "Sin earns death; eternal life is the gift of God through Jesus Christ.", refs: ["Romans 6:23"] },
						{ label: "Dead in trespasses and sins", via: "", note: "By nature children of wrath, walking according to the course of this world.", refs: ["Ephesians 2:1-3"] },
					],
				},
				{
					label: "God's provision in Christ",
					via: "answered by",
					note: "God commends His love: Christ died for the ungodly, bore our sins, and rose again.",
					refs: ["Romans 5:8", "1 Peter 2:24", "1 Corinthians 15:3-4"],
					children: [
						{ label: "While we were yet sinners", via: "", note: "God shows His love in that Christ died for us while we were still sinners.", refs: ["Romans 5:6-8", "John 3:16"] },
						{ label: "He bare our sins", via: "", note: "He was wounded for our transgressions, and the LORD laid on Him the iniquity of us all.", refs: ["Isaiah 53:5-6", "1 Peter 2:24"] },
						{ label: "Made sin for us", via: "", note: "He who knew no sin was made sin for us, that we might be made the righteousness of God in Him.", refs: ["2 Corinthians 5:21"] },
						{ label: "Raised for our justification", via: "", note: "He died for our sins, was buried, and rose again the third day according to the scriptures.", refs: ["Romans 4:25", "1 Corinthians 15:3-4"] },
					],
				},
				{
					label: "Repentance and faith",
					via: "received by",
					note: "God calls all men to repent and believe the gospel; whosoever shall call upon the name of the Lord shall be saved.",
					refs: ["Mark 1:15", "Acts 20:21", "Romans 10:9-13"],
					children: [
						{ label: "Repent ye, and believe the gospel", via: "", note: "Turning from sin and trusting the good news belong together.", refs: ["Mark 1:15", "Acts 3:19"] },
						{ label: "Confess and believe", via: "", note: "With the heart man believeth unto righteousness, and with the mouth confession is made unto salvation.", refs: ["Romans 10:9-10"] },
						{ id: "grace-through-faith", label: "By grace through faith", via: "", note: "Salvation is the gift of God, not of works, lest any man should boast.", refs: ["Ephesians 2:8-9"] },
						{ label: "Ye must be born again", via: "", note: "Not by works of righteousness, but by the washing of regeneration and renewing of the Holy Ghost.", refs: ["John 3:3-7", "Titus 3:5"] },
					],
				},
				{
					id: "justification",
					label: "Justification",
					via: "declared righteous",
					note: "God declares the believing sinner righteous, freely by His grace, through the redemption that is in Christ Jesus.",
					refs: ["Romans 3:24-26", "Romans 5:1"],
					children: [
						{ label: "Freely by his grace", via: "", note: "Justified freely: God is just, and the justifier of him which believeth in Jesus.", refs: ["Romans 3:24-26"] },
						{ label: "Counted for righteousness", via: "", note: "To him that worketh not, but believeth, his faith is counted for righteousness.", refs: ["Romans 4:3-5"] },
						{ label: "Not by the works of the law", via: "", note: "A man is not justified by the works of the law, but by the faith of Jesus Christ.", refs: ["Galatians 2:16"] },
						{ label: "Peace with God", via: "", note: "Being justified by faith, we have peace with God through our Lord Jesus Christ.", refs: ["Romans 5:1-2"] },
						{ label: "No condemnation", via: "", note: "Who shall lay any thing to the charge of God's elect? It is God that justifieth.", refs: ["Romans 8:1", "Romans 8:33-34"] },
					],
				},
				{
					label: "Sanctification",
					via: "made holy",
					note: "God sets His people apart in Christ once for all, and goes on making them holy by His Spirit and His word.",
					refs: ["Hebrews 10:10", "1 Thessalonians 4:3", "John 17:17"],
					children: [
						{ label: "Sanctified once for all", via: "", note: "By one offering He hath perfected for ever them that are sanctified.", refs: ["Hebrews 10:10", "Hebrews 10:14"] },
						{ label: "Changed into the same image", via: "", note: "Beholding the glory of the Lord, believers are changed from glory to glory.", refs: ["2 Corinthians 3:18", "Romans 12:2"] },
						{ label: "God worketh in you", via: "", note: "Work out your own salvation with fear and trembling, for it is God which worketh in you.", refs: ["Philippians 2:12-13", "Philippians 1:6"] },
						{ label: "The fruit of the Spirit", via: "", note: "Love, joy, peace and the rest grow as believers walk in the Spirit.", refs: ["Galatians 5:22-25"] },
						{ id: "good-works", label: "Created unto good works", via: "", note: "Good works are the fruit of living faith, never payment for salvation.", refs: ["Ephesians 2:10", "James 2:17-18"] },
					],
				},
				{
					id: "glorification",
					label: "Glorification",
					via: "made like Him",
					note: "Whom He justified, them He also glorified: believers will be raised and made like Christ.",
					refs: ["Romans 8:30", "1 John 3:2"],
					children: [
						{ label: "We shall be like him", via: "", note: "When He shall appear we shall be like Him, for we shall see Him as He is.", refs: ["1 John 3:2-3"] },
						{ label: "Fashioned like his glorious body", via: "", note: "The Lord Jesus will change our vile body, that it may be fashioned like unto His glorious body.", refs: ["Philippians 3:20-21"] },
						{ label: "Raised incorruptible", via: "", note: "In a moment the dead shall be raised incorruptible, and death is swallowed up in victory.", refs: ["1 Corinthians 15:51-54"] },
						{ label: "The glory which shall be revealed", via: "", note: "The sufferings of this present time are not worthy to be compared with the glory to come.", refs: ["Romans 8:18", "Romans 8:23"] },
					],
				},
				{
					label: "Can a true believer finally fall away?",
					kind: "question",
					via: "Christians differ",
					note: "Both readings hold that salvation is by grace through faith and that saving faith goes on believing. They differ on what the warning passages mean.",
					refs: ["John 10:27-29", "Hebrews 6:4-6"],
					children: [
						{ label: "Kept by God to the end", kind: "reading", via: "one reading", note: "Those Christ gives eternal life shall never perish. The warnings are means God uses to keep His own, and those who leave show they were never truly His.", refs: ["John 10:27-29", "Romans 8:38-39", "Philippians 1:6", "1 John 2:19"] },
						{ label: "A believer can depart from the faith", kind: "reading", via: "another reading", note: "The warnings describe real believers who could turn away; we are kept as we continue in the faith.", refs: ["Hebrews 6:4-6", "Colossians 1:21-23", "Hebrews 3:12-14", "2 Peter 2:20-21"] },
					],
				},
			],
		},
		links: [
			{ from: "justification", to: "glorification", label: "justified, then glorified", refs: ["Romans 8:30"] },
			{ from: "grace-through-faith", to: "good-works", label: "saved unto good works", refs: ["Ephesians 2:8-10"] },
		],
	},
	{
		slug: "life-of-christ",
		title: "The order of the Gospels' events",
		summary: "The four Gospels tell one life. The main events of Christ's life in the order most harmonies give, with the passage in each Gospel.",
		topics: ["gospels", "life of christ", "chronology", "jesus christ"],
		root: {
			label: "The life of Jesus Christ in order",
			note: "Matthew, Mark, Luke and John tell one life. This map follows the main events in the order most harmonies give them.",
			refs: ["Luke 1:1-4", "John 20:30-31"],
			children: [
				{
					label: "1. Birth and early years",
					via: "",
					note: "The eternal Word becomes flesh, born of a virgin in Bethlehem, and grows up in Nazareth.",
					refs: ["Matthew 1:18-2:23", "Luke 2:1-52"],
					children: [
						{ label: "The Word made flesh", via: "", note: "The Word who was with God dwelt among us, full of grace and truth.", refs: ["John 1:1-14"] },
						{ label: "Born of a virgin", via: "", note: "The angel comes to Mary, and Joseph is told that what is conceived in her is of the Holy Ghost.", refs: ["Luke 1:26-35", "Matthew 1:18-25"] },
						{ label: "Born in Bethlehem", via: "", note: "Laid in a manger because there was no room for them in the inn.", refs: ["Luke 2:1-7", "Matthew 2:1"] },
						{ label: "Shepherds and the angels", via: "", note: "Unto you is born this day in the city of David a Saviour, which is Christ the Lord.", refs: ["Luke 2:8-20"] },
						{ label: "The wise men and Egypt", via: "", note: "Wise men worship the young child; Joseph takes Him into Egypt until Herod is dead.", refs: ["Matthew 2:1-15"] },
						{ label: "In the temple at twelve", via: "", note: "Wist ye not that I must be about my Father's business?", refs: ["Luke 2:41-52"] },
					],
				},
				{
					label: "2. Preparation",
					via: "",
					note: "John prepares the way; Jesus is baptized and tempted in the wilderness.",
					refs: ["Matthew 3:1-4:11"],
					children: [
						{ label: "John the Baptist preaches", via: "", note: "Repent ye: for the kingdom of heaven is at hand.", refs: ["Matthew 3:1-12", "Mark 1:2-8", "Luke 3:1-18"] },
						{ label: "The baptism of Jesus", via: "", note: "This is my beloved Son, in whom I am well pleased.", refs: ["Matthew 3:13-17", "Mark 1:9-11", "Luke 3:21-22"] },
						{ label: "Tempted in the wilderness", via: "", note: "Forty days, three temptations, and three answers from Scripture.", refs: ["Matthew 4:1-11", "Luke 4:1-13"] },
					],
				},
				{
					label: "3. Early ministry",
					via: "",
					note: "Before the ministry in Galilee, John records the first disciples, the first sign, Nicodemus and the woman of Samaria.",
					refs: ["John 1:35-4:42"],
					children: [
						{ label: "The first disciples", via: "", note: "Andrew, Peter, Philip and Nathanael follow Jesus.", refs: ["John 1:35-51"] },
						{ label: "Water made wine at Cana", via: "", note: "The beginning of miracles, and His disciples believed on Him.", refs: ["John 2:1-11"] },
						{ label: "The temple cleansed at the Passover", via: "", note: "Make not my Father's house an house of merchandise.", refs: ["John 2:13-17"] },
						{ label: "Nicodemus: Ye must be born again", via: "", note: "For God so loved the world, that he gave his only begotten Son.", refs: ["John 3:1-21"] },
						{ label: "The woman at the well", via: "", note: "Living water, and many Samaritans believe that this is the Christ.", refs: ["John 4:1-42"] },
						{
							label: "How long was His public ministry?",
							kind: "question",
							via: "Christians differ",
							note: "John names the Passovers of the ministry. Christians count them differently, so harmonies give a little over two years or about three and a half.",
							refs: ["John 2:13", "John 6:4", "John 11:55"],
							children: [
								{ label: "Four Passovers: about three and a half years", kind: "reading", via: "one reading", note: "Reads the unnamed feast of John 5:1 as a Passover, making four in all.", refs: ["John 2:13", "John 5:1", "John 6:4", "John 11:55"] },
								{ label: "Three Passovers: a little over two years", kind: "reading", via: "another reading", note: "Counts only the three Passovers John names; the feast of John 5:1 is another feast.", refs: ["John 2:13", "John 6:4", "John 11:55"] },
							],
						},
					],
				},
				{
					label: "4. Ministry in Galilee",
					via: "",
					note: "Jesus preaches, heals and calls the twelve in Galilee, and Peter confesses Him the Christ.",
					refs: ["Matthew 4:12-17", "Mark 1:14-15"],
					children: [
						{ label: "Rejected at Nazareth", via: "", note: "He reads Isaiah in the synagogue: This day is this scripture fulfilled in your ears.", refs: ["Luke 4:16-30"] },
						{ label: "Fishers of men", via: "", note: "Peter, Andrew, James and John leave their nets and follow Him.", refs: ["Matthew 4:18-22", "Luke 5:1-11"] },
						{ label: "The twelve chosen", via: "", note: "After a night in prayer He ordains twelve to be with Him and to preach.", refs: ["Mark 3:13-19", "Luke 6:12-16"] },
						{ label: "The sermon on the mount", via: "", note: "The beatitudes, the Lord's prayer, and the wise man who built his house upon a rock.", refs: ["Matthew 5:1-7:29"] },
						{ label: "Five thousand fed", via: "", note: "The one miracle before the resurrection that all four Gospels record.", refs: ["Matthew 14:13-21", "Mark 6:30-44", "Luke 9:10-17", "John 6:1-14"] },
						{ id: "peters-confession", label: "Peter's confession", via: "", note: "Thou art the Christ, the Son of the living God.", refs: ["Matthew 16:13-20", "Mark 8:27-30", "Luke 9:18-21"] },
						{ label: "The transfiguration", via: "", note: "His face shines as the sun, and the Father says, Hear ye him.", refs: ["Matthew 17:1-8", "Mark 9:2-8", "Luke 9:28-36"] },
					],
				},
				{
					label: "5. Toward Jerusalem",
					via: "",
					note: "He stedfastly sets His face to go to Jerusalem, teaching in parables and raising Lazarus.",
					refs: ["Luke 9:51", "Luke 13:22"],
					children: [
						{ label: "The good Samaritan", via: "", note: "Who is my neighbour? Go, and do thou likewise.", refs: ["Luke 10:25-37"] },
						{ label: "The prodigal son", via: "", note: "This my son was dead, and is alive again; he was lost, and is found.", refs: ["Luke 15:11-32"] },
						{ id: "lazarus", label: "Lazarus raised", via: "", note: "I am the resurrection, and the life. Lazarus, come forth.", refs: ["John 11:1-44"] },
						{ label: "The rich young ruler", via: "", note: "With men it is impossible, but not with God.", refs: ["Mark 10:17-27", "Luke 18:18-27"] },
					],
				},
				{
					id: "passion-week",
					label: "6. Passion week",
					via: "",
					note: "From the entry into Jerusalem to the cross and the tomb.",
					refs: ["Matthew 21:1-27:66", "John 12:12-19:42"],
					children: [
						{ id: "triumphal-entry", label: "The triumphal entry", via: "", note: "Hosanna to the Son of David: thy King cometh unto thee.", refs: ["Matthew 21:1-11", "Mark 11:1-10", "Luke 19:28-40", "John 12:12-15"] },
						{ label: "The temple cleansed", via: "", note: "My house shall be called the house of prayer.", refs: ["Matthew 21:12-13", "Mark 11:15-17", "Luke 19:45-46"] },
						{ label: "The last supper", via: "", note: "This is my body; this cup is the new testament in my blood.", refs: ["Matthew 26:26-29", "Luke 22:14-20", "1 Corinthians 11:23-26"] },
						{ label: "Gethsemane and the betrayal", via: "", note: "Not my will, but thine, be done; Judas betrays Him with a kiss.", refs: ["Matthew 26:36-50", "Luke 22:39-48", "John 18:1-11"] },
						{ label: "Before the council and Pilate", via: "", note: "Condemned by the council, sent to Pilate, and delivered to be crucified.", refs: ["Matthew 26:57-68", "Matthew 27:11-26", "John 18:28-19:16"] },
						{ label: "Crucified and buried", via: "", note: "It is finished; He is laid in Joseph's new tomb.", refs: ["Matthew 27:33-60", "Luke 23:33-53", "John 19:17-42"] },
					],
				},
				{
					label: "7. Resurrection and ascension",
					via: "",
					note: "He rose the third day, was seen of many for forty days, commissioned His disciples and was taken up into heaven.",
					refs: ["1 Corinthians 15:3-8", "Acts 1:3"],
					children: [
						{ label: "The empty tomb", via: "", note: "He is not here: for he is risen, as he said.", refs: ["Matthew 28:1-8", "Mark 16:1-8", "Luke 24:1-12", "John 20:1-10"] },
						{ label: "Mary Magdalene sees the Lord", via: "", note: "He appeared first to Mary Magdalene at the tomb.", refs: ["John 20:11-18", "Mark 16:9"] },
						{ label: "The road to Emmaus", via: "", note: "Beginning at Moses and all the prophets, He expounds the things concerning Himself.", refs: ["Luke 24:13-35"] },
						{ label: "Thomas believes", via: "", note: "Blessed are they that have not seen, and yet have believed.", refs: ["John 20:24-29"] },
						{ label: "The great commission", via: "", note: "Go ye therefore, and teach all nations; I am with you alway.", refs: ["Matthew 28:18-20"] },
						{ label: "Taken up into heaven", via: "", note: "This same Jesus shall so come in like manner as ye have seen him go.", refs: ["Luke 24:50-53", "Acts 1:9-11"] },
					],
				},
			],
		},
		links: [
			{ from: "peters-confession", to: "passion-week", label: "He must suffer", refs: ["Matthew 16:21"] },
			{ from: "lazarus", to: "triumphal-entry", label: "the crowd bare record", refs: ["John 12:17-18"] },
		],
	},
	{
		slug: "armor-of-god",
		title: "The armour of God",
		summary: "Each piece of the whole armour of God in Ephesians 6, and where Scripture fills in what it means.",
		topics: ["armour of god", "spiritual warfare", "prayer", "word of god", "faith"],
		root: {
			label: "The whole armour of God",
			note: "Paul tells believers to be strong in the Lord and to stand against the wiles of the devil, clothed in what God supplies.",
			refs: ["Ephesians 6:10-18"],
			children: [
				{
					label: "Our battle",
					via: "why",
					note: "We wrestle not against flesh and blood but against spiritual wickedness, so we stand in the Lord's strength.",
					refs: ["Ephesians 6:10-13"],
					children: [
						{ label: "Strong in the Lord", via: "", note: "Strength comes from the Lord and the power of His might, in the grace that is in Christ.", refs: ["Ephesians 6:10", "2 Timothy 2:1"] },
						{ label: "Not against flesh and blood", via: "", note: "The weapons of our warfare are not carnal, but mighty through God.", refs: ["Ephesians 6:12", "2 Corinthians 10:3-5"] },
						{ label: "Having done all, to stand", via: "", note: "Take the whole armour, that ye may withstand in the evil day.", refs: ["Ephesians 6:13"] },
					],
				},
				{
					label: "The girdle of truth",
					via: "loins girt about with",
					note: "Truth holds everything together, as a girdle binds the soldier's loins.",
					refs: ["Ephesians 6:14"],
					children: [
						{ label: "Thy word is truth", via: "", note: "Jesus prays that the Father sanctify His people through His truth.", refs: ["John 17:17"] },
						{ label: "I am the way, the truth, and the life", via: "", note: "The truth the believer is girded with is first a person.", refs: ["John 14:6"] },
						{ label: "The girdle of his loins", via: "", note: "The promised Branch from Jesse wears righteousness and faithfulness as His girdle.", refs: ["Isaiah 11:5"] },
					],
				},
				{
					label: "The breastplate of righteousness",
					via: "having on",
					note: "Righteousness covers the heart.",
					refs: ["Ephesians 6:14"],
					children: [
						{ id: "lords-breastplate", label: "The LORD's own breastplate", via: "", note: "In Isaiah the LORD Himself puts on righteousness as a breastplate.", refs: ["Isaiah 59:17"] },
						{
							label: "Whose righteousness is the breastplate?",
							kind: "question",
							via: "Christians differ",
							note: "Christians agree that believers are righteous in Christ and called to live righteously. They differ on which Paul means here.",
							refs: ["Ephesians 6:14"],
							children: [
								{ label: "Christ's righteousness counted to us", kind: "reading", via: "one reading", note: "The breastplate is the righteousness God gives in Christ, the ground on which the believer stands.", refs: ["2 Corinthians 5:21", "Philippians 3:9", "Isaiah 61:10"] },
								{ label: "A righteous life lived in His strength", kind: "reading", via: "another reading", note: "The breastplate is practical holiness, a life of integrity that gives no place to the devil.", refs: ["Ephesians 4:24", "Ephesians 4:27", "Romans 6:13", "1 John 3:7"] },
							],
						},
					],
				},
				{
					label: "Feet shod with the gospel of peace",
					via: "your feet shod with",
					note: "Sure footing comes from the gospel that brings peace with God.",
					refs: ["Ephesians 6:15"],
					children: [
						{ label: "How beautiful are the feet", via: "", note: "The feet of them that preach the gospel of peace.", refs: ["Isaiah 52:7", "Romans 10:15"] },
						{ label: "Peace with God", via: "", note: "Justified by faith, we have peace with God through our Lord Jesus Christ.", refs: ["Romans 5:1"] },
					],
				},
				{
					label: "The shield of faith",
					via: "above all, taking",
					note: "Faith quenches all the fiery darts of the wicked.",
					refs: ["Ephesians 6:16"],
					children: [
						{ label: "I am thy shield", via: "", note: "God Himself is the shield of those who trust Him.", refs: ["Genesis 15:1", "Psalm 91:4"] },
						{ label: "This is the victory", via: "", note: "The victory that overcometh the world, even our faith.", refs: ["1 John 5:4"] },
						{ label: "Resist stedfast in the faith", via: "", note: "Resist the devil, and he will flee from you.", refs: ["1 Peter 5:8-9", "James 4:7"] },
					],
				},
				{
					label: "The helmet of salvation",
					via: "take",
					note: "Salvation guards the mind with the sure hope of what God has done and will finish.",
					refs: ["Ephesians 6:17"],
					children: [
						{ id: "lords-helmet", label: "The LORD's own helmet", via: "", note: "The same verse in Isaiah: an helmet of salvation upon His head.", refs: ["Isaiah 59:17"] },
						{ label: "The hope of salvation", via: "", note: "For an helmet, the hope of salvation; God hath not appointed us to wrath.", refs: ["1 Thessalonians 5:8-9"] },
					],
				},
				{
					label: "The sword of the Spirit",
					via: "and",
					note: "The word of God is the one weapon for attack.",
					refs: ["Ephesians 6:17"],
					children: [
						{ label: "Quick, and powerful", via: "", note: "Sharper than any twoedged sword, a discerner of the thoughts and intents of the heart.", refs: ["Hebrews 4:12"] },
						{ label: "It is written", via: "", note: "Jesus answers each temptation with Scripture.", refs: ["Matthew 4:1-11"] },
					],
				},
				{
					label: "Praying always",
					via: "with all prayer",
					note: "The armour is worn in prayer, for all saints and for boldness to make known the gospel.",
					refs: ["Ephesians 6:18-20"],
					children: [
						{ label: "Pray without ceasing", via: "", note: "Continue in prayer, and watch in the same with thanksgiving.", refs: ["1 Thessalonians 5:17", "Colossians 4:2"] },
						{ label: "Men ought always to pray", via: "", note: "And not to faint.", refs: ["Luke 18:1"] },
					],
				},
			],
		},
		links: [
			{ from: "lords-breastplate", to: "lords-helmet", label: "the armour God wears", refs: ["Isaiah 59:17"] },
		],
	},
	{
		slug: "fall-and-redemption",
		title: "The fall and redemption",
		summary: "From Genesis 3 to Revelation 22: what was lost at the fall, the first promise, justification in Romans 5 and Galatians, the cross, and all things made new.",
		topics: ["fall", "redemption", "sin", "justification", "new creation", "gospel"],
		root: {
			label: "From the fall to the new creation",
			note: "What was lost in Genesis 3 is restored in Christ, from the first promise to the tree of life in Revelation 22.",
			refs: ["Genesis 3:15", "Revelation 22:1-5"],
			children: [
				{
					label: "Very good",
					via: "in the beginning",
					note: "God made all things very good, set man in the garden with the tree of life, and gave one command.",
					refs: ["Genesis 1:31", "Genesis 2:8-9", "Genesis 2:15-17"],
					children: [
						{ label: "In the image of God", via: "", note: "Male and female He created them, in His own image.", refs: ["Genesis 1:26-27"] },
						{ label: "The tree of life", via: "", note: "Planted in the midst of the garden.", refs: ["Genesis 2:8-9"] },
						{ label: "Thou shalt not eat of it", via: "", note: "In the day that thou eatest thereof thou shalt surely die.", refs: ["Genesis 2:16-17"] },
					],
				},
				{
					id: "genesis-3",
					label: "Genesis 3: The fall",
					via: "then",
					note: "Sin enters: the serpent deceives, man disobeys, and death and the curse follow.",
					refs: ["Genesis 3:1-24"],
					children: [
						{ label: "Yea, hath God said?", via: "", note: "The serpent questions God's word, then denies it.", refs: ["Genesis 3:1-5"] },
						{ label: "They did eat", via: "", note: "The woman takes of the fruit and gives also unto her husband, and their eyes are opened.", refs: ["Genesis 3:6-7"] },
						{ label: "Where art thou?", via: "", note: "The man and his wife hide from the presence of the LORD God.", refs: ["Genesis 3:8-10"] },
						{ id: "the-curse", label: "Cursed is the ground", via: "", note: "Sorrow, thorns and sweat, until man returns unto the dust.", refs: ["Genesis 3:16-19"] },
						{ id: "driven-out", label: "Driven from the tree of life", via: "", note: "Cherubims and a flaming sword keep the way of the tree of life.", refs: ["Genesis 3:22-24"] },
					],
				},
				{
					label: "The first promise",
					via: "within the curse",
					note: "The seed of the woman shall bruise the serpent's head. Christians have long called this the first gospel.",
					refs: ["Genesis 3:15"],
					children: [
						{ label: "Coats of skins", via: "", note: "The LORD God Himself clothes the man and his wife.", refs: ["Genesis 3:21"] },
						{ label: "Made of a woman", via: "fulfilled", note: "When the fulness of the time was come, God sent forth His Son, made of a woman.", refs: ["Galatians 4:4-5"] },
						{ label: "To destroy the works of the devil", via: "fulfilled", note: "Through death He destroyed him that had the power of death, that is, the devil.", refs: ["1 John 3:8", "Hebrews 2:14-15"] },
					],
				},
				{
					id: "romans-5",
					label: "Romans 5: Justification",
					via: "answered in",
					note: "As by one man sin entered, so by the obedience of one shall many be made righteous: peace with God.",
					refs: ["Romans 5:1", "Romans 5:12-21"],
					children: [
						{ label: "By one man sin entered", via: "", note: "Sin entered by one man, and death by sin, and so death passed upon all men.", refs: ["Romans 5:12"] },
						{ label: "In Adam all die", via: "", note: "As in Adam all die, even so in Christ shall all be made alive.", refs: ["1 Corinthians 15:21-22"] },
						{ label: "Grace did much more abound", via: "", note: "Where sin abounded, grace did much more abound.", refs: ["Romans 5:15-21"] },
						{ label: "Peace with God", via: "", note: "Being justified by faith, we have peace with God through our Lord Jesus Christ.", refs: ["Romans 5:1-2"] },
					],
				},
				{
					id: "galatians",
					label: "Galatians: Not by works",
					via: "the same truth",
					note: "The same truth: justified by faith and not by the works of the law, because Christ bore the curse.",
					refs: ["Galatians 2:16", "Galatians 3:13"],
					children: [
						{ label: "Not by the works of the law", via: "", note: "By the works of the law shall no flesh be justified.", refs: ["Galatians 2:16"] },
						{ id: "made-a-curse", label: "Christ made a curse for us", via: "", note: "Christ hath redeemed us from the curse of the law, being made a curse for us.", refs: ["Galatians 3:13-14"] },
						{ label: "Abraham believed God", via: "", note: "They which be of faith are blessed with faithful Abraham.", refs: ["Galatians 3:6-9"] },
					],
				},
				{
					label: "The Lamb slain",
					via: "accomplished at",
					note: "Redeemed with the precious blood of Christ, as of a lamb without blemish, foreordained before the foundation of the world.",
					refs: ["1 Peter 1:18-20", "Revelation 5:9"],
					children: [
						{ label: "It is finished", via: "", note: "He bowed His head and gave up the ghost.", refs: ["John 19:30"] },
						{ label: "Thou wast slain", via: "", note: "Redeemed to God by His blood out of every kindred, and tongue, and people, and nation.", refs: ["Revelation 5:9-10"] },
						{ label: "He is risen", via: "", note: "Now is Christ risen from the dead, the firstfruits of them that slept.", refs: ["Luke 24:5-7", "1 Corinthians 15:20-22"] },
					],
				},
				{
					label: "Revelation 21-22: All things new",
					via: "completed in",
					note: "A new heaven and a new earth, God dwelling with men, and the curse gone for ever.",
					refs: ["Revelation 21:1-5", "Revelation 22:1-5"],
					children: [
						{ label: "No more death", via: "", note: "God shall wipe away all tears; neither sorrow, nor crying, nor pain.", refs: ["Revelation 21:4"] },
						{ id: "tree-restored", label: "The tree of life again", via: "", note: "In the midst of the street, and blessed are they that have right to it.", refs: ["Revelation 22:1-2", "Revelation 22:14"] },
						{ id: "no-more-curse", label: "There shall be no more curse", via: "", note: "The throne of God and of the Lamb shall be in it, and His servants shall serve Him.", refs: ["Revelation 22:3"] },
						{ label: "Surely I come quickly", via: "", note: "Even so, come, Lord Jesus.", refs: ["Revelation 22:20"] },
					],
				},
			],
		},
		links: [
			{ from: "genesis-3", to: "romans-5", label: "by one man", refs: ["Romans 5:12"] },
			{ from: "romans-5", to: "galatians", label: "the same truth", refs: ["Romans 4:3", "Galatians 3:6"] },
			{ from: "the-curse", to: "made-a-curse", label: "Christ bore the curse", refs: ["Galatians 3:13"] },
			{ from: "the-curse", to: "no-more-curse", label: "the curse lifted", refs: ["Revelation 22:3"] },
			{ from: "driven-out", to: "tree-restored", label: "the way opened again", refs: ["Revelation 22:14"] },
		],
	},
	{
		slug: "christ-in-prophecy",
		title: "Christ in prophecy",
		summary: "Prophecies of Christ's birth, ministry, suffering and reign with where the New Testament says they were fulfilled, and His return still ahead.",
		topics: ["prophecy", "messiah", "fulfillment", "second coming", "millennium"],
		root: {
			label: "Christ in all the scriptures",
			note: "Beginning at Moses and all the prophets, Jesus expounded the things concerning Himself. Here are prophecies fulfilled, and the one still ahead.",
			refs: ["Luke 24:25-27", "Luke 24:44", "Acts 10:43"],
			children: [
				{
					label: "His birth",
					via: "foretold",
					note: "Where He would be born, of whom, and of what line.",
					refs: ["Isaiah 7:14", "Micah 5:2"],
					children: [
						{ label: "Born of a virgin", via: "fulfilled", note: "Isaiah's sign, which Matthew says was fulfilled in Jesus' birth.", refs: ["Isaiah 7:14", "Matthew 1:22-23"] },
						{ label: "Born in Bethlehem", via: "fulfilled", note: "Out of Bethlehem Ephratah shall He come forth; the scribes quote Micah to Herod.", refs: ["Micah 5:2", "Matthew 2:4-6"] },
						{ label: "A Branch of David's line", via: "fulfilled", note: "A rod out of the stem of Jesse, a righteous Branch raised unto David.", refs: ["Isaiah 11:1-2", "Jeremiah 23:5", "Luke 1:32-33"] },
					],
				},
				{
					label: "His ministry",
					via: "foretold",
					note: "The forerunner, the light in Galilee, and the King riding into Jerusalem.",
					refs: ["Isaiah 61:1-2", "Luke 4:16-21"],
					children: [
						{ label: "A voice in the wilderness", via: "fulfilled", note: "Prepare ye the way of the LORD: John the Baptist.", refs: ["Isaiah 40:3", "Matthew 3:1-3"] },
						{ label: "Galilee of the nations", via: "fulfilled", note: "The people which sat in darkness saw great light.", refs: ["Isaiah 9:1-2", "Matthew 4:13-16"] },
						{ id: "lowly-king", label: "Lowly, and riding upon an ass", via: "fulfilled", note: "Thy King cometh unto thee, just, and having salvation.", refs: ["Zechariah 9:9", "Matthew 21:4-5"] },
					],
				},
				{
					label: "His suffering",
					via: "foretold",
					note: "The suffering Servant of Isaiah 53 and the psalm Jesus prayed on the cross.",
					refs: ["Isaiah 53:3-12", "Psalm 22:1-18"],
					children: [
						{ label: "Wounded for our transgressions", via: "fulfilled", note: "By His stripes we are healed; Peter applies the words to the cross.", refs: ["Isaiah 53:5-6", "1 Peter 2:24-25"] },
						{ label: "They pierced my hands and my feet", via: "fulfilled", note: "The risen Christ shows Thomas the print of the nails.", refs: ["Psalm 22:16", "John 20:25-27"] },
						{ label: "They part my garments", via: "fulfilled", note: "The soldiers cast lots for His coat, that the scripture might be fulfilled.", refs: ["Psalm 22:18", "John 19:23-24"] },
						{ label: "Thirty pieces of silver", via: "fulfilled", note: "The price of the betrayal, cast down in the temple and given for the potter's field.", refs: ["Zechariah 11:12-13", "Matthew 27:3-10"] },
						{ label: "Not a bone broken", via: "fulfilled", note: "The Passover lamb's bones were not broken, nor were His.", refs: ["Exodus 12:46", "Psalm 34:20", "John 19:33-36"] },
					],
				},
				{
					label: "His resurrection and reign",
					via: "foretold",
					note: "David foresaw the resurrection, and the Son seated at God's right hand.",
					refs: ["Psalm 16:10", "Psalm 110:1"],
					children: [
						{ label: "Not leave my soul in hell", via: "fulfilled", note: "Peter preaches that David spake of the resurrection of Christ.", refs: ["Psalm 16:10", "Acts 2:25-32"] },
						{ id: "right-hand", label: "Sit thou at my right hand", via: "fulfilled", note: "Exalted to the right hand of God, made both Lord and Christ.", refs: ["Psalm 110:1", "Acts 2:33-36", "Hebrews 1:13"] },
					],
				},
				{
					id: "his-return",
					label: "His return",
					via: "still ahead",
					note: "The same Jesus who ascended will come again in like manner. This prophecy is still to be fulfilled.",
					refs: ["Acts 1:11", "Revelation 1:7"],
					children: [
						{ id: "with-clouds", label: "Coming with the clouds", via: "", note: "Every eye shall see Him.", refs: ["Daniel 7:13-14", "Matthew 24:30", "Revelation 1:7"] },
						{ label: "This same Jesus", via: "", note: "Taken up from the disciples, He shall so come in like manner.", refs: ["Acts 1:9-11"] },
						{ label: "Caught up to meet the Lord", via: "", note: "The dead in Christ shall rise first; so shall we ever be with the Lord.", refs: ["1 Thessalonians 4:16-17"] },
						{
							label: "What are the thousand years of Revelation 20?",
							kind: "question",
							via: "Christians differ",
							note: "All agree that Christ will return bodily and judge the living and the dead. Christians read the thousand years differently.",
							refs: ["Revelation 20:1-6"],
							children: [
								{ label: "Premillennial: a reign on earth after He returns", kind: "reading", via: "one reading", note: "Christ returns first, then reigns with His saints on the earth for a thousand years before the last judgment.", refs: ["Revelation 20:4-6", "Revelation 19:11-16", "Isaiah 11:6-9", "Zechariah 14:9"] },
								{ label: "Amillennial: Christ's present reign", kind: "reading", via: "another reading", note: "The thousand years stand for this present age, in which Christ reigns and His saints live and reign with Him, until He returns.", refs: ["Revelation 20:4", "Ephesians 2:5-6", "Colossians 1:13", "John 5:24-25"] },
								{ label: "Postmillennial: the gospel prevails, then He returns", kind: "reading", via: "a third reading", note: "The gospel spreads until righteousness prevails over the earth for a long age, and then Christ returns.", refs: ["Psalm 2:8", "Matthew 13:31-33", "Habakkuk 2:14"] },
							],
						},
					],
				},
			],
		},
		links: [
			{ from: "lowly-king", to: "with-clouds", label: "first lowly, then in glory", refs: ["Hebrews 9:28"] },
			{ from: "right-hand", to: "his-return", label: "till His enemies are subdued", refs: ["Psalm 110:1", "1 Corinthians 15:25"] },
		],
	},
];

/** The id a library node gets when it names none: its label, lowercased and dashed. */
export function librarySlugId(label: string): string {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
	return slug || "node";
}

/**
 * The source as a raw map for `checkConceptMap`: nodes in pre-order with
 * stable ids, every connection carrying its verses explicitly.
 */
export function compileLibraryMap(source: LibraryMapSource): Record<string, unknown> {
	const nodes: Record<string, unknown>[] = [];
	const used = new Set<string>();
	const idFor = (node: LibraryNodeSource): string => {
		let id = node.id ?? librarySlugId(node.label);
		if (used.has(id) && !node.id) {
			let n = 2;
			while (used.has(`${id}-${n}`)) n++;
			id = `${id}-${n}`;
		}
		used.add(id);
		return id;
	};
	const walk = (node: LibraryNodeSource, parentId: string | null) => {
		const id = idFor(node);
		nodes.push({
			id,
			parentId,
			label: node.label,
			note: node.note,
			kind: node.kind ?? "topic",
			refs: node.refs,
			via: parentId === null ? null : { label: node.via ?? "", refs: node.viaRefs ?? [node.refs[0]] },
		});
		for (const child of node.children ?? []) walk(child, id);
	};
	walk(source.root, null);
	return {
		version: 1,
		title: source.title,
		summary: source.summary,
		topics: source.topics,
		nodes,
		links: (source.links ?? []).map((link, index) => ({ id: `link-${index + 1}`, ...link })),
		origin: { kind: "library", slug: source.slug },
	};
}
