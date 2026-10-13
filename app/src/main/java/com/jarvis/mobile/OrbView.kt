package com.jarvis.mobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Núcleo do assistente: anéis segmentados que giram, onda radial e brilho central.
 * Estados: idle/wake (azul-gelo calmo), listening (reage ao microfone),
 * thinking (âmbar, giro rápido), speaking (pulsa).
 */
class OrbView(c: Context) : View(c) {

    var state = "idle"

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()
    private val path = Path()
    private var tt = 0f
    private var last = 0L
    private var spd = 0.25f
    private var amp = 0.04f
    private var cr = 92f
    private var cg = 240f
    private var cb = 255f
    private var lvl = 0f

    private fun col(a: Float): Int =
        Color.argb((a.coerceIn(0f, 1f) * 255).toInt(), cr.toInt(), cg.toInt(), cb.toInt())

    private fun arc(canvas: Canvas, cx: Float, cy: Float, r: Float, a0: Float, sweep: Float, w: Float, al: Float) {
        rect.set(cx - r, cy - r, cx + r, cy + r)
        paint.strokeWidth = w
        paint.color = col(al)
        canvas.drawArc(rect, a0, sweep, false, paint)
    }

    private fun deg(rad: Float) = rad * 180f / PI.toFloat()

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.nanoTime()
        val dt = if (last == 0L) 0.016f else min(0.05f, (now - last) / 1e9f)
        last = now
        val k = min(1f, dt * 4f)

        var tSpd = 0.25f; var tAmp = 0.04f
        var tr = 92f; var tg = 240f; var tb = 255f
        when (state) {
            "listening" -> { tSpd = 0.9f; tAmp = 0.06f + lvl * 0.22f }
            "thinking" -> { tSpd = 2.2f; tAmp = 0.05f; tr = 255f; tg = 181f; tb = 71f }
            "speaking" -> { tSpd = 0.6f; tAmp = 0.12f }
        }
        spd += (tSpd - spd) * k
        amp += (tAmp - amp) * k
        cr += (tr - cr) * k; cg += (tg - cg) * k; cb += (tb - cb) * k
        lvl += (Jarvis.level - lvl) * min(1f, dt * 12f)
        tt += dt * spd

        val w = width.toFloat()
        val h = height.toFloat()
        val cx = w / 2
        val cy = h / 2
        val half = min(w, h) / 2
        val s = half / 340f
        val idle = state == "idle" || state == "wake"

        // brilho de fundo
        paint.style = Paint.Style.FILL
        paint.shader = RadialGradient(
            cx, cy, half * 0.9f,
            intArrayOf(col(0.30f), col(0.07f), col(0f)), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, half * 0.9f, paint)
        paint.shader = null

        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.BUTT

        // anel externo segmentado
        for (i in 0 until 48) {
            val a = i * 7.5f + deg(tt * 0.5f)
            val big = i % 6 == 0
            arc(canvas, cx, cy, 300f * s, a, 4f, (if (big) 7f else 3f) * s, if (big) 0.95f else 0.35f)
        }
        // arcos em sentidos opostos
        for (j in 0 until 3) arc(canvas, cx, cy, 262f * s, deg(-tt * 0.9f + j * 2.09f), 74f, 4f * s, 0.85f)
        for (j in 0 until 4) arc(canvas, cx, cy, 228f * s, deg(tt * 1.3f + j * 1.57f), 40f, 2f * s, 0.6f)

        // anel pontilhado
        paint.pathEffect = DashPathEffect(floatArrayOf(2f * s, 10f * s), 0f)
        arc(canvas, cx, cy, 196f * s, 0f, 360f, 1.5f * s, 0.5f)
        paint.pathEffect = null

        // onda radial
        val n = 90
        path.reset()
        for (j in 0..n) {
            val q = j / n.toFloat() * 2f * PI.toFloat()
            val m = sin(q * 7f + tt * 6f) * sin(q * 3f - tt * 4f)
            var r = 150f + m * amp * 340f * (if (idle) 0.5f else 1f)
            if (state == "speaking") r += sin(tt * 9f + q * 5f) * 10f
            val x = cx + cos(q) * r * s
            val y = cy + sin(q) * r * s
            if (j == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        paint.strokeWidth = 9f * s; paint.color = col(0.25f); canvas.drawPath(path, paint)
        paint.strokeWidth = 3f * s; paint.color = col(0.95f); canvas.drawPath(path, paint)

        // núcleo
        val pulse = 1f + sin(tt * (if (state == "thinking") 7f else 2.4f)) * 0.07f
        val cr0 = 70f * s * pulse
        paint.style = Paint.Style.FILL
        paint.shader = RadialGradient(
            cx, cy, cr0,
            intArrayOf(Color.argb(242, 255, 255, 255), col(0.9f), col(0f)), floatArrayOf(0f, 0.35f, 1f), Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, cr0, paint)
        paint.shader = null

        postInvalidateOnAnimation()
    }
}
