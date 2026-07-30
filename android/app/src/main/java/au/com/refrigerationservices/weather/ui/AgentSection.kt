package au.com.refrigerationservices.weather.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import au.com.refrigerationservices.weather.ChatEntry
import au.com.refrigerationservices.weather.ui.theme.ReportTextStyle
import au.com.refrigerationservices.weather.ui.theme.Warm

/** Bottom section: "Weather Ai Agent - Australia". */
@Composable
fun AgentSection(
    chat: List<ChatEntry>,
    busy: Boolean,
    chatConfigured: Boolean,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(chat.size, busy) {
        if (chat.isNotEmpty()) listState.animateScrollToItem(chat.lastIndex)
    }

    GlassPanel(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Weather Ai Agent - Australia", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Any Australian suburb, any date — past or future. Ask it to send a report.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Pill(
                text = if (chatConfigured) "Weather agent" else "Needs an API key",
                tint = if (chatConfigured) MaterialTheme.colorScheme.primary else Warm,
            )
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 420.dp).padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            itemsIndexed(chat) { _, entry -> ChatBubble(entry) }
            if (busy) {
                item {
                    Row(modifier = Modifier.padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.width(15.dp), strokeWidth = 2.dp)
                        Text(
                            "Checking the weather…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(start = 10.dp),
                        )
                    }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text("Ask about Australian weather…") },
                maxLines = 4,
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    onSend(draft)
                    draft = ""
                }),
                modifier = Modifier.weight(1f),
            )
            FilledIconButton(
                onClick = {
                    onSend(draft)
                    draft = ""
                },
                enabled = !busy && draft.isNotBlank(),
                shape = RoundedCornerShape(14.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send message")
            }
        }
    }
}

@Composable
private fun ChatBubble(entry: ChatEntry) {
    val isUser = entry.role == "user"
    val background = when {
        entry.isError -> MaterialTheme.colorScheme.error.copy(alpha = 0.1f)
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
        else -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.04f)
    }
    val borderTint = when {
        entry.isError -> MaterialTheme.colorScheme.error.copy(alpha = 0.4f)
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
        else -> MaterialTheme.colorScheme.outline
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth(0.88f)
                .background(background, RoundedCornerShape(16.dp))
                .border(1.dp, borderTint, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 11.dp),
        ) {
            // Report blocks keep their fixed-width layout; prose wraps normally.
            for (chunk in splitReportBlocks(entry.text)) {
                if (chunk.isReport) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                            .background(Color(0xFF04070F), RoundedCornerShape(10.dp))
                            .padding(11.dp)
                            .horizontalScroll(rememberScrollState()),
                    ) {
                        Text(
                            chunk.text,
                            style = ReportTextStyle,
                            color = Color(0xFFE2E8F0),
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                } else {
                    Text(
                        chunk.text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (entry.isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

internal data class Chunk(val text: String, val isReport: Boolean)

/**
 * Split box-drawn report blocks out of the agent's prose so they can be rendered
 * in a monospace, horizontally scrollable container.
 */
internal fun splitReportBlocks(text: String): List<Chunk> {
    val chunks = mutableListOf<Chunk>()
    val buffer = StringBuilder()
    var inReport = false

    fun flush() {
        val content = buffer.toString().trim('\n')
        if (content.isNotBlank()) chunks += Chunk(content, inReport)
        buffer.clear()
    }

    for (line in text.lines()) {
        val looksLikeReport = line.any { it in "╔╚║─═╗╝" } || REPORT_ROW.containsMatchIn(line)
        if (looksLikeReport != inReport) {
            flush()
            inReport = looksLikeReport
        }
        buffer.append(line).append('\n')
    }
    flush()

    return chunks.ifEmpty { listOf(Chunk(text, false)) }
}

private val REPORT_ROW = Regex("""^\s{3,}\S.*\.{3,}\s""")
