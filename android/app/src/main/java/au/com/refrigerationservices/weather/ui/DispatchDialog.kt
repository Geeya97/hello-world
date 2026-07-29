package au.com.refrigerationservices.weather.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import au.com.refrigerationservices.weather.DispatchState
import au.com.refrigerationservices.weather.data.Recipients
import au.com.refrigerationservices.weather.ui.theme.Good

/**
 * The dispatch loop.
 *
 * It stays open after every send, so one Start can serve the whole family. The
 * only way out is the "Give me a Break" button — dismissing by back gesture or
 * outside tap is disabled deliberately so the loop cannot be exited by accident.
 */
@Composable
fun DispatchDialog(
    state: DispatchState,
    onEmailChanged: (String) -> Unit,
    onSend: () -> Unit,
    onBreak: () -> Unit,
) {
    if (!state.open) return

    Dialog(
        onDismissRequest = { /* Only "Give me a Break" ends the loop. */ },
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(22.dp)) {
                Text("Send a weather dispatch", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Enter a family address. Keep going as long as you like — the loop only stops when you say so.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )

                OutlinedTextField(
                    value = state.email,
                    onValueChange = onEmailChanged,
                    label = { Text("Family email address") },
                    placeholder = { Text("name@${Recipients.ALLOWED_DOMAIN}") },
                    isError = state.error != null,
                    singleLine = true,
                    enabled = !state.sending,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Send,
                    ),
                    keyboardActions = KeyboardActions(onSend = { onSend() }),
                    modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
                )

                if (state.error != null) {
                    Text(
                        "⚠  ${state.error}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }

                if (state.sent.isNotEmpty()) {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().heightIn(max = 168.dp).padding(top = 14.dp),
                        verticalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        items(state.sent) { address ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Good.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
                                    .border(1.dp, Good.copy(alpha = 0.22f), RoundedCornerShape(10.dp))
                                    .padding(horizontal = 13.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("✓", color = Good)
                                Text(
                                    address,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 9.dp),
                                )
                            }
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    OutlinedButton(
                        onClick = onBreak,
                        enabled = !state.sending,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f),
                    ) { Text("Give me a Break") }

                    Button(
                        onClick = onSend,
                        enabled = !state.sending,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.weight(1f),
                    ) {
                        if (state.sending) {
                            CircularProgressIndicator(
                                modifier = Modifier.width(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Text("Send")
                        }
                    }
                }
            }
        }
    }
}
