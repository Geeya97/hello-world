/**
 * The report formatter — the single source of truth for what a weather report
 * looks like. Every surface (web, Android, the Claude-space artifact) renders
 * from this same shape, and test/report.test.js pins the output so the three
 * cannot quietly drift apart.
 */

const WIDTH = 48;

/** Subject line for the email. */
export function buildSubject(obs) {
  const where = obs.location.suburb ?? obs.location.label;
  const when = obs.kind === 'current' ? 'Now' : `${obs.observedAt.dateLabel} ${obs.observedAt.timeLabel}`;
  const temp = fmt(obs.dryBulbC, '°C');
  return `Weather Dispatch — ${where} — ${when} — ${temp}`;
}

/** The creative fixed-width text report. */
export function buildTextReport(obs) {
  const L = [];
  // Nothing ambiguous-width goes inside the frame: characters like ☁ render one
  // column in a terminal and two in a browser, so no amount of padding keeps the
  // box square across every place this report gets read. Emoji live outside it.
  L.push('╔' + '═'.repeat(WIDTH) + '╗');
  L.push('║' + centre('C U R R E N T   W E A T H E R') + '║');
  L.push('║' + centre('D I S P A T C H') + '║');
  L.push('╚' + '═'.repeat(WIDTH) + '╝');
  L.push('   Prepared for the Refrigeration Services family');
  L.push('');
  L.push(`   📍 LOCATION   ${obs.location.label}`);
  if (obs.station) L.push(`      ${stationLine(obs)}`);
  L.push(`   📅 DATE       ${obs.observedAt.dateLabel}`);
  L.push(`   🕐 TIME       ${obs.observedAt.timeLabel} ${obs.observedAt.tzAbbr}`.trimEnd());
  L.push('');
  L.push(section('TEMPERATURES'));
  L.push(row('Dry bulb', fmt(obs.dryBulbC, ' °C')));
  L.push(row('Wet bulb', wetBulbValue(obs)));
  L.push(row('Dew point', fmt(obs.dewPointC, ' °C')));
  if (obs.apparentC !== null && obs.apparentC !== undefined) {
    L.push(row('Feels like', fmt(obs.apparentC, ' °C')));
  }
  L.push(section('MOISTURE'));
  L.push(row('Relative humidity', fmt(obs.relativeHumidityPct, ' %', 0)));
  L.push(section('AIR'));
  L.push(row('Wind', windValue(obs)));
  L.push(row('Pressure (MSL)', fmt(obs.pressureHpa, ' hPa')));
  if (obs.rainSince9amMm !== null && obs.rainSince9amMm !== undefined) {
    L.push(row(rainLabel(obs), fmt(obs.rainSince9amMm, ' mm')));
  }
  L.push('');
  L.push(`   "${quip(obs)}"`);
  L.push('');
  if (obs.wetBulbMethod) L.push(`   Wet bulb: ${obs.wetBulbMethod}.`);
  L.push(`   Source: ${obs.source}${obs.kind === 'current' ? '' : ` — ${kindLabel(obs.kind)}`}`);
  return L.join('\n');
}

