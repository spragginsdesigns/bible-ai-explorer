import Foundation
import SwiftUI
import Testing
import UIKit
@testable import SureWord

/// The info sheet's data layer and a render smoke for the two new sheets.
/// The API host is unroutable on purpose: these pin the failure paths -
/// optimistic writes roll back, a failed create yields no note, a failed links
/// fetch surfaces an error the sheet can retry - without touching production.
@Suite("Note info, aliases and properties (iOS)")
@MainActor
struct NoteInfoIOSTests {

    private func makeModel() -> (NoteEditorModel, NotesStore) {
        let store = NotesStore(cacheURL: nil)
        store.upsert(Note(
            id: "n1",
            htmlContent: "<p>see [[Romans study]]</p>",
            title: "Grace alone",
            plainText: "see [[Romans study]]",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            aliases: ["Sola gratia"],
            properties: ["book": .text("Ephesians")],
            hasBody: true
        ))
        let api = APIClient(baseURL: URL(string: "https://example.invalid")!, token: { _ in nil }, onAuthFailure: {})
        return (NoteEditorModel(noteID: "n1", api: NotesAPI(api: api), store: store), store)
    }

    @Test("A rejected alias write rolls back the note and the cache, and says so")
    func aliasRollback() async {
        let (model, store) = makeModel()
        await model.setAliases(["Sola gratia", "By grace"])
        #expect(model.note?.aliases == ["Sola gratia"])
        #expect(store.cachedNote(id: "n1")?.aliases == ["Sola gratia"])
        #expect(model.error != nil)
    }

    @Test("A rejected property write rolls back")
    func propertyRollback() async {
        let (model, store) = makeModel()
        await model.setProperties(["book": .text("Ephesians"), "chapter": .number(2)])
        #expect(model.note?.properties == ["book": .text("Ephesians")])
        #expect(store.cachedNote(id: "n1")?.properties == ["book": .text("Ephesians")])
    }

    @Test("A failed linked-note create returns nil; a failed links fetch is retryable")
    func failures() async {
        let (model, _) = makeModel()
        #expect(await model.createLinkedNote(title: "Romans study") == nil)
        await model.loadLinks()
        #expect(model.links == nil)
        #expect(model.linksError != nil)
        #expect(!model.isLoadingLinks)
    }

    @Test("The info sheet and the link picker render")
    func rendersSheets() {
        let (model, _) = makeModel()
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        let info = UIHostingController(
            rootView: NoteInfoSheet(model: model, folderName: nil, onOpenNote: { _ in })
                .environment(\.theme, .dark)
        )
        window.rootViewController = info
        window.makeKeyAndVisible()
        info.view.layoutIfNeeded()
        #expect(info.view.bounds.width > 0)

        let picker = UIHostingController(
            rootView: InsertWikilinkSheet(currentNoteID: "n1", onSelect: { _ in })
                .environment(\.theme, .dark)
        )
        window.rootViewController = picker
        picker.view.layoutIfNeeded()
        #expect(picker.view.bounds.width > 0)
    }
}
