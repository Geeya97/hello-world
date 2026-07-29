package au.com.refrigerationservices.weather

import au.com.refrigerationservices.weather.data.Recipients
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors server/test/recipients.test.js. If these two ever disagree the phone
 * would either nag about valid addresses or wave through invalid ones.
 */
class RecipientsTest {

    @Test
    fun `accepts addresses on the family domain`() {
        listOf(
            "dad@refrigerationservices.com.au",
            "jane.doe@refrigerationservices.com.au",
            "service+jobs@refrigerationservices.com.au",
            "DAD@REFRIGERATIONSERVICES.COM.AU",
            "  spaced@refrigerationservices.com.au  ",
        ).forEach { assertTrue("expected $it to be allowed", Recipients.isAllowed(it)) }
    }

    @Test
    fun `rejects everything else including lookalikes`() {
        listOf(
            "someone@gmail.com",
            "someone@refrigerationservices.com",
            "someone@refrigerationservices.com.au.evil.com",
            "someone@sub.refrigerationservices.com.au",
            "someone@notrefrigerationservices.com.au",
            "a@refrigerationservices.com.au, b@evil.com",
            "a@refrigerationservices.com.au;b@evil.com",
            "\"a@refrigerationservices.com.au\" <b@evil.com>",
            "@refrigerationservices.com.au",
            "refrigerationservices.com.au",
            "",
            null,
        ).forEach { assertFalse("expected $it to be rejected", Recipients.isAllowed(it)) }
    }

    @Test
    fun `header injection attempts are rejected`() {
        assertFalse(Recipients.isAllowed("a@refrigerationservices.com.au\nbcc: b@evil.com"))
    }

    @Test
    fun `uses the exact wording the business asked for`() {
        val result = Recipients.check("stranger@gmail.com")
        assertTrue(result is Recipients.Result.Invalid)
        assertEquals(
            "This email is not one of your family member",
            (result as Recipients.Result.Invalid).error,
        )
    }

    @Test
    fun `blank input is a different problem to a wrong domain`() {
        val result = Recipients.check("   ")
        assertTrue(result is Recipients.Result.Invalid)
        assertEquals("Enter an email address first.", (result as Recipients.Result.Invalid).error)
    }

    @Test
    fun `accepted addresses are normalised`() {
        val result = Recipients.check("  Dad@Refrigerationservices.Com.Au ")
        assertTrue(result is Recipients.Result.Valid)
        assertEquals("dad@refrigerationservices.com.au", (result as Recipients.Result.Valid).email)
    }
}
