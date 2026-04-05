# Android Recorder — App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Kotlin Android app that records GPS runs, shows distance / current pace / avg pace in real time, saves runs locally, and uploads them to the HTMITUB webhook-listener endpoint.

**Architecture:** Foreground `Service` runs GPS via `FusedLocationProviderClient` and exposes live state as `StateFlow`. Two activities: `MainActivity` (run list + upload buttons) and `RecordingActivity` (live display + pause/stop). `Room` persists runs + raw track points. `WorkManager` auto-retries failed uploads on connectivity. `ApiClient` POSTs to `POST /api/run`.

**Tech Stack:** Kotlin, Android SDK 28+, Room 2.6, WorkManager 2.9, FusedLocationProviderClient (play-services-location 21), OkHttp 4.12, Kotlin Coroutines, ViewBinding

**Prerequisites:** Android Studio Hedgehog or newer. The backend endpoint (`POST /api/run`) from the companion plan must be deployed first so you can smoke-test uploads.

---

## File Map

| File | Change |
|---|---|
| `android/settings.gradle.kts` | New — project settings |
| `android/build.gradle.kts` | New — root build file |
| `android/local.properties.example` | New — documents required local config |
| `android/app/build.gradle.kts` | New — app module build config |
| `android/app/src/main/AndroidManifest.xml` | New — permissions + activity/service declarations |
| `android/app/src/main/res/values/colors.xml` | New — dark theme palette matching HTMITUB web app |
| `android/app/src/main/res/values/strings.xml` | New |
| `android/app/src/main/res/values/themes.xml` | New |
| `android/app/src/main/res/layout/activity_main.xml` | New — home screen layout |
| `android/app/src/main/res/layout/activity_recording.xml` | New — recording screen layout |
| `android/app/src/main/res/layout/item_run.xml` | New — run list row |
| `android/app/src/main/java/com/htmitub/recorder/util/PolylineEncoder.kt` | New — Google Encoded Polyline encoder |
| `android/app/src/main/java/com/htmitub/recorder/db/Run.kt` | New — Room entity |
| `android/app/src/main/java/com/htmitub/recorder/db/TrackPoint.kt` | New — Room entity |
| `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt` | New — Room DAO |
| `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt` | New — Room database singleton |
| `android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt` | New — OkHttp upload client |
| `android/app/src/main/java/com/htmitub/recorder/sync/SyncWorker.kt` | New — WorkManager worker |
| `android/app/src/main/java/com/htmitub/recorder/RecordingService.kt` | New — foreground GPS service |
| `android/app/src/main/java/com/htmitub/recorder/RecordingActivity.kt` | New — recording screen |
| `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt` | New — home screen |
| `android/app/src/main/java/com/htmitub/recorder/App.kt` | New — Application class |
| `android/app/src/test/java/com/htmitub/recorder/PolylineEncoderTest.kt` | New — JVM unit tests |
| `android/app/src/test/java/com/htmitub/recorder/RunDaoTest.kt` | New — Room in-memory tests |
| `android/app/src/test/java/com/htmitub/recorder/ApiClientPayloadTest.kt` | New — payload builder tests |

---

## Task 1: Project scaffold

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/local.properties.example`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/values/colors.xml`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values/themes.xml`

- [ ] **Step 1: Create `android/settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "HtmitubRecorder"
include(":app")
```

- [ ] **Step 2: Create `android/build.gradle.kts`**

```kotlin
plugins {
    id("com.android.application") version "8.3.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("com.google.devtools.ksp") version "1.9.22-1.0.17" apply false
}
```

- [ ] **Step 3: Create `android/local.properties.example`**

```
# Copy this file to local.properties and fill in your values.
# local.properties is gitignored — never commit it.
sdk.dir=/path/to/your/Android/Sdk
server_url=https://your-domain.com
bearer_token=your-app-bearer-token
```

- [ ] **Step 4: Create `android/app/build.gradle.kts`**

```kotlin
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(f.inputStream())
}

