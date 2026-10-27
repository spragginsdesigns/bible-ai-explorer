import ClerkKit
import SwiftUI

/// Send a word to someone on macOS and iOS (`docs/FEATURES.md`, "Share cards"
/// -> "Send a word"). Port of `mobile/src/features/shareCards/SendWordSheet.tsx`
/// and the web's `src/components/share/SendWordDialog.tsx`; the paths and wire
/// types live in `ShareCards.swift`.
///
/// The sender names who it is for and what they face. SureWord picks a KJV
/// passage (or uses the one the sender chose) and writes a word for them by
/// name, saved on the server as a private draft. The sender can add their own
/// line and name, see the card exactly as it will be shared, ask for another
/// word, then share the image or the link. What they typed about the situation
/// lives only in this sheet's model: the server uses it to choose and write
/// and never stores it, and nothing here logs it.

// MARK: - API

extension APIClient {
    /// Draft a card for someone. An AI call: callers ask the consent gate first.
    func sendWordDraft(_ request: SendWordRequest) async throws -> SendWordDraft {
        try await json("/api/cards/word", method: "POST", body: request, as: SendWordDraft.self)
    }

    /// Save the sender's own line and name on an unpublished draft, and learn
    /// whether the card still fits. The server answers 409 once the card is
    /// sent, which the sheet never asks for.
    func savePersonalCard(id: String, _ edit: PersonalCardEdit) async throws -> PersonalCardSaved {
        try await json("/api/cards/personal/\(ShareCards.pathSegment(id))", method: "PATCH", body: edit, as: PersonalCardSaved.self)
    }

    /// Send the draft: from here on the card is public at its link and frozen.
    func publishPersonalCard(_ request: PublishPersonalCardRequest) async throws -> PublishedPersonalCard {
        try await json("/api/cards/personal", method: "POST", body: request, as: PublishedPersonalCard.self)
    }
}

// MARK: - Model

/// State behind one open of the sheet, `@State`-owned by the view so the
/// situation text dies with the sheet.
@MainActor
@Observable
final class SendWordModel {
    enum Busy {
        case image
        case link
    }

    static let writeFallback = "SureWord couldn't write that word just now. Try again."
    static let cardFallback = "The card didn't load."
    static let imageFallback = "That card couldn't be shared. Try again."
    static let linkFallback = "That link couldn't be shared. Try again."
    static let saveFallback = "Your words couldn't be saved."
    static let tooLong = "That's a little long for the card. Shorten your words."
    static let sentNotice = "Sent. Write another word to change it."
    static let needsNameNotice = "Add your name under your words."
    /// Long enough that a word being typed is one save, short enough that the
    /// preview catches up while the sender is still looking at it. Android's
    /// `EDIT_SAVE_DELAY_MS`.
    static let saveDelay: Duration = .milliseconds(700)

    /// The passage the sender chose, or nil to let SureWord find one.
    let reference: String?
    private let api: APIClient
    private let defaults: UserDefaults

    private(set) var recipient = ""
    private(set) var situation = ""
    private(set) var personalLine = ""
    private(set) var signature: String
    private(set) var prefs: ShareCardPrefs
    private(set) var draft: SendWordDraft?
    /// The name the draft was written for; the field may change after it.
    private(set) var draftRecipient = ""
    /// Whether the draft, with the sender's words as last saved, draws whole
    /// at every size. Share waits for it.
    private(set) var fits = true
    private(set) var isWriting = false
    private(set) var error: String?
    private(set) var preview: ShareCardPreview = .loading(nil)
    private(set) var busy: Busy?
    /// Set when a file or the link text is ready for the system share UI; the
    /// view presents it and clears it.
    var pendingShare: OutgoingShare?

    /// Counts saved edits so each one is a new preview URL.
    private var edit = 0
    /// The draft id once it has been sent, and its public page.
    private var sentID: String?
    private var sentURL: String?
    /// What the draft on the server already holds, so typing saves only changes.
    private var saved = PersonalCardEdit(personalLine: "", signature: "")
    private var previews: [String: Image] = [:]
    private var previewTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    init(reference: String?, api: APIClient, senderName: String?, defaults: UserDefaults = .standard) {
        self.reference = reference
        self.api = api
        self.defaults = defaults
        // The sender's first name, so "From" is usually already right.
        self.signature = SendWordLimits.clip(
            senderName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            to: SendWordLimits.signature
        )
        self.prefs = ShareCardPrefs.load(defaults)
    }

