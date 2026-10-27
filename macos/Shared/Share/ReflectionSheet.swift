import ClerkKit
import SwiftUI

enum ReflectionFont: String, CaseIterable, Codable, Identifiable {
    case italic, book, simple
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum ReflectionPlacement: String, CaseIterable, Codable, Identifiable {
    case below, above
    var id: String { rawValue }
    var label: String { self == .above ? "Above verse" : "Below verse" }
}

struct ReflectionPresentation: Codable, Equatable, Sendable {
    var font: ReflectionFont = .italic
    var placement: ReflectionPlacement = .below
}

private struct ReflectionDraft: Decodable, Sendable {
    var id: String
    var reference: String
    var translation: String
    var text: String
}
private struct ReflectionStart: Encodable { let reference: String; let translation: String }
private struct ReflectionEdit: Encodable {
    let personalLine: String
    let signature: String
    let presentation: ReflectionPresentation
}
private struct ReflectionPublish: Encodable {
    let draftId: String
    let personalLine: String
    let signature: String
    let presentation: ReflectionPresentation
}
private struct ReflectionSuggestion: Decodable { let text: String }

/// Words stay private until the sender shares. Every edit invalidates the previously rendered preview.
@MainActor @Observable
final class ReflectionModel {
    let reference: String
    let translation: String
    private let api: APIClient
    private var draft: ReflectionDraft?
    private var active = true
    private var revision = 0
    private var previewRevision: Int?
    private(set) var text = ""
    private(set) var signature: String
    private(set) var presentation = ReflectionPresentation()
    private(set) var prefs: ShareCardPrefs
    private(set) var busy: String?
    private(set) var error: String?
    private(set) var preview: Image?
    private(set) var publishedURL: String?
    var pendingShare: OutgoingShare?
    var ready: Bool { preview != nil && previewRevision == revision }
    var locked: Bool { busy != nil || publishedURL != nil }
    var opened: Bool { draft != nil }

    init(reference: String, translation: String, api: APIClient, name: String?, prefs: ShareCardPrefs) {
        self.reference = reference
        self.translation = translation
        self.api = api
        signature = name ?? ""
        self.prefs = prefs
    }

    func start() async {
        guard draft == nil, busy == nil else { return }
        busy = "opening"
        defer { if active { busy = nil } }
        do {
            let result: ReflectionDraft = try await api.json("/api/cards/reflection", method: "POST", body: ReflectionStart(reference: reference, translation: translation))
            guard active, !Task.isCancelled else { return }
            draft = result
        } catch { if active { self.error = "The reflection couldn't be opened. Close it and try again." } }
    }

    func stop() { active = false }
    private func dirty() { revision += 1; error = nil }
    func setText(_ value: String) { guard !locked else { return }; text = String(value.prefix(200)); dirty() }
    func setSignature(_ value: String) { guard !locked else { return }; signature = String(value.prefix(30)); dirty() }
    func setFont(_ value: ReflectionFont) { guard !locked else { return }; presentation.font = value; dirty() }
    func setPlacement(_ value: ReflectionPlacement) { guard !locked else { return }; presentation.placement = value; dirty() }
    func setStyle(_ value: ShareCardStyle) { guard !locked else { return }; prefs.style = value; dirty() }
    func setFormat(_ value: ShareCardFormat) { guard !locked else { return }; prefs.format = value; dirty() }

    func suggest() async {
        guard let draft, !locked else { return }
        busy = "writing"; error = nil
        defer { if active { busy = nil } }
        guard await AIConsentGate.ensure(.tap), active else { return }
        do {
            let result: ReflectionSuggestion = try await api.json("/api/cards/reflection/\(ShareCards.pathSegment(draft.id))/suggest", method: "POST", timeout: 90)
            guard active, !Task.isCancelled else { return }
            text = result.text
            dirty()
        } catch { if active { self.error = ShareCardModel.message(error, fallback: "SureWord couldn't safely draft this reflection. You can write your own words.") } }
    }

    func updatePreview() async {
        guard let draft, !locked, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        busy = "preview"; error = nil; previewRevision = nil
        let requestedRevision = revision
        defer { if active { busy = nil } }
        do {
            let saved: PersonalCardSaved = try await api.json("/api/cards/personal/\(ShareCards.pathSegment(draft.id))", method: "PATCH", body: edit)
            guard saved.fits else { throw APIError(message: "Shorten your reflection or choose fewer verses so every word fits.") }
            let path = ShareCards.personalPreviewPath(id: draft.id, style: prefs.style, format: prefs.format, size: .preview, edit: revision)
            let data = try await api.data(path)
            guard active, !Task.isCancelled, revision == requestedRevision else { return }
            guard let image = ShareCardModel.image(from: data) else { throw APIError(message: "The preview didn't load.") }
            preview = image
            previewRevision = requestedRevision
        } catch { if active { self.error = ShareCardModel.message(error, fallback: "The preview didn't load. Try again.") } }
    }

    private var edit: ReflectionEdit {
        ReflectionEdit(personalLine: text.trimmingCharacters(in: .whitespacesAndNewlines),
            signature: signature.trimmingCharacters(in: .whitespacesAndNewlines), presentation: presentation)
    }

