import Foundation
import Testing
import UIKit
@testable import SureWord

/// The chat composer brought to Android parity (PRD D5): slash parsing and the
/// text a command sends, `/clear` confirmation, the conversation-creation
/// failure, stop signals, pasted-image names, the photo picker's limit, the
/// image pass-through rule and the source sheet's copy.
///
/// Android sources: `slashCommands.ts`, `ChatInputBar.tsx`, `useSureWordChat.ts`,
/// `chatStopSignals.ts`, `pastedImages.ts`, `imageDownscale.ts`,
/// `attachmentRules.ts`, `AttachmentSourceSheet.tsx`, `FileAttachmentCards.tsx`.
@Suite("Composer parity")
@MainActor
struct ComposerParityTests {

    private func makeViewModel(stopSignals: ChatStopSignals = ChatStopSignals()) -> ChatViewModel {
        let api = APIClient(
            baseURL: URL(string: "https://example.invalid")!,
            token: { _ in nil },
            onAuthFailure: {}
        )
        return ChatViewModel(api: api, settings: SettingsStore(), stopSignals: stopSignals)
    }

    // MARK: Slash parsing

    @Test("Splits the command off on any whitespace, newlines included")
    func parsesOnAnyWhitespace() throws {
        let parsed = try #require(SlashCommand.parse("/verse\nJohn 3:16"))
        #expect(parsed.command.command == "/verse")
        #expect(parsed.args == "John 3:16")
        #expect(SlashCommand.parse("/new\n")?.command.localAction == .new)
        #expect(SlashCommand.parse("/search\tgrace")?.args == "grace")
    }

    @Test("Collapses every run of whitespace in the arguments, as Android's split/join does")
    func collapsesArgs() throws {
        let parsed = try #require(SlashCommand.parse("/check  Is   this\n\ntrue?"))
        #expect(parsed.args == "Is this true?")
        #expect(SlashCommand.parse("/memory   ")?.args == "")
    }

    @Test("An AI command sends its canonical name, never the alias")
    func canonicalOutgoingText() throws {
        let note = try #require(SlashCommand.parse("/add  this please"))
        #expect(SlashCommand.outgoingText(note.command, args: note.args) == "/note this please")
        let reply = try #require(SlashCommand.parse("/ANSWER he said"))
        #expect(SlashCommand.outgoingText(reply.command, args: reply.args) == "/reply he said")
        let cross = try #require(SlashCommand.parse("/cross"))
        #expect(SlashCommand.outgoingText(cross.command, args: cross.args) == "/cross")
    }

