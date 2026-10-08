import Foundation
import XCTest
@testable import SureWord

@MainActor
final class NoteDeletionTests: XCTestCase {
    private func model(_ id: String) -> (NoteEditorModel, NotesStore) {
        let store = NotesStore(cacheURL: nil)
        store.upsert(Note(id: id, content: "kept", htmlContent: "<p>kept</p>", title: "Kept note", plainText: "kept", folderId: nil, tagIds: [], createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", isPinned: false, wordCount: 1, hasBody: true))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NoteDeletionProtocol.self]
        let client = APIClient(baseURL: URL(string: "https://sureword-parity.invalid")!, token: { _ in nil }, onAuthFailure: {}, session: URLSession(configuration: configuration))
        return (NoteEditorModel(noteID: id, api: NotesAPI(api: client), store: store), store)
    }
    func testRejectedDeleteKeepsTheNoteAndReportsFailure() async {
        let (editor, store) = model("rejected")
        let deleted = await editor.delete()
        XCTAssertFalse(deleted)
        XCTAssertNotNil(store.cachedNote(id: "rejected"))
        XCTAssertNotNil(editor.error)
    }
    func testSuccessfulDeleteRemovesTheNoteAndReportsSuccess() async {
        let (editor, store) = model("success")
        let deleted = await editor.delete()
        XCTAssertTrue(deleted)
        XCTAssertNil(store.cachedNote(id: "success"))
    }
}

private final class NoteDeletionProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "sureword-parity.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let success = request.url!.path.hasSuffix("/success")
        let response = HTTPURLResponse(url: request.url!, statusCode: success ? 200 : 503, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((success ? #"{"success":true}"# : #"{"error":"Couldn't delete the note"}"#).utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
