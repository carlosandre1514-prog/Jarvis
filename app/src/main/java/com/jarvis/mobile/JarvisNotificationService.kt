package com.jarvis.mobile

import android.app.Notification
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.concurrent.CopyOnWriteArrayList

/** Lê as notificações recebidas e responde mensagens (WhatsApp, Telegram etc.) pela resposta rápida. */
class JarvisNotificationService : NotificationListenerService() {

    class Rec(val pkg: String, val app: String, val title: String, val text: String, val time: Long)

    companion object {
        @Volatile
        var instance: JarvisNotificationService? = null
        val recent = CopyOnWriteArrayList<Rec>()
    }

    override fun onListenerConnected() {
        instance = this
    }

    override fun onListenerDisconnected() {
        instance = null
    }

    private fun appLabel(pkg: String): String = try {
        val pm = packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
        pkg
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || Store.isBlocked(sbn.packageName)) return
        val n = sbn.notification ?: return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val ex = n.extras ?: return
        val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: ""
        if (title.isEmpty() && text.isEmpty()) return
        recent.add(0, Rec(sbn.packageName, appLabel(sbn.packageName), title, text, sbn.postTime))
        while (recent.size > 40) recent.removeAt(recent.size - 1)
    }

    /** Responde a notificação mais recente do app (e, se informado, do contato) com a resposta rápida. */
    fun reply(app: String, who: String?, text: String): String {
        val q = Store.norm(app)
        val list = try {
            activeNotifications?.toList() ?: emptyList()
        } catch (e: Exception) {
            return "Não consegui ler as notificações ativas."
        }
        for (sbn in list.sortedByDescending { it.postTime }) {
            val label = Store.norm(appLabel(sbn.packageName))
            if (!(label.contains(q) || sbn.packageName.lowercase().contains(q))) continue
            val title = sbn.notification?.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
            if (!who.isNullOrBlank() && !Store.norm(title).contains(Store.norm(who))) continue
            val actions = sbn.notification?.actions ?: continue
            for (a in actions) {
                val ri = a.remoteInputs ?: continue
                if (ri.isEmpty()) continue
                val intent = Intent()
                val b = Bundle()
                for (r in ri) b.putCharSequence(r.resultKey, text)
                RemoteInput.addResultsToIntent(ri, intent, b)
                return try {
                    a.actionIntent.send(this, 0, intent)
                    "ok, respondido a \"$title\""
                } catch (e: Exception) {
                    "Falhou ao enviar a resposta: ${e.message}"
                }
            }
        }
        return "Nenhuma notificação com resposta rápida encontrada para $app${if (who.isNullOrBlank()) "" else " / $who"}."
    }
}
