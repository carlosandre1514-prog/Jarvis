package com.jarvis.mobile

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.location.LocationManager
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.telephony.SmsManager
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class P(val name: String, val type: String, val desc: String, val req: Boolean = false, val enum: List<String>? = null)

class Tool(val name: String, val desc: String, val params: List<P> = emptyList(), val run: (JSONObject) -> Any?)

object Tools {
    private val ctx: Context get() = Store.ctx

    // ------------------------------------------------------------------ utilidades
    fun toJson(x: Any?): Any = when (x) {
        null -> JSONObject.NULL
        is JSONObject, is JSONArray -> x
        is Map<*, *> -> JSONObject().also { o -> x.forEach { (k, v) -> o.put(k.toString(), toJson(v)) } }
        is Iterable<*> -> JSONArray().also { a -> x.forEach { a.put(toJson(it)) } }
        is Number, is Boolean, is String -> x
        else -> x.toString()
    }

    fun declarations(): JSONArray {
        val arr = JSONArray()
        for (t in all) {
            val props = JSONObject()
            val req = JSONArray()
            for (p in t.params) {
                val o = JSONObject().put("type", p.type).put("description", p.desc)
                if (p.enum != null) o.put("enum", JSONArray(p.enum))
                props.put(p.name, o)
                if (p.req) req.put(p.name)
            }
            val params = JSONObject().put("type", "object").put("properties", props)
            if (req.length() > 0) params.put("required", req)
            arr.put(JSONObject().put("name", t.name).put("description", t.desc).put("parameters", params))
        }
        return arr
    }

    fun summary(): String = all.joinToString("\n") { "- ${it.name}: ${it.desc}" }

    private fun a11y(): JarvisAccessibilityService = JarvisAccessibilityService.instance
        ?: throw IllegalStateException("O serviço de acessibilidade do Jarvis está desligado. Peça ao usuário para ativá-lo em Ajustes do Jarvis > Acessibilidade.")

    private fun has(perm: String) = ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED

    private fun need(perm: String, nome: String) {
        if (!has(perm)) throw SecurityException("Falta a permissão de $nome. Peça ao usuário para conceder em Ajustes do Jarvis > Permissões.")
    }

    private fun start(i: Intent): Boolean = try {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        true
    } catch (e: Exception) {
        false
    }

    private fun httpGet(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 12000
        c.readTimeout = 15000
        return c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun matchItems(list: List<Item>, m: String): List<Item> {
        val q = Store.norm(m)
        return list.filter { it.id == m || Store.norm(it.text).contains(q) }
    }

    private fun digits(s: String) = s.filter { it.isDigit() || it == '+' }

    private fun waNumber(s: String): String {
        var d = s.filter { it.isDigit() }
        if (d.length <= 11 && !d.startsWith("55")) d = "55$d"
        return d
    }

    private fun findContacts(q: String): List<Pair<String, String>> {
        need(Manifest.permission.READ_CONTACTS, "contatos")
        val out = ArrayList<Pair<String, String>>()
        val seen = HashSet<String>()
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?", arrayOf("%$q%"), null
        )?.use { c ->
            while (c.moveToNext() && out.size < 8) {
                val name = c.getString(0) ?: continue
                val num = c.getString(1) ?: continue
                if (seen.add(num.filter { it.isDigit() })) out.add(name to num)
            }
        }
        return out
    }

    /** Aceita número ou nome de contato. */
    private fun resolvePhone(s: String): String {
        if (Regex("^[+\\d\\s()-]{8,}$").matches(s.trim())) return s.trim()
        val r = findContacts(s.trim())
        if (r.isEmpty()) throw IllegalArgumentException("Não encontrei o contato \"$s\".")
        if (r.size > 1) throw IllegalArgumentException(
            "Vários contatos para \"$s\": " + r.joinToString("; ") { "${it.first} ${it.second}" } + ". Pergunte qual."
        )
        return r[0].second
    }

    private fun location(): Pair<Double, Double> {
        if (!has(Manifest.permission.ACCESS_COARSE_LOCATION) && !has(Manifest.permission.ACCESS_FINE_LOCATION))
            throw SecurityException("Falta a permissão de localização.")
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        var best: android.location.Location? = null
        for (p in lm.getProviders(true)) {
            val l = try { lm.getLastKnownLocation(p) } catch (_: SecurityException) { null } ?: continue
            if (best == null || l.time > best.time) best = l
        }
        val b = best ?: throw IllegalStateException("Sem localização disponível agora.")
        return b.latitude to b.longitude
    }

