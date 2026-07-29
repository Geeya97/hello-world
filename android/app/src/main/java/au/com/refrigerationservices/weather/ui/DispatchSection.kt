package au.com.refrigerationservices.weather.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.com.refrigerationservices.weather.data.CurrentResponse
import au.com.refrigerationservices.weather.data.Observation
import au.com.refrigerationservices.weather.ui.theme.ReportTextStyle
import au.com.refrigerationservices.weather.ui.theme.Warm

/** Top section: current BOM conditions at Sunshine West, and the Start button. */
@Composable
fun DispatchSection(
    loading: Boolean,
    current: CurrentResponse?,
    error: String?,
    onStart: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Manual Dispatch", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Current Bureau of Meteorology conditions at Sunshine West, emailed to the family.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Button(
                onClick = onStart,
                enabled = current != null,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.padding(start = 12.dp),
            ) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.width(18.dp))
                Text("Start", modifier = Modifier.padding(start = 6.dp), fontWeight = FontWeight.SemiBold)
            }
        }

        when {
            loading -> Row(
                modifier = Modifier.padding(top = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.width(18.dp), strokeWidth = 2.dp)
                Text(
                    "Fetching the latest observation…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 12.dp),
                )
            }

            error != null -> Column(modifier = Modifier.padding(top = 16.dp)) {
                Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = onRetry, modifier = Modifier.padding(top = 4.dp)) { Text("Try again") }
            }

            current != null -> ObservationBody(current)
        }
    }
}

@Composable
private fun ObservationBody(current: CurrentResponse) {
    val obs = current.observation
    var showReport by remember { mutableStateOf(false) }

    Column(modifier = Modifier.padding(top = 18.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HeroReading("Dry bulb", fmt(obs.dryBulbC, "°C"), Modifier.weight(1f))
            HeroReading("Wet bulb", fmt(obs.wetBulbC, "°C"), Modifier.weight(1f), accent = true)
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SmallReading("Humidity", fmt(obs.relativeHumidityPct, "%", 0), Modifier.weight(1f))
            SmallReading("Dew point", fmt(obs.dewPointC, "°C"), Modifier.weight(1f))
            SmallReading("Wind", windText(obs), Modifier.weight(1f))
        }

        Text(
            provenance(obs),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 14.dp),
        )

        TextButton(onClick = { showReport = !showReport }, modifier = Modifier.padding(top = 4.dp)) {
            Text(if (showReport) "Hide the report" else "Preview the report that gets sent")
        }

        if (showReport) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF04070F), RoundedCornerShape(12.dp))
                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
                    .padding(14.dp)
                    // The report is fixed-width art, so it scrolls sideways
                    // rather than wrapping and losing its alignment.
                    .horizontalScroll(rememberScrollState()),
            ) {
                Text(
                    current.report.text,
                    style = ReportTextStyle,
                    color = Color(0xFFE2E8F0),
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun HeroReading(label: String, value: String, modifier: Modifier = Modifier, accent: Boolean = false) {
    val tint = if (accent) Warm else MaterialTheme.colorScheme.primary
    Column(
        modifier = modifier
            .background(tint.copy(alpha = 0.08f), RoundedCornerShape(13.dp))
            .border(1.dp, tint.copy(alpha = 0.28f), RoundedCornerShape(13.dp))
            .padding(horizontal = 15.dp, vertical = 13.dp),
    ) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.headlineSmall,
            color = if (accent) Warm else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(top = 5.dp),
        )
    }
}

@Composable
private fun SmallReading(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.035f), RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp),
    ) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

private fun provenance(obs: Observation): String = buildList {
    add("${obs.observedAt.dateLabel}, ${obs.observedAt.timeLabel} ${obs.observedAt.tzAbbr}".trim())
    obs.station?.let { s ->
        add("Observed at ${s.name}" + (s.distanceKm?.let { ", ${it.toInt()} km ${s.bearing.orEmpty()}".trimEnd() } ?: ""))
    }
    add("Source: ${obs.source}")
}.joinToString(" · ")

private fun windText(obs: Observation): String {
    val speed = obs.windSpeedKmh ?: return "—"
    return "${obs.windDir.orEmpty()} ${speed.toInt()}".trim() + " km/h"
}

internal fun fmt(value: Double?, unit: String, decimals: Int = 1): String =
    value?.let { String.format("%.${decimals}f%s", it, unit) } ?: "—"
