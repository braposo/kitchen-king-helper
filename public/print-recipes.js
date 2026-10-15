import { api, escape, icon, qs, skeleton, toast } from "/lib.js";
import { addDays, cap, linesTable, longDate, servingsText, shortDate } from "/print-util.js";

const retreatId = qs("retreat");
let day = qs("date") || null;

const container = document.getElementById("cards");
const back = document.getElementById("back");
const dateLabel = document.getElementById("date");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const allBtn = document.getElementById("all");

back.href = `/retreat.html?id=${encodeURIComponent(retreatId ?? "")}`;
document.getElementById("print").addEventListener("click", () => window.print());
// With no date, the cards cover the whole retreat: "next" starts at the first day.
prevBtn.addEventListener("click", () => go(addDays(day, -1)));
nextBtn.addEventListener("click", () => go(day ? addDays(day, 1) : startDate));
allBtn.addEventListener("click", () => go(null));

let startDate = null;
let endDate = null;

/** Switches between one day and the whole retreat without a reload. */
function go(next) {
  day = next;
  const query = day ? `?retreat=${encodeURIComponent(retreatId)}&date=${day}` : `?retreat=${encodeURIComponent(retreatId)}`;
  history.replaceState(null, "", query);
  load();
}

function renderCard(card, first) {
  const when = [longDate(card.date), cap(card.slot), card.time_label].filter(Boolean).join(" · ");
  const versions = card.versions
    .map(
      (v) => `<section>
        <h3>${escape(v.label)} <span class="servings">${v.servings} ${v.servings === 1 ? "serving" : "servings"}</span></h3>
        ${linesTable(v.lines)}
      </section>`,
    )
    .join("");
  // Escape first, then keep the chef's line breaks.
  const method = card.method
    ? escape(card.method).replace(/\r?\n/g, "<br>")
    : `<span class="empty-text">No method recorded.</span>`;
  return `<article class="recipe-card${first ? "" : " page-break"}">
    <h2>${escape(card.title)}</h2>
    <p class="meta">${escape(when)} · ${servingsText(card.versions)}</p>
    ${versions}
    <h3>Method</h3>
    <p class="method">${method}</p>
  </article>`;
}

function setPicker() {
  dateLabel.textContent = day ? shortDate(day) : "All days";
  allBtn.hidden = !day;
  prevBtn.disabled = !day || addDays(day, -1) < startDate;
  nextBtn.disabled = day ? addDays(day, 1) > endDate : false;
}

async function load() {
  if (!retreatId) {
    container.innerHTML = `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">Open the recipe cards from a retreat day.</p></div>`;
    return;
  }
  container.innerHTML = skeleton(4);
  setPicker();
  try {
    const query = day ? `?date=${encodeURIComponent(day)}` : "";
    const data = await api(`/print/${encodeURIComponent(retreatId)}/recipes${query}`);
    startDate = data.retreat.start_date;
    endDate = data.retreat.end_date;
    setPicker();
    if (!data.cards.length) {
      container.innerHTML = `<p class="muted">No dishes planned${day ? " for this day" : ""}.</p>`;
      return;
    }
    container.innerHTML = data.cards.map((card, i) => renderCard(card, i === 0)).join("");
  } catch (err) {
    container.innerHTML = `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">Could not load the recipe cards (${escape(err.message)}).</p></div>`;
    toast(err.message, { error: true });
  }
}

load();
