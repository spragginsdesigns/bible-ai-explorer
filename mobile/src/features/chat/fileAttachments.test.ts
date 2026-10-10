import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedFile } from "@/features/share/shareIntake";

const MB = 1024 * 1024;

// A stand-in for expo-file-system's File over an in-memory disk: sizes by
// URI, copies that land the source's bytes, and deletes that remove them.
const fs = vi.hoisted(() => {
	const disk = new Map<string, number>();
	const deleted: string[] = [];
	const copyFails = { value: false };
	class FakeFile {
		uri: string;
		constructor(...parts: Array<string | { uri: string }>) {
			this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
		}
		get size(): number {
			return disk.get(this.uri) ?? 0;
		}
		get exists(): boolean {
			return disk.has(this.uri);
		}
		delete(): void {
			disk.delete(this.uri);
			deleted.push(this.uri);
		}
		async copy(target: FakeFile): Promise<void> {
			// A failing copy can still leave a partial file behind.
			disk.set(target.uri, Math.min(disk.get(this.uri) ?? 0, 1024));
			if (copyFails.value) throw new Error("read grant lapsed");
			disk.set(target.uri, disk.get(this.uri) ?? 0);
		}
	}
	return { disk, deleted, copyFails, FakeFile };
});

vi.mock("expo-file-system", () => ({
	File: fs.FakeFile,
	Paths: { cache: { uri: "file:///cache" } },
}));

const bounded = vi.hoisted(() => ({ copySharedFileBounded: vi.fn() }));
vi.mock("@/lib/sharedFileCopy", () => bounded);
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

const { copySharedFileToCache } = await import("./fileAttachments");

const voice = (overrides: Partial<SharedFile> = {}): SharedFile => ({
	uri: "content://com.whatsapp.provider/voice.ogg",
	filename: "voice-message.ogg",
	mediaType: "audio/ogg",
	size: null,
	...overrides,
});

beforeEach(() => {
	fs.disk.clear();
	fs.deleted.length = 0;
	fs.copyFails.value = false;
	bounded.copySharedFileBounded.mockReset();
});

describe("copySharedFileToCache", () => {
	it("copies a share under its type's cap and attaches the measured size", async () => {
		bounded.copySharedFileBounded.mockImplementation(async () => {
			fs.disk.set("file:///cache/shared-files/a", 48_000);
			return { tooLarge: false, uri: "file:///cache/shared-files/a", size: 48_000 };
		});
		// The sender claimed 1 KB; the bytes actually copied are what count.
		const local = await copySharedFileToCache(voice({ size: 1024 }), 0);
		expect(bounded.copySharedFileBounded).toHaveBeenCalledWith("content://com.whatsapp.provider/voice.ogg", 20 * MB);
		expect(local).toEqual({
			uri: "file:///cache/shared-files/a",
			filename: "voice-message.ogg",
			mediaType: "audio/ogg",
			size: 48_000,
		});
	});

	it("refuses a declared oversize share without copying anything", async () => {
		await expect(copySharedFileToCache(voice({ size: 21 * MB }), 0))
			.rejects.toThrow("voice-message.ogg exceeds the 20 MB file limit.");
		expect(bounded.copySharedFileBounded).not.toHaveBeenCalled();
	});

	it("caps the copy at what the message has left", async () => {
		bounded.copySharedFileBounded.mockResolvedValue({ tooLarge: true, size: 10 * MB + 65_536 });
		await expect(copySharedFileToCache(voice(), 15 * MB))
			.rejects.toThrow("Attachments can total up to 25 MB per message, so voice-message.ogg was left out.");
		expect(bounded.copySharedFileBounded).toHaveBeenCalledWith(expect.any(String), 10 * MB);
	});

	it("reports the type's limit when a stream runs past it, however small it claimed to be", async () => {
		bounded.copySharedFileBounded.mockResolvedValue({ tooLarge: true, size: 20 * MB + 65_536 });
		await expect(copySharedFileToCache(voice({ size: 2048 }), 0))
			.rejects.toThrow("voice-message.ogg exceeds the 20 MB file limit.");
	});

	it("deletes an empty copy", async () => {
		bounded.copySharedFileBounded.mockImplementation(async () => {
			fs.disk.set("file:///cache/shared-files/empty", 0);
			return { tooLarge: false, uri: "file:///cache/shared-files/empty", size: 0 };
		});
		await expect(copySharedFileToCache(voice(), 0)).rejects.toThrow("voice-message.ogg is empty or unreadable.");
		expect(fs.disk.has("file:///cache/shared-files/empty")).toBe(false);
	});

	describe("on a binary without the SureWordShare module", () => {
		beforeEach(() => {
			bounded.copySharedFileBounded.mockResolvedValue(null);
		});

		it("still attaches a share that fits", async () => {
			fs.disk.set("content://com.whatsapp.provider/voice.ogg", 48_000);
			const local = await copySharedFileToCache(voice(), 0);
			expect(local.size).toBe(48_000);
			expect(local.uri).toMatch(/^file:\/\/\/cache\/shared-\d+-voice-message\.ogg$/);
			expect(fs.disk.get(local.uri)).toBe(48_000);
		});

		it("deletes a copy that measured over the cap", async () => {
			fs.disk.set("content://com.whatsapp.provider/voice.ogg", 30 * MB);
			await expect(copySharedFileToCache(voice({ size: 1024 }), 0))
				.rejects.toThrow("voice-message.ogg exceeds the 20 MB file limit.");
			expect([...fs.disk.keys()]).toEqual(["content://com.whatsapp.provider/voice.ogg"]);
		});

		it("deletes a partial copy when the read fails", async () => {
			fs.disk.set("content://com.whatsapp.provider/voice.ogg", 48_000);
			fs.copyFails.value = true;
			await expect(copySharedFileToCache(voice(), 0)).rejects.toThrow("read grant lapsed");
			expect([...fs.disk.keys()]).toEqual(["content://com.whatsapp.provider/voice.ogg"]);
			expect(fs.deleted).toHaveLength(1);
		});
	});

	it("measures a file:// share on disk instead of trusting the declared size", async () => {
		fs.disk.set("file:///cache/big.ogg", 25 * MB);
		await expect(copySharedFileToCache(voice({ uri: "file:///cache/big.ogg", size: 1024 }), 0))
			.rejects.toThrow("voice-message.ogg exceeds the 20 MB file limit.");
		expect(bounded.copySharedFileBounded).not.toHaveBeenCalled();
	});
});
