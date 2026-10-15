// Helpers shared by print-day.js and print-recipes.js. Import with:
//   import { addDays, longDate, cap, linesTable, servingsText } from "/print-util.js";
import { escape } from "/lib.js";

/** Adds days to a YYYY-MM-DD date (UTC, so no daylight-saving surprises). */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Friday 14 November" for a YYYY-MM-DD date. */
export function longDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** Upper-cases the first letter of a slot name ("brunch" -> "Brunch"). */
export function cap(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** "Main 19 · Vegan 3" for a list of versions. */
export function servingsText(versions) {
  return versions.map((v) => `${escape(v.label)} ${v.servings}`).join(" · ");
}

/** Two-column table of scaled ingredients for one version: name (with prep note) and amount. */
export function linesTable(lines) {
  if (!lines.length) return "";
  const rows = lines
    .map((l) => {
      const prep = l.prep_note ? `<span class="prep">, ${escape(l.prep_note)}</span>` : "";
      return `<tr><td>${escape(l.name)}${prep}</td><td class="num">${escape(l.display)}</td></tr>`;
    })
    .join("");
  return `<table class="lines"><tbody>${rows}</tbody></table>`;
}

/** "Fri 14 Nov" for a YYYY-MM-DD date: fits the toolbar on a phone. */
export function shortDate(day) {
  return new Date(`${day}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(",", "");
}