    private val WCODE = mapOf(
        0 to "céu limpo", 1 to "quase limpo", 2 to "parcialmente nublado", 3 to "nublado", 45 to "neblina", 48 to "neblina",
        51 to "garoa fraca", 53 to "garoa", 55 to "garoa forte", 61 to "chuva fraca", 63 to "chuva", 65 to "chuva forte",
        80 to "pancadas fracas", 81 to "pancadas de chuva", 82 to "pancadas fortes", 95 to "trovoadas", 96 to "trovoadas com granizo", 99 to "trovoadas com granizo forte"
    )

    // ------------------------------------------------------------------ calculadora
    private class Calc(val s: String) {
        var p = 0
        fun parse(): Double {
            val v = expr()
            ws()
            if (p < s.length) throw IllegalArgumentException("Expressão inválida.")
            return v
        }
        fun ws() { while (p < s.length && s[p] == ' ') p++ }
        fun eat(c: Char): Boolean { ws(); if (p < s.length && s[p] == c) { p++; return true }; return false }
        fun expr(): Double {
            var v = term()
            while (true) { v = if (eat('+')) v + term() else if (eat('-')) v - term() else return v }
        }
        fun term(): Double {
            var v = pow()
            while (true) { v = if (eat('*')) v * pow() else if (eat('/')) v / pow() else return v }
        }
        fun pow(): Double {
            val b = unary()
            return if (eat('^')) Math.pow(b, pow()) else b
        }
        fun unary(): Double {
            if (eat('-')) return -unary()
            if (eat('+')) return unary()
            var v = primary()
            while (eat('%')) v /= 100.0
            return v
        }
        fun primary(): Double {
            ws()
            if (eat('(')) { val v = expr(); if (!eat(')')) throw IllegalArgumentException("Falta ')'"); return v }
            val st = p
            if (p < s.length && (s[p].isDigit() || s[p] == '.')) {
                while (p < s.length && (s[p].isDigit() || s[p] == '.')) p++
                return s.substring(st, p).toDouble()
            }
            while (p < s.length && s[p].isLetter()) p++
            val id = s.substring(st, p)
            if (id.isEmpty()) throw IllegalArgumentException("Expressão inválida.")
            if (id == "pi") return Math.PI
            if (id == "e") return Math.E
            if (!eat('(')) throw IllegalArgumentException("Função sem parênteses: $id")
            val a = expr()
            val b = if (eat(',')) expr() else 0.0
            if (!eat(')')) throw IllegalArgumentException("Falta ')'")
            return when (id) {
                "sqrt" -> Math.sqrt(a); "sin" -> Math.sin(a); "cos" -> Math.cos(a); "tan" -> Math.tan(a)
                "log" -> Math.log10(a); "ln" -> Math.log(a); "abs" -> Math.abs(a); "round" -> Math.round(a).toDouble()
                "floor" -> Math.floor(a); "ceil" -> Math.ceil(a); "min" -> Math.min(a, b); "max" -> Math.max(a, b)
                "pow" -> Math.pow(a, b)
                else -> throw IllegalArgumentException("Função não permitida: $id")
            }
        }
    }

    // ------------------------------------------------------------------ lembretes
    private fun scheduleReminder(r: Item) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val i = Intent(ctx, ReminderReceiver::class.java).putExtra("text", r.text).putExtra("id", r.id)
        val pi = PendingIntent.getBroadcast(ctx, r.id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
    }

    private fun cancelReminderAlarm(r: Item) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val i = Intent(ctx, ReminderReceiver::class.java)
        val pi = PendingIntent.getBroadcast(ctx, r.id.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.cancel(pi)
    }

    private val fmt get() = SimpleDateFormat("EEEE, dd/MM/yyyy HH:mm:ss", Locale("pt", "BR"))

