# kotlinx.serialization keeps its generated serializers on the companion object;
# R8 will strip them without these rules and every API response fails to parse.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class au.com.refrigerationservices.weather.data.** {
    *** Companion;
}
-keepclasseswithmembers class au.com.refrigerationservices.weather.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class au.com.refrigerationservices.weather.data.**$$serializer { *; }

# OkHttp ships optional references to Conscrypt/BouncyCastle that are not present.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
