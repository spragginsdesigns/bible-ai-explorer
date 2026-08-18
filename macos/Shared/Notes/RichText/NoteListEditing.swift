import Foundation

/// The pure half of the note editor's structural editing: list nesting,
/// container paths and character-offset bookkeeping.
///
/// This used to live on the macOS `NoteRichTextController`. It is extracted —
/// not rewritten — so the iOS controller applies byte-identical HTML edits:
/// a list nested here is the same `<ul><li>…<ul>` shape Tiptap writes on the
/// web and TenTap writes on Android, whichever client produced it.
///
/// Everything here is `nonisolated` on purpose: the thing that has to be right
/// about these operations is the HTML they produce, and keeping them off the
/// view layer is what lets the tests assert that directly instead of through a
/// text view.
enum NoteListEditing {

    // MARK: - Container factories

    nonisolated static func makeList(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        var attributes: [HTMLAttribute] = []
        if kind == .taskList { attributes.append(HTMLAttribute("data-type", "taskList")) }
        return NoteContainer(
            kind: kind,
            id: ids.take(),
            tag: kind == .orderedList ? "ol" : "ul",
            attributes: attributes
        )
    }

    nonisolated static func makeListItem(
        kind: NoteContainer.Kind,
        ids: inout NoteContainerIDGenerator
    ) -> NoteContainer {
        var attributes: [HTMLAttribute] = []
        if kind == .taskList {
            attributes = [
                HTMLAttribute("data-checked", "false"),
                HTMLAttribute("data-type", "taskItem"),
            ]
        }
        return NoteContainer(kind: .listItem, id: ids.take(), tag: "li", attributes: attributes)
    }

    // MARK: - Container paths

    /// The container path down to and including the list item that belongs to
    /// the `depth`-th list. Depth 0 means "outside every list", which keeps an
    /// enclosing blockquote while dropping the list membership.
    nonisolated static func containerPrefix(
        _ containers: [NoteContainer],
        upToListDepth depth: Int
    ) -> [NoteContainer] {
        guard depth > 0 else {
            return containers.filter { !$0.isList && $0.kind != .listItem }
        }
        var result: [NoteContainer] = []
        var lists = 0
        for container in containers {
            result.append(container)
            if container.isList { lists += 1 }
            if lists == depth, container.kind == .listItem { return result }
        }
        return result
    }

    nonisolated static func listContainer(
        _ containers: [NoteContainer],
        atDepth depth: Int
    ) -> NoteContainer? {
        var lists = 0
        for container in containers where container.isList {
            lists += 1
            if lists == depth { return container }
        }
        return nil
    }

    // MARK: - Nesting

    /// The first item of a list has nothing to nest under, and two adjacent
    /// lists must never be merged by an indent — both are why this checks the
    /// previous block shares the *same* list, not merely the same depth.
    nonisolated static func canIndent(_ blocks: [NoteBlock], at index: Int) -> Bool {
        guard index > 0, blocks.indices.contains(index) else { return false }
        let depth = blocks[index].listDepth
        guard depth >= 1 else { return false }

        let previous = blocks[index - 1]
        guard previous.listDepth >= depth else { return false }
        guard
            let here = listContainer(blocks[index].containers, atDepth: depth),
            let there = listContainer(previous.containers, atDepth: depth),
            here.id == there.id
        else { return false }
        return true
    }

    nonisolated static func indent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        guard canIndent(blocks, at: index) else { return }
        let depth = blocks[index].listDepth
        let previous = blocks[index - 1]
        let kind = blocks[index].listContainer?.kind ?? .bulletList

        var path: [NoteContainer]
        if previous.listDepth > depth {
            // The previous item already contains a deeper list — join it as a
            // sibling rather than opening a second one beside it.
            path = containerPrefix(previous.containers, upToListDepth: depth + 1)
            if path.last?.kind == .listItem { path.removeLast() }
            let joined = listContainer(path, atDepth: depth + 1)?.kind ?? kind
            path.append(makeListItem(kind: joined, ids: &ids))
        } else {
            // Same depth: open a new list inside the previous item.
            path = containerPrefix(previous.containers, upToListDepth: depth)
            path.append(makeList(kind: kind, ids: &ids))
            path.append(makeListItem(kind: kind, ids: &ids))
        }
        blocks[index].containers = path
    }

    nonisolated static func outdent(
        _ blocks: inout [NoteBlock],
        at index: Int,
        ids: inout NoteContainerIDGenerator
    ) {
        guard blocks.indices.contains(index) else { return }
        let depth = blocks[index].listDepth
        guard depth >= 1 else { return }

        if depth == 1 {
            blocks[index].containers = containerPrefix(blocks[index].containers, upToListDepth: 0)
            if blocks[index].tag == nil { blocks[index].tag = "p" }
            return
        }

        // Becomes a sibling of the item it was nested inside.
        var path = containerPrefix(blocks[index].containers, upToListDepth: depth - 1)
        if path.last?.kind == .listItem { path.removeLast() }
        let parent = listContainer(path, atDepth: depth - 1)?.kind ?? .bulletList
        path.append(makeListItem(kind: parent, ids: &ids))
        blocks[index].containers = path
    }

    // MARK: - Offsets

    /// Character offset each block starts at, in UTF-16 units — the unit
    /// `NSRange` and `NSTextStorage` count in.
    nonisolated static func paragraphStarts(of document: NoteDocument) -> [Int] {
        var starts: [Int] = []
        var offset = 0
        for block in document.blocks {
            starts.append(offset)
            let length = block.kind == .horizontalRule ? 1 : (block.text as NSString).length
            offset += length + 1
        }
        return starts
    }

    nonisolated static func blockIndex(
        containing location: Int,
        in starts: [Int],
        document: NoteDocument
    ) -> Int? {
        guard !starts.isEmpty else { return nil }
        var result = 0
        for (index, start) in starts.enumerated() where start <= location {
            result = index
        }
        return result
    }
}
