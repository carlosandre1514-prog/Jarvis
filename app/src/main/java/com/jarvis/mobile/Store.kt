package com.jarvis.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.Normalizer
import java.util.Locale

data class Item(val id: String, val text: String, val ts: Long, val at: Long = 0L)

object Store {
    lateinit var ctx: Context
    fun init(c: Context) { ctx = c.applicationContext }

    private val sp get() = ctx.getSharedPreferences("jarvis", Context.MODE_PRIVATE)

    private fun str(k: String, d: String) = sp.getString(k, d) ?: d
    private fun put(k: String, v: String) = sp.edit().putString(k, v).apply()

    val defaultModels = "gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite"
    val defaultBlocked = "com.nu.production,com.itau,br.com.bradesco,com.bradesco,br.com.bb.android," +
        "com.caixa,com.santander,br.com.intermedium,com.picpay,com.mercadopago.wallet,com.paypal.android.p2pmobile"

    var apiKey: String
        get() = str("apiKey", "")
        set(v) = put("apiKey", v.trim())

    var picoKey: String
        get() = str("picoKey", "")
        set(v) = put("picoKey", v.trim())

    var imageModel: String
        get() = str("imageModel", "gemini-3.1-flash-image-preview")
        set(v) = put("imageModel", v.trim().ifEmpty { "gemini-3.1-flash-image-preview" })

    var modelsCsv: String
        get() = str("models", defaultModels)
        set(v) = put("models", v)

    val models: List<String>
        get() = modelsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { defaultModels.split(",") }

    var assistant: String
        get() = str("assistant", "Jarvis")
        set(v) = put("assistant", v.trim().ifEmpty { "Jarvis" })

    var userName: String
        get() = str("user", "")
        set(v) = put("user", v.trim())

    var autoSpeak: Boolean
        get() = sp.getBoolean("autoSpeak", true)
        set(v) = sp.edit().putBoolean("autoSpeak", v).apply()

    var wakeRequired: Boolean
        get() = sp.getBoolean("wakeRequired", true)
        set(v) = sp.edit().putBoolean("wakeRequired", v).apply()

    var blockedCsv: String
        get() = str("blocked", defaultBlocked)
        set(v) = put("blocked", v)

    fun isBlocked(pkg: String): Boolean {
        if (pkg.isEmpty()) return false
        return blockedCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.any { pkg.startsWith(it) }
    }

    // ---- listas (memória, notas, lembretes) ----
    fun load(key: String): MutableList<Item> {
        val out = mutableListOf<Item>()
        try {
            val a = JSONArray(str(key, "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                out.add(Item(o.getString("id"), o.getString("text"), o.optLong("ts"), o.optLong("at")))
            }
        } catch (_: Exception) {
        }
        return out
    }

    fun save(key: String, list: List<Item>) {
        val a = JSONArray()
        list.forEach { a.put(JSONObject().put("id", it.id).put("text", it.text).put("ts", it.ts).put("at", it.at)) }
        put(key, a.toString())
    }

    // ---- histórico da conversa (role: me | ai | err) ----
    fun loadLog(): MutableList<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        try {
            val a = JSONArray(str("log", "[]"))
            for (i in 0 until a.length()) {
                val o = a.getJSONObject(i)
                out.add(o.getString("r") to o.getString("t"))
            }
        } catch (_: Exception) {
        }
        return out
    }

    fun saveLog(list: List<Pair<String, String>>) {
        val a = JSONArray()
        list.takeLast(40).forEach { a.put(JSONObject().put("r", it.first).put("t", it.second)) }
        put("log", a.toString())
    }

    fun uid(): String = Integer.toString((Math.random() * 1_000_000_000).toInt(), 36)

    fun norm(s: String): String =
        Normalizer.normalize(s.lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "").trim()
}
