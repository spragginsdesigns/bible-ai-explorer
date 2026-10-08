import SwiftUI
import UIKit

/// Chapter reading screen: bundled KJV and BSB (offline) or NKJV (bolls.life),
/// the two-tier verse sheet, the parchment page, adjustable type size, and
/// prev/next navigation that rolls into adjacent books like YouVersion.
///
/// Port of `mobile/app/(app)/bible/chapter.tsx`. The verse sheet is an overlay,
/// not a presented sheet: it is non-modal so a second tap on the chapter grows
/// the selection (see `VerseSheetPanel`), and streaming text never lives inside
/// the chapter's `LazyVStack`, so arriving tokens never re-measure the verse
/// list (`macos/README.md`, "The reader is a layout minefield").
///
/// The pushed-in `order`/`chapter`/`verse` only seed the shared `BibleModel`
/// once; after that the model is the source of truth (prev/next paging and
/// See-also jumps change the model, never the stack), so reading position
/// survives a trip to another tab.
struct ChapterReaderView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(AppModel.self) private var app

    let order: Int
    let chapter: Int
    var verse: Int? = nil

    private var model: BibleModel { app.bible }
    private var sheet: VerseSheetModel { app.bible.sheet }
    @State private var localTranslationOverride: TranslationID?
    private var translation: TranslationID { localTranslationOverride ?? app.settings.translation }
    /// Set once this screen has pushed its location into the shared model.
    /// Re-appearing (back from Atlas or Learn) must not re-seed it, or the
    /// reader would jump back to the chapter it was first opened on.
    @State private var seeded = false
    @State private var crossReferences = CrossReferencesModel()
    @State private var showingLearn = false
    @State private var showingCustomColor = false
    /// Drives the reveal scroll (`ReaderReveal`); deep links keep using the
    /// `ScrollViewReader` proxy.
    @State private var scrollPosition = ScrollPosition(idType: Int.self)
    /// Live geometry for the reveal, kept out of SwiftUI state so scrolling
    /// and lazy row layout never re-render the reader.
    @State private var revealGeometry = RevealGeometry()
    /// The verse sheet's height, for the footer's clearance.
    @State private var sheetHeight: CGFloat = 0

    /// The parchment page surface, per the shared account preference.
    private var parchment: Bool { app.settings.parchment }

    init(order: Int, chapter: Int, verse: Int? = nil, translation: TranslationID? = nil) {
        self.order = order
        self.chapter = chapter
        self.verse = verse
        _localTranslationOverride = State(initialValue: translation)
    }

    /// "John 3". Until the model has caught up with this screen (the first
    /// render after a push) fall back to the pushed-in values so the title
    /// never flashes the previous chapter.
    private var title: String {
        if seeded { return model.reference }
        guard let book = Bible.book(order: order) else { return "" }
        return "\(book.name) \(chapter)"
    }

    /// The chapter on screen, as the sheet sees it. Nil until the text for
    /// this exact translation and chapter has arrived.
    private var context: VerseSheetContext? {
        guard let book = model.book, model.loadedKey == model.chapterKey(translation) else { return nil }
        return VerseSheetContext(
            order: book.order,
            bookName: book.name,
            chapter: model.chapter,
            plainTexts: model.readerVerses.map(\.plainText),
            translation: translation
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ReadingSyncStatus(model: model.reading)
            translationChips

            if model.loading {
                loadingState
            } else if let error = model.error {
                errorState(error)
            } else {
                reader
            }
        }
        .background { MeshBackground() }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { fontControls }
        .safeAreaInset(edge: .bottom, spacing: 0) { ChapterAudioBar() }
        .task {
            guard !seeded else { return }
            model.open(order: order, chapter: chapter, verse: verse)
            seeded = true
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does.
        .task(id: model.chapterKey(translation)) {
            await model.load(translation: translation)
            await loadAudio()
        }
        // A new chapter or translation under an open sheet: the selection no
        // longer describes what is on screen.
        .onChange(of: model.chapterKey(translation)) { _, _ in sheet.chapterChanged() }
        .onAppear {
            model.reading.setReaderVisible(true)
            model.reading.setForeground(scenePhase == .active)
            model.prepareReading(translation: translation)
        }
        .onDisappear { model.reading.setReaderVisible(false); app.chapterAudio.close() }
        .onChange(of: model.loadedKey) { _, _ in model.prepareReading(translation: translation) }
        .onChange(of: scenePhase) { _, phase in model.reading.setForeground(phase == .active) }
        // The peek leaves most of the chapter readable; only the expanded
        // study view covers the text.
        .onChange(of: sheet.obscuresReader) { _, obscured in model.reading.setObscured(obscured) }
        .navigationDestination(isPresented: $showingLearn) { LearnView() }
        .sheet(isPresented: $showingCustomColor) {
            CustomHighlightSheet(color: Color(hex: selectionHex ?? HighlightColors.presets[0].hex) ?? .yellow) { hex in
                applyHighlight(hex)
            }
        }
    }

    private func loadAudio() async {
        let reader = model
        let next = reader.nextLocation
        await app.chapterAudio.load(
            book: reader.selectedBook ?? order, chapter: reader.chapter,
            reference: reader.reference, enabled: translation == .kjv,
            next: next.flatMap { location in
                guard ChapterAudio.hasNarration(location.order) else { return nil }
                return { @MainActor [weak reader] in reader?.open(order: location.order, chapter: location.chapter) }
            }
        )
    }

    // MARK: - Chrome

    private var translationChips: some View {
        @Bindable var settings = app.settings
        return HStack(spacing: Spacing.xs) {
            Spacer()
            ForEach(TranslationID.allCases, id: \.self) { id in
                let isActive = translation == id
                Button {
                    // A chip is an explicit preference choice: it clears a
                    // chat source's one-hop override and persists.
                    localTranslationOverride = nil
                    settings.translation = id
                } label: {
                    Text(id.label)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(isActive ? theme.accent : theme.textMuted)
                        .padding(.horizontal, Spacing.sm)
                        .padding(.vertical, 4)
                        .background(
                            isActive ? theme.accentSoft : theme.surface,
                            in: .rect(cornerRadius: Radius.full)
                        )
                        .overlay {
                            Capsule()
                                .strokeBorder(
                                    isActive ? theme.accentBorder : theme.borderStrong,
                                    lineWidth: 1
                                )
                        }
                        .frame(minHeight: 32)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Read in the \(id.name)")
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.xs)
    }

    @ToolbarContentBuilder
    private var fontControls: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: Spacing.sm) {
                NavigationLink {
                    AtlasExplorerView(
                        model: app.atlas,
                        book: model.selectedBook ?? order,
                        chapter: model.chapter
                    )
                } label: {
                    Image(systemName: "person.2")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Who's in this chapter")
                if app.chapterAudio.available {
                    Button("Listen to this chapter", systemImage: "headphones") {
                        app.dailyCross.listen.pause()
                        app.chapterAudio.start()
                    }.labelStyle(.iconOnly)
                }
                fontButton("A−", size: 12, enabled: model.canShrinkFont) { model.stepFont(-1) }
                fontButton("A+", size: 15, enabled: model.canGrowFont) { model.stepFont(1) }
            }
        }
    }

    private func fontButton(
        _ label: String,
        size: CGFloat,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .frame(width: 30, height: 24)
                .background(theme.surface, in: .rect(cornerRadius: Radius.sm))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.sm)
                        .strokeBorder(theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.sm))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(label == "A+" ? "Increase text size" : "Decrease text size")
    }

    // MARK: - States

    private var loadingState: some View {
        VStack(spacing: Spacing.md) {
            ProgressView().controlSize(.regular)
            Text(translation == .nkjv ? "Loading the NKJV…" : "Opening the chapter…")
                .font(.system(size: 13))
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        GlassCard {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again") {
                    Task { await model.load(translation: translation) }
                }
                .buttonStyle(AccentButtonStyle())
            }
        }
        .padding(.horizontal, Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Reader

    /// Ink colours: the parchment tones on the page, the shell's own text off it.
    private var ink: Color { parchment ? theme.parchmentInk : theme.text }
    private var numberInk: Color { parchment ? theme.parchmentNumber : theme.textMuted }
    /// Sourced words of Jesus. The same two reds Android uses.
    private var redLetter: Color { theme.isDark ? Color(hex: 0xEF8A83) : Color(hex: 0xA12E2A) }
    private var selectionWash: Color { parchment ? theme.parchmentHighlight : theme.accentSoft }

    private var reader: some View {
        GeometryReader { geometry in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if model.readerVerses.first?.headings.isEmpty ?? true {
                            Text(model.reference)
                                .font(.custom(FontFamily.verseItalic, size: 28))
                                .foregroundStyle(ink)
                                .padding(.bottom, 24)
                                .accessibilityAddTraits(.isHeader)
                        }
                        ForEach(model.readerVerses, id: \.number) { verse in
                            verseRow(verse)
                                .id(verse.number)
                                .onGeometryChange(for: CGRect.self) { proxy in
                                    proxy.frame(in: .named(Self.contentSpace))
                                } action: { [key = model.loadedKey] frame in
                                    revealGeometry.record(frame, verse: verse.number, chapter: key)
                                }
                                .onScrollVisibilityChange(threshold: 0.5) { visible in
                                    model.readingVisibility(verse: verse.number, visible: visible, translation: translation)
                                }
                        }

                        footer
                    }
                    .id(model.loadedKey)
                    .coordinateSpace(.named(Self.contentSpace))
                    .padding(.horizontal, 28)
                    .frame(maxWidth: 720, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                // Breathing room as a content margin rather than padding inside
                // the stack, so scrolling verse 1 to the top keeps it.
                .contentMargins(.vertical, Spacing.xl, for: .scrollContent)
                .scrollPosition($scrollPosition)
                .onScrollGeometryChange(for: ScrollGeometry.self) { $0 } action: { _, geometry in
                    revealGeometry.scroll = geometry
                }
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.frame(in: .named(Self.readerSpace)).minY
                } action: { minY in
                    revealGeometry.scrollMinY = minY
                }
                // A deep link only lands once the chapter it names is the one on
                // screen - `loadedKey` is what proves that.
                .onChange(of: model.loadedKey, initial: true) { _, _ in
                    if model.pendingVerse == nil {
                        // A newly opened chapter starts at the top; SwiftUI
                        // reuses the row identities across chapters and would
                        // otherwise keep the old offset.
                        proxy.scrollTo(1, anchor: .top)
                    } else {
                        scrollToPendingVerse(proxy)
                    }
                }
                // A jump into the chapter already on screen changes nothing but
                // the pending verse, so `loadedKey` never moves.
                .onChange(of: model.pendingVerse) { _, verse in
                    guard verse != nil else { return }
                    scrollToPendingVerse(proxy)
                }
                .onChange(of: app.chapterAudio.verse) { _, verse in
                    guard app.chapterAudio.isPlaying, let verse, !sheet.obscuresReader else { return }
                    if reduceMotion { proxy.scrollTo(verse, anchor: .center) }
                    else { withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(verse, anchor: .center) } }
                }
            }
            // The page: a fixed sheet the verses scroll over, like text moving
            // across an unrolled scroll - Android's absolutely positioned image
            // behind its list. A background does not scroll.
            .background {
                if parchment { parchmentPage }
            }
            .overlay(alignment: .bottomTrailing) {
                if !sheet.isOpen { askAIButton }
            }
            .overlay {
                // The study view dims the chapter; a tap there collapses it.
                if sheet.obscuresReader {
                    Color.black.opacity(0.35)
                        .ignoresSafeArea(edges: .bottom)
                        .onTapGesture { withAnimation(.snappy) { sheet.tier = .peek } }
                        .accessibilityLabel("Collapse details")
                        .accessibilityAddTraits(.isButton)
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .bottom) {
                if sheet.isOpen, let context {
                    verseSheet(context: context, availableHeight: geometry.size.height)
                        // Height, not frame: the slide-in and a drag move the
                        // panel without changing where it settles.
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                            revealGeometry.sheetHeight = height
                            sheetHeight = height
                            revealSelection(readerHeight: geometry.size.height)
                        }
                        .transition(.move(edge: .bottom))
                }
            }
            .overlay(alignment: .top) { toastView }
            .coordinateSpace(.named(Self.readerSpace))
            .animation(.snappy, value: sheet.isOpen)
            .animation(.snappy, value: sheet.obscuresReader)
            .animation(.snappy, value: model.toast)
            // A tap, a grown range or a tier change: keep the selection above
            // the sheet it opened.
            .onChange(of: sheet.selection) { _, selection in
                if selection == nil { revealGeometry.sheetHeight = nil }
                revealSelection(readerHeight: geometry.size.height)
            }
            .onChange(of: sheet.tier) { _, _ in revealSelection(readerHeight: geometry.size.height) }
        }
    }

    private static let contentSpace = "reader.content"
    private static let readerSpace = "reader.viewport"

    /// Scroll just enough that the selected verse (the top of a range) sits
    /// above the verse sheet. Runs on selection and tier changes and whenever
    /// the sheet's measured frame moves (it slides up, the teaser fills in),
    /// so the target follows the sheet's real height rather than a guess.
    private func revealSelection(readerHeight: CGFloat) {
        guard let selection = sheet.selection,
              let sheetHeight = revealGeometry.sheetHeight,
              let scroll = revealGeometry.scroll
        else { return }
        let frames = revealGeometry.frames(chapter: model.loadedKey)
        guard let first = frames[selection.start],
              let last = frames[selection.end] ?? frames[selection.start]
        else {
            // Not laid out (a selection made off screen): put it at the top.
            scrollPosition.scrollTo(id: selection.start, anchor: .top)
            return
        }
        let offset = scroll.contentOffset.y
        guard let target = ReaderReveal.targetOffset(
            rangeTop: first.minY,
            rangeBottom: last.maxY,
            offset: offset,
            windowTop: scroll.contentInsets.top,
            // The sheet is bottom-aligned in the reader.
            windowBottom: readerHeight - sheetHeight - revealGeometry.scrollMinY,
            minOffset: -scroll.contentInsets.top,
            // `containerSize` excludes the insets; the visible rect does not.
            maxOffset: scroll.contentSize.height + scroll.contentInsets.bottom - scroll.visibleRect.height
        ) else { return }
        if reduceMotion {
            scrollPosition.scrollTo(y: target)
        } else {
            withAnimation(.snappy) { scrollPosition.scrollTo(y: target) }
        }
    }

    private var parchmentPage: some View {
        // `Color.clear` pins the texture to the reader's bounds: the image is
        // aspect-filled, so it reports more than it was offered, and clipping
        // the image itself would clip to that oversized rect.
        Color.clear
            .overlay {
                Image(theme.isDark ? "ParchmentDark" : "ParchmentLight")
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            }
            .clipped()
            .ignoresSafeArea(edges: .bottom)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    /// Attach the whole chapter to the next question - Android's dock "Ask AI".
    private var askAIButton: some View {
        Button {
            expandWithAI(reference: model.reference, text: model.chapterText)
        } label: {
            Label("Ask AI", systemImage: "sparkles")
                .font(.system(size: 14, weight: .bold))
        }
        .buttonStyle(AccentButtonStyle())
        // An opaque plate under the translucent accent, so gold never sits on
        // gold over the parchment or on verse text.
        .background(theme.bgElevated, in: .capsule)
        .shadow(color: .black.opacity(0.3), radius: 10, y: 3)
        .padding(Spacing.xl)
        .accessibilityLabel("Ask AI about \(model.reference)")
    }

    @ViewBuilder
    private var toastView: some View {
        if let toast = model.toast {
            Text(toast)
                .font(.system(size: 12))
                .foregroundStyle(theme.textSecondary)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .background(theme.bgElevated, in: .rect(cornerRadius: Radius.full))
                .overlay { Capsule().strokeBorder(theme.border, lineWidth: 1) }
                .padding(.top, Spacing.md)
                .transition(.opacity)
        }
    }

    private func scrollToPendingVerse(_ proxy: ScrollViewProxy) {
        guard model.loadedKey == model.chapterKey(translation),
              let verse = model.pendingVerse,
              verse >= 1, verse <= model.verses.count
        else { return }
        proxy.scrollTo(verse, anchor: .top)
        withAnimation(.easeOut(duration: 0.2)) { model.flash(verse: verse) }
    }

    @ViewBuilder
    private func verseRow(_ verse: ReaderVerse) -> some View {
        let number = verse.number
        let selected = (sheet.selection?.includes(number) ?? false) || (app.chapterAudio.isPlaying && app.chapterAudio.verse == number)
        let flashed = model.highlightedVerse == number
        let highlightHex = model.selectedBook.flatMap {
            app.highlights.hex(translation: translation, book: $0, chapter: model.chapter, verse: number)
        }

        VStack(alignment: .leading, spacing: 0) {
            // Publisher headings: never part of the verse, never copied.
            ForEach(Array(verse.headings.enumerated()), id: \.offset) { _, heading in
                Text(heading)
                    .font(.custom(FontFamily.verseItalic, size: 24))
                    .foregroundStyle(ink)
                    .padding(.top, 16)
                    .padding(.bottom, 20)
                    .accessibilityAddTraits(.isHeader)
            }

            // A real Button, not a tap gesture: it earns the pressed state and
            // an accessibility action, and it coexists with the sheet overlay.
            Button {
                tap(number)
            } label: {
                Text(attributedVerse(verse, selected: selected, highlightHex: highlightHex))
                    .lineSpacing(model.fontSize * 0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .background(
                        selected || flashed ? selectionWash : .clear,
                        in: .rect(cornerRadius: 4)
                    )
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .padding(.bottom, 16)
            .accessibilityLabel("\(model.verseReference(number)). \(verse.omitted ? "Not included in this edition's main text." : verse.plainText)")
            .accessibilityHint(selected ? "Selected. Tap to change the selection." : "Opens the verse sheet")
            .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }

    /// Verse number then the formatted segments in one attributed run, so the
    /// number stays inline with the wrapped body and a user highlight washes
    /// the words themselves, as Android draws it.
    private func attributedVerse(_ verse: ReaderVerse, selected: Bool, highlightHex: String?) -> AttributedString {
        var result = AttributedString("\(verse.number)\u{2002}")
        result.font = .system(size: 12)
        result.foregroundColor = selected ? theme.accent : numberInk

        if verse.omitted {
            var note = AttributedString("Not included in this edition\u{2019}s main text.")
            note.font = .system(size: 14).italic()
            note.foregroundColor = theme.textMuted
            result += note
        }

        let wash = highlightHex.map(HighlightColors.wash)
        for segment in verse.segments {
            var run = AttributedString(segment.text)
            run.font = .custom(segment.italic ? FontFamily.verseItalic : FontFamily.verse, size: model.fontSize)
            run.foregroundColor = segment.jesusSpeech ? redLetter : ink
            if let wash { run.backgroundColor = wash }
            result += run
        }
        return result
    }

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            Text("\(translation.name) - \(translation.copyright)")
                .font(.system(size: 11))
                .italic()
                .foregroundStyle(parchment ? theme.parchmentInk.opacity(0.55) : theme.textGhost)
                .frame(maxWidth: .infinity)

            HStack(spacing: Spacing.md) {
                navButton(title: "Previous", systemImage: "chevron.left", target: model.previousLocation, accent: false)
                navButton(title: "Next", systemImage: "chevron.right", target: model.nextLocation, accent: true)
            }
        }
        .padding(.top, Spacing.lg)
        // Room for the floating Ask AI button, or for the peek when it is up,
        // so the last verses can always scroll clear of it.
        .padding(.bottom, sheet.isOpen ? max(280, sheetHeight + Spacing.xl) : 80)
    }

    private func navButton(
        title: String,
        systemImage: String,
        target: Bible.Location?,
        accent: Bool
    ) -> some View {
        Button {
            model.go(to: target)
        } label: {
            Label(title, systemImage: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(accent ? theme.accent : theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    accent ? theme.accentSoft : theme.surface,
                    in: .rect(cornerRadius: Radius.lg)
                )
                // An opaque plate under the translucent fill, so the buttons
                // read the same over the parchment as over the shell.
                .background(theme.bgElevated, in: .rect(cornerRadius: Radius.lg))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(accent ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
        .opacity(target == nil ? 0.35 : 1)
        .accessibilityHint(target.map { location in
            "\(Bible.book(order: location.order)?.name ?? "") \(location.chapter)"
        } ?? "")
    }

    // MARK: - Verse sheet

    private func tap(_ number: Int) {
        guard let context else { return }
        let applied = sheet.tap(number, context: context)
        UIImpactFeedbackGenerator(style: applied ? .light : .rigid).impactOccurred()
    }

    /// Stored colours for the selection, verse → hex.
    private var selectionHighlights: [Int: String] {
        guard let book = model.selectedBook else { return [:] }
        var map: [Int: String] = [:]
        for verse in sheet.activeSelection.verses {
            if let hex = app.highlights.hex(translation: translation, book: book, chapter: model.chapter, verse: verse) {
                map[verse] = hex
            }
        }
        return map
    }

    private var selectionHex: String? { sheet.activeSelection.sharedColor(in: selectionHighlights) }

    private func verseSheet(context: VerseSheetContext, availableHeight: CGFloat) -> some View {
        @Bindable var sheet = sheet
        let reference = sheet.reference(context)
        let text = sheet.text(context)
        let highlights = selectionHighlights
        let shared = sheet.activeSelection.sharedColor(in: highlights)
        let markedAs = shared.flatMap { HighlightColors.label(forHex: $0, in: app.settings.highlightLabels) }
        let message = sheet.actionMessage
            ?? markedAs.map { VerseSheetModel.Message(text: "Marked as \u{201C}\($0)\u{201D}", tone: .muted) }

        return VerseSheetPanel(
            model: sheet,
            title: reference,
            subtitle: sheet.subtitle,
            availableHeight: availableHeight,
            onClose: { sheet.close() },
            peek: {
                InsightTeaserView(
                    insight: sheet.insight,
                    onExpand: { withAnimation(.snappy) { sheet.openStudy(.explain) } },
                    onRetry: { sheet.retryInsight(context) }
                )
            },
            study: {
                studyView(context: context, reference: reference, text: text)
            },
            footer: {
                VerseActionBarView(
                    color: shared,
                    canRemove: !highlights.isEmpty,
                    labelForPreset: { HighlightColors.displayName($0, in: app.settings.highlightLabels) },
                    onHighlight: { applyHighlight($0) },
                    onRemoveHighlight: removeHighlight,
                    onCustomColor: { showingCustomColor = true },
                    actions: actions(context: context, reference: reference, text: text, highlighted: shared != nil),
                    message: message
                )
            }
        )
    }

    @ViewBuilder
    private func studyView(context: VerseSheetContext, reference: String, text: String) -> some View {
        @Bindable var sheet = sheet
        let selection = sheet.activeSelection
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(text)
                .font(.custom(FontFamily.verse, size: 17))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(4)
                .padding(.horizontal, Spacing.lg)

            StudyTabsView(selection: $sheet.studyTab)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                // Each study is a model generation, so a range studies its
                // first verse only rather than firing one per selected verse.
                if sheet.studyTab != .explain, selection.count > 1 {
                    Text("For verse \(selection.start)")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.textFaint)
                }
                switch sheet.studyTab {
                case .explain:
                    VerseInsightView(
                        status: sheet.insight.status,
                        text: sheet.insight.text,
                        error: sheet.insight.error,
                        skeletonWidths: [300, 268, 184],
                        onRetry: { sheet.retryInsight(context) }
                    )
                case .words:
                    WordStudyView(
                        api: app.api,
                        book: context.order,
                        chapter: context.chapter,
                        verse: selection.start,
                        modelId: app.settings.chatModelId,
                        onAsk: { prompt, attach in
                            askWithPrompt(prompt, reference: attach ? reference : nil, text: attach ? text : nil)
                        }
                    )
                case .seeAlso:
                    CrossReferencesView(
                        model: crossReferences,
                        reference: VerseSelection(start: selection.start, end: selection.start)
                            .reference(bookName: context.bookName, chapter: context.chapter),
                        translation: context.translation,
                        onNavigate: openCrossReference
                    )
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.xs)
        }
    }

    private func actions(context: VerseSheetContext, reference: String, text: String, highlighted: Bool) -> [VerseSheetAction] {
        let share = sheet.shareText(context)
        return (app.chapterAudio.available ? [VerseSheetAction(id: "listen", systemImage: "headphones", label: "Listen") {
            app.dailyCross.listen.pause()
            app.chapterAudio.start(from: sheet.selection?.start ?? 1)
        }] : []) + [
            VerseSheetAction(id: "ask", systemImage: "sparkles", label: "Ask") {
                expandWithAI(reference: reference, text: text)
            },
            VerseSheetAction(
                id: "copy",
                systemImage: sheet.copied ? "checkmark" : "doc.on.doc",
                label: sheet.copied ? "Copied" : "Copy",
                active: sheet.copied
            ) {
                UIPasteboard.general.string = share
                sheet.markCopied()
            },
            VerseSheetAction(id: "share", systemImage: "square.and.arrow.up", label: "Share", shareText: share) {},
            VerseSheetAction(
                id: "note",
                systemImage: "square.and.pencil",
                label: sheet.saveBusy ? "Saving…" : "Note",
                disabled: sheet.saveBusy
            ) {
                Task { await saveToNote(context) }
            },
            VerseSheetAction(
                id: "learn",
                systemImage: sheet.learnStatus == .added ? "graduationcap.fill" : "graduationcap",
                label: sheet.learnStatus == .adding ? "Adding…" : sheet.learnStatus == .added ? "Added" : "Learn",
                disabled: sheet.learnStatus == .adding,
                active: sheet.learnStatus == .added
            ) {
                if sheet.learnStatus == .added {
                    showingLearn = true
                } else {
                    Task { await addToLearn(context, highlighted: highlighted) }
                }
            },
        ]
    }

    // MARK: - Actions

    /// Highlight writes are optimistic - the store recolours at once and rolls
    /// back any verse whose write fails - so this fires one per verse.
    private func applyHighlight(_ hex: String) {
        guard let book = model.selectedBook else { return }
        for verse in sheet.activeSelection.verses {
            app.highlights.setColor(translation: translation, book: book, chapter: model.chapter, verse: verse, hex: hex)
        }
    }

    private func removeHighlight() {
        guard let book = model.selectedBook else { return }
        for verse in sheet.activeSelection.verses {
            app.highlights.remove(translation: translation, book: book, chapter: model.chapter, verse: verse)
        }
    }

    private func saveToNote(_ context: VerseSheetContext) async {
        guard let noteID = await sheet.saveToNote(api: app.api, context: context) else { return }
        sheet.close()
        NotificationCenter.default.post(name: .openNote, object: nil, userInfo: ["noteId": noteID])
    }

    private func addToLearn(_ context: VerseSheetContext, highlighted: Bool) async {
        let api = app.api
        await sheet.addToLearn(context: context, highlighted: highlighted) { body in
            try await api.json("/api/learn", method: "POST", body: body, as: VerseLearnCard.self)
        }
    }

    /// The sheet is not modal, so a See-also jump can land straight away: the
    /// reader opens the passage in place and flashes the verse.
    private func openCrossReference(_ target: Reference) {
        sheet.close()
        model.open(target, translationOverride: localTranslationOverride)
    }

    /// Attach the passage to the next question and ask the shell to switch to
    /// Chat - the iOS equivalent of Android pushing "/" with
    /// `?attachRef&attachText`.
    private func expandWithAI(reference: String, text: String) {
        app.chat.attachment = model.attachment(reference: reference, text: text, translation: translation)
        sheet.close()
        NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
    }

    /// The same hop to Chat with the composer filled in - the Words tab's two
    /// actions. A nil reference (a lexicon search) attaches nothing.
    private func askWithPrompt(_ prompt: String, reference: String?, text: String?) {
        app.chat.input = prompt
        if let reference, let text {
            app.chat.attachment = model.attachment(reference: reference, text: text, translation: translation)
        } else {
            app.chat.attachment = nil
        }
        sheet.close()
        NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
    }
}

/// Geometry the reveal reads at decision time. A plain class held in `@State`
/// so writes from scroll and layout callbacks are not view updates.
private final class RevealGeometry {
    /// Verse frames in the chapter's content space (fixed while scrolling),
    /// for the chapter they were measured in.
    private var verseFrames: [Int: CGRect] = [:]
    private var framesChapter: String?
    var scroll: ScrollGeometry?
    /// The scroll view's top edge in the reader's space.
    var scrollMinY: CGFloat = 0
    /// The open sheet's settled height; nil while it is closed.
    var sheetHeight: CGFloat?

    func record(_ frame: CGRect, verse: Int, chapter: String?) {
        if chapter != framesChapter {
            verseFrames = [:]
            framesChapter = chapter
        }
        verseFrames[verse] = frame
    }

    func frames(chapter: String?) -> [Int: CGRect] {
        chapter == framesChapter ? verseFrames : [:]
    }
}
