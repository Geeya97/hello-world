/**
 * Getting the current observation for Sunshine West, with fallbacks.
 *
 * BOM is the source the business asked for, so it is always tried first. But BOM
 * returns 403 to anything it judges automated, and refuses some networks and
 * datacentre IP ranges outright — confirmed in practice, not theoretical. A live
 * presentation cannot hinge on that.
 *
 * So the chain is:
 *   1. BOM (nearest station to Sunshine West, then two fallback stations)
 *   2. Open-Meteo for the same coordinates — still live, real weather
 *   3. A recorded BOM sample, only when DEMO_MODE is on
 *
 * Every step labels its own source, so a fallback report can never be mistaken
 * for a Bureau reading. `fallbackFrom` is set when step 1 failed, which the UI
 * surfaces so you know to mention it rather than being caught out.
 */

import { fetchSunshineWestObservation, SUNSHINE_WEST } from './bom.js';
import { fetchWeatherAt } from './openmeteo.js';
import { DEMO_MODE, demoObservation } from './demo.js';

/** Set BOM_FALLBACK=0 to fail loudly instead of falling back. */
const FALLBACK_ENABLED = process.env.BOM_FALLBACK !== '0';

/**
 * @returns {Promise<object>} a normalised observation, from whichever source worked
 */
export async function currentHomeObservation(options = {}) {
  if (DEMO_MODE) return demoObservation();

  try {
    return await fetchSunshineWestObservation(options);
  } catch (bomError) {
    if (!FALLBACK_ENABLED) throw bomError;

    try {
      const observation = await fetchWeatherAt(SUNSHINE_WEST, null, options);
      return {
        ...observation,
        source: 'Open-Meteo (Bureau of Meteorology unavailable)',
        fallbackFrom: 'bom',
        fallbackReason: bomError.message,
      };
    } catch (fallbackError) {
      // Report the original BOM failure — that is the one worth acting on — but
      // mention that the backup failed too, so the cause isn't misdiagnosed.
      const err = new Error(
        `${bomError.message}. The Open-Meteo fallback also failed: ${fallbackError.message}`,
      );
      err.cause = bomError;
      throw err;
    }
  }
}

export { DEMO_MODE };