    var intro: String { ShareCards.sendWordIntro(reference: reference) }

    var canWrite: Bool {
        !isWriting && SendWordLimits.canWrite(recipient: recipient, situation: situation)
    }

    /// Once sent the card is frozen, so the sender's fields stop editing it.
    var isSent: Bool {
        guard let draft else { return false }
        return sentID == draft.id
    }

    /// The line and name lock from the moment a share starts: what is being
    /// sent is what was on the card when the button was pressed.
    var wordsLocked: Bool { isSent || busy != nil }

    /// A line needs the sender's name under it; the server refuses one without.
    var needsName: Bool {
        !personalLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && signature.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canShare: Bool { draft != nil && busy == nil && !isWriting && fits && !needsName }

    var writeLabel: String {
        guard isWriting else { return "Write their card" }
        let name = recipient.trimmingCharacters(in: .whitespacesAndNewlines)
        return "Finding a word for \(name.isEmpty ? "them" : name)\u{2026}"
    }

    var previewLabel: String {
        guard let draft else { return "" }
        return "Card for \(draftRecipient): \(draft.reference). \(draft.word)"
    }

    func stop() {
        previewTask?.cancel()
        saveTask?.cancel()
    }

    // MARK: Fields

    func setRecipient(_ value: String) {
        recipient = SendWordLimits.clip(value, to: SendWordLimits.recipient)
    }

    func setSituation(_ value: String) {
        situation = SendWordLimits.clip(value, to: SendWordLimits.situation)
    }

    func setPersonalLine(_ value: String) {
        personalLine = SendWordLimits.clip(value, to: SendWordLimits.personalLine)
        scheduleSave()
    }

    func setSignature(_ value: String) {
        signature = SendWordLimits.clip(value, to: SendWordLimits.signature)
        scheduleSave()
    }

    // MARK: Choices

    func choose(style: ShareCardStyle) {
        guard style != prefs.style else { return }
        prefs.style = style
        remember()
    }

    func choose(format: ShareCardFormat) {
        guard format != prefs.format else { return }
        prefs.format = format
        remember()
    }

    /// The same per-device choice as the Share sheet. The encourage switch
    /// belongs to that sheet, and `prefs` carries whatever it holds.
    private func remember() {
        error = nil
        prefs.save(defaults)
        loadPreview()
    }

    func retry() {
        previews.removeAll()
        loadPreview()
    }

    // MARK: Writing

    /// Ask for a draft, or another one under the same inputs. The sender's own
    /// words are carried onto the new draft before it is drawn.
    func write() async {
        guard canWrite else { return }
        isWriting = true
        error = nil
        defer { isWriting = false }
        // The POST reaches a model, so it waits on the same consent sheet as
        // the Share sheet's word of encouragement.
        guard await AIConsentGate.ensure(.tap) else {
            error = AIConsent.declinedNotice
            return
        }
        saveTask?.cancel()
        let edits = PersonalCardEdit(personalLine: personalLine, signature: signature)
        do {
            let result = try await api.sendWordDraft(SendWordRequest(
                recipient: recipient.trimmingCharacters(in: .whitespacesAndNewlines),
                situation: situation.trimmingCharacters(in: .whitespacesAndNewlines),
                reference: reference,
                // "Write another word" deletes the unsent draft it replaces.
                replaces: isSent ? nil : draft?.id
            ))
            guard !result.id.isEmpty else { throw APIError(message: Self.writeFallback) }
            var fitsNow = result.fits
            if !edits.personalLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !edits.signature.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                fitsNow = try await api.savePersonalCard(id: result.id, edits).fits
            }
            sentID = nil
            sentURL = nil
            saved = edits
            fits = fitsNow
            draftRecipient = recipient.trimmingCharacters(in: .whitespacesAndNewlines)
            draft = result
            edit += 1
            loadPreview()
            // Typing while the word was written leaves the fields ahead of `edits`.
            scheduleSave()
        } catch {
            self.error = ShareCardModel.message(error, fallback: Self.writeFallback)
        }
    }

