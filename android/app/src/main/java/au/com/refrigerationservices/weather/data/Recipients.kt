package au.com.refrigerationservices.weather.data

/**
 * The recipient rule, ported from server/src/recipients.js.
 *
 * This copy exists so the UI can reject a bad address instantly without a round
 * trip. It is NOT the enforcement point — the server re-checks every address
 * before anything is sent. server/test/shared-rule.test.js fails if this port
 * drifts from the server's domain, wording or anchoring.
 */
object Recipients {

    const val ALLOWED_DOMAIN = "refrigerationservices.com.au"

    /** The exact message the business asked for when an address fails the rule. */
    const val REJECTION_MESSAGE = "This email is not one of your family member"

    /**
     * Anchored at both ends so a lookalike such as
     * `a@refrigerationservices.com.au.evil.com` cannot pass. The local part
     * excludes whitespace, `@`, commas and semicolons so a recipient list can
     * never be smuggled through as a single address.
     */
    private val ADDRESS = Regex(
        "^[^\\s@,;<>\"]+@refrigerationservices\\.com\\.au$",
        RegexOption.IGNORE_CASE,
    )

    fun isAllowed(email: String?): Boolean =
        email != null && ADDRESS.matches(email.trim())

    /** Validate and normalise, or explain the refusal. */
    fun check(email: String?): Result {
        val trimmed = email?.trim().orEmpty()
        return when {
            trimmed.isEmpty() -> Result.Invalid("Enter an email address first.")
            !isAllowed(trimmed) -> Result.Invalid(REJECTION_MESSAGE)
            else -> Result.Valid(trimmed.lowercase())
        }
    }

    sealed interface Result {
        data class Valid(val email: String) : Result
        data class Invalid(val error: String) : Result
    }
}
