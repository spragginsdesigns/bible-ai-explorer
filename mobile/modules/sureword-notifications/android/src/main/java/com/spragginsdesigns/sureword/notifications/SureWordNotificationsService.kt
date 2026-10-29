package com.spragginsdesigns.sureword.notifications

import android.content.Context
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.interfaces.PresentationDelegate

/**
 * expo-notifications' dispatcher with SureWord's presentation delegate. Every
 * other event (taps, dismissals, scheduling, categories) is Expo's unchanged,
 * which is what keeps tap routing and the JS listeners working.
 */
class SureWordNotificationsService : NotificationsService() {
	override fun getPresentationDelegate(context: Context): PresentationDelegate =
		SureWordPresentationDelegate(context)
}