    // ------------------------------------------------------------------ apps
    private val ALIASES = mapOf(
        "zap" to "whatsapp", "zapzap" to "whatsapp", "insta" to "instagram", "email" to "gmail", "e-mail" to "gmail",
        "loja" to "play store", "navegador" to "chrome", "mapas" to "maps", "agenda" to "calendario", "galeria" to "fotos",
        "despertador" to "relogio", "twitter" to "x"
    )
    private val SETTINGS = mapOf(
        "wifi" to Settings.ACTION_WIFI_SETTINGS, "wi-fi" to Settings.ACTION_WIFI_SETTINGS,
        "bluetooth" to Settings.ACTION_BLUETOOTH_SETTINGS, "configuracoes" to Settings.ACTION_SETTINGS,
        "ajustes" to Settings.ACTION_SETTINGS, "bateria" to Settings.ACTION_BATTERY_SAVER_SETTINGS,
        "som" to Settings.ACTION_SOUND_SETTINGS, "tela" to Settings.ACTION_DISPLAY_SETTINGS,
        "brilho" to Settings.ACTION_DISPLAY_SETTINGS, "localizacao" to Settings.ACTION_LOCATION_SOURCE_SETTINGS
    )

    private fun launchables(): List<Pair<String, String>> {
        val pm = ctx.packageManager
        val i = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(i, 0).map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
            .distinctBy { it.second }.sortedBy { it.first.lowercase() }
    }

    private var torchOn = false

