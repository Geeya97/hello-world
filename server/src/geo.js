/** Small geo helpers shared by the BOM and Open-Meteo paths. */

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** Initial great-circle bearing from `a` to `b`, as a 16-point compass label. */
export function bearingLabel(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((deg + 360) % 360) / 22.5) % 16];
}

/** Degrees to a 16-point compass label, for sources that give wind direction numerically. */
export function degreesToCompass(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
