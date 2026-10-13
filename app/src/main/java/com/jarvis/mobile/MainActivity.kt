package com.jarvis.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var orb: OrbView
    private lateinit var caption: TextView
    private lateinit var msgs: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var listenBtn: Button

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun roundBg(color: Int, radius: Int, stroke: Int = 0): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        if (stroke != 0) setStroke(dp(1), stroke)
    }

    private fun btn(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        setTextColor(Color.parseColor("#7FE9FF"))
        background = roundBg(Color.parseColor("#0B1B2B"), 12, Color.parseColor("#1F5C73"))
        setOnClickListener { onClick() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#050912")
        window.navigationBarColor = Color.parseColor("#050912")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#050912"))
            setPadding(dp(14), dp(34), dp(14), dp(12))
        }

        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(TextView(this).apply {
            text = "J.A.R.V.I.S"
            setTextColor(Color.parseColor("#7FE9FF"))
            textSize = 18f
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.2f
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(btn("Ajustes") { startActivity(Intent(this, SettingsActivity::class.java)) })
        root.addView(top)

        orb = OrbView(this)
        root.addView(orb, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(280)))

        caption = TextView(this).apply {
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#6FD3EA"))
            textSize = 12f
            typeface = Typeface.MONOSPACE
            letterSpacing = 0.18f
        }
        root.addView(caption)

        msgs = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(8)) }
        scroll = ScrollView(this).apply { addView(msgs) }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        input = EditText(this).apply {
            hint = "Digite um pedido…"
            setHintTextColor(Color.parseColor("#4F7080"))
            setTextColor(Color.WHITE)
            background = roundBg(Color.parseColor("#0B1B2B"), 14, Color.parseColor("#1F5C73"))
            setPadding(dp(14), dp(10), dp(14), dp(10))
            imeOptions = EditorInfo.IME_ACTION_SEND
            maxLines = 4
            setOnEditorActionListener { _, id, ev ->
                if (id == EditorInfo.IME_ACTION_SEND || (ev != null && ev.keyCode == KeyEvent.KEYCODE_ENTER)) { send(); true } else false
            }
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(btn("Enviar") { send() })
        root.addView(row)

        listenBtn = btn("") { toggleListening() }
        root.addView(listenBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })

        setContentView(root)

        for ((r, t) in Jarvis.messages()) bubble(r, t)
        askPermissions()
        if (Store.apiKey.isBlank()) startActivity(Intent(this, SettingsActivity::class.java))
    }

    override fun onResume() {
        super.onResume()
        Jarvis.onMessage = { r, t -> bubble(r, t) }
        Jarvis.onState = { s, cap -> orb.state = s; caption.text = cap; refreshListenBtn() }
        orb.state = Jarvis.state
        refreshListenBtn()
    }

    override fun onPause() {
        Jarvis.onMessage = null
        Jarvis.onState = null
        super.onPause()
    }

    private fun refreshListenBtn() {
        listenBtn.text = if (VoiceService.running) "Parar de ouvir" else "Ouvir (diga “${Store.assistant}”)"
        if (!VoiceService.running && Jarvis.state == "idle") caption.text = "SUSPENSO"
    }

    private fun toggleListening() {
        if (VoiceService.running) {
            VoiceService.stop(this)
            VoiceService.running = false
        } else {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                askPermissions()
                return
            }
            VoiceService.start(this)
        }
        listenBtn.postDelayed({ refreshListenBtn() }, 300)
    }

    private fun send() {
        val t = input.text.toString().trim()
        if (t.isEmpty()) return
        input.setText("")
        Jarvis.submit(t, false)
    }

    private fun bubble(role: String, text: String) {
        val me = role == "me"
        val tv = TextView(this).apply {
            this.text = text
            textSize = 15f
            setTextColor(if (role == "err") Color.parseColor("#FFB4A8") else Color.WHITE)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = roundBg(
                when (role) { "me" -> Color.parseColor("#12384A"); "err" -> Color.parseColor("#3A1712"); else -> Color.parseColor("#0B1B2B") },
                14
            )
        }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = if (me) Gravity.END else Gravity.START
            topMargin = dp(6)
            if (me) marginStart = dp(48) else marginEnd = dp(48)
        }
        msgs.addView(tv, lp)
        scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun askPermissions() {
        val p = mutableListOf(
            Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE,
            Manifest.permission.SEND_SMS, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION
        )
        if (Build.VERSION.SDK_INT >= 33) p.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = p.filter { checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 7)
    }
}
