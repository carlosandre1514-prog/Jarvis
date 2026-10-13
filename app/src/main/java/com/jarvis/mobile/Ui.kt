package com.jarvis.mobile

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable

/** Painel com dois cantos cortados (superior esquerdo e inferior direito). */
class CutDrawable(private val fill: Int, private val stroke: Int, private val cut: Float, private val sw: Float = 2f) : Drawable() {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()

    override fun draw(c: Canvas) {
        val b = bounds
        val l = b.left + sw / 2; val t = b.top + sw / 2
        val r = b.right - sw / 2; val bt = b.bottom - sw / 2
        path.reset()
        path.moveTo(l + cut, t); path.lineTo(r, t); path.lineTo(r, bt - cut)
        path.lineTo(r - cut, bt); path.lineTo(l, bt); path.lineTo(l, t + cut); path.close()
        p.style = Paint.Style.FILL; p.color = fill; c.drawPath(path, p)
        if (stroke != 0) { p.style = Paint.Style.STROKE; p.strokeWidth = sw; p.color = stroke; c.drawPath(path, p) }
    }

    override fun setAlpha(alpha: Int) {}
    override fun setColorFilter(colorFilter: ColorFilter?) {}
    @Suppress("OVERRIDE_DEPRECATION")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
