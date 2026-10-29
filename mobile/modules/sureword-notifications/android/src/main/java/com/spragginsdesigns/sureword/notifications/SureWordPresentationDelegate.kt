package com.spragginsdesigns.sureword.notifications

import android.app.Notification
import android.content.Context
import android.util.Log
import android.widget.RemoteViews
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate
import expo.modules.notifications.notifications.model.Notification as ExpoNotification

/**
 * Draws the Daily Cross and "Your answer is ready" with their own art
 * (Android's DecoratedCustomViewStyle: the system keeps the small icon, app
 * name, time and actions; SureWord supplies the content area). Before this the
 * two read alike in the tray: same logo, both a line of Scripture.
 *
 * Expo builds the notification first, so its channel, tap intent, extras and
 * sound survive; this only re-dresses the result. Anything unrecognised, or any
 * failure, posts Expo's notification exactly as it was.
 */
class SureWordPresentationDelegate(context: Context) : ExpoPresentationDelegate(context) {
	protected override suspend fun createNotification(
		notification: ExpoNotification,
		notificationBehavior: NotificationBehaviorRecord?
	): Notification {
		val base = super.createNotification(notification, notificationBehavior)
		val art = NotificationArt.forScreen(notification.notificationRequest.content.body?.optString("screen"))
			?: return base
		return try {
			dress(base, art)
		} catch (error: Exception) {
			Log.w("SureWordNotifications", "Kept the plain notification: ${error.message}")
			base
		}
	}

	private fun dress(base: Notification, art: NotificationArt): Notification {
		val title = base.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
		val text = base.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()

		val collapsed = RemoteViews(context.packageName, R.layout.sureword_notification_collapsed).apply {
			setImageViewResource(R.id.sureword_notification_mark, art.mark)
			setTextViewText(R.id.sureword_notification_title, title)
			setTextViewText(R.id.sureword_notification_text, text)
		}
		val expanded = RemoteViews(context.packageName, R.layout.sureword_notification_expanded).apply {
			setImageViewResource(R.id.sureword_notification_banner, art.banner)
			setTextViewText(R.id.sureword_notification_title, title)
			setTextViewText(R.id.sureword_notification_text, text)
		}

		return Notification.Builder.recoverBuilder(context, base)
			.setStyle(Notification.DecoratedCustomViewStyle())
			.setCustomContentView(collapsed)
			.setCustomHeadsUpContentView(collapsed)
			.setCustomBigContentView(expanded)
			.build()
	}
}

/** The art for each kind of SureWord notification, keyed by its tap `screen`. */
enum class NotificationArt(val mark: Int, val banner: Int) {
	CROSS(R.drawable.sureword_notif_cross_mark, R.drawable.sureword_notif_cross_wide),
	ANSWER(R.drawable.sureword_notif_answer_mark, R.drawable.sureword_notif_answer_wide);

	companion object {
		/** `screen` is the same field the tap router reads (tapTarget.ts). */
		fun forScreen(screen: String?): NotificationArt? = when (screen) {
			"cross" -> CROSS
			"chat" -> ANSWER
			else -> null
		}
	}
}