android {
    namespace = "com.htmitub.recorder"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.htmitub.recorder"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "SERVER_URL", "\"${localProps["server_url"] ?: "https://example.com"}\"")
        buildConfigField("String", "BEARER_TOKEN", "\"${localProps["bearer_token"] ?: ""}\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    implementation("com.google.android.gms:play-services-location:21.2.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.11.1")
    testImplementation("androidx.test:core:1.5.0")
    testImplementation("androidx.room:room-testing:2.6.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
}
```

- [ ] **Step 5: Create `android/app/src/main/AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:name=".App"
        android:allowBackup="false"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name=".RecordingActivity"
            android:exported="false"
            android:screenOrientation="portrait"
            android:keepScreenOn="true" />

        <service
            android:name=".RecordingService"
            android:exported="false"
            android:foregroundServiceType="location" />

    </application>
</manifest>
```

- [ ] **Step 6: Create `android/app/src/main/res/values/colors.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="bg">#0F0F0F</color>
    <color name="surface">#1A1A1A</color>
    <color name="border">#2A2A2A</color>
    <color name="text">#E8E8E8</color>
    <color name="muted">#888888</color>
    <color name="accent">#F97316</color>
    <color name="stop_red">#C0392B</color>
    <color name="pause_green">#1A5C2A</color>
</resources>
```

- [ ] **Step 7: Create `android/app/src/main/res/values/strings.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Run Recorder</string>
    <string name="channel_name">Recording</string>
    <string name="channel_desc">GPS recording in progress</string>
    <string name="notification_title">Run in progress</string>
</resources>
```

- [ ] **Step 8: Create `android/app/src/main/res/values/themes.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:windowBackground">@color/bg</item>
        <item name="android:statusBarColor">@color/bg</item>
        <item name="android:navigationBarColor">@color/bg</item>
        <item name="colorPrimary">@color/accent</item>
    </style>
</resources>
```

- [ ] **Step 9: Copy `local.properties.example` to `local.properties` and fill in values**

```bash
cp android/local.properties.example android/local.properties
# Edit android/local.properties: set sdk.dir, server_url, bearer_token
```

- [ ] **Step 10: Verify the project syncs in Android Studio**

Open Android Studio → File → Open → select `android/`. Click "Sync Project with Gradle Files". Expected: no errors.

- [ ] **Step 11: Add `.gitignore` entry**

Append to the repo root `.gitignore` (or create one if missing):
```
android/local.properties
android/.gradle/
android/app/build/
android/build/
.superpowers/
```

- [ ] **Step 12: Commit**

```bash
git add android/ .gitignore
git commit -m "feat: scaffold Android run recorder project"
```

---

## Task 2: `PolylineEncoder.kt` with unit tests

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/util/PolylineEncoder.kt`
- Create: `android/app/src/test/java/com/htmitub/recorder/PolylineEncoderTest.kt`

- [ ] **Step 1: Write the failing test**

Create `android/app/src/test/java/com/htmitub/recorder/PolylineEncoderTest.kt`:

```kotlin
package com.htmitub.recorder

import com.htmitub.recorder.util.PolylineEncoder
import org.junit.Assert.assertEquals
import org.junit.Test

class PolylineEncoderTest {

    @Test
    fun `encodes known Google documentation example`() {
        // Source: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
        val points = listOf(
            Pair(38.5, -120.2),
            Pair(40.7, -120.95),
            Pair(43.252, -126.453),
        )
        assertEquals("_p~iF~ps|U_ulLnnqC_mqNvxq`@", PolylineEncoder.encode(points))
    }

    @Test
    fun `encodes empty list to empty string`() {
        assertEquals("", PolylineEncoder.encode(emptyList()))
    }

    @Test
    fun `encodes single point`() {
        val result = PolylineEncoder.encode(listOf(Pair(0.0, 0.0)))
        assertEquals("??", result)
    }
}
```

- [ ] **Step 2: Run tests to confirm failure**

In Android Studio: right-click `PolylineEncoderTest` → Run. Or from terminal:
```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.PolylineEncoderTest"
```

Expected: compilation error — `PolylineEncoder` not found.

- [ ] **Step 3: Implement `PolylineEncoder.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/util/PolylineEncoder.kt`:

```kotlin
package com.htmitub.recorder.util

import kotlin.math.roundToInt

object PolylineEncoder {

    fun encode(points: List<Pair<Double, Double>>): String {
        val sb = StringBuilder()
        var prevLat = 0
        var prevLng = 0
        for ((lat, lng) in points) {
            val iLat = (lat * 1e5).roundToInt()
            val iLng = (lng * 1e5).roundToInt()
            encodeSignedInt(sb, iLat - prevLat)
            encodeSignedInt(sb, iLng - prevLng)
            prevLat = iLat
            prevLng = iLng
        }
        return sb.toString()
    }

