import SwiftUI

/// Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), per-verse
/// actions (copy / share / save to note / Ask AI), adjustable type size, and
/// prev/next navigation that rolls into adjacent books like YouVersion.
///
/// Port of `mobile/app/(app)/bible/chapter.tsx`. Android opens the actions from
/// a long-press bottom sheet; a Mac gets both a click-to-open inline row and the
/// same four items on the right-click menu.
struct ChapterReaderPane: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    @Bindable var model: BibleModel
    let askAI: (_ reference: String, _ text: String) -> Void
    let showAtlas: (_ book: Int, _ chapter: Int) -> Void

    private var translation: TranslationID { app.settings.translation }

    var body: some View {
        VStack(spacing: 0) {
            topBar

            if model.loading {
                loadingState
            } else if let error = model.error {
                errorState(error)
            } else {
                reader
                versePanel
            }
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does — and a superseded load is cancelled, not raced.
        .task(id: model.chapterKey(translation)) {
            await model.load(translation: translation)
        }
        // Reading history for "Pick Up Your Cross": a chapter counts as read
        // only once it has actually been on screen for a few seconds. Keyed on
        // `loadedKey` rather than the selection so the clock starts when the
        // text is really there, and paging away cancels the wait mid-sleep.
        .task(id: model.loadedKey) {
            guard model.loadedKey == model.chapterKey(translation) else { return }
            try? await Task.sleep(for: BibleModel.readEventDelay)
            guard !Task.isCancelled else { return }
            model.recordRead(translation: translation)
        }
    }

    // MARK: - Chrome

    private var topBar: some View {
        HStack(spacing: Spacing.md) {
            Button {
                model.showChapterGrid()
            } label: {
                Label("Chapters", systemImage: "chevron.left")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(SubtleButtonStyle())
            .help("Back to the chapter list")

            Text(model.reference)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.text)
                .lineLimit(1)

            Spacer()

            if let book = model.selectedBook {
                Button {
                    showAtlas(book, model.chapter)
                } label: {
                    Label("Who's here", systemImage: "person.2")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(SubtleButtonStyle())
                .help("Open the people, places and events in this chapter")
                .accessibilityLabel("Who's in this chapter")
            }

            translationChips

            HStack(spacing: Spacing.xs) {
                fontButton("A−", size: 12, enabled: model.canShrinkFont) { model.stepFont(-1) }
                fontButton("A+", size: 15, enabled: model.canGrowFont) { model.stepFont(1) }
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.md)
    }

    private var translationChips: some View {
        @Bindable var settings = app.settings
        return HStack(spacing: Spacing.xs) {
            ForEach(TranslationID.allCases, id: \.self) { id in
                let isActive = translation == id
                Button {
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
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .help("Read in the \(id.label)")
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
                .frame(width: 28, height: 22)
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
            ProgressView().controlSize(.small)
            Text(translation == .nkjv ? "Loading the NKJV…" : "Opening the chapter…")
                .font(.system(size: 12))
                .foregroundStyle(theme.textFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        GlassCard {
            VStack(spacing: Spacing.md) {
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(theme.textSecondary)
                    .multilineTextAlignment(.center)
                Button("Try again") {
                    Task { await model.load(translation: translation) }
                }
                .buttonStyle(AccentButtonStyle())
            }
            .frame(maxWidth: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Reader

    private var reader: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(Array(model.verses.enumerated()), id: \.offset) { index, markup in
                        verseRow(number: index + 1, markup: markup)
                            .id(index + 1)
                    }

                    footer
                }
                .padding(.horizontal, Spacing.xxl)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            // The reader's breathing room is a content margin rather than
            // padding inside the stack, so that scrolling verse 1 to the top
            // keeps it instead of scrolling it away.
            .contentMargins(.vertical, Spacing.lg, for: .scrollContent)
            // A deep link only lands once the chapter it names is the one on
            // screen — `loadedKey` is what proves that, since the selection
            // changes a render before the text does.
            .onChange(of: model.loadedKey, initial: true) { _, _ in
                if model.pendingVerse == nil {
                    // A newly opened chapter starts at the top. SwiftUI reuses
                    // the row identities `1...n` across chapters and keeps the
                    // old offset, so paging out of the middle of John 3 would
                    // otherwise land in the middle of John 4
                    // (`mobile/app/(app)/bible/chapter.tsx` scrolls to offset 0
                    // for the same reason). Verse 1 is the top anchor.
                    proxy.scrollTo(1, anchor: .top)
                } else {
                    scrollToPendingVerse(proxy)
                }
            }
            // A jump into the chapter already on screen changes nothing but the
            // pending verse — no reload, so `loadedKey` never moves and the
            // effect above never re-fires. Android keys its effect on the verse
            // param for the same reason.
            .onChange(of: model.pendingVerse) { _, verse in
                guard verse != nil else { return }
                scrollToPendingVerse(proxy)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                askAI(model.reference, model.chapterText)
            } label: {
                Text("✦ Ask AI")
                    .font(.system(size: 13, weight: .bold))
            }
            .buttonStyle(AccentButtonStyle())
            .padding(Spacing.xl)
            .accessibilityLabel("Ask AI about \(model.reference)")
        }
    }

    // MARK: - Verse panel

    /// Tap-a-verse lands here: the tapped verse's explanation and actions, in a
    /// panel pinned under the reader rather than inline in the verse list.
    ///
    /// The placement is a hard requirement, not a layout preference. Streaming
    /// text into a row of the reader's `LazyVStack` re-measures every verse in
    /// the chapter on every update — a chapter of Cormorant Garamond, tens of
    /// times a second — which pegged the main thread so badly that the very
    /// stream feeding it never got scheduled again, and the explanation never
    /// arrived. Outside the scroll view, the verse list never re-measures at
    /// all. It also happens to be the better Mac reading experience, and the
    /// closest analogue to Android's bottom sheet.
    @ViewBuilder
    private var versePanel: some View {
        if let number = model.actionVerse {
            let reference = model.verseReference(number)
            let text = model.verseText(number)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                HStack {
                    Text(reference)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(theme.accent)
                    Spacer()
                    Button {
                        model.dismissVerseActions()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(theme.textMuted)
                    }
                    .buttonStyle(.plain)
                    .help("Close")
                    .accessibilityLabel("Close verse panel")
                }

                VerseInsightView(
                    status: model.insight.status,
                    text: model.insight.text,
                    error: model.insight.error,
                    onRetry: { model.insight.retry() }
                )

                actionRow(reference: reference, text: text)
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.md)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .background(theme.glassLight)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(theme.border)
                    .frame(height: 1)
            }
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
    private func verseRow(number: Int, markup: String) -> some View {
        let isHighlighted = model.highlightedVerse == number
        let isOpen = model.actionVerse == number
        let reference = model.verseReference(number)
        let text = VerseMarkup.plainText(markup)
        let highlightHex = model.selectedBook.flatMap {
            app.highlights.hex(translation: translation, book: $0, chapter: model.chapter, verse: number)
        }

        VStack(alignment: .leading, spacing: Spacing.sm) {
            // A real Button, not an `onTapGesture` — the same call the notes
            // list makes, and for a second reason here: a tap gesture on a
            // stack inside this `LazyVStack` never fires at all, so clicking a
            // verse did nothing. It also earns keyboard activation and an
            // accessibility action.
            //
            // Deliberately NOT `.textSelection(.enabled)` either. A selectable
            // `Text` takes ownership of the whole text region on macOS: it
            // swallows left-clicks *and* right-clicks, so right-clicking a
            // verse raised the system Cut/Copy/Font menu instead of SureWord's
            // own. Copy still sits one click away in the action row and the
            // context menu, and the AI explanation below *is* selectable.
            Button {
                model.toggleVerse(number, translation: translation)
            } label: {
                verseText(number: number, markup: markup)
                    .lineSpacing(model.lineHeight - model.fontSize)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(reference). Explain this verse")
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(
            // Deep-link flash and the open-panel state keep precedence over
            // the persistent highlight wash, exactly as before.
            isHighlighted ? theme.accentSoft
                : (isOpen ? theme.surface : (highlightHex.map(HighlightColors.wash) ?? .clear)),
            in: .rect(cornerRadius: Radius.md)
        )
        .contentShape(.rect(cornerRadius: Radius.md))
        .contextMenu {
            if let order = model.selectedBook {
                Menu("Highlight") {
                    ForEach(HighlightColors.presets) { preset in
                        let isCurrent = highlightHex?.caseInsensitiveCompare(preset.hex) == .orderedSame
                        Button {
                            app.highlights.setColor(
                                translation: translation,
                                book: order,
                                chapter: model.chapter,
                                verse: number,
                                hex: preset.hex
                            )
                        } label: {
                            Label(preset.name, systemImage: isCurrent ? "checkmark" : "circle.fill")
                        }
                    }
                    if highlightHex != nil {
                        Divider()
                        Button("Remove Highlight") {
                            app.highlights.remove(
                                translation: translation,
                                book: order,
                                chapter: model.chapter,
                                verse: number
                            )
                        }
                    }
                }
                Divider()
            }
            Button("Copy") {
                model.copy(reference: reference, text: text, translation: translation)
            }
            ShareLink(
                item: VerseAttachment.formatForSharing(
                    reference: reference,
                    text: text,
                    translation: translation
                )
            ) {
                Text("Share…")
            }
            Button("Save to note") {
                model.saveToNote(reference: reference, text: text, translation: translation)
            }
            Button("✦ Expand with AI") {
                askAI(reference, text)
            }
        }
    }

    /// Verse number then the emphasis-aware segments, concatenated into one
    /// `Text` so the number stays inline with the wrapped body.
    private func verseText(number: Int, markup: String) -> Text {
        var result = Text("\(number) ")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(theme.accentDim)
        for segment in VerseMarkup.segments(markup) {
            result = result
                + Text(segment.text)
                .font(
                    .custom(
                        segment.italic ? FontFamily.verseItalic : FontFamily.verse,
                        size: model.fontSize
                    )
                )
                .italic(segment.italic)
                .foregroundStyle(theme.textSecondary)
        }
        return result
    }

    private func actionRow(reference: String, text: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Button("Copy") {
                model.copy(reference: reference, text: text, translation: translation)
            }
            .buttonStyle(SubtleButtonStyle())

            ShareLink(
                item: VerseAttachment.formatForSharing(
                    reference: reference,
                    text: text,
                    translation: translation
                )
            ) {
                Text("Share")
            }
            .buttonStyle(SubtleButtonStyle())

            Button("Save to note") {
                model.saveToNote(reference: reference, text: text, translation: translation)
            }
            .buttonStyle(SubtleButtonStyle())

            Button("✦ Expand with AI") {
                askAI(reference, text)
            }
            .buttonStyle(SubtleButtonStyle())

            if let order = model.selectedBook, let verse = model.actionVerse {
                highlightControls(order: order, verse: verse)
            }

            Spacer()
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(theme.textMuted)
    }

    /// YouVersion-style highlight picker: the shared preset swatches (current
    /// colour ringed), a native `ColorPicker` for a custom colour, and a
    /// Remove button once the verse is highlighted.
    private func highlightControls(order: Int, verse: Int) -> some View {
        let current = app.highlights.hex(
            translation: translation,
            book: order,
            chapter: model.chapter,
            verse: verse
        )
        return HStack(spacing: Spacing.xs) {
            ForEach(HighlightColors.presets) { preset in
                let isCurrent = current?.caseInsensitiveCompare(preset.hex) == .orderedSame
                Button {
                    app.highlights.setColor(
                        translation: translation,
                        book: order,
                        chapter: model.chapter,
                        verse: verse,
                        hex: preset.hex
                    )
                } label: {
                    Circle()
                        .fill(Color(hex: preset.hex) ?? .clear)
                        .frame(width: 14, height: 14)
                        .overlay {
                            if isCurrent {
                                Circle()
                                    .strokeBorder(theme.accent, lineWidth: 2)
                                    .padding(-2)
                            }
                        }
                        .contentShape(.circle)
                }
                .buttonStyle(.plain)
                .help("Highlight \(preset.name)")
                .accessibilityLabel("Highlight \(preset.name)")
            }

            ColorPicker(
                "",
                selection: Binding(
                    get: { current.flatMap { Color(hex: $0) } ?? Color(hex: 0xF5D76E) },
                    set: { picked in
                        guard let hex = HighlightColors.hexString(from: picked) else { return }
                        app.highlights.setColor(
                            translation: translation,
                            book: order,
                            chapter: model.chapter,
                            verse: verse,
                            hex: hex
                        )
                    }
                ),
                supportsOpacity: false
            )
            .labelsHidden()
            .frame(width: 28, height: 22)
            .help("Custom highlight color")

            if current != nil {
                Button("Remove") {
                    app.highlights.remove(
                        translation: translation,
                        book: order,
                        chapter: model.chapter,
                        verse: verse
                    )
                }
                .buttonStyle(SubtleButtonStyle())
            }
        }
    }

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            Text("\(translation.label) — \(translation.copyright)")
                .font(.system(size: 11))
                .italic()
                .foregroundStyle(theme.textGhost)
                .frame(maxWidth: .infinity)

            HStack(spacing: Spacing.md) {
                navButton(
                    title: "‹ Previous",
                    target: model.previousLocation,
                    accent: false
                )
                navButton(
                    title: "Next ›",
                    target: model.nextLocation,
                    accent: true
                )
            }
        }
        .padding(.top, Spacing.lg)
    }

    private func navButton(title: String, target: Bible.Location?, accent: Bool) -> some View {
        Button {
            model.go(to: target)
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(accent ? theme.accent : theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(
                    accent ? theme.accentSoft : theme.surface,
                    in: .rect(cornerRadius: Radius.lg)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .strokeBorder(accent ? theme.accentBorder : theme.borderStrong, lineWidth: 1)
                }
                .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .disabled(target == nil)
        .opacity(target == nil ? 0.35 : 1)
        .help(target.map { location in
            "\(Bible.book(order: location.order)?.name ?? "") \(location.chapter)"
        } ?? "")
    }
}