/** Styled HTML for the email body; the text report is the plain-text alternative. */
export function buildHtmlReport(obs) {
  const rows = [
    ['Dry bulb', fmt(obs.dryBulbC, ' °C')],
    ['Wet bulb', wetBulbValue(obs)],
    ['Dew point', fmt(obs.dewPointC, ' °C')],
    ['Feels like', fmt(obs.apparentC, ' °C')],
    ['Relative humidity', fmt(obs.relativeHumidityPct, ' %', 0)],
    ['Wind', windValue(obs)],
    ['Pressure (MSL)', fmt(obs.pressureHpa, ' hPa')],
    [rainLabel(obs), fmt(obs.rainSince9amMm, ' mm')],
  ].filter(([, v]) => v !== '—');

  const tableRows = rows
    .map(
      ([k, v], i) => `
      <tr style="background:${i % 2 ? '#0f172a' : '#111c33'}">
        <td style="padding:10px 18px;color:#94a3b8;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif">${esc(k)}</td>
        <td style="padding:10px 18px;color:#e2e8f0;font:600 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;white-space:nowrap">${esc(v)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#060b16">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;border-radius:16px;overflow:hidden;border:1px solid #1e293b">
    <tr><td style="padding:26px 24px;background:linear-gradient(135deg,#0b1a33,#0e2947)">
      <div style="font:700 21px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0">&#9729;&#65039; Current Weather Dispatch</div>
      <div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#7dd3fc;margin-top:6px">Prepared for the Refrigeration Services family</div>
    </td></tr>
    <tr><td style="padding:20px 24px;background:#0b1425">
      <div style="font:600 16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0">&#128205; ${esc(obs.location.label)}</div>
      ${obs.station ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8;margin-top:4px">${esc(stationLine(obs))}</div>` : ''}
      <div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#94a3b8;margin-top:4px">&#128197; ${esc(obs.observedAt.dateLabel)} &nbsp;&bull;&nbsp; &#128336; ${esc(obs.observedAt.timeLabel)} ${esc(obs.observedAt.tzAbbr)}</div>
    </td></tr>
    <tr><td style="padding:0"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${tableRows}</table></td></tr>
    <tr><td style="padding:18px 24px;background:#0b1425">
      <div style="font:italic 14px/1.6 Georgia,serif;color:#fbbf24">&ldquo;${esc(quip(obs))}&rdquo;</div>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#060b16;border-top:1px solid #1e293b">
      ${obs.wetBulbMethod ? `<div style="font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b">Wet bulb: ${esc(obs.wetBulbMethod)}.</div>` : ''}
      <div style="font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#64748b">Source: ${esc(obs.source)}${obs.kind === 'current' ? '' : ` &mdash; ${esc(kindLabel(obs.kind))}`}</div>
    </td></tr>
  </table>
</body></html>`;
}

export function buildReport(obs) {
  return {
    subject: buildSubject(obs),
    text: buildTextReport(obs),
    html: buildHtmlReport(obs),
  };
}

// ---------------------------------------------------------------- helpers

function stationLine(obs) {
  const bits = [`Observed at ${obs.station.name}`];
  if (obs.station.id) bits.push(`BOM ${obs.station.id}`);
  if (obs.station.distanceKm !== null && obs.station.distanceKm !== undefined) {
    bits.push(`${obs.station.distanceKm} km ${obs.station.bearing ?? ''}`.trim());
  }
  return bits.join(' · ');
}

function wetBulbValue(obs) {
  if (obs.wetBulbC === null || obs.wetBulbC === undefined) return '—';
  let v = fmt(obs.wetBulbC, ' °C');
  if (obs.wetBulbDepressionC !== null && obs.wetBulbDepressionC !== undefined) {
    v += `   (Δt ${fmt(obs.wetBulbDepressionC, ' °C')})`;
  }
  if (obs.wetBulbApproximate) v += ' ≈';
  return v;
}

function windValue(obs) {
  if (obs.windSpeedKmh === null || obs.windSpeedKmh === undefined) return '—';
  const dir = obs.windDir ? `${obs.windDir} ` : '';
  let v = `${dir}${fmt(obs.windSpeedKmh, ' km/h', 0)}`;
  if (obs.gustKmh) v += ` (gust ${fmt(obs.gustKmh, '', 0)})`;
  return v;
}

function rainLabel(obs) {
  return obs.sourceKind === 'bom' ? 'Rain since 9am' : 'Precipitation';
}

function kindLabel(kind) {
  return kind === 'forecast' ? 'forecast' : kind === 'historical' ? 'historical record' : 'observation';
}

/** A little colour, chosen from the reading itself rather than at random. */
function quip(obs) {
  const t = obs.dryBulbC;
  const rh = obs.relativeHumidityPct;
  if (t === null || t === undefined) return 'Readings are thin on the ground right now.';
  if (t >= 35) return 'Scorcher. Every compressor in the west is earning its keep today.';
  if (t >= 28) return 'Warm one — good day to check those condenser coils.';
  if (t >= 20) return typeof rh === 'number' && rh >= 75
    ? 'Mild but sticky; the latent load is doing the heavy lifting.'
    : 'Comfortable out there. Enjoy it while it lasts.';
  if (t >= 12) return 'Mild Melbourne middle ground — four seasons still on the table.';
  if (t >= 6) return 'Cold enough to keep the coolroom honest.';
  return 'Proper cold. The coolroom is basically outdoors today.';
}

function section(title) {
  const line = `   ── ${title} `;
  return line + '─'.repeat(Math.max(0, WIDTH + 2 - line.length));
}

function row(label, value) {
  const dots = Math.max(1, 22 - label.length);
  return `      ${label} ${'.'.repeat(dots)} ${value}`;
}

/**
 * Terminal-style display width. Emoji and other wide glyphs occupy two columns
 * in a monospace font while counting as a single code point, so padding by
 * string length alone visibly skews the box frame.
 */
export function displayWidth(s) {
  let width = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) ||   // CJK radicals through Yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe6f) ||   // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) ||   // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) || // Misc symbols & pictographs, emoticons
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // Supplemental symbols & pictographs
    (cp >= 0x1fa70 && cp <= 0x1faff)    // Symbols & pictographs extended-A
  );
}

function centre(s) {
  const pad = WIDTH - displayWidth(s);
  const left = Math.floor(pad / 2);
  return ' '.repeat(Math.max(0, left)) + s + ' '.repeat(Math.max(0, pad - left));
}

function fmt(v, unit = '', dp = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(dp)}${unit}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