    private fun encodeSignedInt(sb: StringBuilder, value: Int) {
        var v = value shl 1
        if (value < 0) v = v.inv()
        do {
            var chunk = v and 0x1f
            v = v ushr 5
            if (v > 0) chunk = chunk or 0x20
            sb.append((chunk + 63).toChar())
        } while (v > 0)
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.PolylineEncoderTest"
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/util/PolylineEncoder.kt \
        android/app/src/test/java/com/htmitub/recorder/PolylineEncoderTest.kt
git commit -m "feat: add Google Encoded Polyline encoder"
```

---

## Task 3: Room database

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/db/Run.kt`
- Create: `android/app/src/main/java/com/htmitub/recorder/db/TrackPoint.kt`
- Create: `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt`
- Create: `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt`
- Create: `android/app/src/test/java/com/htmitub/recorder/RunDaoTest.kt`

- [ ] **Step 1: Write the failing tests**

Create `android/app/src/test/java/com/htmitub/recorder/RunDaoTest.kt`:

```kotlin
package com.htmitub.recorder

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.htmitub.recorder.db.Run
import com.htmitub.recorder.db.RunDatabase
import com.htmitub.recorder.db.TrackPoint
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RunDaoTest {

    private lateinit var db: RunDatabase

    @Before fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(ctx, RunDatabase::class.java)
            .allowMainThreadQueries()
            .build()
    }

    @After fun tearDown() = db.close()

    private fun sampleRun(id: String = "run-1") = Run(
        id = id,
        startedAt = 1712220720000L,
        distanceM = 8420.0,
        movingTimeS = 2640,
        elapsedTimeS = 2780,
        avgSpeedMs = 3.19,
        startLat = 59.334,
        startLng = 18.063,
        summaryPolyline = "_p~iF~ps|U",
        splitsJson = "[]",
        syncStatus = "pending",
    )

    @Test fun `insert and retrieve run`() = runBlocking {
        db.runDao().insert(sampleRun())
        val runs = db.runDao().getAllRuns()
        assertEquals(1, runs.size)
        assertEquals("run-1", runs[0].id)
    }

    @Test fun `getPendingRuns returns only pending`() = runBlocking {
        db.runDao().insert(sampleRun("a").copy(syncStatus = "pending"))
        db.runDao().insert(sampleRun("b").copy(syncStatus = "synced"))
        db.runDao().insert(sampleRun("c").copy(syncStatus = "failed"))
        val pending = db.runDao().getPendingRuns()
        assertEquals(1, pending.size)
        assertEquals("a", pending[0].id)
    }

    @Test fun `markSynced updates status`() = runBlocking {
        db.runDao().insert(sampleRun())
        db.runDao().markSynced("run-1")
        assertEquals("synced", db.runDao().getAllRuns()[0].syncStatus)
    }

    @Test fun `markFailed updates status`() = runBlocking {
        db.runDao().insert(sampleRun())
        db.runDao().markFailed("run-1")
        assertEquals("failed", db.runDao().getAllRuns()[0].syncStatus)
    }

    @Test fun `insert and delete track points`() = runBlocking {
        db.runDao().insert(sampleRun())
        db.runDao().insertTrackPoint(TrackPoint(runId = "run-1", lat = 59.334, lng = 18.063, alt = 10.0, ts = 1000L, accuracy = 5f))
        db.runDao().insertTrackPoint(TrackPoint(runId = "run-1", lat = 59.335, lng = 18.064, alt = 11.0, ts = 2000L, accuracy = 4f))
        assertEquals(2, db.runDao().getTrackPoints("run-1").size)
        db.runDao().deleteTrackPoints("run-1")
        assertEquals(0, db.runDao().getTrackPoints("run-1").size)
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.RunDaoTest"
```

Expected: compilation errors — `Run`, `RunDao`, `RunDatabase`, `TrackPoint` not defined.

- [ ] **Step 3: Create `Run.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/db/Run.kt`:

```kotlin
package com.htmitub.recorder.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "runs")
data class Run(
    @PrimaryKey val id: String,
    val startedAt: Long,       // Unix ms
    val distanceM: Double,
    val movingTimeS: Int,
    val elapsedTimeS: Int,
    val avgSpeedMs: Double,
    val startLat: Double,
    val startLng: Double,
    val summaryPolyline: String,
    val splitsJson: String,    // JSON array string
    val syncStatus: String,    // "pending" | "synced" | "failed"
)
```

- [ ] **Step 4: Create `TrackPoint.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/db/TrackPoint.kt`:

```kotlin
package com.htmitub.recorder.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "track_points",
    foreignKeys = [ForeignKey(
        entity = Run::class,
        parentColumns = ["id"],
        childColumns = ["runId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("runId")],
)
data class TrackPoint(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val runId: String,
    val lat: Double,
    val lng: Double,
    val alt: Double,
    val ts: Long,       // Unix ms
    val accuracy: Float,
)
```

- [ ] **Step 5: Create `RunDao.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt`:

```kotlin
package com.htmitub.recorder.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface RunDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(run: Run)

    @Query("SELECT * FROM runs ORDER BY startedAt DESC")
    suspend fun getAllRuns(): List<Run>

    @Query("SELECT * FROM runs WHERE syncStatus = 'pending' ORDER BY startedAt ASC")
    suspend fun getPendingRuns(): List<Run>

    @Query("SELECT * FROM runs WHERE syncStatus = 'failed' ORDER BY startedAt ASC")
    suspend fun getFailedRuns(): List<Run>

    @Query("UPDATE runs SET syncStatus = 'synced' WHERE id = :id")
    suspend fun markSynced(id: String)

    @Query("UPDATE runs SET syncStatus = 'failed' WHERE id = :id")
    suspend fun markFailed(id: String)

    @Insert
    suspend fun insertTrackPoint(point: TrackPoint)

    @Query("SELECT * FROM track_points WHERE runId = :runId ORDER BY ts ASC")
    suspend fun getTrackPoints(runId: String): List<TrackPoint>

    @Query("DELETE FROM track_points WHERE runId = :runId")
    suspend fun deleteTrackPoints(runId: String)
}
```

- [ ] **Step 6: Create `RunDatabase.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt`:

```kotlin
package com.htmitub.recorder.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Run::class, TrackPoint::class], version = 1, exportSchema = false)
abstract class RunDatabase : RoomDatabase() {
    abstract fun runDao(): RunDao

    companion object {
        @Volatile private var INSTANCE: RunDatabase? = null

        fun getInstance(context: Context): RunDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    RunDatabase::class.java,
                    "runs.db",
                ).build().also { INSTANCE = it }
            }
    }
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.RunDaoTest"
```

Expected: 5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/db/ \
        android/app/src/test/java/com/htmitub/recorder/RunDaoTest.kt
git commit -m "feat: add Room database with Run and TrackPoint entities"
```

---

## Task 4: `ApiClient.kt` with payload tests

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt`
- Create: `android/app/src/test/java/com/htmitub/recorder/ApiClientPayloadTest.kt`

- [ ] **Step 1: Write the failing tests**

Create `android/app/src/test/java/com/htmitub/recorder/ApiClientPayloadTest.kt`:

```kotlin
package com.htmitub.recorder

import com.htmitub.recorder.db.Run
import com.htmitub.recorder.sync.buildRunPayload
import org.junit.Assert.*
import org.junit.Test

class ApiClientPayloadTest {

    private val run = Run(
        id = "550e8400-e29b-41d4-a716-446655440000",
        startedAt = 1712220720000L,  // 2024-04-04T07:12:00Z
        distanceM = 8420.0,
        movingTimeS = 2640,
        elapsedTimeS = 2780,
        avgSpeedMs = 3.19,
        startLat = 59.334,
        startLng = 18.063,
        summaryPolyline = "_p~iF~ps|U",
        splitsJson = "[{\"split\":1}]",
        syncStatus = "pending",
    )

    @Test fun `payload contains app_run_id`() {
        assertTrue(buildRunPayload(run).contains("\"app_run_id\":\"550e8400-e29b-41d4-a716-446655440000\""))
    }

    @Test fun `payload contains started_at as ISO string`() {
        assertTrue(buildRunPayload(run).contains("\"started_at\":\"2024-04-04T07:12:00Z\""))
    }

    @Test fun `payload contains distance_m`() {
        assertTrue(buildRunPayload(run).contains("\"distance_m\":8420.0"))
    }

    @Test fun `payload contains splits array`() {
        assertTrue(buildRunPayload(run).contains("\"splits\":[{\"split\":1}]"))
    }
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.ApiClientPayloadTest"
```

Expected: compilation error — `buildRunPayload` not defined.

- [ ] **Step 3: Create `ApiClient.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt`:

```kotlin
package com.htmitub.recorder.sync

import com.htmitub.recorder.BuildConfig
import com.htmitub.recorder.db.Run
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit

// Pure function — extracted for testability
fun buildRunPayload(run: Run): String = buildString {
    append("{")
    append("\"app_run_id\":\"${run.id}\",")
    append("\"started_at\":\"${Instant.ofEpochMilli(run.startedAt)}\",")
    append("\"distance_m\":${run.distanceM},")
    append("\"moving_time_s\":${run.movingTimeS},")
    append("\"elapsed_time_s\":${run.elapsedTimeS},")
    append("\"avg_speed_ms\":${run.avgSpeedMs},")
    append("\"start_lat\":${run.startLat},")
    append("\"start_lng\":${run.startLng},")
    append("\"summary_polyline\":\"${run.summaryPolyline}\",")
    append("\"splits\":${run.splitsJson}")
    append("}")
}

class ApiClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun uploadRun(run: Run) = withContext(Dispatchers.IO) {
        val body = buildRunPayload(run)
        val request = Request.Builder()
            .url("${BuildConfig.SERVER_URL}/api/run")
            .addHeader("Authorization", "Bearer ${BuildConfig.BEARER_TOKEN}")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) {
            throw IOException("Upload failed: HTTP ${response.code}")
        }
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd android && ./gradlew :app:testDebugUnitTest --tests "com.htmitub.recorder.ApiClientPayloadTest"
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt \
        android/app/src/test/java/com/htmitub/recorder/ApiClientPayloadTest.kt
git commit -m "feat: add ApiClient for uploading runs"
```

---

## Task 5: `RecordingService.kt`

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/RecordingService.kt`

This service runs GPS tracking in the foreground. It exposes a `StateFlow<RecordingState>` that `RecordingActivity` observes. No unit tests — GPS and Android service lifecycle require device/emulator testing.

- [ ] **Step 1: Create `RecordingService.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/RecordingService.kt`:

```kotlin
package com.htmitub.recorder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.htmitub.recorder.db.Run
import com.htmitub.recorder.db.RunDatabase
import com.htmitub.recorder.db.TrackPoint
import com.htmitub.recorder.util.PolylineEncoder
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID
import kotlin.math.*

data class Split(
    val split: Int,
    val distance: Int,
    val movingTime: Int,
    val averageSpeed: Double,
    val elevationDifference: Int,
)

data class RecordingState(
    val distanceM: Double = 0.0,
    val currentPaceSecKm: Int? = null,
    val avgPaceSecKm: Int? = null,
    val movingTimeMs: Long = 0L,
    val isPaused: Boolean = false,
)

class RecordingService : Service() {

    inner class LocalBinder : Binder() {
        fun getService(): RecordingService = this@RecordingService
    }

    private val binder = LocalBinder()
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val _state = MutableStateFlow(RecordingState())
    val state: StateFlow<RecordingState> get() = _state

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback

    // Tracking state
    private var runId: String = ""
    private var startTimeMs: Long = 0L
    private var lastResumeMs: Long = 0L
    private var accumulatedMovingMs: Long = 0L
    private var isPaused: Boolean = false

    private var totalDistanceM: Double = 0.0
    private var lastLat: Double? = null
    private var lastLng: Double? = null
    private var lastAlt: Double = 0.0

    private val trackPoints = mutableListOf<TrackPoint>()

    // Rolling pace window (30 seconds)
    private data class PacePoint(val ts: Long, val distM: Double)
    private val paceWindow = ArrayDeque<PacePoint>()
    private val PACE_WINDOW_MS = 30_000L

    // 1km split tracking
    private var nextSplitKm = 1
    private var splitStartMovingMs: Long = 0L
    private var splitStartAlt: Double = 0.0
    private val completedSplits = mutableListOf<Split>()

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    fun startRun() {
        runId = UUID.randomUUID().toString()
        startTimeMs = System.currentTimeMillis()
        lastResumeMs = startTimeMs
        accumulatedMovingMs = 0L
        totalDistanceM = 0.0
        lastLat = null
        lastLng = null
        trackPoints.clear()
        paceWindow.clear()
        completedSplits.clear()
        nextSplitKm = 1
        splitStartMovingMs = 0L
        isPaused = false

        startForeground(NOTIFICATION_ID, buildNotification("0.00 km"))
        startLocationUpdates()
    }

    fun pauseRun() {
        if (isPaused) return
        isPaused = true
        accumulatedMovingMs += System.currentTimeMillis() - lastResumeMs
        _state.value = _state.value.copy(isPaused = true, currentPaceSecKm = null)
    }

    fun resumeRun() {
        if (!isPaused) return
        isPaused = false
        lastResumeMs = System.currentTimeMillis()
        _state.value = _state.value.copy(isPaused = false)
    }

    fun stopRun() {
        stopLocationUpdates()
        if (!isPaused) accumulatedMovingMs += System.currentTimeMillis() - lastResumeMs
        val elapsedMs = System.currentTimeMillis() - startTimeMs

        scope.launch {
            val polyline = PolylineEncoder.encode(trackPoints.map { Pair(it.lat, it.lng) })
            val avgSpeedMs = if (accumulatedMovingMs > 0) totalDistanceM / (accumulatedMovingMs / 1000.0) else 0.0
            val splitsJson = buildSplitsJson()

            val run = Run(
                id = runId,
                startedAt = startTimeMs,
                distanceM = totalDistanceM,
                movingTimeS = (accumulatedMovingMs / 1000).toInt(),
                elapsedTimeS = (elapsedMs / 1000).toInt(),
                avgSpeedMs = avgSpeedMs,
                startLat = trackPoints.firstOrNull()?.lat ?: 0.0,
                startLng = trackPoints.firstOrNull()?.lng ?: 0.0,
                summaryPolyline = polyline,
                splitsJson = splitsJson,
                syncStatus = "pending",
            )

            val db = RunDatabase.getInstance(applicationContext)
            db.runDao().insert(run)
            trackPoints.forEach { db.runDao().insertTrackPoint(it) }
        }

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
            .setMinUpdateDistanceMeters(5f)
            .build()
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    if (loc.accuracy > 10f) return
                    onLocation(loc.latitude, loc.longitude, loc.altitude, loc.time)
                }
            }
        }
        try {
            fusedClient.requestLocationUpdates(request, locationCallback, mainLooper)
        } catch (_: SecurityException) {}
    }

    private fun stopLocationUpdates() {
        if (::locationCallback.isInitialized) fusedClient.removeLocationUpdates(locationCallback)
    }

    private fun onLocation(lat: Double, lng: Double, alt: Double, ts: Long) {
        val point = TrackPoint(runId = runId, lat = lat, lng = lng, alt = alt, ts = ts, accuracy = 0f)
        trackPoints.add(point)

        if (!isPaused) {
            val prev = Pair(lastLat, lastLng)
            if (prev.first != null && prev.second != null) {
                val d = haversineMeters(prev.first!!, prev.second!!, lat, lng)
                totalDistanceM += d

                val movingMs = accumulatedMovingMs + (System.currentTimeMillis() - lastResumeMs)

                // Rolling pace window
                paceWindow.addLast(PacePoint(ts = System.currentTimeMillis(), distM = totalDistanceM))
                paceWindow.removeAll { System.currentTimeMillis() - it.ts > PACE_WINDOW_MS }
                val currentPace: Int? = if (paceWindow.size >= 2) {
                    val first = paceWindow.first()
                    val last = paceWindow.last()
                    val dt = (last.ts - first.ts) / 1000.0
                    val dd = last.distM - first.distM
                    if (dd > 0) (1000.0 * dt / dd).toInt() else null
                } else null

                val avgPace: Int? = if (movingMs > 0 && totalDistanceM > 0)
                    (1000.0 * (movingMs / 1000.0) / totalDistanceM).toInt() else null

                // Check 1km splits
                if (totalDistanceM >= nextSplitKm * 1000.0) {
                    val splitMovingMs = movingMs - splitStartMovingMs
                    completedSplits.add(Split(
                        split = nextSplitKm,
                        distance = 1000,
                        movingTime = (splitMovingMs / 1000).toInt(),
                        averageSpeed = 1000.0 / (splitMovingMs / 1000.0),
                        elevationDifference = (alt - splitStartAlt).toInt(),
                    ))
                    nextSplitKm++
                    splitStartMovingMs = movingMs
                    splitStartAlt = alt
                }

                _state.value = RecordingState(
                    distanceM = totalDistanceM,
                    currentPaceSecKm = currentPace,
                    avgPaceSecKm = avgPace,
                    movingTimeMs = movingMs,
                    isPaused = false,
                )

                val distKm = "%.2f km".format(totalDistanceM / 1000)
                startForeground(NOTIFICATION_ID, buildNotification(distKm))
            }
        }

        lastLat = lat
        lastLng = lng
        lastAlt = alt
    }

    private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return r * 2 * asin(sqrt(a))
    }

    private fun buildSplitsJson(): String {
        if (completedSplits.isEmpty()) return "[]"
        return completedSplits.joinToString(prefix = "[", postfix = "]") { s ->
            "{\"split\":${s.split},\"distance\":${s.distance},\"moving_time\":${s.movingTime}," +
            "\"average_speed\":${s.averageSpeed},\"elevation_difference\":${s.elevationDifference}}"
        }
    }

    private fun createNotificationChannel() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { description = getString(R.string.channel_desc) })
    }

    private fun buildNotification(distanceText: String) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(distanceText)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        stopLocationUpdates()
    }

    companion object {
        const val CHANNEL_ID = "recording"
        const val NOTIFICATION_ID = 1
    }
}
```

- [ ] **Step 2: Build the project**

```bash
cd android && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/RecordingService.kt
git commit -m "feat: add foreground GPS recording service"
```

---

## Task 6: Layouts and `RecordingActivity.kt`

**Files:**
- Create: `android/app/src/main/res/layout/activity_recording.xml`
- Create: `android/app/src/main/java/com/htmitub/recorder/RecordingActivity.kt`

- [ ] **Step 1: Create `activity_recording.xml`**

Create `android/app/src/main/res/layout/activity_recording.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/bg"
    android:padding="24dp">

    <!-- Distance row -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="center">
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="DISTANCE"
            android:textColor="@color/muted"
            android:textSize="12sp"
            android:letterSpacing="0.12" />
        <TextView
            android:id="@+id/tvDistance"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="0.00"
            android:textColor="@color/text"
            android:textSize="52sp"
            android:textStyle="bold" />
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="km"
            android:textColor="@color/muted"
            android:textSize="14sp" />
    </LinearLayout>

    <View android:layout_width="match_parent" android:layout_height="1dp" android:background="@color/border" />

    <!-- Current pace row -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="center">
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="CURRENT PACE"
            android:textColor="@color/muted"
            android:textSize="12sp"
            android:letterSpacing="0.12" />
        <TextView
            android:id="@+id/tvCurrentPace"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="—"
            android:textColor="@color/accent"
            android:textSize="52sp"
            android:textStyle="bold" />
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="/km"
            android:textColor="@color/muted"
            android:textSize="14sp" />
    </LinearLayout>

    <View android:layout_width="match_parent" android:layout_height="1dp" android:background="@color/border" />

    <!-- Avg pace row -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:orientation="vertical"
        android:gravity="center">
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="AVG PACE"
            android:textColor="@color/muted"
            android:textSize="12sp"
            android:letterSpacing="0.12" />
        <TextView
            android:id="@+id/tvAvgPace"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="—"
            android:textColor="@color/text"
            android:textSize="52sp"
            android:textStyle="bold" />
        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="/km"
            android:textColor="@color/muted"
            android:textSize="14sp" />
    </LinearLayout>

    <!-- Buttons -->
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:layout_marginTop="16dp">
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnPause"
            android:layout_width="0dp"
            android:layout_height="56dp"
            android:layout_weight="1"
            android:layout_marginEnd="8dp"
            android:text="PAUSE"
            android:backgroundTint="@color/pause_green"
            android:textColor="@color/text" />
        <com.google.android.material.button.MaterialButton
            android:id="@+id/btnStop"
            android:layout_width="0dp"
            android:layout_height="56dp"
            android:layout_weight="1"
            android:layout_marginStart="8dp"
            android:text="STOP"
            android:backgroundTint="@color/stop_red"
            android:textColor="@color/text" />
    </LinearLayout>