    @Test("Describes /web with Android's hyphen")
    func webDescription() {
        #expect(
            SlashCommand.chat.first { $0.command == "/web" }?.description
                == "Search the web - history, archaeology, apologetics"
        )
    }

    @Test("AI commands declare no local action, local ones do")
    func kindsAndActions() {
        for command in SlashCommand.chat + SlashCommand.note {
            if command.kind == .ai {
                #expect(command.localAction == nil, "\(command.command)")
            } else {
                #expect(command.localAction != nil, "\(command.command)")
            }
        }
    }

    // MARK: Sending commands

    @Test("A command that needs an argument is not sent without one, in any case")
    func requiresArgsWaits() async {
        let chat = makeViewModel()
        for typed in ["/verse", "/VERSE  ", "/search\n", "/who"] {
            chat.input = typed
            await chat.send()
            #expect(chat.input == typed, "\(typed) should stay in the composer")
            #expect(chat.messages.isEmpty)
            #expect(chat.sendError == nil)
        }
    }

    @Test("/clear with a conversation open asks first instead of deleting")
    func clearAsksFirst() async {
        let chat = makeViewModel()
        chat.seedPendingSend(conversationID: "c1", question: "Who is Melchizedek?", status: .idle)
        chat.input = "/clear"
        await chat.send()
        #expect(chat.isClearConfirmationPresented)
        #expect(chat.activeConversationID == "c1")
        #expect(chat.input.isEmpty)
        chat.teardown()
    }

    @Test("/clear with nothing open just starts a new chat")
    func clearWithNothingOpen() async {
        let chat = makeViewModel()
        chat.input = "/clear"
        await chat.send()
        #expect(!chat.isClearConfirmationPresented)
        #expect(chat.activeConversationID == nil)
    }

    // MARK: Conversation creation failure

    /// Android never sends without a conversation; iOS used to clear the
    /// composer, fail, and leave a Retry that did nothing.
    @Test("A failed conversation create keeps the draft and Retry sends it again")
    func conversationCreateFailureKeepsDraft() async {
        let chat = makeViewModel()
        chat.input = "Who is Melchizedek?"
        await chat.send()

        #expect(chat.input == "Who is Melchizedek?")
        #expect(chat.messages.isEmpty)
        #expect(chat.activeConversationID == nil)
        #expect(chat.sendError?.message == ChatViewModel.conversationCreateError)
        #expect(chat.sendError?.retryable == true)
        #expect(!chat.isCreatingConversation)

        // Retry goes through the same path again (and fails the same way here,
        // since the host does not exist) - it does not silently do nothing.
        chat.input = ""
        await chat.retrySend()
        #expect(chat.input == "Who is Melchizedek?")
        #expect(chat.sendError?.message == ChatViewModel.conversationCreateError)
        #expect(chat.messages.isEmpty)
    }

    // MARK: Stop signals

    @Test("Stop records the walked-away conversation for the push handler")
    func stopMarksConversation() {
        let signals = ChatStopSignals()
        let chat = makeViewModel(stopSignals: signals)
        chat.seedPendingSend(conversationID: "conv_a", question: "Hi")
        chat.stop()
        #expect(signals.wasStopped("conv_a"))
        #expect(!signals.wasStopped("conv_never"))
    }

    @Test("Starting a new chat mid-answer records it too")
    func newConversationMarks() {
        let signals = ChatStopSignals()
        let chat = makeViewModel(stopSignals: signals)
        chat.seedPendingSend(conversationID: "conv_b", question: "Hi")
        chat.newConversation()
        #expect(signals.wasStopped("conv_b"))
    }

    @Test("Nothing owed, nothing recorded")
    func idleStopMarksNothing() {
        let signals = ChatStopSignals()
        let chat = makeViewModel(stopSignals: signals)
        chat.stop()
        chat.newConversation()
        #expect(!signals.wasStopped(""))
    }

    @Test("A stop is forgotten after three minutes, like Android's STOP_MEMORY_MS")
    func stopSignalExpires() {
        let signals = ChatStopSignals()
        let start = Date(timeIntervalSince1970: 1_000_000)
        signals.markStopped("conv_c", now: start)
        #expect(signals.wasStopped("conv_c", now: start.addingTimeInterval(179)))
        #expect(!signals.wasStopped("conv_c", now: start.addingTimeInterval(181)))
        // Once expired it stays forgotten.
        #expect(!signals.wasStopped("conv_c", now: start.addingTimeInterval(10)))
    }

    @Test("Recognises the chat-ready push for a stopped conversation, in any payload shape")
    func unwantedChatPush() {
        let signals = ChatStopSignals()
        signals.markStopped("conv_d")
        #expect(signals.isUnwantedChatPush(["screen": "chat", "conversationId": "conv_d"]))
        #expect(signals.isUnwantedChatPush(["body": ["screen": "chat", "conversationId": "conv_d"]]))
        #expect(!signals.isUnwantedChatPush(["screen": "chat", "conversationId": "conv_e"]))
        #expect(!signals.isUnwantedChatPush(["screen": "cross"]))
    }

    // MARK: Pasted images (pastedImages.test.ts)

    @Test("Normalizes keyboard and clipboard images for the attachment validator", arguments: [
        ("file:///cache/gboard.png", "image/png", "clipboard-1720000000000.png"),
        ("file:///cache/photo.JPG", "image/jpeg", "clipboard-1720000000000.jpg"),
        ("file:///cache/sticker.webp", "image/webp", "clipboard-1720000000000.webp"),
        ("file:///cache/animation.gif", "image/gif", "clipboard-1720000000000.gif"),
    ])
    func pastedNames(uri: String, mediaType: String, filename: String) {
        #expect(PastedImages.mediaType(forURI: uri) == mediaType)
        #expect(PastedImages.filename(uri: uri, index: 0, timestamp: 1_720_000_000_000) == filename)
    }

    @Test("Gives extensionless files a supported PNG fallback")
    func pastedExtensionlessFallback() {
        let uri = "file:///cache/keyboard-content"
        #expect(PastedImages.mediaType(forURI: uri) == "image/png")
        #expect(PastedImages.filename(uri: uri, index: 1, timestamp: 1_720_000_000_000) == "clipboard-1720000000000-2.png")
    }

    @Test("Uses the declared MIME type instead of guessing from the name")
    func pastedDeclaredType() {
        let named = PastedImages.metadata(name: "42", declaredType: "image/jpeg", index: 0, timestamp: 1_720_000_000_000)
        #expect(named.filename == "clipboard-1720000000000.jpg")
        #expect(named.mediaType == "image/jpeg")
    }

    @Test("Normalizes the image/jpg alias")
    func pastedJpgAlias() {
        let named = PastedImages.metadata(name: nil, declaredType: "image/jpg", index: 1, timestamp: 1_720_000_000_000)
        #expect(named.filename == "clipboard-1720000000000-2.jpg")
        #expect(named.mediaType == "image/jpeg")
    }

    @Test("Photos get unique names within one pick")
    func photoNames() {
        #expect(PastedImages.sequencedName(prefix: "photo", timestamp: 5, index: 0, fileExtension: "jpg") == "photo-5.jpg")
        #expect(PastedImages.sequencedName(prefix: "photo", timestamp: 5, index: 2, fileExtension: "png") == "photo-5-3.png")
        #expect(PastedImages.timestamp(Date(timeIntervalSince1970: 1_720_000_000.123)) == 1_720_000_000_123)
    }

    // MARK: Picker and image rules

    @Test("The photo picker offers only what still fits, never below one")
    func pickerLimit() {
        #expect(AttachmentLimits.pickerSelectionLimit(staged: 0) == 5)
        #expect(AttachmentLimits.pickerSelectionLimit(staged: 3) == 2)
        #expect(AttachmentLimits.pickerSelectionLimit(staged: 5) == 1)
        #expect(AttachmentLimits.pickerSelectionLimit(staged: 9) == 1)
    }

    @Test("Audio is exactly the five accepted types")
    func audioIsExact() {
        for type in ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"] {
            #expect(AttachmentLimits.isAudio(type), "\(type)")
        }
        #expect(!AttachmentLimits.isAudio("audio/flac"))
        #expect(!AttachmentLimits.isAudio("image/png"))
    }

    @Test("Sniffs the allowlisted image formats from their bytes")
    func sniffing() {
        #expect(AttachmentLimits.sniffImageMediaType(Data([0x89, 0x50, 0x4E, 0x47, 0x0D])) == "image/png")
        #expect(AttachmentLimits.sniffImageMediaType(Data([0xFF, 0xD8, 0xFF, 0xE0])) == "image/jpeg")
        #expect(AttachmentLimits.sniffImageMediaType(Data("GIF89a".utf8)) == "image/gif")
        #expect(AttachmentLimits.sniffImageMediaType(Data("RIFF\0\0\0\0WEBPVP8 ".utf8)) == "image/webp")
        #expect(AttachmentLimits.sniffImageMediaType(Data("....ftypheic".utf8)) == nil)
        #expect(AttachmentLimits.sniffImageMediaType(Data()) == nil)
    }

    private func image(_ width: Int, _ height: Int) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    @Test("An in-budget JPEG ships untouched, as on Android")
    func inBudgetJPEGUntouched() throws {
        let jpeg = try #require(image(800, 600).jpegData(compressionQuality: 0.5))
        let ready = try #require(PickedPhoto.uploadReady(jpeg))
        #expect(ready.data == jpeg)
        #expect(ready.mediaType == "image/jpeg")
        #expect(ready.fileExtension == "jpg")
    }

    @Test("An in-budget PNG ships untouched")
    func inBudgetPNGUntouched() throws {
        let png = try #require(image(400, 300).pngData())
        let ready = try #require(PickedPhoto.uploadReady(png))
        #expect(ready.data == png)
        #expect(ready.mediaType == "image/png")
    }

    @Test("An oversized image is downscaled to JPEG")
    func oversizedBecomesJPEG() throws {
        let png = try #require(image(4000, 1000).pngData())
        let ready = try #require(PickedPhoto.uploadReady(png))
        #expect(ready.mediaType == "image/jpeg")
        #expect(ready.data.starts(with: [0xFF, 0xD8]))
    }

    @Test("Bytes that are not an image are refused")
    func notAnImage() {
        #expect(PickedPhoto.uploadReady(Data("hello".utf8)) == nil)
    }

    // MARK: Source sheet

    @Test("Offers Android's sources, in its order, with its copy")
    func sourceOptions() {
        #expect(AttachmentSourceOption.available(hasCamera: true) == [.camera, .photoLibrary, .files, .paste])
        #expect(AttachmentSourceOption.available(hasCamera: false) == [.photoLibrary, .files, .paste])
        #expect(AttachmentSourceOption.allCases.map(\.label) == [
            "Take a photo", "Photo library", "Choose files", "Paste screenshot",
        ])
        #expect(AttachmentSourceOption.allCases.map(\.detail) == [
            "Use your camera",
            "Choose one or more images",
            "PDF, text, CSV, JSON, or a voice message",
            "Use the image on your clipboard",
        ])
    }

    @Test("A refused camera is explained with Android's copy")
    func cameraAccess() {
        #expect(CameraAccess.problem(status: .denied) == "Camera permission is required to take a photo.")
        #expect(CameraAccess.problem(status: .restricted) == "Camera permission is required to take a photo.")
        #expect(CameraAccess.problem(status: .authorized) == nil)
        #expect(CameraAccess.problem(status: .notDetermined) == nil)
        #expect(ClipboardAttachments.noImageMessage == "There isn't an image on the clipboard.")
    }

    @Test("Attachment chips are labelled like Android's cards")
    func chipLabels() {
        #expect(AttachmentChip.accessibilityLabel(filename: "a.pdf", hasTranscript: false, isTranscriptOpen: false) == "Open a.pdf")
        #expect(
            AttachmentChip.accessibilityLabel(filename: "v.ogg", hasTranscript: true, isTranscriptOpen: false)
                == "Show what was said in v.ogg"
        )
        #expect(
            AttachmentChip.accessibilityLabel(filename: "v.ogg", hasTranscript: true, isTranscriptOpen: true)
                == "Hide what was said in v.ogg"
        )
    }
}
