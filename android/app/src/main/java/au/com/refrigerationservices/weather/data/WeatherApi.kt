package au.com.refrigerationservices.weather.data

import au.com.refrigerationservices.weather.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Thin client for the Current Weather App backend. */
class WeatherApi(
    private val baseUrl: String = BuildConfig.API_BASE_URL.trimEnd('/'),
    private val client: OkHttpClient = defaultClient,
) {

    suspend fun health(): Health = get("/api/health")

    suspend fun current(): CurrentResponse = get("/api/current")

    suspend fun send(email: String, location: String? = null, datetime: String? = null): SendResponse =
        post("/api/send", json.encodeToString(SendRequest.serializer(), SendRequest(email, location, datetime)))

    suspend fun chat(messages: List<ChatMessage>): ChatResponse =
        post("/api/chat", json.encodeToString(ChatRequest.serializer(), ChatRequest(messages)))

    private suspend inline fun <reified T> get(path: String): T =
        execute(Request.Builder().url(baseUrl + path).get().build())

    private suspend inline fun <reified T> post(path: String, body: String): T =
        execute(
            Request.Builder()
                .url(baseUrl + path)
                .post(body.toRequestBody(JSON_MEDIA))
                .build(),
        )

    private suspend inline fun <reified T> execute(request: Request): T = withContext(Dispatchers.IO) {
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw ApiException("Could not reach the weather service. Is the backend running at $baseUrl?", e)
        }

        response.use {
            val body = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                // The server sends a human-readable reason; surface that rather
                // than a bare status code, so the domain rejection reaches the UI intact.
                val message = runCatching { json.decodeFromString(ApiError.serializer(), body).error }
                    .getOrElse { _ -> "Request failed (${it.code})" }
                throw ApiException(message)
            }
            json.decodeFromString<T>(body)
        }
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
        }

        private val defaultClient = OkHttpClient.Builder()
            // The chat agent can take a while when it makes several tool calls.
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}

class ApiException(message: String, cause: Throwable? = null) : Exception(message, cause)