</LinearLayout>
```

- [ ] **Step 2: Create `RecordingActivity.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/RecordingActivity.kt`:

```kotlin
package com.htmitub.recorder

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.IBinder
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.lifecycle.lifecycleScope
import com.htmitub.recorder.databinding.ActivityRecordingBinding
import com.htmitub.recorder.sync.SyncWorker
import kotlinx.coroutines.launch

class RecordingActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRecordingBinding
    private var service: RecordingService? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = (binder as RecordingService.LocalBinder).getService()
            service!!.startRun()
            lifecycleScope.launch {
                service!!.state.collect { state -> updateUI(state) }
            }
        }
        override fun onServiceDisconnected(name: ComponentName) { service = null }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRecordingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (!hasLocationPermission()) {
            ActivityCompat.requestPermissions(this, arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ), RC_LOCATION)
        } else {
            bindAndStart()
        }

        binding.btnPause.setOnClickListener {
            val svc = service ?: return@setOnClickListener
            if (svc.state.value.isPaused) {
                svc.resumeRun()
                binding.btnPause.text = "PAUSE"
            } else {
                svc.pauseRun()
                binding.btnPause.text = "RESUME"
            }
        }

        binding.btnStop.setOnClickListener {
            service?.stopRun()
            SyncWorker.enqueue(applicationContext)
            finish()
        }
    }

    private fun bindAndStart() {
        val intent = Intent(this, RecordingService::class.java)
        startForegroundService(intent)
        bindService(intent, connection, BIND_AUTO_CREATE)
    }

    private fun updateUI(state: RecordingState) {
        binding.tvDistance.text = "%.2f".format(state.distanceM / 1000)
        binding.tvCurrentPace.text = state.currentPaceSecKm?.let { formatPace(it) } ?: "—"
        binding.tvAvgPace.text = state.avgPaceSecKm?.let { formatPace(it) } ?: "—"
    }

    private fun formatPace(secKm: Int): String {
        val m = secKm / 60
        val s = secKm % 60
        return "%d:%02d".format(m, s)
    }

    private fun hasLocationPermission() =
        ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == RC_LOCATION && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            bindAndStart()
        } else {
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (service != null) unbindService(connection)
    }

    companion object { private const val RC_LOCATION = 1001 }
}
```

- [ ] **Step 3: Build the project**

```bash
cd android && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/res/layout/activity_recording.xml \
        android/app/src/main/java/com/htmitub/recorder/RecordingActivity.kt