    /// Save the sender's line and name once they pause, then draw them. Only
    /// what changed is sent, and a sent card is frozen, so edits stop there.
    private func scheduleSave() {
        saveTask?.cancel()
        guard let draft, sentID != draft.id else { return }
        let next = PersonalCardEdit(personalLine: personalLine, signature: signature)
        guard next != saved else { return }
        let id = draft.id
        saveTask = Task { [weak self, api] in
            try? await Task.sleep(for: Self.saveDelay)
            guard !Task.isCancelled else { return }
            do {
                let result = try await api.savePersonalCard(id: id, next)
                guard let self, self.draft?.id == id else { return }
                self.saved = next
                self.fits = result.fits
                self.error = nil
                self.edit += 1
                self.loadPreview()
            } catch {
                // Shown, as on Android: a refused line (a link, "SureWord")
                // must read as refused now, not at the share. The next
                // keystroke tries again.
                guard let self, !Task.isCancelled, self.draft?.id == id else { return }
                self.error = ShareCardModel.message(error, fallback: Self.saveFallback)
            }
        }
    }

    // MARK: Preview

    private func loadPreview() {
        previewTask?.cancel()
        guard let draft else { return }
        let path = ShareCards.personalPreviewPath(
            id: draft.id,
            style: prefs.style,
            format: prefs.format,
            size: .preview,
            edit: edit
        )
        if let cached = previews[path] {
            preview = .ready(cached)
            return
        }
        preview = .loading(nil)
        previewTask = Task { [weak self, api] in
            do {
                // The draft preview is the owner's alone, so it carries the session.
                let data = try await api.data(path)
                guard let self, !Task.isCancelled else { return }
                guard let image = ShareCardModel.image(from: data) else {
                    self.preview = .error(Self.cardFallback)
                    return
                }
                self.previews[path] = image
                self.preview = .ready(image)
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.preview = .error(ShareCardModel.message(error, fallback: Self.cardFallback))
            }
        }
    }

    // MARK: Sending

    /// Publishing freezes the card (whoever receives it must never see it
    /// change), so it happens once, at the first share.
    private func publish() async throws -> String {
        guard let draft else { throw APIError(message: "Write the card first.") }
        if sentID == draft.id, let sentURL { return sentURL }
        saveTask?.cancel()
        let edits = PersonalCardEdit(personalLine: personalLine, signature: signature)
        let result = try await api.publishPersonalCard(PublishPersonalCardRequest(
            draftId: draft.id,
            personalLine: edits.personalLine,
            signature: edits.signature
        ))
        guard !result.url.isEmpty else { throw APIError(message: Self.linkFallback) }
        saved = edits
        sentID = draft.id
        sentURL = result.url
        return result.url
    }

    /// Send the card, download its public full-size image, and hand the file to
    /// the system share UI.
    func shareImage() async {
        guard canShare, let draft else { return }
        busy = .image
        error = nil
        defer { busy = nil }
        do {
            _ = try await publish()
            let path = ShareCards.personalCardPath(id: draft.id, style: prefs.style, format: prefs.format, size: .full)
            let data = try await api.publicData(path)
            let file = try ShareCardModel.write(
                data,
                named: ShareCards.personalFileName(recipient: draftRecipient, style: prefs.style, format: prefs.format)
            )
            pendingShare = OutgoingShare(payload: .image(file))
        } catch {
            guard !Task.isCancelled else { return }
            self.error = ShareCardModel.message(error, fallback: Self.imageFallback)
        }
    }

    /// Send the card and share "A word for Sarah: <link>".
    func shareLink() async {
        guard canShare else { return }
        busy = .link
        error = nil
        defer { busy = nil }
        do {
            let url = try await publish()
            pendingShare = OutgoingShare(payload: .text(ShareCards.sendWordLinkText(recipient: draftRecipient, url: url)))
        } catch {
            guard !Task.isCancelled else { return }
            self.error = ShareCardModel.message(error, fallback: Self.linkFallback)
        }
    }

    /// Something actually left the device. The only text this sheet shares is
    /// the link message, so a text payload is the "link" method. Kind and
    /// method (plus the card's style and format for an image): never the
    /// name, the situation or the words.
    func didShare(_ share: OutgoingShare) {
        let method: String
        if case .image = share.payload { method = "image" } else { method = "link" }
        AnalyticsReporter.track(
            AnalyticsEvents.shareCardShared,
            AnalyticsRules.shareCardShared(
                kind: "word",
                method: method,
                style: prefs.style.rawValue,
                format: prefs.format.rawValue
            )
        )
    }
}

