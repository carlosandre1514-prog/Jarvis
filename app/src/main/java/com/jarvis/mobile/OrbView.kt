package com.jarvis.mobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.View
import java.util.Random
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Rede neural 3D que gira. Quatro estados:
 *  suspenso (idle/wake): azul-aço apagado, quase parado, pulsos raros
 *  ouvindo: verde-água, os nós reagem ao volume do microfone
 *  pensando: violeta, giro rápido e rajadas de sinais correndo pelas conexões
 *  falando: ciano brilhante, ondas que atravessam a rede e anéis que se expandem
 */
class OrbView(c: Context) : View(c) {

    private class Pulse(val a: Int, val b: Int, var t: Float)

    private val n = 90
    private val px = FloatArray(n)
    private val py = FloatArray(n)
    private val pz = FloatArray(n)
    private val ea = ArrayList<Int>()
    private val eb = ArrayList<Int>()
    private val pulses = ArrayList<Pulse>()
    private val rnd = Random(7)

    private val sx = FloatArray(n)
    private val sy = FloatArray(n)
    private val sd = FloatArray(n) // profundidade 0..1

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val hsv = floatArrayOf(0f, 1f, 1f)

    // parâmetros suavizados
    private var hue = 210f
    private var sat = 0.45f
    private var alpha = 0.35f
    private var speed = 0.12f
    private var pulseRate = 0.5f
    private var pulseSpeed = 0.6f
    private var waveAmp = 0f
    private var micAmp = 0f
    private var jitter = 0f
    private var core = 0.25f

    private var rot = 0f
    private var last = 0L
    private var lvl = 0f

    var state = "idle"

    init {
        for (i in 0 until n) {
            val y = 1f - 2f * (i + 0.5f) / n
            val r = sqrt(1f - y * y)
            val th = i * 2.399963f
            px[i] = cos(th) * r
            py[i] = y
            pz[i] = sin(th) * r
        }
        val seen = HashSet<Int>()
        for (i in 0 until n) {
            val d = (0 until n).filter { it != i }.sortedBy { j ->
                val dx = px[i] - px[j]; val dy = py[i] - py[j]; val dz = pz[i] - pz[j]
                dx * dx + dy * dy + dz * dz
            }
            for (k in 0 until 3) {
                val j = d[k]
                val key = min(i, j) * 1000 + maxOf(i, j)
                if (seen.add(key)) { ea.add(i); eb.add(j) }
            }
        }
    }

    private fun color(h: Float, s: Float, v: Float, a: Float): Int {
        hsv[0] = h; hsv[1] = s.coerceIn(0f, 1f); hsv[2] = v.coerceIn(0f, 1f)
        return Color.HSVToColor((a.coerceIn(0f, 1f) * 255).toInt(), hsv)
    }

    private fun approach(cur: Float, target: Float, k: Float) = cur + (target - cur) * k

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val now = System.nanoTime()
        val dt = if (last == 0L) 0.016f else min(0.05f, (now - last) / 1e9f)
        last = now
        val t = now / 1e9f
        val k = min(1f, dt * 3f)

        // alvos por estado
        var tHue = 210f; var tSat = 0.45f; var tAlpha = 0.35f; var tSpeed = 0.12f; var tRate = 0.5f
        var tPS = 0.6f; var tWave = 0f; var tMic = 0f; var tJit = 0f; var tCore = 0.25f
        when (state) {
            "listening" -> { tHue = 150f; tSat = 0.85f; tAlpha = 0.85f; tSpeed = 0.25f; tRate = 2.5f; tPS = 0.9f; tMic = 0.45f; tCore = 0.5f }
            "thinking" -> { tHue = 278f; tSat = 0.85f; tAlpha = 1f; tSpeed = 0.9f; tRate = 26f; tPS = 2.6f; tJit = 0.09f; tCore = 0.7f }
            "speaking" -> { tHue = 192f; tSat = 0.55f; tAlpha = 1f; tSpeed = 0.3f; tRate = 9f; tPS = 1.5f; tWave = 0.17f; tCore = 0.85f }
        }
        hue = approach(hue, tHue, k); sat = approach(sat, tSat, k); alpha = approach(alpha, tAlpha, k)
        speed = approach(speed, tSpeed, k); pulseRate = approach(pulseRate, tRate, k); pulseSpeed = approach(pulseSpeed, tPS, k)
        waveAmp = approach(waveAmp, tWave, k); micAmp = approach(micAmp, tMic, k); jitter = approach(jitter, tJit, k)
        core = approach(core, tCore, k)
        lvl = approach(lvl, Jarvis.level, min(1f, dt * 12f))

