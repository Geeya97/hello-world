package au.com.refrigerationservices.weather

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.com.refrigerationservices.weather.data.ChatMessage
import au.com.refrigerationservices.weather.data.CurrentResponse
import au.com.refrigerationservices.weather.data.Recipients
import au.com.refrigerationservices.weather.data.Report
import au.com.refrigerationservices.weather.data.WeatherApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One request the app made of Gmail, surfaced to the UI to act on. */
data class ComposeRequest(
    val id: Long,
    val to: String,
    val subject: String,
    val body: String,
)

data class DispatchState(
    val open: Boolean = false,
    val email: String = "",
    val error: String? = null,
    val sending: Boolean = false,
    /** Everyone who has been sent a report since Start was pressed. */
    val sent: List<String> = emptyList(),
)

data class ChatEntry(
    val role: String,
    val text: String,
    val isError: Boolean = false,
)

data class UiState(
    val loading: Boolean = true,
    val current: CurrentResponse? = null,
    val loadError: String? = null,
    val chatConfigured: Boolean = true,
    val dispatch: DispatchState = DispatchState(),
    val chat: List<ChatEntry> = listOf(
        ChatEntry(
            role = "assistant",
            text = "G'day. I'm your Australian weather agent.\n\n" +
                "Ask me for conditions anywhere in Australia — any suburb, any date, past or " +
                "future — and I can email the report to anyone on @${Recipients.ALLOWED_DOMAIN}.",
        ),
    ),
    val chatBusy: Boolean = false,
    val toast: String? = null,
    val composeRequest: ComposeRequest? = null,
)

class MainViewModel(private val api: WeatherApi = WeatherApi()) : ViewModel() {

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** History sent to the agent; separate from the display list. */
    private val history = mutableListOf<ChatMessage>()

    init {
        refresh()
        viewModelScope.launch {
            runCatching { api.health() }
                .onSuccess { h -> _state.update { it.copy(chatConfigured = h.chatConfigured) } }
        }
    }

    fun refresh() {
        _state.update { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            runCatching { api.current() }
                .onSuccess { data -> _state.update { it.copy(loading = false, current = data) } }
                .onFailure { e -> _state.update { it.copy(loading = false, loadError = e.message) } }
        }
    }

    // ── the dispatch loop ────────────────────────────────────────────────────

    fun startDispatch() {
        _state.update { it.copy(dispatch = DispatchState(open = true)) }
    }

    fun onEmailChanged(value: String) {
        _state.update { it.copy(dispatch = it.dispatch.copy(email = value, error = null)) }
    }

    /**
     * Send to one address and stay open. The loop only ends when the user presses
     * "Give me a Break".
     */
    fun sendToCurrentEmail() {
        val entered = _state.value.dispatch.email

        // Checked here for instant feedback; the server checks again before sending.
        when (val check = Recipients.check(entered)) {
            is Recipients.Result.Invalid -> {
                _state.update { it.copy(dispatch = it.dispatch.copy(error = check.error)) }
                return
            }

            is Recipients.Result.Valid -> viewModelScope.launch {
                _state.update { it.copy(dispatch = it.dispatch.copy(sending = true, error = null)) }

                runCatching { api.send(check.email) }
                    .onSuccess { result ->
                        _state.update { s ->
                            s.copy(
                                dispatch = s.dispatch.copy(
                                    sending = false,
                                    email = "",
                                    error = null,
                                    sent = s.dispatch.sent + result.to,
                                ),
                                // In compose mode the phone opens Gmail; in smtp mode
                                // the server already sent it and there is nothing to open.
                                composeRequest = if (result.delivered) null else composeFor(result.to, result.report),
                                toast = if (result.delivered) "Report sent to ${result.to}." else null,
                            )
                        }
                    }
                    .onFailure { e ->
                        // A rejected domain belongs on the field, not in a toast.
                        val message = e.message ?: "Something went wrong."
                        _state.update { s ->
                            if (message == Recipients.REJECTION_MESSAGE) {
                                s.copy(dispatch = s.dispatch.copy(sending = false, error = message))
                            } else {
                                s.copy(dispatch = s.dispatch.copy(sending = false), toast = message)
                            }
                        }
                    }
            }
        }
    }

    /** "Give me a Break" — the only thing that ends the loop. */
    fun endDispatch() {
        val sent = _state.value.dispatch.sent
        val summary = when (sent.size) {
            0 -> "No reports sent this round."
            1 -> "Break time. 1 report sent — ${sent.first().substringBefore('@')}."
            else -> "Break time. ${sent.size} reports sent — " +
                sent.joinToString(", ") { it.substringBefore('@') } + "."
        }
        _state.update { it.copy(dispatch = DispatchState(open = false), toast = summary) }
    }

    // ── the agent ────────────────────────────────────────────────────────────

    fun sendChat(text: String) {
        val message = text.trim()
        if (message.isEmpty() || _state.value.chatBusy) return

        history += ChatMessage("user", message)
        _state.update {
            it.copy(chat = it.chat + ChatEntry("user", message), chatBusy = true)
        }

        viewModelScope.launch {
            runCatching { api.chat(history.toList()) }
                .onSuccess { response ->
                    history += ChatMessage("assistant", response.reply)

                    val compose = response.actions
                        .firstOrNull { it.type == "send" && !it.delivered && it.to != null }

                    _state.update { s ->
                        s.copy(
                            chat = s.chat + ChatEntry("assistant", response.reply),
                            chatBusy = false,
                            toast = response.actions
                                .firstOrNull { it.type == "send" && it.delivered }
                                ?.let { "Report sent to ${it.to}." },
                            // The agent asked for a send but the backend is in compose
                            // mode, so fetch the report and hand it to Gmail.
                            composeRequest = s.composeRequest,
                        )
                    }

                    if (compose?.to != null) fetchAndCompose(compose.to)
                }
                .onFailure { e ->
                    _state.update { s ->
                        s.copy(
                            chat = s.chat + ChatEntry("assistant", e.message ?: "Something went wrong.", isError = true),
                            chatBusy = false,
                        )
                    }
                }
        }
    }

    /**
     * The chat endpoint reports that a send was requested but, in compose mode,
     * the draft has to be opened on the device. Re-request it so we have the
     * rendered report to hand to Gmail.
     */
    private fun fetchAndCompose(to: String) {
        viewModelScope.launch {
            runCatching { api.send(to) }
                .onSuccess { result ->
                    if (!result.delivered) {
                        _state.update { it.copy(composeRequest = composeFor(result.to, result.report)) }
                    }
                }
                .onFailure { e -> _state.update { it.copy(toast = e.message) } }
        }
    }

    // ── one-shot events ──────────────────────────────────────────────────────

    fun onComposeHandled() = _state.update { it.copy(composeRequest = null) }

    fun onToastShown() = _state.update { it.copy(toast = null) }

    fun reportComposeFailure() =
        _state.update { it.copy(toast = "No email app found on this device.") }

    private var composeId = 0L

    private fun composeFor(to: String, report: Report) =
        ComposeRequest(id = ++composeId, to = to, subject = report.subject, body = report.text)
}
