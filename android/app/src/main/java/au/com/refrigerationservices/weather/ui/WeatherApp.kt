package au.com.refrigerationservices.weather.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import au.com.refrigerationservices.weather.MainViewModel
import au.com.refrigerationservices.weather.data.GmailLauncher

@Composable
fun WeatherApp(viewModel: MainViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbars = remember { SnackbarHostState() }

    // When the backend hands back a draft, open it in Gmail. Keyed on the request
    // id so re-composition never re-fires the same draft.
    LaunchedEffect(state.composeRequest?.id) {
        state.composeRequest?.let { request ->
            val opened = GmailLauncher.compose(context, request.to, request.subject, request.body)
            if (!opened) viewModel.reportComposeFailure()
            viewModel.onComposeHandled()
        }
    }

    LaunchedEffect(state.toast) {
        state.toast?.let {
            snackbars.showSnackbar(it)
            viewModel.onToastShown()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbars) },
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets.systemBars,
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                            MaterialTheme.colorScheme.background,
                        ),
                    ),
                ),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Masthead()

                DispatchSection(
                    loading = state.loading,
                    current = state.current,
                    error = state.loadError,
                    onStart = viewModel::startDispatch,
                    onRetry = viewModel::refresh,
                )

                AgentSection(
                    chat = state.chat,
                    busy = state.chatBusy,
                    chatConfigured = state.chatConfigured,
                    onSend = viewModel::sendChat,
                )

                Text(
                    "Observations from the Bureau of Meteorology. Agent lookups from Open-Meteo. " +
                        "Reports go only to @refrigerationservices.com.au.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
        }
    }

    DispatchDialog(
        state = state.dispatch,
        onEmailChanged = viewModel::onEmailChanged,
        onSend = viewModel::sendToCurrentEmail,
        onBreak = viewModel::endDispatch,
    )
}

@Composable
private fun Masthead() {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("🌦️", style = MaterialTheme.typography.headlineSmall)
        Column(modifier = Modifier.padding(start = 12.dp)) {
            Text("Current Weather App", style = MaterialTheme.typography.headlineSmall)
            Text(
                "REFRIGERATION SERVICES · SUNSHINE WEST, VIC",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 3.dp),
            )
        }
    }
}

/** The frosted card both sections sit in. */
@Composable
fun GlassPanel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.75f), RoundedCornerShape(18.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(18.dp))
            .padding(18.dp),
        content = content,
    )
}

@Composable
fun Pill(text: String, tint: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = tint,
        fontFamily = FontFamily.Default,
        modifier = Modifier
            .background(tint.copy(alpha = 0.1f), RoundedCornerShape(999.dp))
            .border(1.dp, tint.copy(alpha = 0.28f), RoundedCornerShape(999.dp))
            .padding(horizontal = 11.dp, vertical = 6.dp),
    )
}