        rot += speed * dt
        val w = width.toFloat()
        val h = height.toFloat()
        val cx = w / 2
        val cy = h / 2
        val rad = min(w, h) / 2 * 0.78f
        val cr = cos(rot); val sr = sin(rot)
        val tx = 0.38f; val ct = cos(tx); val st = sin(tx)

        // projeção
        for (i in 0 until n) {
            var s = 1f
            s += micAmp * lvl * (0.4f + 0.6f * abs(sin(i * 1.3f + t * 6f)))
            s += waveAmp * sin(py[i] * 5f - t * 9f)
            s += jitter * sin(t * 11f + i)
            s += 0.02f * sin(t * 1.3f + i * 0.5f)
            val x = px[i] * s; val y = py[i] * s; val z = pz[i] * s
            val x1 = x * cr + z * sr
            val z1 = -x * sr + z * cr
            val y2 = y * ct - z1 * st
            val z2 = y * st + z1 * ct
            val f = 3.2f / (3.2f - z2)
            sx[i] = cx + x1 * rad * f
            sy[i] = cy + y2 * rad * f
            sd[i] = ((z2 + 1.3f) / 2.6f).coerceIn(0f, 1f)
        }

        // brilho central
        val cg = RadialGradient(
            cx, cy, rad * (0.55f + 0.25f * lvl * micAmp * 2f + 0.1f * waveAmp * 4f),
            intArrayOf(color(hue, sat * 0.8f, 1f, core * 0.55f), color(hue, sat, 1f, 0f)),
            floatArrayOf(0f, 1f), Shader.TileMode.CLAMP
        )
        paint.shader = cg
        paint.style = Paint.Style.FILL
        canvas.drawCircle(cx, cy, rad, paint)
        paint.shader = null

        // anéis de fala
        if (waveAmp > 0.02f) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f
            for (r in 0 until 3) {
                val ph = ((t * 0.7f + r / 3f) % 1f)
                paint.color = color(hue, sat * 0.6f, 1f, (1f - ph) * 0.55f * (waveAmp / 0.17f))
                canvas.drawCircle(cx, cy, rad * (0.35f + 0.85f * ph), paint)
            }
        }

        // conexões
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.6f
        for (e in 0 until ea.size) {
            val a = ea[e]; val b = eb[e]
            val d = (sd[a] + sd[b]) / 2
            paint.color = color(hue, sat, 1f, alpha * (0.12f + 0.38f * d))
            canvas.drawLine(sx[a], sy[a], sx[b], sy[b], paint)
        }

        // pulsos de sinal
        var spawn = pulseRate * dt
        while (spawn > 0f) {
            if (rnd.nextFloat() < spawn) {
                val e = rnd.nextInt(ea.size)
                if (pulses.size < 120) pulses.add(if (rnd.nextBoolean()) Pulse(ea[e], eb[e], 0f) else Pulse(eb[e], ea[e], 0f))
            }
            spawn -= 1f
        }
        paint.style = Paint.Style.FILL
        val it = pulses.iterator()
        while (it.hasNext()) {
            val p = it.next()
            p.t += dt * pulseSpeed
            if (p.t >= 1f) { it.remove(); continue }
            val x = sx[p.a] + (sx[p.b] - sx[p.a]) * p.t
            val y = sy[p.a] + (sy[p.b] - sy[p.a]) * p.t
            val d = (sd[p.a] + sd[p.b]) / 2
            paint.color = color(hue, sat * 0.4f, 1f, alpha * 0.35f)
            canvas.drawCircle(x, y, 7f + 4f * d, paint)
            paint.color = color(hue, sat * 0.3f, 1f, min(1f, alpha + 0.2f))
            canvas.drawCircle(x, y, 2.5f + 2f * d, paint)
        }

        // nós
        for (i in 0 until n) {
            val d = sd[i]
            val boost = 1f + micAmp * lvl * 1.2f
            paint.color = color(hue, sat * 0.8f, 1f, alpha * (0.25f + 0.75f * d) * 0.45f)
            canvas.drawCircle(sx[i], sy[i], (4.5f + 4f * d) * boost, paint)
            paint.color = color(hue, sat * 0.35f, 1f, alpha * (0.45f + 0.55f * d))
            canvas.drawCircle(sx[i], sy[i], (1.8f + 2.2f * d) * boost, paint)
        }

        postInvalidateOnAnimation()
    }
}
