package au.com.refrigerationservices.weather.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Hands a pre-filled draft to the Gmail app.
 *
 * This is what "send it using my gmail app" means on Android: an ACTION_SENDTO
 * intent, so the report opens in Gmail with recipient, subject and body already
 * filled in and the user taps Send. No credentials live in the app.
 *
 * If the backend is configured with MAIL_MODE=smtp it sends server-side instead
 * and this is never called — see MainViewModel.
 */
object GmailLauncher {

    private const val GMAIL_PACKAGE = "com.google.android.gm"

    /**
     * @return true if a mail app was opened.
     */
    fun compose(context: Context, to: String, subject: String, body: String): Boolean {
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            // ACTION_SENDTO with a mailto: URI reaches email apps only, never the
            // full share sheet of messaging apps.
            data = Uri.parse("mailto:")
            putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        // Prefer Gmail, but fall back to whatever mail app is installed rather
        // than failing outright.
        val gmail = Intent(intent).setPackage(GMAIL_PACKAGE)
        return try {
            context.startActivity(gmail)
            true
        } catch (e: ActivityNotFoundException) {
            try {
                context.startActivity(Intent.createChooser(intent, "Send weather report"))
                true
            } catch (e2: ActivityNotFoundException) {
                false
            }
        }
    }
}