git commit -m "feat: add recording screen with live pace and distance display"
```

---

## Task 7: `SyncWorker.kt`

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/sync/SyncWorker.kt`

- [ ] **Step 1: Create `SyncWorker.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/sync/SyncWorker.kt`:

```kotlin
package com.htmitub.recorder.sync

import android.content.Context
import androidx.work.*
import com.htmitub.recorder.db.RunDatabase

class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val db = RunDatabase.getInstance(applicationContext)
        val api = ApiClient()
        val runs = db.runDao().getPendingRuns() + db.runDao().getFailedRuns()
        var anyFailed = false
        for (run in runs) {
            try {
                api.uploadRun(run)
                db.runDao().markSynced(run.id)
                db.runDao().deleteTrackPoints(run.id)
            } catch (_: Exception) {
                db.runDao().markFailed(run.id)
                anyFailed = true
            }
        }
        return if (anyFailed) Result.retry() else Result.success()
    }

    companion object {
        fun enqueue(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                "sync_runs",
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }
    }
}
```

- [ ] **Step 2: Build**

```bash
cd android && ./gradlew :app:assembleDebug
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/sync/SyncWorker.kt
git commit -m "feat: add WorkManager sync worker for uploading runs"
```

---

## Task 8: Layouts and `MainActivity.kt`