// MARK: - View

struct SendWordSheet: View {
    @Environment(\.theme) private var theme
    @State private var model: SendWordModel
    private let onClose: () -> Void

    /// `reference` is a passage the sender already chose; nil lets SureWord
    /// find one. Drafts are KJV either way.
    init(reference: String?, api: APIClient, onClose: @escaping () -> Void) {
        _model = State(initialValue: SendWordModel(
            reference: reference,
            api: api,
            senderName: Clerk.shared.user?.firstName
        ))
        self.onClose = onClose
    }

    var body: some View {
        chrome
            .onDisappear { model.stop() }
    }

    #if os(macOS)
    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Send a word")
                    .appFont(.system(size: 15, weight: .semibold))
                    .foregroundStyle(theme.text)
                Spacer()
                Button("Done", action: onClose)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(Spacing.md)
            Divider().overlay(theme.border)
            ScrollView {
                content(maxPreviewHeight: ShareCardSheet.sheetSize.height * 0.4, width: ShareCardSheet.sheetSize.width)
            }
        }
        .frame(width: ShareCardSheet.sheetSize.width, height: ShareCardSheet.sheetSize.height)
        .background(theme.bgElevated)
    }
    #else
    private var chrome: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView {
                    // About 40% of the screen for the card, as Android sizes
                    // it, so the sender's fields and the buttons stay in reach.
                    content(maxPreviewHeight: proxy.size.height * 0.4, width: proxy.size.width)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .background(theme.bgElevated)
            .navigationTitle("Send a word")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
        .presentationDetents([.large])
        .sheet(item: $model.pendingShare) { share in
            ActivitySheet(share: share) {
                model.didShare(share)
                model.pendingShare = nil
                onClose()
            }
            .presentationDetents([.medium, .large])
        }
    }
    #endif

    private func content(maxPreviewHeight: CGFloat, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            if model.draft != nil {
                draftControls(maxPreviewHeight: maxPreviewHeight, width: width)
            } else {
                Text(model.intro)
                    .appFont(.system(size: 14))
                    .foregroundStyle(theme.textSecondary)
                    .padding(.bottom, Spacing.xs)
            }

            // Still editable under a draft, as on Android: a new name or a
            // clearer situation is what "Write another word" writes from.
            label("Who is it for?")
            field("Their first name", text: Binding(get: { model.recipient }, set: { model.setRecipient($0) }))
                .autocapitalizeWords()
            label("What are they facing?")
            field(
                "Surgery tomorrow, a hard week, a new job\u{2026}",
                text: Binding(get: { model.situation }, set: { model.setSituation($0) }),
                lines: 3...6
            )
            hint("Only used to choose the verse and the words. Never saved or shown.")
            if model.draft != nil {
                Button {
                    Task { await model.write() }
                } label: {
                    Text(model.isWriting ? "Writing\u{2026}" : "Write another word")
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(GhostShareButtonStyle())
                .disabled(!model.canWrite || model.busy != nil)
            }

            label("Your own words (optional)")
            field(
                "Praying for you today.",
                text: Binding(get: { model.personalLine }, set: { model.setPersonalLine($0) }),
                lines: 2...4
            )
            .disabled(model.wordsLocked)
            label("From")
            field("Your first name", text: Binding(get: { model.signature }, set: { model.setSignature($0) }))
                .autocapitalizeWords()
                .disabled(model.wordsLocked)
            if model.isSent {
                hint(SendWordModel.sentNotice)
            }
            if model.draft != nil, model.needsName {
                hint(SendWordModel.needsNameNotice)
            }
            if model.draft != nil, !model.fits {
                hint(SendWordModel.tooLong)
            }

            if model.draft == nil {
                Button {
                    Task { await model.write() }
                } label: {
                    Text(model.writeLabel)
                        .appFont(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(AccentButtonStyle())
                .disabled(!model.canWrite)
                .padding(.top, Spacing.sm)
            } else {
                shareButtons
            }

            if let error = model.error {
                Text(error)
                    .appFont(.system(size: 13))
                    .foregroundStyle(theme.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, Spacing.xl)
        .padding(.vertical, Spacing.lg)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func draftControls(maxPreviewHeight: CGFloat, width: CGFloat) -> some View {
        VStack(spacing: Spacing.md) {
            ShareCardPreviewFrame(
                preview: model.preview,
                format: model.prefs.format,
                maxHeight: maxPreviewHeight,
                width: width,
                accessibilityLabel: model.previewLabel,
                onRetry: model.retry
            )
            ShareCardStyleChips(selected: model.prefs.style) { model.choose(style: $0) }
            ShareCardFormatPicker(selected: model.prefs.format) { model.choose(format: $0) }
        }
        .frame(maxWidth: .infinity)
    }

    private var shareButtons: some View {
        VStack(spacing: Spacing.sm) {
            Button {
                Task { await model.shareImage() }
            } label: {
                Text(model.busy == .image ? "Preparing\u{2026}" : "Share image")
                    .appFont(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(AccentButtonStyle())
            .disabled(!model.canShare || !model.preview.isReady)
            #if os(macOS)
            .background {
                SharingPicker(share: $model.pendingShare, matches: { share in
                    if case .image = share.payload { return true }
                    return false
                }, onShared: model.didShare)
            }
            #endif

            Button {
                Task { await model.shareLink() }
            } label: {
                Text(model.busy == .link ? "Opening\u{2026}" : "Share link")
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(GhostShareButtonStyle())
            .disabled(!model.canShare)
            #if os(macOS)
            .background {
                SharingPicker(share: $model.pendingShare, matches: { share in
                    if case .image = share.payload { return false }
                    return true
                }, onShared: model.didShare)
            }
            #endif
        }
        .padding(.top, Spacing.sm)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 12))
            .foregroundStyle(theme.textFaint)
            .frame(maxWidth: .infinity)
            .multilineTextAlignment(.center)
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .appFont(.system(size: 13, weight: .bold))
            .foregroundStyle(theme.textSecondary)
            .padding(.top, Spacing.xs)
    }

    @ViewBuilder
    private func field(_ placeholder: String, text: Binding<String>, lines: ClosedRange<Int>? = nil) -> some View {
        Group {
            if let lines {
                TextField(placeholder, text: text, axis: .vertical)
                    .lineLimit(lines)
            } else {
                TextField(placeholder, text: text)
            }
        }
        .textFieldStyle(.plain)
        .appFont(.system(size: 14))
        .foregroundStyle(theme.text)
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm)
        .frame(maxWidth: .infinity, minHeight: 40, alignment: lines == nil ? .leading : .topLeading)
        .background(theme.surface, in: .rect(cornerRadius: Radius.md))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(theme.borderStrong, lineWidth: 1)
        }
    }
}

private extension View {
    /// Names are capitalised as typed on iOS; a Mac keyboard has no such mode.
    @ViewBuilder
    func autocapitalizeWords() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.words)
        #else
        self
        #endif
    }
}

// MARK: - Bible home entry

/// "Send a word to someone" on the Bible home, under Pick Up Your Cross, as on
/// the Android Bible tab and the web `/bible` page. Quieter than the accent
/// cards above it, like Android's row. Owns its own sheet, so the two homes
/// (the Mac sidebar, the iOS Bible tab) place it with one line each.
struct SendWordHomeCard: View {
    @Environment(\.theme) private var theme
    @Environment(AppModel.self) private var app
    @State private var isOpen = false
    private let titleSize: CGFloat
    private let subtitleSize: CGFloat

    /// The Mac sidebar's type sizes by default; the iOS Bible tab passes its
    /// larger ones.
    init(titleSize: CGFloat = 13, subtitleSize: CGFloat = 11) {
        self.titleSize = titleSize
        self.subtitleSize = subtitleSize
    }

    var body: some View {
        Button {
            isOpen = true
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: "envelope")
                    .appFont(.system(size: titleSize + 4))
                    .foregroundStyle(theme.textMuted)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Send a word to someone")
                        .appFont(.system(size: titleSize, weight: .bold))
                        .foregroundStyle(theme.text)
                    Text("A verse and a few words for what they face")
                        .appFont(.system(size: subtitleSize))
                        .foregroundStyle(theme.textMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .appFont(.system(size: titleSize - 1, weight: .semibold))
                    .foregroundStyle(theme.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.md)
            .background(theme.surface, in: .rect(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(theme.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
        .help("A verse and a few words for what they face")
        .accessibilityLabel("Send a word to someone")
        .sheet(isPresented: $isOpen) {
            SendWordSheet(reference: nil, api: app.api) { isOpen = false }
        }
    }
}
