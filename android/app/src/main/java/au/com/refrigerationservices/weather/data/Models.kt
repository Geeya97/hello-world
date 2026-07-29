package au.com.refrigerationservices.weather.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire types mirroring the JSON from ../../server.
 *
 * Only the fields the app renders are declared; the client is configured with
 * ignoreUnknownKeys so the server can add fields without breaking older builds.
 */

@Serializable
data class Observation(
    val source: String,
    val kind: String = "current",
    val location: Location,
    val station: Station? = null,
    val observedAt: ObservedAt,
    val dryBulbC: Double? = null,
    val wetBulbC: Double? = null,
    val wetBulbMethod: String? = null,
    val wetBulbDepressionC: Double? = null,
    val dewPointC: Double? = null,
    val apparentC: Double? = null,
    val relativeHumidityPct: Double? = null,
    val windDir: String? = null,
    val windSpeedKmh: Double? = null,
    val gustKmh: Double? = null,
    val pressureHpa: Double? = null,
    val rainSince9amMm: Double? = null,
)

@Serializable
data class Location(
    val label: String,
    val suburb: String? = null,
    val state: String? = null,
    val timezone: String? = null,
)

@Serializable
data class Station(
    val name: String,
    val id: String? = null,
    val distanceKm: Double? = null,
    val bearing: String? = null,
)

@Serializable
data class ObservedAt(
    val dateLabel: String,
    val timeLabel: String,
    val tzAbbr: String = "",
)

/**
 * The rendered report. Generated server-side so the phone, the browser and the
 * emails all show byte-identical text — there is no second formatter to drift.
 */
@Serializable
data class Report(
    val subject: String,
    val text: String,
    val html: String,
)

@Serializable
data class CurrentResponse(
    val observation: Observation,
    val report: Report,
)

@Serializable
data class SendResponse(
    val delivered: Boolean,
    val mode: String,
    val to: String,
    val composeUrl: String? = null,
    val mailtoUrl: String? = null,
    val report: Report,
    val location: String? = null,
)

@Serializable
data class ChatRequest(val messages: List<ChatMessage>)

@Serializable
data class ChatMessage(val role: String, val content: String)

@Serializable
data class ChatResponse(
    val reply: String,
    val actions: List<ChatAction> = emptyList(),
)

@Serializable
data class ChatAction(
    val type: String,
    val to: String? = null,
    val delivered: Boolean = false,
    val mode: String? = null,
    val composeUrl: String? = null,
    @SerialName("location") val location: String? = null,
)

@Serializable
data class SendRequest(
    val email: String,
    val location: String? = null,
    val datetime: String? = null,
)

@Serializable
data class ApiError(val error: String)

@Serializable
data class Health(
    val ok: Boolean = false,
    val mailMode: String = "compose",
    val chatConfigured: Boolean = false,
    val demoMode: Boolean = false,
)