    // ------------------------------------------------------------------ lista de ferramentas
    val all: List<Tool> by lazy {
        listOf(
            // ---- informação
            Tool("get_datetime", "Data, hora e fuso horário atuais do aparelho.") {
                mapOf("data_hora" to fmt.format(Date()), "fuso" to java.util.TimeZone.getDefault().id)
            },
            Tool("get_weather", "Clima atual e previsão de 3 dias. Sem cidade, usa a localização do aparelho.", listOf(P("city", "string", "Cidade (opcional)."))) { a ->
                val lat: Double
                val lon: Double
                var nome: String
                val city = a.optString("city")
                if (city.isNotEmpty()) {
                    val g = JSONObject(httpGet("https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=" + Uri.encode(city)))
                    val rs = g.optJSONArray("results")
                    if (rs == null || rs.length() == 0) return@Tool mapOf("error" to "Cidade não encontrada: $city")
                    val r0 = rs.getJSONObject(0)
                    lat = r0.getDouble("latitude"); lon = r0.getDouble("longitude"); nome = r0.getString("name")
                } else {
                    val (la, lo) = location(); lat = la; lon = lo; nome = "localização atual"
                }
                val u = "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3"
                val j = JSONObject(httpGet(u))
                val c = j.getJSONObject("current")
                val d = j.getJSONObject("daily")
                val days = (0 until d.getJSONArray("time").length()).map { i ->
                    mapOf(
                        "dia" to d.getJSONArray("time").getString(i),
                        "condicao" to (WCODE[d.getJSONArray("weather_code").getInt(i)] ?: ""),
                        "min_c" to d.getJSONArray("temperature_2m_min").getDouble(i),
                        "max_c" to d.getJSONArray("temperature_2m_max").getDouble(i),
                        "chance_chuva_pct" to d.getJSONArray("precipitation_probability_max").optInt(i)
                    )
                }
                mapOf(
                    "local" to nome,
                    "agora" to mapOf(
                        "condicao" to (WCODE[c.getInt("weather_code")] ?: "indefinido"),
                        "temperatura_c" to c.getDouble("temperature_2m"),
                        "sensacao_c" to c.getDouble("apparent_temperature"),
                        "umidade_pct" to c.getDouble("relative_humidity_2m"),
                        "vento_kmh" to c.getDouble("wind_speed_10m")
                    ),
                    "previsao" to days
                )
            },
            Tool("create_image", "Cria uma imagem ORIGINAL (desenho, ilustração, arte, foto realista, logo) a partir de uma descrição e mostra na conversa. Use quando pedirem para criar, desenhar ou gerar uma imagem. Para achar fotos que já existem, use web_search.", listOf(P("prompt", "string", "Descrição detalhada da imagem: assunto, estilo, cores, clima.", true))) { a ->
                createImage(a.getString("prompt"))
            },
            Tool("web_search", "Pesquisa na web: notícias, preços, fatos atuais, qualquer coisa que mude com o tempo.", listOf(P("query", "string", "O que pesquisar.", true))) { a ->
                val body = JSONObject()
                    .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text",
                        "Pesquise na web e responda em português do Brasil, de forma objetiva e factual, com datas e números quando houver. Hoje é ${fmt.format(Date())}."))))
                    .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", a.getString("query"))))))
                    .put("tools", JSONArray().put(JSONObject().put("google_search", JSONObject())))
                val j = Gemini.generate(body)
                val parts = j.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
                val sb = StringBuilder()
                if (parts != null) for (i in 0 until parts.length()) sb.append(parts.getJSONObject(i).optString("text"))
                mapOf("resposta" to sb.toString().trim().ifEmpty { "Nada encontrado." })
            },
            Tool("device_status", "Bateria, rede, memória e armazenamento do aparelho.") {
                val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val caps = cm.getNetworkCapabilities(cm.activeNetwork)
                val st = StatFs(Environment.getDataDirectory().path)
                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
                val mi = android.app.ActivityManager.MemoryInfo()
                am.getMemoryInfo(mi)
                mapOf(
                    "bateria_pct" to bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY),
                    "carregando" to bm.isCharging,
                    "rede" to when {
                        caps == null -> "sem internet"
                        caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                        caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "dados móveis"
                        else -> "outra"
                    },
                    "armazenamento_livre_gb" to Math.round(st.availableBytes / 1.0e8) / 10.0,
                    "ram_livre_mb" to mi.availMem / 1048576,
                    "modelo" to "${Build.MANUFACTURER} ${Build.MODEL}",
                    "android" to Build.VERSION.RELEASE
                )
            },
            Tool("calculate", "Calcula uma expressão matemática. Aceita + - * / ^ % ( ) sqrt sin cos tan log ln abs round pi.", listOf(P("expression", "string", "Ex.: 12.5*3+sqrt(81)", true))) { a ->
                var e = a.getString("expression").lowercase().replace("×", "*").replace("÷", "/")
                if (!Regex("\\b(min|max|pow)\\(").containsMatchIn(e)) e = e.replace(Regex("(\\d),(\\d)"), "$1.$2")
                val v = Calc(e).parse()
                if (v.isNaN() || v.isInfinite()) mapOf("error" to "Sem resultado numérico.") else mapOf("resultado" to v)
            },

            // ---- memória, notas, lembretes
            Tool("remember", "Guarda um fato durável sobre o usuário (nome de familiares, preferências, telefones, endereço).", listOf(P("fact", "string", "O fato, em uma frase.", true))) { a ->
                val f = a.getString("fact").trim()
                val l = Store.load("mem")
                val dup = l.firstOrNull { Store.norm(it.text) == Store.norm(f) }
                if (dup != null) mapOf("ok" to true, "obs" to "já existia") else {
                    val it = Item(Store.uid(), f, System.currentTimeMillis()); l.add(it); Store.save("mem", l); mapOf("ok" to true, "id" to it.id)
                }
            },
            Tool("forget", "Apaga um fato da memória, pelo id ou por parte do texto.", listOf(P("match", "string", "Id ou trecho do texto.", true))) { a ->
                val l = Store.load("mem"); val hit = matchItems(l, a.getString("match"))
                if (hit.isEmpty()) mapOf("error" to "Nada encontrado.") else { l.removeAll(hit.toSet()); Store.save("mem", l); mapOf("ok" to true, "apagados" to hit.size) }
            },
            Tool("add_note", "Salva uma nota de texto.", listOf(P("text", "string", "Conteúdo da nota.", true))) { a ->
                val l = Store.load("notes"); val n = Item(Store.uid(), a.getString("text").trim(), System.currentTimeMillis()); l.add(n); Store.save("notes", l); mapOf("ok" to true, "id" to n.id)
            },
            Tool("list_notes", "Lista as notas salvas.") {
                mapOf("notas" to Store.load("notes").map { mapOf("id" to it.id, "texto" to it.text, "criada" to fmt.format(Date(it.ts))) })
            },
            Tool("delete_note", "Apaga uma nota pelo id ou por parte do texto.", listOf(P("match", "string", "Id ou trecho.", true))) { a ->
                val l = Store.load("notes"); val hit = matchItems(l, a.getString("match"))
                if (hit.isEmpty()) mapOf("error" to "Nada encontrado.") else { l.removeAll(hit.toSet()); Store.save("notes", l); mapOf("ok" to true, "apagadas" to hit.size) }
            },
            Tool(
                "set_reminder", "Agenda um lembrete que dispara uma notificação e fala, mesmo com o app fechado. Informe minutes_from_now OU at_iso.",
                listOf(
                    P("message", "string", "O que lembrar.", true),
                    P("minutes_from_now", "number", "Daqui a quantos minutos (aceita decimais)."),
                    P("at_iso", "string", "Data e hora local no formato AAAA-MM-DDTHH:MM:SS.")
                )
            ) { a ->
                val at: Long = if (a.has("minutes_from_now")) System.currentTimeMillis() + (a.getDouble("minutes_from_now") * 60000).toLong()
                else if (a.has("at_iso")) {
                    try { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(a.getString("at_iso"))!!.time }
                    catch (e: Exception) { return@Tool mapOf("error" to "Data inválida.") }
                } else return@Tool mapOf("error" to "Informe minutes_from_now ou at_iso.")
                if (at <= System.currentTimeMillis()) return@Tool mapOf("error" to "Esse horário já passou.")
                val l = Store.load("rems"); val r = Item(Store.uid(), a.getString("message"), System.currentTimeMillis(), at)
                l.add(r); Store.save("rems", l); scheduleReminder(r)
                mapOf("ok" to true, "id" to r.id, "dispara_em" to fmt.format(Date(at)))
            },
            Tool("list_reminders", "Lista os lembretes pendentes.") {
                mapOf("pendentes" to Store.load("rems").filter { it.at > System.currentTimeMillis() }.sortedBy { it.at }.map { mapOf("id" to it.id, "texto" to it.text, "quando" to fmt.format(Date(it.at))) })
            },
            Tool("cancel_reminder", "Cancela um lembrete pelo id ou por parte do texto.", listOf(P("match", "string", "Id ou trecho.", true))) { a ->
                val l = Store.load("rems"); val hit = matchItems(l, a.getString("match"))
                if (hit.isEmpty()) mapOf("error" to "Nada encontrado.") else { hit.forEach { cancelReminderAlarm(it) }; l.removeAll(hit.toSet()); Store.save("rems", l); mapOf("ok" to true, "cancelados" to hit.size) }
            },
            Tool("set_alarm", "Cria um alarme de verdade no app Relógio, sem pedir confirmação.", listOf(P("hour", "integer", "Hora 0-23.", true), P("minute", "integer", "Minuto 0-59.", true), P("label", "string", "Nome do alarme."))) { a ->
                val i = Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, a.getInt("hour")).putExtra(AlarmClock.EXTRA_MINUTES, a.getInt("minute"))
                    .putExtra(AlarmClock.EXTRA_MESSAGE, a.optString("label", "Alarme")).putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                mapOf("ok" to start(i))
            },

            // ---- apps e navegação
            Tool("open_app", "Abre qualquer aplicativo instalado no celular, pelo nome (WhatsApp, Instagram, Facebook, YouTube, Spotify, Câmera, Configurações, Wi-Fi etc.).", listOf(P("name", "string", "Nome do app.", true))) { a ->
                val n0 = Store.norm(a.getString("name"))
                val n = ALIASES[n0] ?: n0
                SETTINGS[n]?.let { act -> return@Tool mapOf("ok" to start(Intent(act))) }
                if (n == "camera") return@Tool mapOf("ok" to start(Intent(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)))
                val apps = launchables()
                val hit = apps.firstOrNull { Store.norm(it.first) == n } ?: apps.firstOrNull { Store.norm(it.first).startsWith(n) }
                    ?: apps.firstOrNull { Store.norm(it.first).contains(n) }
                    ?: return@Tool mapOf("error" to "Não achei um app chamado \"${a.getString("name")}\". Use list_apps.")
                val li = ctx.packageManager.getLaunchIntentForPackage(hit.second)
                if (li != null && start(li)) mapOf("ok" to true, "app" to hit.first) else mapOf("error" to "Não consegui abrir ${hit.first}.")
            },
            Tool("list_apps", "Lista os aplicativos instalados (nomes).") {
                mapOf("apps" to launchables().map { it.first })
            },
            Tool("open_url", "Abre um site no navegador.", listOf(P("url", "string", "Endereço completo.", true))) { a ->
                var u = a.getString("url").trim(); if (!u.startsWith("http", true)) u = "https://$u"
                mapOf("ok" to start(Intent(Intent.ACTION_VIEW, Uri.parse(u))))
            },
            Tool("play_youtube", "Procura vídeos ou músicas no YouTube.", listOf(P("query", "string", "O que tocar ou assistir.", true))) { a ->
                mapOf("ok" to start(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(a.getString("query"))))))
            },
            Tool("maps", "Abre o Google Maps: rota até um destino ou busca de lugares.", listOf(P("query", "string", "Destino ou busca.", true), P("mode", "string", "\"directions\" ou \"search\".", false, listOf("directions", "search")))) { a ->
                val q = Uri.encode(a.getString("query"))
                val u = if (a.optString("mode") == "directions") "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=$q" else "https://www.google.com/maps/search/?api=1&query=$q"
                mapOf("ok" to start(Intent(Intent.ACTION_VIEW, Uri.parse(u))))
            },

            // ---- comunicação (executa de verdade)
            Tool("find_contact", "Procura contatos pelo nome e devolve os telefones.", listOf(P("name", "string", "Nome ou parte.", true))) { a ->
                mapOf("contatos" to findContacts(a.getString("name")).map { mapOf("nome" to it.first, "telefone" to it.second) })
            },
            Tool("call", "Liga para um número ou contato agora (chamada direta).", listOf(P("to", "string", "Número com DDD ou nome do contato.", true))) { a ->
                need(Manifest.permission.CALL_PHONE, "ligações")
                val num = digits(resolvePhone(a.getString("to")))
                mapOf("ok" to start(Intent(Intent.ACTION_CALL, Uri.parse("tel:$num"))), "numero" to num)
            },
            Tool("send_sms", "Envia um SMS de verdade para um número ou contato.", listOf(P("to", "string", "Número ou nome do contato.", true), P("message", "string", "Texto.", true))) { a ->
                need(Manifest.permission.SEND_SMS, "SMS")
                val num = digits(resolvePhone(a.getString("to")))
                val sm = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
                val parts = sm.divideMessage(a.getString("message"))
                sm.sendMultipartTextMessage(num, null, parts, null, null)
                mapOf("ok" to true, "enviado_para" to num)
            },
            Tool("send_whatsapp", "Envia uma mensagem de WhatsApp de verdade (abre a conversa e toca em Enviar sozinho).", listOf(P("to", "string", "Número com DDD ou nome do contato.", true), P("message", "string", "Texto.", true))) { a ->
                val svc = a11y()
                val num = waNumber(resolvePhone(a.getString("to")))
                val pm = ctx.packageManager
                val pkg = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { pm.getLaunchIntentForPackage(it) != null }
                    ?: return@Tool mapOf("error" to "WhatsApp não está instalado.")
                val i = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$num?text=" + Uri.encode(a.getString("message")))).setPackage(pkg)
                if (!start(i)) return@Tool mapOf("error" to "Não consegui abrir o WhatsApp.")
                var sent = false
                for (k in 0 until 40) {
                    if (svc.clickWhatsAppSend(pkg)) { sent = true; break }
                    Thread.sleep(250)
                }
                if (sent) {
                    Thread.sleep(450)
                    svc.press("back")
                    Thread.sleep(400)
                    if (svc.currentPackage() == pkg) svc.press("back")
                    return@Tool mapOf("ok" to true, "obs" to "Mensagem enviada para $num e voltei à tela anterior.")
                }
                mapOf("error" to "Abri a conversa, mas não achei o botão Enviar. Use read_screen e tap.")
            },
            Tool("send_email", "Abre o app de e-mail com o rascunho pronto (depois use read_screen/tap_text para tocar em Enviar).", listOf(P("to", "string", "Destinatário.", true), P("subject", "string", "Assunto."), P("body", "string", "Corpo."))) { a ->
                val i = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(a.getString("to"))))
                    .putExtra(Intent.EXTRA_SUBJECT, a.optString("subject")).putExtra(Intent.EXTRA_TEXT, a.optString("body"))
                mapOf("ok" to start(i))
            },
            Tool("read_notifications", "Lê as notificações recentes recebidas (mensagens, apps). Útil para ver quem mandou mensagem.", listOf(P("app", "string", "Filtrar por app (opcional)."))) { a ->
                if (JarvisNotificationService.instance == null) return@Tool mapOf("error" to "O acesso a notificações está desligado. Ative em Ajustes do Jarvis.")
                val q = Store.norm(a.optString("app"))
                mapOf("notificacoes" to JarvisNotificationService.recent.filter { q.isEmpty() || Store.norm(it.app).contains(q) }.take(15)
                    .map { mapOf("app" to it.app, "titulo" to it.title, "texto" to it.text, "hora" to SimpleDateFormat("HH:mm", Locale.US).format(Date(it.time))) })
            },
            Tool("reply_notification", "Responde uma mensagem recebida (WhatsApp, Telegram etc.) usando a resposta rápida da notificação.", listOf(P("app", "string", "Nome do app.", true), P("text", "string", "Resposta.", true), P("contact", "string", "Nome de quem enviou (opcional)."))) { a ->
                val s = JarvisNotificationService.instance ?: return@Tool mapOf("error" to "O acesso a notificações está desligado.")
                mapOf("resultado" to s.reply(a.getString("app"), a.optString("contact").ifEmpty { null }, a.getString("text")))
            },

            // ---- controle da tela (outros apps)
            Tool("read_screen", "Lê o que está na tela agora, com um número para cada elemento. Use antes de tap/type_text.") {
                mapOf("tela" to a11y().readScreen())
            },
            Tool("tap", "Toca no elemento pelo número mostrado em read_screen.", listOf(P("index", "integer", "Número do elemento.", true))) { a ->
                val r = a11y().tapIndex(a.getInt("index")); Thread.sleep(500); mapOf("resultado" to r)
            },
            Tool("tap_text", "Toca no elemento que contém esse texto (ou descrição) na tela.", listOf(P("text", "string", "Texto visível.", true))) { a ->
                val r = a11y().tapText(a.getString("text")); Thread.sleep(500); mapOf("resultado" to r)
            },
            Tool("tap_xy", "Toca em coordenadas da tela (use só se não houver outro jeito).", listOf(P("x", "number", "X em pixels.", true), P("y", "number", "Y em pixels.", true))) { a ->
                val r = a11y().tapXY(a.getDouble("x").toFloat(), a.getDouble("y").toFloat()); Thread.sleep(400); mapOf("resultado" to r)
            },
            Tool("type_text", "Digita texto num campo (o focado, o do número informado, ou o primeiro da tela).", listOf(P("text", "string", "Texto.", true), P("index", "integer", "Número do campo em read_screen (opcional)."))) { a ->
                mapOf("resultado" to a11y().typeText(a.getString("text"), if (a.has("index")) a.getInt("index") else null))
            },
            Tool("scroll", "Rola a tela. direction = para onde rolar: down mostra o que está abaixo.", listOf(P("direction", "string", "up, down, left ou right.", true, listOf("up", "down", "left", "right")))) { a ->
                val r = a11y().scroll(a.getString("direction")); Thread.sleep(500); mapOf("resultado" to r)
            },
            Tool("press_key", "Teclas globais: back, home, recents, notifications, quick_settings, lock, screenshot, power_menu, enter.", listOf(P("key", "string", "Nome da tecla.", true))) { a ->
                val r = a11y().press(a.getString("key")); Thread.sleep(400); mapOf("resultado" to r)
            },
            Tool("see_screen", "Tira um print da tela e descreve/analisa a imagem (para o que read_screen não mostra: fotos, vídeos, jogos).", listOf(P("question", "string", "O que descobrir na tela."))) { a ->
                val b64 = a11y().screenshotJpegBase64() ?: return@Tool mapOf("error" to "Não consegui capturar a tela (precisa de Android 11+, e o app atual pode ser protegido).")
                val body = JSONObject()
                    .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", "Você descreve capturas de tela do celular com precisão, em português do Brasil, direto ao ponto."))))
                    .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray()
                        .put(JSONObject().put("inlineData", JSONObject().put("mimeType", "image/jpeg").put("data", b64)))
                        .put(JSONObject().put("text", a.optString("question").ifEmpty { "Descreva o que há na tela." })))))
                val j = Gemini.generate(body)
                val parts = j.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
                val sb = StringBuilder()
                if (parts != null) for (i in 0 until parts.length()) sb.append(parts.getJSONObject(i).optString("text"))
                mapOf("descricao" to sb.toString().trim().ifEmpty { "Não consegui analisar a imagem." })
            },
            Tool("wait", "Espera alguns segundos (para um app terminar de carregar).", listOf(P("seconds", "number", "Segundos (máx. 10).", true))) { a ->
                Thread.sleep((Math.min(10.0, Math.max(0.0, a.getDouble("seconds"))) * 1000).toLong()); mapOf("ok" to true)
            },

            // ---- hardware e ajustes
            Tool("flashlight", "Liga ou desliga a lanterna.", listOf(P("on", "boolean", "true liga, false desliga.", true))) { a ->
                val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
                    ?: return@Tool mapOf("error" to "Este aparelho não tem lanterna.")
                cm.setTorchMode(id, a.getBoolean("on")); torchOn = a.getBoolean("on"); mapOf("ok" to true, "estado" to if (torchOn) "ligada" else "desligada")
            },
            Tool("set_volume", "Ajusta o volume de mídia (0 a 100).", listOf(P("percent", "integer", "Porcentagem.", true))) { a ->
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * a.getInt("percent").coerceIn(0, 100) / 100f), 0); mapOf("ok" to true)
            },
            Tool("media_control", "Controla a mídia tocando: play_pause, next, previous.", listOf(P("action", "string", "play_pause, next ou previous.", true, listOf("play_pause", "next", "previous")))) { a ->
                val code = when (a.getString("action")) { "next" -> KeyEvent.KEYCODE_MEDIA_NEXT; "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS; else -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE }
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code)); am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code)); mapOf("ok" to true)
            },
            Tool("clipboard", "Lê ou escreve na área de transferência.", listOf(P("action", "string", "read ou write.", true, listOf("read", "write")), P("text", "string", "Texto, se for write."))) { a ->
                val cb = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                if (a.getString("action") == "write") { cb.setPrimaryClip(ClipData.newPlainText("jarvis", a.optString("text"))); mapOf("ok" to true) }
                else mapOf("texto" to (cb.primaryClip?.getItemAt(0)?.text?.toString() ?: ""), "obs" to "O Android pode devolver vazio se o Jarvis não estiver em primeiro plano.")
            },
            Tool("vibrate", "Faz o aparelho vibrar.", listOf(P("ms", "integer", "Duração em ms (padrão 400)."))) { a ->
                val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                v.vibrate(VibrationEffect.createOneShot(a.optLong("ms", 400), VibrationEffect.DEFAULT_AMPLITUDE)); mapOf("ok" to true)
            },
            Tool("configure", "Muda ajustes do app por pedido do usuário.", listOf(P("assistant_name", "string", "Novo nome do assistente."), P("user_name", "string", "Como chamar o usuário."), P("speak_replies", "boolean", "Responder em voz alta."))) { a ->
                val done = ArrayList<String>()
                if (a.has("assistant_name")) { Store.assistant = a.getString("assistant_name"); done.add("nome do assistente") }
                if (a.has("user_name")) { Store.userName = a.getString("user_name"); done.add("seu nome") }
                if (a.has("speak_replies")) { Store.autoSpeak = a.getBoolean("speak_replies"); done.add("voz") }
                mapOf("ok" to true, "alterado" to done)
            }
        )
    }

    private fun createImage(prompt: String): Any {
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", prompt)))))
            .put("generationConfig", JSONObject().put("responseModalities", JSONArray().put("TEXT").put("IMAGE")))
        val res = try {
            Gemini.generate(body, listOf(Store.imageModel), 120000)
        } catch (e: FatalApiError) {
            return mapOf("error" to "A chave de API foi recusada: ${e.message}")
        } catch (e: Exception) {
            return mapOf("error" to "Não consegui gerar a imagem (${e.message}). Modelos de imagem podem exigir faturamento ativo no Google AI Studio.")
        }
        val parts = res.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
        var b64: String? = null
        if (parts != null) for (i in 0 until parts.length()) {
            val p = parts.getJSONObject(i)
            val inl = p.optJSONObject("inlineData") ?: p.optJSONObject("inline_data")
            if (inl != null) { b64 = inl.getString("data"); break }
        }
        if (b64 == null) return mapOf("error" to "O modelo não devolveu imagem (pode ter recusado o pedido). Tente descrever de outro jeito.")
        val bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
        val name = "jarvis_${System.currentTimeMillis()}.png"
        val uri: Uri
        if (Build.VERSION.SDK_INT >= 29) {
            val v = android.content.ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Jarvis")
            }
            uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v)
                ?: return mapOf("error" to "Não consegui salvar a imagem na galeria.")
            ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        } else {
            val f = java.io.File(ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES), name)
            f.writeBytes(bytes)
            uri = Uri.fromFile(f)
        }
        Jarvis.addMsg("img", uri.toString())
        return mapOf("ok" to true, "mensagem" to "Imagem criada e já aparece na conversa. Foi salva em Pictures/Jarvis.")
    }

    fun run(name: String, args: JSONObject): JSONObject {
        val t = all.firstOrNull { it.name == name } ?: return JSONObject().put("error", "Ferramenta desconhecida: $name")
        return try {
            val r = toJson(t.run(args))
            if (r is JSONObject) r else JSONObject().put("resultado", r)
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: e.javaClass.simpleName)
        }
    }
}
