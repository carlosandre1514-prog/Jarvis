package com.jarvis.mobile

import android.app.Application

class JarvisApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Store.init(this)
    }
}
