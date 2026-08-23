import SwiftUI
import UIKit

/// Chapter reading screen: bundled KJV (offline) or NKJV (bolls.life), tap-a-
/// verse bottom sheet, adjustable type size, and prev/next navigation that
/// rolls into adjacent books like YouVersion.
///
/// Port of `mobile/app/(app)/bible/chapter.tsx` and the logic of the Mac's
/// `ChapterReaderPane`; where the Mac pins the verse panel under the reader,
/// iOS presents it as a native sheet — which satisfies the same hard layout
/// requirement (see `macos/README.md`, "The reader is a layout minefield"):
/// streaming text never lives inside the chapter's `LazyVStack`, so arriving
/// tokens never re-measure the verse list.
///
/// The pushed-in `order`/`chapter`/`verse` only seed the shared `BibleModel`
/// once; after that the model is the source of truth (prev/next paging changes
/// the model, never the stack), so reading position survives a trip to another
/// tab — the same reason `AppModel` owns the model.
struct ChapterReaderView: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app

    let order: Int
    let chapter: Int
    var verse: Int? = nil

    private var model: BibleModel { app.bible }
    private var translation: TranslationID { app.settings.translation }

    /// "John 3". The model answers once it has caught up with this screen's
    /// location; until then (the first render after a push) fall back to the
    /// pushed-in values so the title never flashes the previous chapter.
    private var title: String {
        if model.selectedBook == order { return model.reference }
        guard let book = Bible.book(order: order) else { return "" }
        return "\(book.name) \(chapter)"
    }

    var body: some View {
        VStack(spacing: 0) {
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
        // Align the shared reader state with the location this screen was
        // pushed for. Idempotent, and superseded loads are cancelled by the
        // `chapterKey` task below rather than raced.
        .task {
            model.open(order: order, chapter: chapter, verse: verse)
        }
        // The chapter *and* the translation are part of the identity of what is
        // on screen, so a translation change reloads through the same path a
        // page turn does.
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
        // Tap-a-verse. Swiping the sheet down dismisses it through the same
        // path as the close button, so the stream is cancelled either way.
        .sheet(isPresented: Binding(
            get: { model.actionVerse != nil },
            set: { if !$0 { model.dismissVerseActions() } }
        )) {
            if let number = model.actionVerse {
                let reference = model.verseReference(number)
                let text = model.verseText(number)
                VerseSheetView(
                    reference: reference,
                    text: text,
                    verse: number,
                    insight: model.insight,
                    shareText: VerseAttachment.formatForSharing(
                        reference: reference,
                        text: text,
                        translation: translation
                    ),
                    onClose: { model.dismissVerseActions() },
                    onExpand: { expandWithAI(reference: reference, text: text) },
                    onCopy: { model.copy(reference: reference, text: text, translation: translation) },
                    onSave: { model.saveToNote(reference: reference, text: text, translation: translation) }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: - Chrome

    private var translationChips: some View {
        @Bindable var settings = app.settings
        return HStack(spacing: Spacing.xs) {
            Spacer()
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
                .accessibilityLabel("Read in the \(id.label)")
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }

    @ToolbarContentBuilder
    private var fontControls: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: Spacing.sm) {
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
                .padding(.horizontal, Spacing.xl)
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
                    // otherwise land in the middle of John 4.
                    proxy.scrollTo(1, anchor: .top)
                } else {
                    scrollToPendingVerse(proxy)
                }
            }
            // A jump into the chapter already on screen changes nothing but the
            // pending verse — no reload, so `loadedKey` never moves and the
            // effect above never re-fires.
            .onChange(of: model.pendingVerse) { _, verse in
                guard verse != nil else { return }
                scrollToPendingVerse(proxy)
            }
        }
        // Attach the whole chapter to the next question — Android's floating
        // "✦ Ask AI" button.
        .overlay(alignment: .bottomTrailing) {
            Button {
                expandWithAI(reference: model.reference, text: model.chapterText)
            } label: {
                Label("Ask AI", systemImage: "sparkles")
                    .font(.system(size: 14, weight: .bold))
            }
            .buttonStyle(AccentButtonStyle())
            .padding(Spacing.xl)
            .accessibilityLabel("Ask AI about \(model.reference)")
        }
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.textSecondary)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(theme.bgElevated, in: .rect(cornerRadius: Radius.full))
                    .overlay {
                        Capsule().strokeBorder(theme.border, lineWidth: 1)
                    }
                    .padding(.bottom, Spacing.xl)
                    .transition(.opacity)
            }
        }
        .animation(.snappy, value: model.toast)
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
        let highlightHex = model.selectedBook.flatMap {
            app.highlights.hex(translation: translation, book: $0, chapter: model.chapter, verse: number)
        }

        // A real Button, not a tap gesture — it earns the pressed state and an
        // accessibility action, and on iOS it coexists cleanly with the sheet.
        // No `.textSelection(.enabled)`: copy lives one tap away in the sheet,
        // and a selectable region would fight the row's own tap handling.
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            model.toggleVerse(number, translation: translation)
        } label: {
            verseText(number: number, markup: markup)
                .lineSpacing(model.lineHeight - model.fontSize)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs)
        .background(
            // Deep-link flash and the open-sheet state keep precedence over
            // the persistent highlight wash, exactly as before.
            isHighlighted ? theme.accentSoft
                : (isOpen ? theme.surface : (highlightHex.map(HighlightColors.wash) ?? .clear)),
            in: .rect(cornerRadius: Radius.md)
        )
        .contentShape(.rect(cornerRadius: Radius.md))
        .accessibilityLabel("\(reference). Explain this verse")
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

    private var footer: some View {
        VStack(spacing: Spacing.xl) {
            Text("\(translation.label) — \(translation.copyright)")
                .font(.system(size: 11))
                .italic()
                .foregroundStyle(theme.textGhost)
                .frame(maxWidth: .infinity)

            HStack(spacing: Spacing.md) {
                navButton(title: "Previous", systemImage: "chevron.left", target: model.previousLocation, accent: false)
                navButton(title: "Next", systemImage: "chevron.right", target: model.nextLocation, accent: true)
            }
        }
        .padding(.top, Spacing.lg)
        // Room for the floating Ask AI button above the tab bar.
        .padding(.bottom, 80)
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

    // MARK: - Ask AI

    /// Attach the passage to the next question and ask the shell to switch to
    /// Chat — the iOS equivalent of Android pushing "/" with
    /// `?attachRef&attachText`. TabShell observes `.openChatWithAttachment`
    /// and selects the Chat tab; the input bar renders the attachment pill.
    private func expandWithAI(reference: String, text: String) {
        app.chat.attachment = model.attachment(
            reference: reference,
            text: text,
            translation: translation
        )
        model.dismissVerseActions()
        NotificationCenter.default.post(name: .openChatWithAttachment, object: nil)
    }
}