    func share(image: Bool) async {
        guard let draft, ready, busy == nil else { return }
        busy = image ? "image" : "link"; error = nil
        defer { if active { busy = nil } }
        do {
            let url: String
            if let publishedURL { url = publishedURL }
            else {
                let published: PublishedPersonalCard = try await api.json("/api/cards/personal", method: "POST",
                    body: ReflectionPublish(draftId: draft.id, personalLine: edit.personalLine, signature: edit.signature, presentation: presentation))
                guard !published.url.isEmpty else { throw APIError(message: "The share link wasn't returned.") }
                publishedURL = published.url
                url = published.url
            }
            guard active, !Task.isCancelled else { return }
            if image {
                let path = ShareCards.personalCardPath(id: draft.id, style: prefs.style, format: prefs.format, size: .full)
                let data = try await api.publicData(path)
                guard active, !Task.isCancelled else { return }
                let file = try ShareCardModel.write(data, named: "SureWord reflection \(draft.id).jpg")
                pendingShare = OutgoingShare(payload: .image(file))
            } else { pendingShare = OutgoingShare(payload: .text("\(edit.personalLine)\n\n\(url)")) }
        } catch { if active { self.error = ShareCardModel.message(error, fallback: "That reflection couldn't be shared. Try again.") } }
    }
}

struct ReflectionSheet: View {
    @Environment(\.theme) private var theme
    @State private var model: ReflectionModel
    private let onClose: () -> Void

    init(reference: String, translation: String, api: APIClient, prefs: ShareCardPrefs, onClose: @escaping () -> Void) {
        _model = State(initialValue: ReflectionModel(reference: reference, translation: translation, api: api, name: Clerk.shared.user?.firstName, prefs: prefs))
        self.onClose = onClose
    }

    var body: some View {
        chrome.task { await model.start() }.onDisappear { model.stop() }
        #if os(macOS)
            .background(SharingPicker(share: $model.pendingShare, matches: { _ in true }, onShared: { _ in }))
        #else
            .sheet(item: $model.pendingShare) { share in
                ActivitySheet(share: share) { model.pendingShare = nil; onClose() }.presentationDetents([.medium, .large])
            }
        #endif
    }

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack {
                Text("My reflection").appFont(.headline)
                Spacer()
                Button("Done", action: onClose).frame(minHeight: 44)
            }.padding(Spacing.md)
            Divider().overlay(theme.border)
            ScrollView { content.padding(Spacing.md) }
            Divider().overlay(theme.border)
            footer.padding(Spacing.md)
        }
        .background(theme.bgElevated)
        .foregroundStyle(theme.text)
        #if os(macOS)
        .frame(width: ShareCardSheet.sheetSize.width, height: ShareCardSheet.sheetSize.height)
        #else
        .presentationDetents([.large])
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text("\(model.reference) · \(model.translation)").appFont(.subheadline.weight(.semibold)).foregroundStyle(theme.accent)
            Text("Share how this verse speaks to your walk with God. Only the words you approve are shared.").appFont(.subheadline)
            Text("My reflection").appFont(.subheadline.weight(.semibold))
            TextEditor(text: Binding(get: { model.text }, set: { model.setText($0) }))
                .frame(minHeight: 110).padding(8).background(theme.bg)
                .clipShape(.rect(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.borderStrong))
                .disabled(model.locked).accessibilityLabel("My reflection")
            Text("\(model.text.count)/200").appFont(.caption).foregroundStyle(theme.textMuted)
            Button(model.busy == "writing" ? "Considering your walk…" : "Draft from my walk") { Task { await model.suggest() } }
                .buttonStyle(GhostShareButtonStyle()).disabled(!model.opened || model.locked)
            Text("Uses your study to suggest a reflection without private details. Review and edit every word before sharing.")
                .appFont(.caption).foregroundStyle(theme.textMuted)
            TextField("Your name (optional)", text: Binding(get: { model.signature }, set: { model.setSignature($0) }))
                .textFieldStyle(.roundedBorder).disabled(model.locked).accessibilityLabel("Name on reflection, optional")
            Picker("Reflection font", selection: Binding(get: { model.presentation.font }, set: { model.setFont($0) })) {
                ForEach(ReflectionFont.allCases) { Text($0.label).tag($0) }
            }.pickerStyle(.segmented).disabled(model.locked)
            Picker("Reflection placement", selection: Binding(get: { model.presentation.placement }, set: { model.setPlacement($0) })) {
                ForEach(ReflectionPlacement.allCases) { Text($0.label).tag($0) }
            }.pickerStyle(.segmented).disabled(model.locked)
            ShareCardStyleChips(selected: model.prefs.style, onSelect: model.setStyle).disabled(model.locked)
            ShareCardFormatPicker(selected: model.prefs.format, onSelect: model.setFormat).disabled(model.locked)
            if model.ready, let preview = model.preview {
                preview.resizable().scaledToFit().frame(maxHeight: 280).frame(maxWidth: .infinity)
                    .accessibilityLabel("Your reflection: \(model.text)")
            }
            if model.publishedURL != nil {
                Text("This shared version is fixed. Close and reopen to write a new reflection.").appFont(.caption).foregroundStyle(theme.textMuted)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: Spacing.sm) {
            if let error = model.error { Text(error).appFont(.subheadline).foregroundStyle(.red).accessibilityLabel(error) }
            if model.ready {
                HStack {
                    Button(model.busy == "image" ? "Preparing…" : "Share image") { Task { await model.share(image: true) } }
                    Button(model.busy == "link" ? "Preparing…" : "Share link") { Task { await model.share(image: false) } }
                }.buttonStyle(GhostShareButtonStyle()).disabled(model.busy != nil)
            } else {
                Button(model.busy == "preview" ? "Preparing preview…" : "Preview my card") { Task { await model.updatePreview() } }
                    .buttonStyle(GhostShareButtonStyle()).disabled(!model.opened || model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.locked)
            }
        }
    }
}
