package au.com.refrigerationservices.weather

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import au.com.refrigerationservices.weather.ui.WeatherApp
import au.com.refrigerationservices.weather.ui.theme.CurrentWeatherTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CurrentWeatherTheme {
                WeatherApp()
            }
        }
    }
}
