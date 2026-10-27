import type { KidsAdventure } from "./kids-rules";

/**
 * SureWord Kids' Bible adventures (LC-17657, docs/beta/kids.md).
 *
 * Written once, by hand, and checked line by line against the KJV passage:
 * every retelling sentence names the verses it retells and says nothing those
 * verses do not say (it may leave things out, and it may use a simpler word
 * for the same thing, never a new fact). Nothing here is generated, per child
 * or otherwise. Every quiz answer is words its verse says, which
 * tests/beta-kids.test.mjs checks with Quiz me's own grounding rules, and the
 * memory text is checked word for word against the bundled KJV.
 *
 * No runtime imports on purpose: the tests load this file with Node's type
 * stripping.
 */
export const KIDS_ADVENTURES: readonly KidsAdventure[] = [
	{
		id: "creation",
		title: "God Makes the World",
		book: 1,
		segments: [
			{ chapter: 1, from: 1, to: 31 },
			{ chapter: 2, from: 1, to: 3 },
		],
		retelling: {
			"3-5": [
				{ text: "In the beginning, God made the heaven and the earth.", verses: ["1:1"] },
				{ text: "God said, “Let there be light,” and there was light.", verses: ["1:3"] },
				{ text: "God made a great light for the day, a smaller light for the night, and the stars.", verses: ["1:16"] },
				{ text: "God made the whales, the birds, and every animal.", verses: ["1:21", "1:25"] },
				{ text: "God made man and woman in his own image.", verses: ["1:27"] },
				{ text: "God saw everything he had made, and it was very good.", verses: ["1:31"] },
				{ text: "On the seventh day, God rested.", verses: ["2:2"] },
			],
			"6-8": [
				{ text: "In the beginning God created the heaven and the earth.", verses: ["1:1"] },
				{ text: "God said, “Let there be light,” and there was light. He called the light Day and the darkness Night.", verses: ["1:3", "1:5"] },
				{ text: "God made the firmament and called it Heaven. He gathered the waters into seas, made the dry land, and made grass and fruit trees grow.", verses: ["1:7", "1:8", "1:9", "1:10", "1:12"] },
				{ text: "God made a greater light to rule the day and a lesser light to rule the night. He made the stars also.", verses: ["1:16"] },
				{ text: "God made great whales and birds, then cattle and every beast of the earth.", verses: ["1:21", "1:25"] },
				{ text: "God created man in his own image, male and female.", verses: ["1:27"] },
				{ text: "God saw every thing that he had made, and it was very good.", verses: ["1:31"] },
				{ text: "On the seventh day God ended his work. He rested, and he blessed the seventh day.", verses: ["2:2", "2:3"] },
			],
			"9-12": [
				{ text: "In the beginning God created the heaven and the earth. The earth was without form and dark, and the Spirit of God moved upon the face of the waters.", verses: ["1:1", "1:2"] },
				{ text: "On the first day God said, “Let there be light,” and he divided the light from the darkness.", verses: ["1:3", "1:4", "1:5"] },
				{ text: "On the second day God made the firmament and called it Heaven.", verses: ["1:6", "1:7", "1:8"] },
				{ text: "On the third day God gathered the waters into seas, let the dry land appear, and made grass, herbs and fruit trees, each after his kind.", verses: ["1:9", "1:10", "1:11", "1:12", "1:13"] },
				{ text: "On the fourth day God made two great lights, the greater to rule the day and the lesser to rule the night, and the stars, for signs and seasons, days and years.", verses: ["1:14", "1:16", "1:19"] },
				{ text: "On the fifth day God made the creatures of the waters and the birds, and he blessed them.", verses: ["1:20", "1:21", "1:22", "1:23"] },
				{ text: "On the sixth day God made cattle, creeping things and beasts. Then he created man in his own image, male and female, and gave them dominion over every living thing.", verses: ["1:24", "1:25", "1:27", "1:28"] },
				{ text: "God saw every thing that he had made, and, behold, it was very good.", verses: ["1:31"] },
				{ text: "On the seventh day God rested from all his work, and he blessed the seventh day and sanctified it.", verses: ["2:2", "2:3"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "God said, “Let there be ...” what?", correct: "Light", wrong: ["Rain", "Snow"], verses: ["1:3"] },
				{ prompt: "How did God see everything he had made?", correct: "Very good", wrong: ["Very sad", "Too small"], verses: ["1:31"] },
			],
			"6-8": [
				{ prompt: "What did God call the light?", correct: "Day", wrong: ["Sky", "Sun"], verses: ["1:5"] },
				{ prompt: "What did God make to rule the night?", correct: "The lesser light", wrong: ["A rainbow", "A cloud"], verses: ["1:16"] },
				{ prompt: "What did God do on the seventh day?", correct: "He rested", wrong: ["He made the sea", "He made the birds"], verses: ["2:2"] },
			],
			"9-12": [
				{ prompt: "What moved upon the face of the waters?", correct: "The Spirit of God", wrong: ["A great wind", "A mighty ship", "The evening star"], verses: ["1:2"] },
				{ prompt: "What did God call the gathering together of the waters?", correct: "Seas", wrong: ["Rivers", "Lakes", "Clouds"], verses: ["1:10"] },
				{ prompt: "In whose image did God create man?", correct: "In God’s own image", wrong: ["In the image of the sun", "In the image of a star", "In the image of a lion"], verses: ["1:27"] },
				{ prompt: "What did God do to the seventh day?", correct: "He blessed it", wrong: ["He hid it", "He forgot it", "He named it Night"], verses: ["2:3"] },
			],
		},
		memory: { chapter: 1, verse: 1, text: "In the beginning God created the heaven and the earth." },
	},
	{
		id: "noah",
		title: "Noah and the Ark",
		book: 1,
		segments: [
			{ chapter: 6, from: 13, to: 22 },
			{ chapter: 7, from: 12, to: 18 },
			{ chapter: 8, from: 8, to: 12 },
			{ chapter: 9, from: 12, to: 16 },
		],
		retelling: {
			"3-5": [
				{ text: "God told Noah, “Make an ark.”", verses: ["6:14"] },
				{ text: "Two of every kind of living thing went into the ark with Noah.", verses: ["6:19", "7:15"] },
				{ text: "Noah did all that God told him.", verses: ["6:22"] },
				{ text: "It rained for forty days and forty nights, and the ark went up on the water.", verses: ["7:12", "7:17", "7:18"] },
				{ text: "Noah sent out a dove. She came back with an olive leaf.", verses: ["8:8", "8:11"] },
				{ text: "God set his bow in the cloud. It is his promise that the waters will never again be a flood to destroy all flesh.", verses: ["9:13", "9:15"] },
			],
			"6-8": [
				{ text: "God told Noah to make an ark of gopher wood, with rooms, a window and a door.", verses: ["6:14", "6:16"] },
				{ text: "God said he would bring a flood of waters upon the earth.", verses: ["6:17"] },
				{ text: "Noah was to take his family into the ark, with two of every sort of living thing, male and female, and food for them all.", verses: ["6:18", "6:19", "6:21"] },
				{ text: "Noah did according to all that God commanded him.", verses: ["6:22"] },
				{ text: "It rained forty days and forty nights. The LORD shut Noah in, and the waters lifted the ark up above the earth.", verses: ["7:12", "7:16", "7:17"] },
				{ text: "Noah sent out a dove. The second time, she came back with an olive leaf in her mouth, so Noah knew the waters were going down. The third time, she did not come back.", verses: ["8:8", "8:10", "8:11", "8:12"] },
				{ text: "God set his bow in the cloud as the token of his covenant: the waters shall no more become a flood to destroy all flesh.", verses: ["9:12", "9:13", "9:15"] },
			],
			"9-12": [
				{ text: "God told Noah that the earth was filled with violence, and that he would bring a flood of waters upon the earth.", verses: ["6:13", "6:17"] },
				{ text: "God told Noah to make an ark of gopher wood, three hundred cubits long, with rooms, a window, a door and three stories.", verses: ["6:14", "6:15", "6:16"] },
				{ text: "God said he would establish his covenant with Noah. Noah, his wife, his sons and their wives would go into the ark, with two of every sort of living thing and food for them all.", verses: ["6:18", "6:19", "6:20", "6:21"] },
				{ text: "Noah did according to all that God commanded him.", verses: ["6:22"] },
				{ text: "The rain was upon the earth forty days and forty nights. Noah’s family and the animals went in, two and two, and the LORD shut him in.", verses: ["7:12", "7:13", "7:14", "7:15", "7:16"] },
				{ text: "The waters increased and bare up the ark, and it was lifted up above the earth.", verses: ["7:17"] },
				{ text: "Noah sent out a dove three times. The first time she came back, the second time she brought an olive leaf, and the third time she returned no more.", verses: ["8:8", "8:9", "8:10", "8:11", "8:12"] },
				{ text: "God set his bow in the cloud as the token of his covenant with every living creature: the waters shall no more become a flood to destroy all flesh.", verses: ["9:12", "9:13", "9:15"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "What did God tell Noah to make?", correct: "An ark", wrong: ["A house", "A tower"], verses: ["6:14"] },
				{ prompt: "What did the dove bring back?", correct: "An olive leaf", wrong: ["A fish", "A flower"], verses: ["8:11"] },
			],
			"6-8": [
				{ prompt: "How long did the rain last?", correct: "Forty days and forty nights", wrong: ["Two days and two nights", "Five days and five nights"], verses: ["7:12"] },
				{ prompt: "Who shut Noah in the ark?", correct: "The LORD", wrong: ["Noah’s sons", "The animals"], verses: ["7:16"] },
				{ prompt: "What did God set in the cloud?", correct: "His bow", wrong: ["His ark", "A star"], verses: ["9:13"] },
			],
			"9-12": [
				{ prompt: "What wood was the ark made of?", correct: "Gopher wood", wrong: ["Cedar wood", "Oak wood", "Olive wood"], verses: ["6:14"] },
				{ prompt: "In Genesis 6, how many of every sort did God tell Noah to bring into the ark?", correct: "Two", wrong: ["Three", "Ten", "Twelve"], verses: ["6:19"] },
				{ prompt: "What was in the dove’s mouth the second time she came back?", correct: "An olive leaf", wrong: ["A twig of cedar", "A small stone", "A fig"], verses: ["8:11"] },
				{ prompt: "What is the bow in the cloud a token of?", correct: "God’s covenant", wrong: ["A coming storm", "Summer rain", "A new day"], verses: ["9:12", "9:13"] },
			],
		},
		memory: { chapter: 6, verse: 22, text: "Thus did Noah; according to all that God commanded him, so did he." },
	},
	{
		id: "abraham",
		title: "Abraham Counts the Stars",
		book: 1,
		segments: [
			{ chapter: 12, from: 1, to: 4 },
			{ chapter: 15, from: 5, to: 6 },
			{ chapter: 21, from: 1, to: 3 },
		],
		retelling: {
			"3-5": [
				{ text: "God told Abram to go to a land that he would show him.", verses: ["12:1"] },
				{ text: "Abram went, just as the LORD had said.", verses: ["12:4"] },
				{ text: "God told Abram to look up at the stars and count them, if he could.", verses: ["15:5"] },
				{ text: "Abram believed the LORD.", verses: ["15:6"] },
				{ text: "God gave Sarah and Abraham a baby boy. His name was Isaac.", verses: ["21:1", "21:2", "21:3"] },
			],
			"6-8": [
				{ text: "The LORD told Abram to leave his country and go to a land that the LORD would show him.", verses: ["12:1"] },
				{ text: "God promised to bless Abram and to make of him a great nation.", verses: ["12:2"] },
				{ text: "So Abram went, as the LORD had spoken to him. He was seventy-five years old.", verses: ["12:4"] },
				{ text: "God brought Abram outside and told him to look toward heaven and count the stars, if he was able. Then God said, “So shall thy seed be.”", verses: ["15:5"] },
				{ text: "Abram believed in the LORD, and the LORD counted it to him for righteousness.", verses: ["15:6"] },
				{ text: "Just as God had said, Sarah had a son when Abraham was old. Abraham named him Isaac.", verses: ["21:1", "21:2", "21:3"] },
			],
			"9-12": [
				{ text: "The LORD told Abram to leave his country, his kindred and his father’s house, and to go to a land the LORD would show him.", verses: ["12:1"] },
				{ text: "God promised to make of Abram a great nation, to bless him, and that in him all families of the earth would be blessed.", verses: ["12:2", "12:3"] },
				{ text: "Abram departed as the LORD had spoken, and Lot went with him. Abram was seventy-five years old when he left Haran.", verses: ["12:4"] },
				{ text: "God brought Abram outside and told him to look toward heaven and count the stars, if he was able. “So shall thy seed be,” God said.", verses: ["15:5"] },
				{ text: "Abram believed in the LORD, and the LORD counted it to him for righteousness.", verses: ["15:6"] },
				{ text: "The LORD did for Sarah as he had spoken. She bare Abraham a son in his old age, at the time God had set, and Abraham named him Isaac.", verses: ["21:1", "21:2", "21:3"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "What did God tell Abram to look at?", correct: "The stars", wrong: ["The sea", "The trees"], verses: ["15:5"] },
				{ prompt: "What was the baby’s name?", correct: "Isaac", wrong: ["Noah", "David"], verses: ["21:3"] },
			],
			"6-8": [
				{ prompt: "How old was Abram when he left Haran?", correct: "Seventy and five years old", wrong: ["Twenty years old", "Ten years old"], verses: ["12:4"] },
				{ prompt: "What did God say Abram’s seed would be like?", correct: "The stars", wrong: ["The trees", "The rivers"], verses: ["15:5"] },
				{ prompt: "What did Abram do when God made his promise?", correct: "He believed in the LORD", wrong: ["He ran away", "He went to sleep"], verses: ["15:6"] },
			],
			"9-12": [
				{ prompt: "Where did God tell Abram to go?", correct: "A land God would shew him", wrong: ["The city of Babylon", "Back to his father’s house", "Across the great sea"], verses: ["12:1"] },
				{ prompt: "Who went with Abram?", correct: "Lot", wrong: ["Isaac", "Noah", "Moses"], verses: ["12:4"] },
				{ prompt: "What did Abram do that the LORD counted to him for righteousness?", correct: "He believed in the LORD", wrong: ["He built a great tower", "He sailed the sea", "He fought a giant"], verses: ["15:6"] },
				{ prompt: "What did Abraham name his son?", correct: "Isaac", wrong: ["Joseph", "Samuel", "Daniel"], verses: ["21:3"] },
			],
		},
		memory: { chapter: 15, verse: 6, text: "And he believed in the LORD; and he counted it to him for righteousness." },
	},
	{
		id: "joseph",
		title: "Joseph and His Brothers",
		book: 1,
		segments: [
			{ chapter: 37, from: 3, to: 4 },
			{ chapter: 37, from: 23, to: 28 },
			{ chapter: 41, from: 39, to: 43 },
			{ chapter: 45, from: 3, to: 8 },
		],
		retelling: {
			"3-5": [
				{ text: "Joseph’s father loved him and made him a coat of many colours.", verses: ["37:3"] },
				{ text: "His brothers hated him. They took his coat and put him in a pit.", verses: ["37:4", "37:23", "37:24"] },
				{ text: "They sold Joseph, and he was taken to Egypt.", verses: ["37:28"] },
				{ text: "In Egypt, Pharaoh made Joseph ruler over all the land.", verses: ["41:41", "41:43"] },
				{ text: "Joseph told his brothers, “I am Joseph.”", verses: ["45:3"] },
				{ text: "He said God had sent him there to save lives.", verses: ["45:5", "45:7"] },
			],
			"6-8": [
				{ text: "Israel loved his son Joseph more than all his children, and made him a coat of many colours.", verses: ["37:3"] },
				{ text: "When his brothers saw it, they hated Joseph and could not speak peaceably to him.", verses: ["37:4"] },
				{ text: "They took off his coat and cast him into an empty pit with no water in it.", verses: ["37:23", "37:24"] },
				{ text: "Then Joseph was sold for twenty pieces of silver and brought into Egypt.", verses: ["37:28"] },
				{ text: "In Egypt, Pharaoh said no one was as wise as Joseph. He put his ring on Joseph’s hand and set him over all the land of Egypt.", verses: ["41:39", "41:41", "41:42"] },
				{ text: "Joseph told his brothers, “I am Joseph your brother, whom ye sold into Egypt.”", verses: ["45:4"] },
				{ text: "He told them not to be grieved or angry with themselves: “God did send me before you to preserve life.”", verses: ["45:5"] },
			],
			"9-12": [
				{ text: "Israel loved Joseph more than all his children, because he was the son of his old age, and he made him a coat of many colours.", verses: ["37:3"] },
				{ text: "His brothers saw that their father loved Joseph most, and they hated him and could not speak peaceably to him.", verses: ["37:4"] },
				{ text: "They stript Joseph of his coat and cast him into a pit that was empty, with no water in it.", verses: ["37:23", "37:24"] },
				{ text: "Judah said, “What profit is it if we slay our brother?” So they sold Joseph to the Ishmeelites for twenty pieces of silver, and he was brought into Egypt.", verses: ["37:26", "37:27", "37:28"] },
				{ text: "Pharaoh said there was none so discreet and wise as Joseph. He gave him his ring, fine linen and a gold chain, and made him ruler over all the land of Egypt.", verses: ["41:39", "41:40", "41:41", "41:42", "41:43"] },
				{ text: "Joseph made himself known to his brothers: “I am Joseph your brother, whom ye sold into Egypt.” They were troubled at his presence.", verses: ["45:3", "45:4"] },
				{ text: "He told them not to be grieved or angry with themselves, “for God did send me before you to preserve life.”", verses: ["45:5"] },
				{ text: "“So now it was not you that sent me hither, but God,” Joseph said. God had sent him to save their lives by a great deliverance.", verses: ["45:7", "45:8"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "What did Joseph’s father make for him?", correct: "A coat of many colours", wrong: ["A little boat", "A tall tower"], verses: ["37:3"] },
				{ prompt: "Where was Joseph taken?", correct: "Into Egypt", wrong: ["Into Babylon", "Into the mountains"], verses: ["37:28"] },
			],
			"6-8": [
				{ prompt: "Where did the brothers put Joseph?", correct: "In an empty pit", wrong: ["In a big boat", "In a high tower"], verses: ["37:24"] },
				{ prompt: "How much was Joseph sold for?", correct: "Twenty pieces of silver", wrong: ["Ten pieces of gold", "Five pieces of silver"], verses: ["37:28"] },
				{ prompt: "What did Pharaoh put on Joseph’s hand?", correct: "His ring", wrong: ["A crown", "A sword"], verses: ["41:42"] },
			],
			"9-12": [
				{ prompt: "Which brother said, “What profit is it if we slay our brother?”", correct: "Judah", wrong: ["Reuben", "Benjamin", "Levi"], verses: ["37:26"] },
				{ prompt: "Who was Joseph sold to?", correct: "The Ishmeelites", wrong: ["The Philistines", "The Romans", "The Moabites"], verses: ["37:28"] },
				{ prompt: "What did Pharaoh put about Joseph’s neck?", correct: "A gold chain", wrong: ["A golden crown", "A white scarf", "A wooden yoke"], verses: ["41:42"] },
				{ prompt: "Who did Joseph say had sent him to Egypt?", correct: "God", wrong: ["His brothers", "His father", "The king of Babylon"], verses: ["45:8"] },
			],
		},
		memory: { chapter: 45, verse: 5, text: "God did send me before you to preserve life." },
	},
	{
		id: "red-sea",
		title: "Moses and the Red Sea",
		book: 2,
		segments: [
			{ chapter: 14, from: 10, to: 16 },
			{ chapter: 14, from: 19, to: 31 },
		],
		retelling: {
			"3-5": [
				{ text: "The Egyptians came after the children of Israel, and the people were afraid.", verses: ["14:10"] },
				{ text: "Moses said, “Fear ye not. The LORD shall fight for you.”", verses: ["14:13", "14:14"] },
				{ text: "Moses stretched out his hand over the sea.", verses: ["14:21"] },
				{ text: "God made the sea into dry land, and the waters stood like a wall on each side.", verses: ["14:21", "14:22"] },
				{ text: "All the people walked through the sea on dry ground.", verses: ["14:22", "14:29"] },
				{ text: "The LORD saved Israel that day.", verses: ["14:30"] },
			],
			"6-8": [
				{ text: "The Egyptians marched after the children of Israel. The people were sore afraid and cried out to the LORD.", verses: ["14:10"] },
				{ text: "Moses said, “Fear ye not, stand still, and see the salvation of the LORD. The LORD shall fight for you.”", verses: ["14:13", "14:14"] },
				{ text: "God told Moses to lift up his rod and stretch out his hand over the sea.", verses: ["14:16"] },
				{ text: "The LORD sent a strong east wind all that night, and the sea became dry land.", verses: ["14:21"] },
				{ text: "Israel walked through the middle of the sea on dry ground, with the waters like a wall on their right and on their left.", verses: ["14:22"] },
				{ text: "When the Egyptians followed, Moses stretched out his hand again, and the sea came back over them.", verses: ["14:23", "14:27", "14:28"] },
				{ text: "The LORD saved Israel that day, and the people believed the LORD and his servant Moses.", verses: ["14:30", "14:31"] },
			],
			"9-12": [
				{ text: "When Pharaoh drew near, the children of Israel were sore afraid. They cried out to the LORD and asked Moses why he had brought them out of Egypt to die in the wilderness.", verses: ["14:10", "14:11"] },
				{ text: "Moses answered, “Fear ye not, stand still, and see the salvation of the LORD. The LORD shall fight for you, and ye shall hold your peace.”", verses: ["14:13", "14:14"] },
				{ text: "The LORD told Moses to tell the people to go forward, and to lift up his rod and divide the sea.", verses: ["14:15", "14:16"] },
				{ text: "The angel of God and the pillar of the cloud moved behind Israel. The cloud was darkness to the Egyptians, but it gave light to Israel all night.", verses: ["14:19", "14:20"] },
				{ text: "Moses stretched out his hand, and the LORD caused the sea to go back by a strong east wind all that night. The waters were divided, and Israel went through on dry ground.", verses: ["14:21", "14:22"] },
				{ text: "The Egyptians pursued them into the sea. The LORD troubled their host and took off their chariot wheels, and they said, “The LORD fighteth for them.”", verses: ["14:23", "14:24", "14:25"] },
				{ text: "Moses stretched out his hand again, and the waters returned and covered Pharaoh’s chariots and horsemen. Not one of them remained.", verses: ["14:26", "14:27", "14:28"] },
				{ text: "So the LORD saved Israel that day. The people feared the LORD, and believed the LORD and his servant Moses.", verses: ["14:30", "14:31"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "Who did Moses say would fight for the people?", correct: "The LORD", wrong: ["The soldiers", "The lions"], verses: ["14:14"] },
				{ prompt: "What did the people walk on through the sea?", correct: "Dry ground", wrong: ["A bridge", "A boat"], verses: ["14:22"] },
			],
			"6-8": [
				{ prompt: "What did the LORD use to push the sea back?", correct: "A strong east wind", wrong: ["A great fire", "A loud trumpet"], verses: ["14:21"] },
				{ prompt: "What were the waters like on their right hand and on their left?", correct: "A wall", wrong: ["A river", "A mountain"], verses: ["14:22"] },
				{ prompt: "What did God tell Moses to lift up?", correct: "His rod", wrong: ["His sword", "A lamp"], verses: ["14:16"] },
			],
			"9-12": [
				{ prompt: "What came between the camp of Israel and the Egyptians?", correct: "The pillar of the cloud", wrong: ["A high wall of stone", "A great river", "A city"], verses: ["14:19", "14:20"] },
				{ prompt: "What happened to the Egyptians’ chariot wheels?", correct: "The LORD took them off", wrong: ["They turned to gold", "They caught fire", "They grew wings"], verses: ["14:25"] },
				{ prompt: "What did Moses tell the people to do?", correct: "Fear not and stand still", wrong: ["Run back to Egypt", "Build a big boat", "Climb the mountain"], verses: ["14:13"] },
				{ prompt: "What did the people do when they saw the great work of the LORD?", correct: "Feared and believed the LORD", wrong: ["Went back to Egypt", "Built a city", "Fell asleep"], verses: ["14:31"] },
			],
		},
		memory: { chapter: 14, verse: 14, text: "The LORD shall fight for you, and ye shall hold your peace." },
	},
	{
		id: "david",
		title: "David and Goliath",
		book: 9,
		segments: [
			{ chapter: 17, from: 4, to: 11 },
			{ chapter: 17, from: 32, to: 50 },
		],
		retelling: {
			"3-5": [
				{ text: "A very tall man named Goliath wanted someone to fight him.", verses: ["17:4", "17:10"] },
				{ text: "Everyone in Israel was afraid.", verses: ["17:11"] },
				{ text: "David told Saul that he would go and fight him.", verses: ["17:32"] },
				{ text: "David took five smooth stones and his sling.", verses: ["17:40"] },
				{ text: "David said, “I come to thee in the name of the LORD of hosts.”", verses: ["17:45"] },
				{ text: "David’s stone hit Goliath, and he fell down on his face.", verses: ["17:49"] },
			],
			"6-8": [
				{ text: "A Philistine champion named Goliath, six cubits and a span tall, called to the armies of Israel: “Give me a man, that we may fight together.”", verses: ["17:4", "17:10"] },
				{ text: "Saul and all Israel were dismayed and greatly afraid.", verses: ["17:11"] },
				{ text: "David told Saul, “Thy servant will go and fight with this Philistine.”", verses: ["17:32"] },
				{ text: "David said the LORD had saved him from a lion and a bear, and would save him from this Philistine too.", verses: ["17:34", "17:37"] },
				{ text: "David did not keep Saul’s armour on. He took his staff, five smooth stones and his sling.", verses: ["17:38", "17:39", "17:40"] },
				{ text: "David said, “I come to thee in the name of the LORD of hosts,” and, “the battle is the LORD’s.”", verses: ["17:45", "17:47"] },
				{ text: "David slang one stone. It sank into the Philistine’s forehead, and he fell on his face to the earth.", verses: ["17:49"] },
			],
			"9-12": [
				{ text: "Goliath of Gath, a champion of the Philistines, was six cubits and a span tall and wore a helmet and a coat of mail of brass.", verses: ["17:4", "17:5"] },
				{ text: "He cried to the armies of Israel to choose a man to fight him: if he won, Israel would serve the Philistines.", verses: ["17:8", "17:9"] },
				{ text: "When Saul and all Israel heard him, they were dismayed and greatly afraid.", verses: ["17:11"] },
				{ text: "David told Saul, “Let no man’s heart fail because of him; thy servant will go and fight with this Philistine.”", verses: ["17:32"] },
				{ text: "Saul said David was but a youth. David answered that while keeping his father’s sheep he had slain a lion and a bear, and that the LORD who delivered him from them would deliver him from this Philistine.", verses: ["17:33", "17:34", "17:35", "17:36", "17:37"] },
				{ text: "David put off Saul’s armour, because he had not proved it, and took his staff, five smooth stones out of the brook, and his sling.", verses: ["17:38", "17:39", "17:40"] },
				{ text: "The Philistine disdained David and cursed him by his gods.", verses: ["17:42", "17:43"] },
				{ text: "David said, “Thou comest to me with a sword, and with a spear, and with a shield: but I come to thee in the name of the LORD of hosts.” He said all would know that the battle is the LORD’s.", verses: ["17:45", "17:47"] },
				{ text: "David ran to meet him, slang a stone, and smote the Philistine in his forehead. So David prevailed with a sling and with a stone, and there was no sword in his hand.", verses: ["17:48", "17:49", "17:50"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "How many smooth stones did David choose?", correct: "Five", wrong: ["Two", "Ten"], verses: ["17:40"] },
				{ prompt: "What did David have in his hand to throw the stone?", correct: "His sling", wrong: ["A bow", "A spear"], verses: ["17:40"] },
			],
			"6-8": [
				{ prompt: "Which two animals did David say he had fought?", correct: "A lion and a bear", wrong: ["A wolf and a fox", "A dog and a goat"], verses: ["17:34"] },
				{ prompt: "Whose armour did David put off?", correct: "Saul’s armour", wrong: ["Goliath’s armour", "His brother’s armour"], verses: ["17:38", "17:39"] },
				{ prompt: "In whose name did David come?", correct: "The LORD of hosts", wrong: ["King Saul", "The army"], verses: ["17:45"] },
			],
			"9-12": [
				{ prompt: "How tall was Goliath?", correct: "Six cubits and a span", wrong: ["Two cubits and a span", "Ten cubits", "Four cubits and a hand"], verses: ["17:4"] },
				{ prompt: "What did Saul say about David?", correct: "He was but a youth", wrong: ["He was a great king", "He was too tall", "He was a giant"], verses: ["17:33"] },
				{ prompt: "Where did David find the five smooth stones?", correct: "Out of the brook", wrong: ["From the king’s house", "On a high mountain", "In the city of Gath"], verses: ["17:40"] },
				{ prompt: "Where did the stone strike the Philistine?", correct: "In his forehead", wrong: ["On his shield", "On his foot", "On his helmet"], verses: ["17:49"] },
			],
		},
		memory: { chapter: 17, verse: 47, text: "for the battle is the LORD’s" },
	},
	{
		id: "daniel",
		title: "Daniel and the Lions",
		book: 27,
		segments: [{ chapter: 6, from: 10, to: 23 }],
		retelling: {
			"3-5": [
				{ text: "Daniel prayed to God three times a day.", verses: ["6:10"] },
				{ text: "Some men told the king, and Daniel was put in the den of lions.", verses: ["6:13", "6:16"] },
				{ text: "The king was very upset, and that night he could not sleep.", verses: ["6:14", "6:18"] },
				{ text: "Very early in the morning, the king hurried to the den.", verses: ["6:19"] },
				{ text: "Daniel said, “My God hath sent his angel, and hath shut the lions’ mouths.”", verses: ["6:22"] },
				{ text: "Daniel was not hurt at all, because he believed in his God.", verses: ["6:23"] },
			],
			"6-8": [
				{ text: "Daniel knew the king had signed a law, but he still kneeled and prayed to his God three times a day, as he did before.", verses: ["6:10"] },
				{ text: "Some men found Daniel praying and told the king. The law said that anyone who asked anything of any God or man for thirty days, except the king, would be cast into the den of lions.", verses: ["6:11", "6:12", "6:13"] },
				{ text: "The king was sore displeased with himself and tried until the sun went down to save Daniel, but the law could not be changed.", verses: ["6:14", "6:15"] },
				{ text: "Daniel was cast into the den of lions. The king said, “Thy God whom thou servest continually, he will deliver thee.”", verses: ["6:16"] },
				{ text: "The king could not sleep. Very early in the morning he hurried to the den and called, “O Daniel, is thy God able to deliver thee from the lions?”", verses: ["6:18", "6:19", "6:20"] },
				{ text: "Daniel answered, “My God hath sent his angel, and hath shut the lions’ mouths.”", verses: ["6:21", "6:22"] },
				{ text: "Daniel was taken up out of the den with no hurt upon him, because he believed in his God.", verses: ["6:23"] },
			],
			"9-12": [
				{ text: "Daniel knew the writing was signed, but he went home and, with his windows open toward Jerusalem, kneeled and prayed and gave thanks before his God three times a day, as he did before.", verses: ["6:10"] },
				{ text: "The men who found him praying reminded the king of his decree: anyone who asked a petition of any God or man for thirty days, except of the king, would be cast into the den of lions.", verses: ["6:11", "6:12", "6:13"] },
				{ text: "The king was sore displeased with himself and laboured until the going down of the sun to deliver Daniel, but the law of the Medes and Persians could not be changed.", verses: ["6:14", "6:15"] },
				{ text: "Daniel was cast into the den, and the king said, “Thy God whom thou servest continually, he will deliver thee.” A stone was laid on the mouth of the den and sealed with the king’s signet.", verses: ["6:16", "6:17"] },
				{ text: "The king passed the night fasting, and his sleep went from him. Very early he went in haste to the den and cried, “O Daniel, servant of the living God, is thy God able to deliver thee?”", verses: ["6:18", "6:19", "6:20"] },
				{ text: "Daniel answered, “My God hath sent his angel, and hath shut the lions’ mouths, that they have not hurt me,” for innocency was found in him before God, and before the king he had done no hurt.", verses: ["6:21", "6:22"] },
				{ text: "The king was exceeding glad. Daniel was taken up out of the den, and no manner of hurt was found upon him, because he believed in his God.", verses: ["6:23"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "How many times a day did Daniel pray?", correct: "Three times", wrong: ["Ten times", "Two times"], verses: ["6:10"] },
				{ prompt: "Who did God send to shut the lions’ mouths?", correct: "His angel", wrong: ["A shepherd", "A soldier"], verses: ["6:22"] },
			],
			"6-8": [
				{ prompt: "Where was Daniel cast?", correct: "Into the den of lions", wrong: ["Into a deep pit", "Into the sea"], verses: ["6:16"] },
				{ prompt: "What happened to the king that night?", correct: "He could not sleep", wrong: ["He had a feast", "He sang songs"], verses: ["6:18"] },
				{ prompt: "Why was no hurt found upon Daniel?", correct: "He believed in his God", wrong: ["He was very strong", "He ran very fast"], verses: ["6:23"] },
			],
			"9-12": [
				{ prompt: "Which way did Daniel’s open windows face when he prayed?", correct: "Toward Jerusalem", wrong: ["Toward Babylon", "Toward the sea", "Toward Egypt"], verses: ["6:10"] },
				{ prompt: "How long did the decree forbid asking a petition of anyone but the king?", correct: "Thirty days", wrong: ["Seven days", "Forty days", "A whole year"], verses: ["6:12"] },
				{ prompt: "How was the stone on the den sealed?", correct: "With the king’s signet", wrong: ["With iron chains", "With a wooden bar", "With strong rope"], verses: ["6:17"] },
				{ prompt: "What did Daniel say his God had sent?", correct: "His angel", wrong: ["A great wind", "A soldier", "A dove"], verses: ["6:22"] },
			],
		},
		memory: { chapter: 6, verse: 22, text: "My God hath sent his angel, and hath shut the lions’ mouths" },
	},
	{
		id: "jonah",
		title: "Jonah and the Great Fish",
		book: 32,
		segments: [
			{ chapter: 1, from: 1, to: 4 },
			{ chapter: 1, from: 12, to: 17 },
			{ chapter: 2, from: 1, to: 1 },
			{ chapter: 2, from: 9, to: 10 },
			{ chapter: 3, from: 1, to: 5 },
			{ chapter: 3, from: 10, to: 10 },
		],
		retelling: {
			"3-5": [
				{ text: "God told Jonah, “Go to Nineveh.”", verses: ["1:1", "1:2"] },
				{ text: "But Jonah ran away on a ship.", verses: ["1:3"] },
				{ text: "The LORD sent a great wind, and a big storm came.", verses: ["1:4"] },
				{ text: "The men threw Jonah into the sea, and the sea was calm.", verses: ["1:15"] },
				{ text: "The LORD sent a great fish to swallow Jonah.", verses: ["1:17"] },
				{ text: "Jonah prayed inside the fish, and the fish put him out on dry land.", verses: ["2:1", "2:10"] },
				{ text: "Then Jonah went to Nineveh, and the people believed God.", verses: ["3:3", "3:5"] },
			],
			"6-8": [
				{ text: "The word of the LORD came to Jonah: “Arise, go to Nineveh, that great city.”", verses: ["1:1", "1:2"] },
				{ text: "But Jonah ran from the LORD. He paid the fare for a ship going to Tarshish.", verses: ["1:3"] },
				{ text: "The LORD sent a great wind, and the storm was so strong that the ship was like to be broken.", verses: ["1:4"] },
				{ text: "Jonah told the men, “Cast me forth into the sea; so shall the sea be calm.” When they did, the sea stopped raging.", verses: ["1:12", "1:15"] },
				{ text: "The LORD had prepared a great fish to swallow Jonah. Jonah was in the fish three days and three nights.", verses: ["1:17"] },
				{ text: "Jonah prayed to the LORD from inside the fish. Then the LORD spake to the fish, and it put Jonah out upon the dry land.", verses: ["2:1", "2:10"] },
				{ text: "This time Jonah went to Nineveh, as the LORD said. The people believed God, and God saw that they turned from their evil way.", verses: ["3:3", "3:5", "3:10"] },
			],
			"9-12": [
				{ text: "The LORD told Jonah to go to Nineveh, that great city, and cry against it, for their wickedness had come up before him.", verses: ["1:1", "1:2"] },
				{ text: "But Jonah rose up to flee from the presence of the LORD. He paid the fare of a ship going to Tarshish.", verses: ["1:3"] },
				{ text: "The LORD sent out a great wind into the sea, and the tempest was so mighty that the ship was like to be broken.", verses: ["1:4"] },
				{ text: "Jonah told the men, “Take me up, and cast me forth into the sea,” for he knew the tempest was for his sake. The men rowed hard and cried to the LORD, then cast him into the sea, and the sea ceased from her raging.", verses: ["1:12", "1:13", "1:14", "1:15"] },
				{ text: "The LORD had prepared a great fish to swallow up Jonah, and Jonah was in the belly of the fish three days and three nights.", verses: ["1:17"] },
				{ text: "Jonah prayed to the LORD his God out of the fish’s belly: “Salvation is of the LORD.” And the LORD spake to the fish, and it put Jonah out upon the dry land.", verses: ["2:1", "2:9", "2:10"] },
				{ text: "The word of the LORD came to Jonah the second time, and this time he went to Nineveh and cried, “Yet forty days, and Nineveh shall be overthrown.”", verses: ["3:1", "3:2", "3:3", "3:4"] },
				{ text: "The people of Nineveh believed God and put on sackcloth. God saw that they turned from their evil way, and he did not do the evil he had said he would do to them.", verses: ["3:5", "3:10"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "What swallowed Jonah?", correct: "A great fish", wrong: ["A big bird", "A lion"], verses: ["1:17"] },
				{ prompt: "Where did God tell Jonah to go?", correct: "Nineveh", wrong: ["Egypt", "Bethlehem"], verses: ["1:2"] },
			],
			"6-8": [
				{ prompt: "Where was Jonah’s ship going?", correct: "Tarshish", wrong: ["Nineveh", "Egypt"], verses: ["1:3"] },
				{ prompt: "How long was Jonah in the belly of the fish?", correct: "Three days and three nights", wrong: ["Two days and two nights", "Forty days and forty nights"], verses: ["1:17"] },
				{ prompt: "What did Jonah do in the fish’s belly?", correct: "He prayed to the LORD", wrong: ["He sang a song", "He went to sleep"], verses: ["2:1"] },
			],
			"9-12": [
				{ prompt: "What did Jonah tell the men to do so the sea would be calm?", correct: "Cast him into the sea", wrong: ["Row back to land", "Throw out the cargo", "Pray to their gods"], verses: ["1:12"] },
				{ prompt: "What did Jonah say in his prayer?", correct: "Salvation is of the LORD", wrong: ["The sea is my home", "I will never go", "The fish is my friend"], verses: ["2:9"] },
				{ prompt: "How many days did Jonah say until Nineveh would be overthrown?", correct: "Forty days", wrong: ["Three days", "Seven days", "Ten days"], verses: ["3:4"] },
				{ prompt: "What did God do when he saw the people turn from their evil way?", correct: "He repented of the evil", wrong: ["He sent a storm", "He sent fire", "He forgot them"], verses: ["3:10"] },
			],
		},
		memory: { chapter: 2, verse: 9, text: "Salvation is of the LORD." },
	},
	{
		id: "birth-of-jesus",
		title: "Jesus Is Born",
		book: 42,
		segments: [{ chapter: 2, from: 1, to: 21 }],
		retelling: {
			"3-5": [
				{ text: "Joseph and Mary went to Bethlehem.", verses: ["2:4", "2:5"] },
				{ text: "There Mary had her baby boy, and she laid him in a manger.", verses: ["2:7"] },
				{ text: "An angel told shepherds, “Fear not: I bring you good tidings of great joy.”", verses: ["2:9", "2:10"] },
				{ text: "“Unto you is born this day a Saviour, which is Christ the Lord.”", verses: ["2:11"] },
				{ text: "Many angels praised God: “Glory to God in the highest.”", verses: ["2:13", "2:14", "2:15"] },
				{ text: "The shepherds hurried and found the baby lying in a manger.", verses: ["2:16"] },
				{ text: "His name was Jesus.", verses: ["2:21"] },
			],
			"6-8": [
				{ text: "Caesar Augustus said that all the world should be taxed, so Joseph went to Bethlehem, the city of David, with Mary.", verses: ["2:1", "2:3", "2:4", "2:5"] },
				{ text: "There Mary brought forth her firstborn son. She wrapped him in swaddling clothes and laid him in a manger, because there was no room for them in the inn.", verses: ["2:6", "2:7"] },
				{ text: "Shepherds were keeping watch over their flock by night. The angel of the Lord came to them, and they were sore afraid.", verses: ["2:8", "2:9"] },
				{ text: "The angel said, “Fear not: for, behold, I bring you good tidings of great joy. For unto you is born this day in the city of David a Saviour, which is Christ the Lord.”", verses: ["2:10", "2:11"] },
				{ text: "Suddenly many angels praised God, saying, “Glory to God in the highest, and on earth peace, good will toward men.”", verses: ["2:13", "2:14", "2:15"] },
				{ text: "The shepherds came with haste and found Mary, and Joseph, and the babe lying in a manger. Then they told others what they had been told about this child.", verses: ["2:16", "2:17"] },
				{ text: "His name was called Jesus, the name the angel had given him.", verses: ["2:21"] },
			],
			"9-12": [
				{ text: "Caesar Augustus decreed that all the world should be taxed. Joseph went from Nazareth to Bethlehem, the city of David, because he was of the house and lineage of David, with Mary, who was great with child.", verses: ["2:1", "2:3", "2:4", "2:5"] },
				{ text: "While they were there, Mary brought forth her firstborn son, wrapped him in swaddling clothes and laid him in a manger, because there was no room for them in the inn.", verses: ["2:6", "2:7"] },
				{ text: "The angel of the Lord came to shepherds keeping watch over their flock by night, and the glory of the Lord shone round about them.", verses: ["2:8", "2:9"] },
				{ text: "The angel said, “Fear not: for, behold, I bring you good tidings of great joy, which shall be to all people. For unto you is born this day in the city of David a Saviour, which is Christ the Lord.”", verses: ["2:10", "2:11"] },
				{ text: "The sign would be a babe wrapped in swaddling clothes, lying in a manger. Then a multitude of the heavenly host praised God: “Glory to God in the highest, and on earth peace, good will toward men.”", verses: ["2:12", "2:13", "2:14"] },
				{ text: "The shepherds came with haste and found Mary, and Joseph, and the babe lying in a manger, and they made known what had been told them. Mary kept all these things and pondered them in her heart.", verses: ["2:16", "2:17", "2:19"] },
				{ text: "The shepherds returned, glorifying and praising God. And the child’s name was called JESUS, as the angel had named him before he was conceived.", verses: ["2:20", "2:21"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "Where did Mary lay her baby?", correct: "In a manger", wrong: ["In a boat", "In a tent"], verses: ["2:7"] },
				{ prompt: "Who told the shepherds the good news?", correct: "An angel", wrong: ["A king", "A fisherman"], verses: ["2:10"] },
			],
			"6-8": [
				{ prompt: "Why did Mary lay the baby in a manger?", correct: "There was no room in the inn", wrong: ["It was warmer there", "The shepherds asked her to"], verses: ["2:7"] },
				{ prompt: "Who did the angel say was born?", correct: "A Saviour, Christ the Lord", wrong: ["A great king of Rome", "A new prophet"], verses: ["2:11"] },
				{ prompt: "What did the heavenly host say?", correct: "Glory to God in the highest", wrong: ["Go home and sleep", "The king is coming"], verses: ["2:14"] },
			],
			"9-12": [
				{ prompt: "Who decreed that all the world should be taxed?", correct: "Caesar Augustus", wrong: ["King Herod", "Pontius Pilate", "Cyrenius"], verses: ["2:1"] },
				{ prompt: "Why did Joseph go to Bethlehem?", correct: "He was of the house of David", wrong: ["He wanted to see the temple", "He was a shepherd there", "The king called him there"], verses: ["2:4"] },
				{ prompt: "What sign did the angel give the shepherds?", correct: "A babe lying in a manger", wrong: ["A star in the east", "A burning bush", "A rainbow"], verses: ["2:12"] },
				{ prompt: "What did Mary do with all these things?", correct: "She pondered them in her heart", wrong: ["She wrote them in a book", "She told them to the king", "She forgot them"], verses: ["2:19"] },
			],
		},
		memory: { chapter: 2, verse: 11, text: "For unto you is born this day in the city of David a Saviour, which is Christ the Lord." },
	},
	{
		id: "calming-the-storm",
		title: "Jesus Calms the Storm",
		book: 41,
		segments: [{ chapter: 4, from: 35, to: 41 }],
		alsoNamed: [{ name: "Jesus", where: "Mark 4:35-41 calls him “he” and “Master”; the chapters around it name him (Mark 3:7, Mark 5:6)" }],
		retelling: {
			"3-5": [
				{ text: "Jesus said, “Let us pass over unto the other side,” and they went in a ship.", verses: ["4:35", "4:36"] },
				{ text: "A great storm came, and the waves filled the ship.", verses: ["4:37"] },
				{ text: "Jesus was asleep on a pillow.", verses: ["4:38"] },
				{ text: "They woke him up: “Master, carest thou not that we perish?”", verses: ["4:38"] },
				{ text: "Jesus said to the sea, “Peace, be still.”", verses: ["4:39"] },
				{ text: "The wind stopped, and there was a great calm.", verses: ["4:39"] },
			],
			"6-8": [
				{ text: "When evening came, Jesus said, “Let us pass over unto the other side,” and they took him in the ship.", verses: ["4:35", "4:36"] },
				{ text: "A great storm of wind arose, and the waves beat into the ship until it was full.", verses: ["4:37"] },
				{ text: "Jesus was in the back of the ship, asleep on a pillow.", verses: ["4:38"] },
				{ text: "They woke him and said, “Master, carest thou not that we perish?”", verses: ["4:38"] },
				{ text: "Jesus arose, rebuked the wind, and said to the sea, “Peace, be still.” The wind ceased, and there was a great calm.", verses: ["4:39"] },
				{ text: "He asked them, “Why are ye so fearful? how is it that ye have no faith?”", verses: ["4:40"] },
				{ text: "They said to one another, “What manner of man is this, that even the wind and the sea obey him?”", verses: ["4:41"] },
			],
			"9-12": [
				{ text: "That evening Jesus said, “Let us pass over unto the other side.” They sent away the multitude and took him in the ship, and other little ships were with him.", verses: ["4:35", "4:36"] },
				{ text: "There arose a great storm of wind, and the waves beat into the ship, so that it was now full.", verses: ["4:37"] },
				{ text: "Jesus was in the hinder part of the ship, asleep on a pillow. They woke him and said, “Master, carest thou not that we perish?”", verses: ["4:38"] },
				{ text: "He arose, rebuked the wind, and said unto the sea, “Peace, be still.” And the wind ceased, and there was a great calm.", verses: ["4:39"] },
				{ text: "He said to them, “Why are ye so fearful? how is it that ye have no faith?”", verses: ["4:40"] },
				{ text: "They feared exceedingly and said one to another, “What manner of man is this, that even the wind and the sea obey him?”", verses: ["4:41"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "Where was Jesus sleeping?", correct: "On a pillow", wrong: ["In a tree", "On the sand"], verses: ["4:38"] },
				{ prompt: "What did Jesus say to the sea?", correct: "Peace, be still", wrong: ["Go away", "Splash more"], verses: ["4:39"] },
			],
			"6-8": [
				{ prompt: "What beat into the ship until it was full?", correct: "The waves", wrong: ["The fish", "The rocks"], verses: ["4:37"] },
				{ prompt: "What did they call Jesus when they woke him?", correct: "Master", wrong: ["King", "Captain"], verses: ["4:38"] },
				{ prompt: "What happened after Jesus spoke?", correct: "There was a great calm", wrong: ["The ship sank", "It began to snow"], verses: ["4:39"] },
			],
			"9-12": [
				{ prompt: "What else was with him on the sea?", correct: "Other little ships", wrong: ["A great whale", "An army of soldiers", "A pillar of fire"], verses: ["4:36"] },
				{ prompt: "What did Jesus rebuke?", correct: "The wind", wrong: ["The fishermen", "The fire", "The sun"], verses: ["4:39"] },
				{ prompt: "What did Jesus ask them?", correct: "Why are ye so fearful?", wrong: ["Where is the food?", "Who sank the ship?", "Why is it raining?"], verses: ["4:40"] },
				{ prompt: "What did they say even the wind and the sea do?", correct: "Obey him", wrong: ["Run from him", "Sing to him", "Hide from him"], verses: ["4:41"] },
			],
		},
		memory: { chapter: 4, verse: 39, text: "Peace, be still." },
	},
	{
		id: "five-loaves",
		title: "Five Loaves and Two Fishes",
		book: 43,
		segments: [{ chapter: 6, from: 1, to: 14 }],
		retelling: {
			"3-5": [
				{ text: "A great many people came to Jesus.", verses: ["6:2", "6:5"] },
				{ text: "A boy had five loaves and two small fishes.", verses: ["6:9"] },
				{ text: "Jesus gave thanks and gave out the food.", verses: ["6:11"] },
				{ text: "Everyone ate as much as they wanted.", verses: ["6:11", "6:12"] },
				{ text: "They filled twelve baskets with what was left.", verses: ["6:13"] },
			],
			"6-8": [
				{ text: "A great multitude followed Jesus, because they saw the miracles he did on them that were sick.", verses: ["6:2"] },
				{ text: "Jesus asked Philip, “Whence shall we buy bread, that these may eat?” Philip said that two hundred pennyworth of bread would not be enough.", verses: ["6:5", "6:7"] },
				{ text: "Andrew said, “There is a lad here, which hath five barley loaves, and two small fishes: but what are they among so many?”", verses: ["6:8", "6:9"] },
				{ text: "Jesus told them to make the men sit down on the grass. There were about five thousand.", verses: ["6:10"] },
				{ text: "Jesus took the loaves, gave thanks, and they were given out, and the fishes too, as much as they wanted.", verses: ["6:11"] },
				{ text: "When everyone was filled, the disciples gathered what was left and filled twelve baskets.", verses: ["6:12", "6:13"] },
			],
			"9-12": [
				{ text: "Jesus went over the sea of Galilee, and a great multitude followed him, because they saw his miracles on them that were diseased.", verses: ["6:1", "6:2"] },
				{ text: "Jesus asked Philip, “Whence shall we buy bread, that these may eat?” He said this to prove him, for he himself knew what he would do.", verses: ["6:5", "6:6"] },
				{ text: "Philip answered that two hundred pennyworth of bread was not enough. Andrew said, “There is a lad here, which hath five barley loaves, and two small fishes: but what are they among so many?”", verses: ["6:7", "6:8", "6:9"] },
				{ text: "The men sat down on the grass, in number about five thousand. Jesus took the loaves, gave thanks, and they were given out, and the fishes, as much as they would.", verses: ["6:10", "6:11"] },
				{ text: "When they were filled, Jesus said, “Gather up the fragments that remain, that nothing be lost.” The fragments filled twelve baskets.", verses: ["6:12", "6:13"] },
				{ text: "When the men saw the miracle, they said, “This is of a truth that prophet that should come into the world.”", verses: ["6:14"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "How many loaves did the boy have?", correct: "Five", wrong: ["Ten", "Twenty"], verses: ["6:9"] },
				{ prompt: "How many baskets did they fill with what was left?", correct: "Twelve", wrong: ["Three", "Fifty"], verses: ["6:13"] },
			],
			"6-8": [
				{ prompt: "What kind of loaves did the lad have?", correct: "Barley loaves", wrong: ["Wheat loaves", "Rye loaves"], verses: ["6:9"] },
				{ prompt: "Which disciple told Jesus about the lad?", correct: "Andrew", wrong: ["Philip", "Thomas"], verses: ["6:8"] },
				{ prompt: "What did Jesus do before the loaves were given out?", correct: "He gave thanks", wrong: ["He sang a song", "He washed his hands"], verses: ["6:11"] },
			],
			"9-12": [
				{ prompt: "Why did Jesus ask Philip where to buy bread?", correct: "To prove him", wrong: ["He had no money", "He was hungry", "He forgot the way"], verses: ["6:6"] },
				{ prompt: "How many men sat down?", correct: "About five thousand", wrong: ["About two hundred", "About fifty", "About twelve"], verses: ["6:10"] },
				{ prompt: "What did Jesus say to do with the fragments?", correct: "Gather them up", wrong: ["Throw them away", "Give them to the birds", "Leave them on the grass"], verses: ["6:12"] },
				{ prompt: "What did the men say Jesus was?", correct: "That prophet that should come", wrong: ["A great king of Egypt", "A fisherman from Rome", "A teacher of the law"], verses: ["6:14"] },
			],
		},
		memory: { chapter: 6, verse: 12, text: "Gather up the fragments that remain, that nothing be lost." },
	},
	{
		id: "resurrection",
		title: "Jesus Is Risen",
		book: 40,
		segments: [{ chapter: 28, from: 1, to: 10 }],
		retelling: {
			"3-5": [
				{ text: "Early in the morning, Mary Magdalene and the other Mary went to see Jesus’ grave.", verses: ["28:1"] },
				{ text: "An angel came down and rolled back the stone.", verses: ["28:2"] },
				{ text: "The angel said, “Fear not. He is not here: for he is risen.”", verses: ["28:5", "28:6"] },
				{ text: "The women ran with great joy to tell his disciples.", verses: ["28:8"] },
				{ text: "Then Jesus met them, and they worshipped him!", verses: ["28:9"] },
			],
			"6-8": [
				{ text: "As the first day of the week began to dawn, Mary Magdalene and the other Mary came to see the sepulchre.", verses: ["28:1"] },
				{ text: "There was a great earthquake, and the angel of the Lord rolled back the stone from the door and sat upon it.", verses: ["28:2"] },
				{ text: "The angel looked like lightning, his raiment was white as snow, and the keepers shook for fear.", verses: ["28:3", "28:4"] },
				{ text: "The angel said to the women, “Fear not ye: for I know that ye seek Jesus. He is not here: for he is risen, as he said.”", verses: ["28:5", "28:6"] },
				{ text: "The women ran with fear and great joy to tell his disciples.", verses: ["28:7", "28:8"] },
				{ text: "On the way, Jesus met them. They held him by the feet and worshipped him.", verses: ["28:9"] },
				{ text: "Jesus said, “Be not afraid: go tell my brethren.”", verses: ["28:10"] },
			],
			"9-12": [
				{ text: "As the first day of the week began to dawn, Mary Magdalene and the other Mary came to see the sepulchre.", verses: ["28:1"] },
				{ text: "There was a great earthquake: the angel of the Lord descended from heaven, rolled back the stone from the door, and sat upon it.", verses: ["28:2"] },
				{ text: "His countenance was like lightning and his raiment white as snow, and for fear of him the keepers did shake and became as dead men.", verses: ["28:3", "28:4"] },
				{ text: "The angel said to the women, “Fear not ye: for I know that ye seek Jesus, which was crucified. He is not here: for he is risen, as he said. Come, see the place where the Lord lay.”", verses: ["28:5", "28:6"] },
				{ text: "He told them to go quickly and tell his disciples that he is risen from the dead and goes before them into Galilee.", verses: ["28:7"] },
				{ text: "They departed quickly with fear and great joy. As they went, Jesus met them, saying, “All hail.” They held him by the feet and worshipped him.", verses: ["28:8", "28:9"] },
				{ text: "Jesus said, “Be not afraid: go tell my brethren that they go into Galilee, and there shall they see me.”", verses: ["28:10"] },
			],
		},
		questions: {
			"3-5": [
				{ prompt: "Who rolled back the stone?", correct: "An angel", wrong: ["A soldier", "A farmer"], verses: ["28:2"] },
				{ prompt: "Who met the women on the way?", correct: "Jesus", wrong: ["Moses", "David"], verses: ["28:9"] },
			],
			"6-8": [
				{ prompt: "What happened when the angel came down?", correct: "A great earthquake", wrong: ["A big flood", "A long night"], verses: ["28:2"] },
				{ prompt: "What was the angel’s raiment like?", correct: "White as snow", wrong: ["Red as fire", "Black as night"], verses: ["28:3"] },
				{ prompt: "What did the angel say about Jesus?", correct: "He is risen", wrong: ["He is sleeping", "He went to Egypt"], verses: ["28:6"] },
			],
			"9-12": [
				{ prompt: "Who came to see the sepulchre?", correct: "Mary Magdalene and the other Mary", wrong: ["Peter and John", "Martha and Lazarus", "The keepers of the tomb"], verses: ["28:1"] },
				{ prompt: "What did the keepers do for fear of the angel?", correct: "They shook and became as dead men", wrong: ["They ran to the city", "They rolled the stone back", "They fell asleep"], verses: ["28:4"] },
				{ prompt: "Where did the angel say Jesus would go before them?", correct: "Into Galilee", wrong: ["Into Egypt", "Into Bethlehem", "Into Rome"], verses: ["28:7"] },
				{ prompt: "What did the women do when Jesus met them?", correct: "They worshipped him", wrong: ["They ran away", "They hid in a cave", "They went to sleep"], verses: ["28:9"] },
			],
		},
		memory: { chapter: 28, verse: 6, text: "He is not here: for he is risen, as he said." },
	},
];

export const KIDS_ADVENTURE_IDS: readonly string[] = KIDS_ADVENTURES.map((adventure) => adventure.id);

export function findKidsAdventure(id: string): KidsAdventure | null {
	return KIDS_ADVENTURES.find((adventure) => adventure.id === id) ?? null;
}