**Files:**
- Create: `android/app/src/main/res/layout/activity_main.xml`
- Create: `android/app/src/main/res/layout/item_run.xml`
- Create: `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt`

- [ ] **Step 1: Create `activity_main.xml`**

Create `android/app/src/main/res/layout/activity_main.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/bg">

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="RUNS"
        android:textColor="@color/text"
        android:textSize="20sp"
        android:textStyle="bold"
        android:letterSpacing="0.08"
        android:padding="20dp" />

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnStartRun"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginHorizontal="16dp"
        android:layout_marginBottom="12dp"
        android:text="START RUN"
        android:backgroundTint="@color/accent"
        android:textColor="@color/text" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/rvRuns"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />
</LinearLayout>
```

- [ ] **Step 2: Create `item_run.xml`**

Create `android/app/src/main/res/layout/item_run.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:padding="16dp"
    android:background="@color/bg">

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical">
        <TextView
            android:id="@+id/tvDate"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textColor="@color/text"
            android:textSize="15sp" />
        <TextView
            android:id="@+id/tvStats"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textColor="@color/muted"
            android:textSize="13sp" />
    </LinearLayout>

    <TextView
        android:id="@+id/tvSyncStatus"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="center_vertical"
        android:layout_marginEnd="8dp"
        android:textSize="11sp" />

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnUpload"
        android:layout_width="wrap_content"
        android:layout_height="36dp"
        android:text="UPLOAD"
        android:backgroundTint="@color/surface"
        android:textColor="@color/muted"
        android:textSize="11sp"
        android:visibility="gone" />
</LinearLayout>
```

