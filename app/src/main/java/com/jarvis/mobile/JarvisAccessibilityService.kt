package com.jarvis.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * É isto que dá ao Jarvis acesso aos outros apps: ler a tela, tocar, digitar, rolar e usar as teclas globais.
 */
class JarvisAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: JarvisAccessibilityService? = null
    }

    class El(
        val rect: Rect,
        val label: String,
        val kind: String,
        val clickable: Boolean,
        val editable: Boolean,
        val node: AccessibilityNodeInfo
    )

    @Volatile
    private var els: List<El> = emptyList()

    override fun onServiceConnected() {
        instance = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    // ---------- leitura ----------
    fun currentPackage(): String = rootInActiveWindow?.packageName?.toString() ?: ""

    private fun guard(): String? {
        val pkg = currentPackage()
        return if (Store.isBlocked(pkg)) "BLOQUEADO: o app $pkg está na lista de apps protegidos (ajustes)." else null
    }

    fun readScreen(): String {
        val root = rootInActiveWindow ?: return "Tela indisponível (nenhuma janela ativa)."
        val pkg = root.packageName?.toString() ?: ""
        if (Store.isBlocked(pkg)) return "BLOQUEADO: o app $pkg está na lista de apps protegidos (ajustes)."
        val list = ArrayList<El>()
        collect(root, list, 0)
        els = list
        val sb = StringBuilder("App: $pkg\n")
        for ((i, e) in list.withIndex()) {
            sb.append("[").append(i).append("] ").append(e.kind).append(": ").append(e.label)
            if (e.clickable) sb.append(" (toque)")
            if (e.editable) sb.append(" (campo de texto)")
            sb.append("\n")
            if (sb.length > 6000) {
                sb.append("...cortado, role a tela para ver mais")
                break
            }
        }
        if (list.isEmpty()) sb.append("(nenhum elemento legível; use see_screen para ver a imagem)")
        return sb.toString()
    }

    private fun collect(n: AccessibilityNodeInfo?, out: MutableList<El>, depth: Int) {
        if (n == null || depth > 40 || out.size > 250) return
        if (n.isVisibleToUser) {
            val text = n.text?.toString()?.trim().orEmpty()
            val desc = n.contentDescription?.toString()?.trim().orEmpty()
            var label = if (text.isNotEmpty()) text else desc
            val editable = n.isEditable
            val leafClickable = n.isClickable && n.childCount == 0
            if (label.isNotEmpty() || editable || leafClickable) {
                val r = Rect()
                n.getBoundsInScreen(r)
                if (label.isEmpty()) label = "(sem nome) @${r.centerX()},${r.centerY()}"
                out.add(
                    El(
                        r, label.take(120),
                        (n.className?.toString() ?: "").substringAfterLast('.'),
                        n.isClickable, editable, n
                    )
                )
            }
        }
        for (i in 0 until n.childCount) collect(n.getChild(i), out, depth + 1)
    }

    // ---------- ações ----------
    private fun clickableAncestor(start: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        var n = start
        var d = 0
        while (n != null && d < 8) {
            if (n.isClickable) return n
            n = n.parent
            d++
        }
        return null
    }

    fun tapIndex(i: Int): String {
        guard()?.let { return it }
        val e = els.getOrNull(i) ?: return "Índice inválido. Chame read_screen de novo."
        val c = clickableAncestor(e.node)
        if (c != null && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "ok"
        return tapXY(e.rect.centerX().toFloat(), e.rect.centerY().toFloat())
    }

    fun tapText(text: String): String {
        guard()?.let { return it }
        val root = rootInActiveWindow ?: return "Tela indisponível."
        val found = root.findAccessibilityNodeInfosByText(text) ?: emptyList<AccessibilityNodeInfo>()
        val node = found.firstOrNull { it.isVisibleToUser } ?: return "Não achei \"$text\" na tela. Use read_screen."
        val c = clickableAncestor(node)
        if (c != null && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "ok"
        val r = Rect()
        node.getBoundsInScreen(r)
        return tapXY(r.centerX().toFloat(), r.centerY().toFloat())
    }

    fun tapXY(x: Float, y: Float): String {
        guard()?.let { return it }
        val p = Path()
        p.moveTo(x, y)
        return if (gesture(p, 60)) "ok" else "O toque não foi concluído."
    }

    fun typeText(text: String, index: Int?): String {
        guard()?.let { return it }
        var node: AccessibilityNodeInfo? = if (index != null) els.getOrNull(index)?.node else null
        if (node == null) node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (node == null || !node.isEditable) node = els.firstOrNull { it.editable }?.node
        val target = node ?: return "Nenhum campo de texto encontrado. Toque no campo e chame read_screen."
        target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return if (target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) "ok" else "Falhou ao digitar."
    }

    /** direction = para onde a tela deve rolar: "down" mostra o que está abaixo. */
    fun scroll(direction: String): String {
        guard()?.let { return it }
        val dm = resources.displayMetrics
        val w = dm.widthPixels.toFloat()
        val h = dm.heightPixels.toFloat()
        val p = Path()
        when (direction.lowercase()) {
            "down" -> { p.moveTo(w / 2, h * 0.72f); p.lineTo(w / 2, h * 0.28f) }
            "up" -> { p.moveTo(w / 2, h * 0.28f); p.lineTo(w / 2, h * 0.72f) }
            "left" -> { p.moveTo(w * 0.2f, h / 2); p.lineTo(w * 0.8f, h / 2) }
            "right" -> { p.moveTo(w * 0.8f, h / 2); p.lineTo(w * 0.2f, h / 2) }
            else -> return "Direção inválida (up, down, left, right)."
        }
        return if (gesture(p, 320)) "ok" else "O gesto não foi concluído."
    }

    fun press(key: String): String {
        val ok = when (key.lowercase()) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "quick_settings" -> performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
            "lock" -> performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
            "screenshot" -> performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
            "power_menu" -> performGlobalAction(GLOBAL_ACTION_POWER_DIALOG)
            "enter" -> pressEnter()
            else -> return "Tecla desconhecida."
        }
        return if (ok) "ok" else "Não consegui executar."
    }

    private fun pressEnter(): Boolean {
        if (Build.VERSION.SDK_INT < 30) return false
        val f = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return f.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    /** Clica no botão Enviar do WhatsApp (ou WhatsApp Business) quando a conversa já está aberta com o texto. */
    fun clickWhatsAppSend(pkg: String): Boolean {
        val root = rootInActiveWindow ?: return false
        if (root.packageName?.toString() != pkg) return false
        val cands = ArrayList<AccessibilityNodeInfo>()
        root.findAccessibilityNodeInfosByViewId("$pkg:id/send")?.let { cands.addAll(it) }
        if (cands.isEmpty()) {
            for (t in listOf("Enviar", "Send")) {
                root.findAccessibilityNodeInfosByText(t)?.forEach { n ->
                    val d = n.contentDescription?.toString() ?: ""
                    if (d.equals(t, ignoreCase = true)) cands.add(n)
                }
            }
        }
        val node = cands.firstOrNull { it.isVisibleToUser } ?: return false
        val c = clickableAncestor(node)
        if (c != null && c.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        val r = Rect()
        node.getBoundsInScreen(r)
        return gesture(Path().apply { moveTo(r.centerX().toFloat(), r.centerY().toFloat()) }, 60)
    }

    // ---------- captura de tela (Android 11+) ----------
    fun screenshotJpegBase64(): String? {
        if (Build.VERSION.SDK_INT < 30) return null
        if (Store.isBlocked(currentPackage())) return null
        val latch = CountDownLatch(1)
        var out: String? = null
        takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    val hb = result.hardwareBuffer
                    val hw = Bitmap.wrapHardwareBuffer(hb, result.colorSpace)
                    val soft = hw?.copy(Bitmap.Config.ARGB_8888, false)
                    hb.close()
                    if (soft != null) {
                        val s = minOf(1f, 1024f / maxOf(soft.width, soft.height))
                        val bmp = if (s < 1f) Bitmap.createScaledBitmap(soft, (soft.width * s).toInt(), (soft.height * s).toInt(), true) else soft
                        val bos = ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.JPEG, 80, bos)
                        out = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                    }
                } catch (_: Exception) {
                } finally {
                    latch.countDown()
                }
            }

            override fun onFailure(errorCode: Int) {
                latch.countDown()
            }
        })
        latch.await(6, TimeUnit.SECONDS)
        return out
    }

    // ---------- gestos ----------
    private fun gesture(path: Path, durationMs: Long): Boolean {
        val g = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        val latch = CountDownLatch(1)
        var ok = false
        val cb = object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                ok = true
                latch.countDown()
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                latch.countDown()
            }
        }
        dispatchGesture(g, cb, Handler(Looper.getMainLooper()))
        latch.await(3, TimeUnit.SECONDS)
        return ok
    }
}
