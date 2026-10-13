package com.jarvis.mobile

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class SettingsActivity : Activity() {

    private lateinit var key: EditText
    private lateinit var models: EditText
    private lateinit var name: EditText
    private lateinit var user: EditText
    private lateinit var blocked: EditText
    private lateinit var speak: CheckBox
    private lateinit var wake: CheckBox
    private lateinit var status: TextView
    private lateinit var box: LinearLayout

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun label(t: String) = TextView(this).apply {
        text = t
        setTextColor(Color.parseColor("#7FE9FF"))
        textSize = 13f
        setPadding(0, dp(14), 0, dp(4))
    }

    private fun field(value: String, hint: String, password: Boolean = false) = EditText(this).apply {
        setText(value)
        this.hint = hint
        setTextColor(Color.WHITE)
        setHintTextColor(Color.parseColor("#4F7080"))
        setBackgroundColor(Color.parseColor("#0B1B2B"))
        setPadding(dp(12), dp(10), dp(12), dp(10))
        if (password) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        else inputType = InputType.TYPE_CLASS_TEXT
    }

    private fun button(t: String, f: () -> Unit) = Button(this).apply {
        text = t
        isAllCaps = false
        setOnClickListener { f() }
    }

    private fun check(t: String, v: Boolean) = CheckBox(this).apply {
        text = t
        isChecked = v
        setTextColor(Color.WHITE)
    }

    private fun open(i: Intent) {
        try { startActivity(i) } catch (e: Exception) { Toast.makeText(this, "Não foi possível abrir essa tela.", Toast.LENGTH_SHORT).show() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#050912")
        box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#050912"))
            setPadding(dp(16), dp(36), dp(16), dp(24))
        }
        val sv = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#050912")); addView(box) }
        setContentView(sv)

        box.addView(TextView(this).apply { text = "Ajustes"; setTextColor(Color.WHITE); textSize = 22f })

        box.addView(label("Chave de API do Gemini (aistudio.google.com/apikey)"))
        key = field(Store.apiKey, "AIza...", true); box.addView(key)
        box.addView(label("Modelos, em ordem de preferência (separados por vírgula)"))
        models = field(Store.modelsCsv, "gemini-2.5-flash,..."); box.addView(models)
        box.addView(label("Nome do assistente (palavra de ativação)"))
        name = field(Store.assistant, "Jarvis"); box.addView(name)
        box.addView(label("Como devo te chamar"))
        user = field(Store.userName, "Seu nome"); box.addView(user)
        speak = check("Responder em voz alta", Store.autoSpeak); box.addView(speak)
        wake = check("Exigir a palavra de ativação para ouvir comandos", Store.wakeRequired); box.addView(wake)
        box.addView(label("Apps protegidos: o Jarvis não lê nem toca neles (prefixos de pacote, vírgula)"))
        blocked = field(Store.blockedCsv, "com.nu.production,..."); box.addView(blocked)

        box.addView(button("Salvar") { save(); Toast.makeText(this, "Salvo.", Toast.LENGTH_SHORT).show() })

        box.addView(label("Acessos ao celular"))
        status = TextView(this).apply { setTextColor(Color.parseColor("#B9D4DE")); textSize = 14f }
        box.addView(status)
        box.addView(button("1. Ativar Acessibilidade (controlar outros apps)") { open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
        box.addView(button("2. Ativar acesso a Notificações (ler e responder)") { open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) })
        box.addView(button("3. Permitir sobrepor outros apps (abrir apps em segundo plano)") {
            open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        })
        box.addView(button("4. Não otimizar bateria (manter ouvindo)") { open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) })
        box.addView(button("Informações do app (Android 13+: ⋮ > Permitir configurações restritas)") {
            open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        })
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onPause() {
        save()
        super.onPause()
    }

    private fun save() {
        Store.apiKey = key.text.toString()
        Store.modelsCsv = models.text.toString()
        Store.assistant = name.text.toString()
        Store.userName = user.text.toString()
        Store.blockedCsv = blocked.text.toString()
        Store.autoSpeak = speak.isChecked
        Store.wakeRequired = wake.isChecked
    }

    private fun refreshStatus() {
        fun yn(b: Boolean) = if (b) "ativo" else "desligado"
        status.text = "Acessibilidade: ${yn(JarvisAccessibilityService.instance != null)}\n" +
            "Notificações: ${yn(JarvisNotificationService.instance != null)}\n" +
            "Sobrepor apps: ${yn(Settings.canDrawOverlays(this))}"
    }
}
