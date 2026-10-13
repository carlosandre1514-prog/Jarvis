package com.jarvis.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/** Serviço em primeiro plano que fica ouvindo (palavra de ativação "Jarvis") e responde por voz. */
class VoiceService : Service() {

    companion object {
        @Volatile
        var running = false

        fun start(c: Context) {
            val i = Intent(c, VoiceService::class.java)
            c.startForegroundService(i)
        }

        fun stop(c: Context) {
            c.stopService(Intent(c, VoiceService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var rec: SpeechRecognizer? = null
    private var commandMode = false
    private var processing = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("voice", "Jarvis ouvindo", NotificationManager.IMPORTANCE_LOW))
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "voice")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("${Store.assistant} está ouvindo")
            .setContentText("Diga “${Store.assistant}” e o que precisa.")
            .setOngoing(true)
            .setContentIntent(pi)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(1, n)
        if (!running) {
            running = true
            listen()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        main.removeCallbacksAndMessages(null)
        try { rec?.destroy() } catch (_: Exception) {}
        rec = null
        Jarvis.level = 0f
        Jarvis.setState("idle")
        super.onDestroy()
    }

    private fun listen() {
        if (!running || processing) return
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Jarvis.addMsg("err", "Falta a permissão do microfone. Conceda em Ajustes.")
            stopSelf()
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Jarvis.addMsg("err", "Este aparelho não tem reconhecimento de voz disponível (instale/ative o app Google).")
            stopSelf()
            return
        }
        if (rec == null) {
            rec = SpeechRecognizer.createSpeechRecognizer(this)
            rec?.setRecognitionListener(listener)
        }
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        try {
            rec?.startListening(i)
            Jarvis.setState(if (commandMode || !Store.wakeRequired) "listening" else "wake")
        } catch (e: Exception) {
            restart(1500, true)
        }
    }

    private fun restart(delayMs: Long, recreate: Boolean = false) {
        if (recreate) {
            try { rec?.destroy() } catch (_: Exception) {}
            rec = null
        }
        main.postDelayed({ listen() }, delayMs)
    }

    private fun beep() {
        try { ToneGenerator(AudioManager.STREAM_MUSIC, 70).startTone(ToneGenerator.TONE_PROP_BEEP, 140) } catch (_: Exception) {}
    }

    private fun handle(text: String) {
        val t = text.trim()
        if (t.isEmpty()) { restart(200); return }
        var cmd: String? = null
        if (commandMode) {
            cmd = t
            commandMode = false
        } else if (!Store.wakeRequired) {
            cmd = t
        } else {
            val m = Regex(Regex.escape(Store.assistant), RegexOption.IGNORE_CASE).find(t)
            if (m != null) {
                val rest = t.substring(m.range.last + 1).trim(' ', ',', '.', '!', '?', ':')
                if (rest.length >= 3) cmd = rest else { commandMode = true; beep() }
            }
        }
        if (cmd == null) { restart(150); return }
        processing = true
        Jarvis.submit(cmd, true) {
            processing = false
            listen()
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {
            Jarvis.level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { Jarvis.level = 0f }
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onResults(results: Bundle?) {
            val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
            handle(t)
        }

        override fun onError(error: Int) {
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
                    commandMode = false
                    restart(250)
                }
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> restart(1000, true)
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                    Jarvis.addMsg("err", "Sem permissão de microfone.")
                    stopSelf()
                }
                else -> restart(2000, true)
            }
        }
    }
}
