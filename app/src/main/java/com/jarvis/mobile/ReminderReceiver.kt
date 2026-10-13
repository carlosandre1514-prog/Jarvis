package com.jarvis.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        Store.init(c)
        val text = i.getStringExtra("text") ?: "Lembrete"
        val id = i.getStringExtra("id")
        val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("rem", "Lembretes", NotificationManager.IMPORTANCE_HIGH))
        val n = Notification.Builder(c, "rem")
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle("Lembrete")
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        nm.notify((System.currentTimeMillis() % 100000).toInt(), n)
        if (id != null) Store.save("rems", Store.load("rems").filter { it.id != id })
        Jarvis.speakAsync("Lembrete: $text")
    }
}
