/** Explicit classification for pinned client reducers, never an open-ended passthrough. */
export const EVIDENCE = Object.freeze({
  sdkTransport: ['ai@7.0.139:src/ui/process-ui-message-stream.ts:270-330,470-516,937-945', 'src/components/useChat.ts:295-372', 'src/lib/chat/receipts.ts:201-219', 'mobile/src/lib/chatView.ts:344-416', 'mobile/src/lib/receipts.ts:205-223', 'macos/Shared/Chat/UIMessage+History.swift:73-121', 'macos/Shared/Chat/ChatViewMessage.swift:322-405 (shared macOS/iOS)'],
  settledState: ['src/components/useChat.ts:314-318,379-381,419-421', 'mobile/src/lib/chatView.ts:358-362,424-425,469-471', 'macos/Shared/Chat/ChatViewMessage.swift:335-339,451', 'macos/Shared/Chat/UIMessage.swift:83-87'],
  receipts: ['src/lib/chat/receipts.ts:68-219', 'mobile/src/lib/receipts.ts:70-221', 'macos/Shared/Chat/ChatViewMessage.swift:469-650'],
  notes: ['src/components/useChat.ts:343-350', 'mobile/src/lib/chatView.ts:388-395', 'macos/Shared/Chat/ChatViewMessage.swift:373-383', 'src/lib/chat/receipts.ts:76-94', 'macos/Shared/Chat/ChatViewMessage.swift:507-525'],
  memory: ['src/lib/chat/receipts.ts:95-126', 'mobile/src/lib/receipts.ts:97-128', 'macos/Shared/Chat/ChatViewMessage.swift:527-570', 'src/lib/memory.ts:85-100'],
  cross: ['src/components/useChat.ts:357-366', 'mobile/src/lib/chatView.ts:402-411', 'macos/Shared/Chat/ChatViewMessage.swift:384-396', 'src/lib/chat/receipts.ts:128-131'],
  plan: ['src/lib/chat/receipts.ts:146-158', 'mobile/src/lib/receipts.ts:148-160', 'macos/Shared/Chat/ChatViewMessage.swift:592-607'],
  highlight: ['src/lib/chat/receipts.ts:160-179', 'mobile/src/lib/receipts.ts:162-181', 'macos/Shared/Chat/ChatViewMessage.swift:609-628'],
  reading: ['src/lib/chat/receipts.ts:133-145', 'mobile/src/lib/receipts.ts:135-147', 'macos/Shared/Chat/ChatViewMessage.swift:576-590'],
  learn: ['src/lib/chat/receipts.ts:181-189', 'mobile/src/lib/receipts.ts:183-191', 'macos/Shared/Chat/ChatViewMessage.swift:630-639'],
  scripture: ['src/components/useChat.ts:201-218,324-340', 'mobile/src/lib/chatView.ts:274-291,369-385', 'macos/Shared/Chat/ChatViewMessage.swift:346-362,674-692'],
  noReadCard: ['src/components/useChat.ts:324-368', 'mobile/src/lib/chatView.ts:369-414', 'macos/Shared/Chat/ChatViewMessage.swift:341-399', 'src/lib/chat/receipts.ts:188-189', 'macos/Shared/Chat/ChatViewMessage.swift:638-639'],
  passiveMemoryMismatch: ['src/lib/chat/receipts.ts:205-208', 'mobile/src/lib/receipts.ts:207-210', 'macos/Shared/Chat/ChatViewMessage.swift:472-479', 'src/components/useChat.ts:438-441', 'mobile/src/lib/chatView.ts:516-519', 'macos/Shared/Chat/UIMessage+History.swift:97-108'],
  historyStatus: ['src/components/useChat.ts:438-441', 'mobile/src/lib/chatView.ts:516-519', 'macos/Shared/Chat/UIMessage+History.swift:97-108', 'src/lib/ai/status-narration.ts:73-85'],
  noAppend: ['src/hooks/useNoteAI.ts:30-44,107-111,121-126', 'mobile/src/features/notes/useNoteAI.ts:30-46,108-112,123-127', 'macos/Shared/Notes/NoteAIModel.swift:82-94,265-288'],
});
export const MEMORY_OPAQUE_FIELDS = Object.freeze(['content', 'category', 'status', 'askedAt', 'followUpAfter']);
const plan = ['description', 'status', 'dayCount', 'currentDay', 'todayDay', 'completedCount', 'percent', 'streak', 'today', 'next', 'presets', 'formatted'];
/** Field values are wholly ignored by ALL three inspected reducers. Unknown sibling fields still reject. */
export const OUTPUT_OPAQUE_FIELDS = Object.freeze({
  searchScripture: ['averageSimilarity','degraded','keywordCoverage','formatted'],
  findVerses: ['averageSimilarity','keywordCoverage','matchMode','relaxed','coverage','truncated','formatted'],
  getPassage: ['reference','contextVerses','coverage','truncated','formatted'],
  searchOriginalLanguage: ['averageSimilarity','keywordCoverage','matchMode','relaxed','coverage','truncated','formatted','total','totalScope','resolved','matches'],
  webSearch: ['answer'],
  updateNote: ['previousWordCount', 'wordCount'],
  saveMemory: ['created'],
  setDailyCross: ['book', 'chapter', 'verse', 'whyToday', 'application', 'studyPath', 'question'],
  startReadingPlan: plan,
  markReadingPlanDay: ['title', ...plan],
  highlightVerse: ['book', 'endChapter', 'endVerse', 'verseCount', 'capped', 'color'],
  organizeNote: ['folder', 'tags', 'pinned', 'createdFolder', 'createdTags'],
  learnVerse: ['book', 'chapter', 'verse', 'created', 'stage', 'known', 'formatted'],
  logReading: ['sessionId','precision','timezone','entries'],
  correctReadingLog: ['result'],
});
/** These exact read tool names have no card branch and no receipt branch. */
export const INERT_READ_OUTPUT_FIELDS = Object.freeze({
  findNotes: ['notes'],
  listMemories: ['success', 'memories'],
  getDailyCross: ['reference', 'book', 'chapter', 'verse', 'text', 'reason', 'whyToday', 'application', 'studyPath', 'question', 'previousReference'],
  getLearnVerses: ['cards', 'knownCount', 'queueCount', 'formatted'],
  // Current tool outputs below have no card/receipt/effect branch in any of
  // the three audited reducers. Only these explicit top-level fields may be
  // omitted; bounded source JSON and current-run execution evidence remain.
  getCrossReferences: ['reference','crossReferences','total','returnedCount','truncated','formatted'],
  getOriginalText: ['reference','language','textName','words','requestedReference','sourceVersification','sourceReferences','sourceIdentifiers','formatted'],
  lookupStrongs: ['number','lemma','translit','def','kjv'],
  lookupBibleEntity: ['query','matches','formatted'],
  getBibleTimeline: ['scope','eras','events','truncated','formatted'],
  readLink: ['ok','success','url','content','truncated','reason'],
  readNote: ['noteId','title','htmlContent','truncated','wordCount','tags','folder','pinned','aliases','properties','updatedAt'],
  getHighlights: ['total','scope','highlights','formatted'],
  listSermonStudies: ['count','studies','formatted'],
  getSermonStudy: ['found','studyId','title','serviceDate','preacher','preachingText','recordingUrl','matchedBy','formatted'],
  getChurchEvents: ['count','events','formatted'],
  getReadingPlan: ['hasPlan','title',...plan],
  findChurch: ['success','churches','error'],
  setChurch: ['success','church','error'],
  saveTestimony: ['success','existing','error'],
  saveAboutMe: ['success','existing','error'],
  finishOnboarding: ['success','outcome','error'],
  getWaysToServe: ['mode','givesToChurch','church','today','ways','nearbySearchAvailable'],
  saveServeEntry: ['success','entry','error'],
  listServeEntries: ['entries'],
  findStudies: ['studies'],
  readStudy: ['success','study','error'],
  saveStudy: ['success','study','error'],
  requestActionApproval: ['success','error','alreadyExecuted','action','result','instruction','proposalOnly','current','replacement'],
  searchReadingHistory: ['entries','nextCursor'],
  getReadingStats: ['sessions','chapterReadings','partialReadings','uniqueChapters','activeDays','lastReadAt','lastReadDate','lastReadPrecision','historicalBackfillPending','coverage','books','currentLocalDate','timezone'],
});
/** success:false suppresses these receipts, and none has a separate output-card branch. */
export const RECEIPT_ONLY_FAILURE_TOOLS = Object.freeze(['updateNote', 'organizeNote', 'saveMemory', 'updateMemory', 'resolvePrayerRequest', 'deleteMemories', 'logReading', 'correctReadingLog', 'removeReadingLog', 'startReadingPlan', 'markReadingPlanDay', 'highlightVerse', 'learnVerse']);
export const TOOL_EVIDENCE = Object.freeze({ searchScripture:'scripture', findVerses:'scripture', searchOriginalLanguage:'scripture', getPassage:'scripture', updateNote:'notes', organizeNote:'notes', addToNote:'notes', saveMemory:'memory', updateMemory:'memory', resolvePrayerRequest:'memory', deleteMemories:'memory', setDailyCross:'cross', startReadingPlan:'plan', markReadingPlanDay:'plan', highlightVerse:'highlight', logReading:'reading', correctReadingLog:'reading', removeReadingLog:'reading', learnVerse:'learn' });
