package com.spragginsdesigns.sureword.clipboard

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream

private const val MAX_IMAGE_BYTES = 10 * 1024 * 1024

class SureWordClipboardModule : Module() {
	override fun definition() = ModuleDefinition {
		Name("SureWordClipboard")

		AsyncFunction("getImageFilesAsync") Coroutine { ->
			val context = requireNotNull(appContext.reactContext) {
				"SureWord is not ready to read the clipboard."
			}
			val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
			val clip = clipboard.primaryClip ?: return@Coroutine emptyList<Map<String, Any>>()
			readClipboardImages(context, clip)
		}
	}
}

private data class ImageFormat(val mediaType: String, val extension: String)

private fun readClipboardImages(context: Context, clip: ClipData): List<Map<String, Any>> {
	val results = mutableListOf<Map<String, Any>>()
	var permissionFailure: SecurityException? = null

	for (index in 0 until clip.itemCount) {
		val item = clip.getItemAt(index)
		val uri = item.uri
			?: item.intent?.data
			?: item.text?.toString()?.takeIf {
				it.startsWith("content://") || it.startsWith("file://")
			}?.let(Uri::parse)
			?: continue

		try {
			copyClipboardImage(context, uri, index)?.let(results::add)
		} catch (error: SecurityException) {
			permissionFailure = error
		}
	}

	if (results.isEmpty() && permissionFailure != null) {
		throw IllegalStateException(
			"Android didn't grant SureWord access to that clipboard image. Copy it again, then paste while SureWord is open.",
			permissionFailure,
		)
	}

	return results
}

private fun copyClipboardImage(
	context: Context,
	uri: Uri,
	index: Int,
): Map<String, Any>? {
	val resolver = context.contentResolver
	val cacheDir = File(context.cacheDir, "clipboard-images").also { it.mkdirs() }
	val pending = File(cacheDir, "clipboard-${System.currentTimeMillis()}-$index.pending")
	val header = ByteArray(16)
	var headerLength = 0
	var totalBytes = 0L

	try {
		resolver.openInputStream(uri)?.use { rawInput ->
			BufferedInputStream(rawInput).use { input ->
				FileOutputStream(pending).use { output ->
					val buffer = ByteArray(32 * 1024)
					while (true) {
						val read = input.read(buffer)
						if (read < 0) break
						if (headerLength < header.size) {
							val headerBytes = minOf(read, header.size - headerLength)
							buffer.copyInto(header, headerLength, 0, headerBytes)
							headerLength += headerBytes
						}
						totalBytes += read
						if (totalBytes > MAX_IMAGE_BYTES) {
							throw IllegalArgumentException("Clipboard images can be up to 10 MB.")
						}
						output.write(buffer, 0, read)
					}
				}
			}
		} ?: return null

		val detectedFormat = imageFormatForHeader(header, headerLength)
		val format = detectedFormat ?: return null
		if (totalBytes <= 0) return null

		val finalFile = File(
			cacheDir,
			"clipboard-${System.currentTimeMillis()}-$index.${format.extension}",
		)
		if (!pending.renameTo(finalFile)) {
			pending.copyTo(finalFile, overwrite = true)
			pending.delete()
		}

		return mapOf(
			"uri" to Uri.fromFile(finalFile).toString(),
			"fileName" to finalFile.name,
			"fileSize" to totalBytes.toDouble(),
			"type" to format.mediaType,
		)
	} finally {
		if (pending.exists()) pending.delete()
	}
}

private fun imageFormatForHeader(bytes: ByteArray, length: Int): ImageFormat? {
	if (
		length >= 8 &&
		bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() &&
		bytes[2] == 0x4e.toByte() && bytes[3] == 0x47.toByte() &&
		bytes[4] == 0x0d.toByte() && bytes[5] == 0x0a.toByte() &&
		bytes[6] == 0x1a.toByte() && bytes[7] == 0x0a.toByte()
	) return ImageFormat("image/png", "png")

	if (
		length >= 3 && bytes[0] == 0xff.toByte() &&
		bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()
	) return ImageFormat("image/jpeg", "jpg")

	if (length >= 6) {
		val signature = bytes.copyOfRange(0, 6).toString(Charsets.US_ASCII)
		if (signature == "GIF87a" || signature == "GIF89a") {
			return ImageFormat("image/gif", "gif")
		}
	}

	if (
		length >= 12 &&
		bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
		bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP"
	) return ImageFormat("image/webp", "webp")

	return null
}
