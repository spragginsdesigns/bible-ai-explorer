package com.spragginsdesigns.sureword.share

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * Copies a file shared from another app into SureWord's cache, refusing it
 * the moment it passes the caller's byte cap. The sending app controls both
 * the size it declares and the stream it serves, so neither can be trusted:
 * the cap is enforced on the bytes actually read, and an oversize or endless
 * stream stops there instead of filling the device's storage.
 */
class SureWordShareModule : Module() {
	override fun definition() = ModuleDefinition {
		Name("SureWordShare")

		AsyncFunction("copySharedFileAsync") { uri: String, maxBytes: Double ->
			val context = requireNotNull(appContext.reactContext) {
				"SureWord is not ready to read the shared file."
			}
			copySharedFile(context, Uri.parse(uri), maxBytes.toLong())
		}
	}
}

private fun copySharedFile(context: Context, uri: Uri, maxBytes: Long): Map<String, Any> {
	require(uri.scheme == "content") { "Only files shared from another app are copied here." }
	val cacheDir = File(context.cacheDir, "shared-files").also { it.mkdirs() }
	val target = File(cacheDir, "shared-${System.currentTimeMillis()}-${UUID.randomUUID()}")
	var totalBytes = 0L
	var kept = false

	try {
		val source = context.contentResolver.openInputStream(uri)
			?: throw IllegalStateException("Android didn't let SureWord read that shared file.")
		source.use { input ->
			FileOutputStream(target).use { output ->
				val buffer = ByteArray(64 * 1024)
				while (true) {
					val read = input.read(buffer)
					if (read < 0) break
					totalBytes += read
					if (totalBytes > maxBytes) {
						return mapOf("tooLarge" to true, "size" to totalBytes.toDouble())
					}
					output.write(buffer, 0, read)
				}
			}
		}
		kept = true
		return mapOf(
			"tooLarge" to false,
			"uri" to Uri.fromFile(target).toString(),
			"size" to totalBytes.toDouble(),
		)
	} finally {
		if (!kept) target.delete()
	}
}
