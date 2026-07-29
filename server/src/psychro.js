/**
 * Psychrometric helpers.
 *
 * The important one is the wet bulb. BOM's observation feed publishes `delta_t`,
 * which is the wet-bulb *depression* (dry bulb minus wet bulb), so when it is
 * present we get a genuine BOM-derived wet bulb by subtraction rather than an
 * estimate. `delta_t` is frequently null at smaller stations, hence the fallback.
 */

/** Stull (2011) empirical wet-bulb approximation. T in degC, rh in percent. */
export function wetBulbStull(t, rh) {
  const term1 = t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659));
  const term2 = Math.atan(t + rh);
  const term3 = Math.atan(rh - 1.676331);
  const term4 = 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh);
  return term1 + term2 - term3 + term4 - 4.686035;
}

/**
 * Stull's fit is only published as accurate for roughly -20..50 degC and 5..99% RH
 * at standard pressure. Outside that we still return a number, but flag it so the
 * report can say the value is approximate rather than quietly implying precision.
 */
function stullInRange(t, rh) {
  return t >= -20 && t <= 50 && rh >= 5 && rh <= 99;
}

/**
 * Resolve a wet-bulb temperature from whatever the observation actually carries.
 *
 * @returns {{ celsius: number, method: string, approximate: boolean } | null}
 */
export function computeWetBulb({ airTemp, deltaT, relHum }) {
  if (isNum(airTemp) && isNum(deltaT)) {
    return {
      celsius: round1(airTemp - deltaT),
      method: 'BOM wet-bulb depression (delta_t)',
      approximate: false,
    };
  }

  if (isNum(airTemp) && isNum(relHum)) {
    return {
      celsius: round1(wetBulbStull(airTemp, relHum)),
      method: 'Stull (2011) from dry bulb + relative humidity',
      approximate: !stullInRange(airTemp, relHum),
    };
  }

  return null;
}

/** Magnus-Tetens dew point, used only when a source omits it. */
export function dewPointMagnus(t, rh) {
  const a = 17.625;
  const b = 243.04;
  const alpha = Math.log(rh / 100) + (a * t) / (b + t);
  return (b * alpha) / (a - alpha);
}

/** Relative humidity from dry bulb and dew point, for sources that omit RH. */
export function relativeHumidityFromDewPoint(t, td) {
  const a = 17.625;
  const b = 243.04;
  return 100 * (Math.exp((a * td) / (b + td)) / Math.exp((a * t) / (b + t)));
}

/** The wet-bulb depression, reported alongside the wet bulb for the fridgies. */
export function wetBulbDepression(airTemp, wetBulb) {
  if (!isNum(airTemp) || !isNum(wetBulb)) return null;
  return round1(airTemp - wetBulb);
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export { isNum, round1 };