- [ ] **Step 3: Create `MainActivity.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt`:

```kotlin
package com.htmitub.recorder

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.htmitub.recorder.databinding.ActivityMainBinding
import com.htmitub.recorder.db.Run
import com.htmitub.recorder.db.RunDatabase
import com.htmitub.recorder.sync.SyncWorker
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: RunAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = RunAdapter(onUploadClick = {
            // SyncWorker already picks up failed runs — just trigger it
            SyncWorker.enqueue(this@MainActivity)
        })

        binding.rvRuns.layoutManager = LinearLayoutManager(this)
        binding.rvRuns.addItemDecoration(DividerItemDecoration(this, DividerItemDecoration.VERTICAL))
        binding.rvRuns.adapter = adapter

        binding.btnStartRun.setOnClickListener {
            startActivity(Intent(this, RecordingActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        loadRuns()
        SyncWorker.enqueue(this) // Auto-sync pending runs on app open
    }

    private fun loadRuns() {
        lifecycleScope.launch {
            val runs = RunDatabase.getInstance(this@MainActivity).runDao().getAllRuns()
            adapter.submitList(runs)
        }
    }
}

class RunAdapter(private val onUploadClick: () -> Unit) :
    RecyclerView.Adapter<RunAdapter.ViewHolder>() {

    private var runs: List<Run> = emptyList()

    fun submitList(list: List<Run>) {
        runs = list
        notifyDataSetChanged()
    }

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvDate: TextView = view.findViewById(R.id.tvDate)
        val tvStats: TextView = view.findViewById(R.id.tvStats)
        val tvSyncStatus: TextView = view.findViewById(R.id.tvSyncStatus)
        val btnUpload: MaterialButton = view.findViewById(R.id.btnUpload)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = layoutInflater(parent).inflate(R.layout.item_run, parent, false)
        return ViewHolder(view)
    }

    private fun layoutInflater(parent: ViewGroup) =
        android.view.LayoutInflater.from(parent.context)

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val run = runs[position]
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
        holder.tvDate.text = fmt.format(Date(run.startedAt))

        val distKm = "%.2f km".format(run.distanceM / 1000)
        val avgPace = if (run.avgSpeedMs > 0) {
            val secKm = (1000.0 / run.avgSpeedMs).toInt()
            "%d:%02d /km".format(secKm / 60, secKm % 60)
        } else "—"
        holder.tvStats.text = "$distKm · $avgPace"

        when (run.syncStatus) {
            "synced" -> {
                holder.tvSyncStatus.text = "✓"
                holder.tvSyncStatus.setTextColor(0xFF22C55E.toInt())
                holder.btnUpload.visibility = View.GONE
            }
            "failed" -> {
                holder.tvSyncStatus.text = "!"
                holder.tvSyncStatus.setTextColor(0xFFC0392B.toInt())
                holder.btnUpload.visibility = View.VISIBLE
                holder.btnUpload.setOnClickListener { onUploadClick() }
            }
            else -> { // pending
                holder.tvSyncStatus.text = "…"
                holder.tvSyncStatus.setTextColor(0xFF888888.toInt())
                holder.btnUpload.visibility = View.GONE
            }
        }
    }

    override fun getItemCount() = runs.size
}
```

