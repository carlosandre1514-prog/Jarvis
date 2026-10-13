package com.jarvis.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class FatalApiError(msg: String) : Exception(msg)

object Gemini {
    private const val API = "https://generativelanguage.googleapis.com/v1beta/models"
    private val cool = HashMap<String, Long>()

    @Volatile
    var lastModel: String = ""

    /** Chama generateContent, tentando cada modelo da lista e pulando os que estão em espera (429 etc.). */
    fun generate(body: JSONObject, models: List<String> = Store.models, timeoutMs: Int = 40000): JSONObject {
        var last: Exception? = null
        for (m in models) {
            val now = System.currentTimeMillis()
            if ((cool[m] ?: 0L) > now) continue
            try {
                val conn = URL("$API/$m:generateContent").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 15000
                conn.readTimeout = timeoutMs
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("x-goog-api-key", Store.apiKey)
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val txt = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                if (code in 200..299) {
                    lastModel = m
                    return JSONObject(txt)
                }
                var msg = txt
                try { msg = JSONObject(txt).getJSONObject("error").getString("message") } catch (_: Exception) {}
                if ((code == 400 && msg.contains("api key", true)) || code == 401 || code == 403) throw FatalApiError(msg)
                val wait = when (code) { 429 -> 90_000L; 404 -> 30 * 60_000L; else -> 60_000L }
                cool[m] = System.currentTimeMillis() + wait
                last = Exception("$m: $msg")
            } catch (e: FatalApiError) {
                throw e
            } catch (e: Exception) {
                cool[m] = System.currentTimeMillis() + 60_000L
                last = e
            }
        }
        throw last ?: Exception("Todos os modelos estão indisponíveis agora.")
    }
}