- [ ] **Step 4: Build and run all unit tests**

```bash
cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
```

Expected: BUILD SUCCESSFUL, all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/res/layout/activity_main.xml \
        android/app/src/main/res/layout/item_run.xml \
        android/app/src/main/java/com/htmitub/recorder/MainActivity.kt
git commit -m "feat: add home screen with run list and upload buttons"
```

---

## Task 9: `App.kt` and end-to-end test

**Files:**
- Create: `android/app/src/main/java/com/htmitub/recorder/App.kt`

- [ ] **Step 1: Create `App.kt`**

Create `android/app/src/main/java/com/htmitub/recorder/App.kt`:

```kotlin
package com.htmitub.recorder

import android.app.Application
import androidx.work.Configuration

class App : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()
}
```

- [ ] **Step 2: Final build with all tests**

```bash
cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest
```

Expected: BUILD SUCCESSFUL, all 12 unit tests pass (3 PolylineEncoder + 5 RunDao + 4 ApiClientPayload).

- [ ] **Step 3: Install on device and manual test**

```bash
cd android && ./gradlew :app:installDebug
```

Manual checklist:
- [ ] App opens to home screen
- [ ] Tap "START RUN" — permission prompt appears (first run)
- [ ] Grant location permission — recording screen appears
- [ ] Walk around — distance increases, pace updates
- [ ] Tap PAUSE — pace shows "—", distance freezes
- [ ] Tap RESUME — accumulation resumes
- [ ] Tap STOP — returns to home screen, run appears as "…" (pending)
- [ ] Ensure phone has internet — run status changes to "✓" (synced)
- [ ] Check HTMITUB web app — run appears in the run list with source `app`

- [ ] **Step 4: Test failed upload recovery**

- Disable network, record a short run, stop it → status shows "…" (pending stays pending since no network)
- Re-enable network → WorkManager retries, status changes to "✓"
- Alternatively: tap the "UPLOAD" button on a failed run → triggers manual sync

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/htmitub/recorder/App.kt
git commit -m "feat: complete Android run recorder app"
```
