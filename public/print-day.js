import { api, escape, icon, qs, skeleton, toast } from "/lib.js";
import { addDays, cap, linesTable, longDate, servingsText, shortDate } from "/print-util.js";

const retreatId = qs("retreat");
let day = qs("date");

const sheet = document.getElementById("sheet");
const back = document.getElementById("back");
const cardsLink = document.getElementById("cards");
const dateLabel = document.getElementById("date");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");

back.href = `/retreat.html?id=${encodeURIComponent(retreatId ?? "")}`;
document.getElementById("print").addEventListener("click", () => window.print());
prevBtn.addEventListener("click", () => go(addDays(day, -1)));
nextBtn.addEventListener("click", () => go(addDays(day, 1)));

/** Moves to another day without a reload, keeping the URL in step so it can be bookmarked. */
function go(next) {
  day = next;
  history.replaceState(null, "", `?retreat=${encodeURIComponent(retreatId)}&date=${day}`);
  load();
}

const notice = (text) => `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">${escape(text)}</p></div>`;

function renderDish(dish) {
  const lines = dish.versions
    .map((v) => (dish.versions.length > 1 ? `<p class="ver">${escape(v.label)} · ${v.servings}</p>` : "") + linesTable(v.lines))
    .join("");
  return `<div class="dish">
    <h3>${escape(dish.title)} <span class="servings">${servingsText(dish.versions) || "no servings"}</span></h3>
    ${lines}
  </div>`;
}

function renderMeal(meal) {
  const when = [cap(meal.meal.slot), meal.time_label].filter(Boolean).join(" · ");
  return `<section class="meal">
    <div class="meal-head"><h2>${escape(when)}</h2><span class="meal-meta">${meal.people} people</span></div>
    ${meal.dishes.length ? meal.dishes.map(renderDish).join("") : `<p class="muted small" style="padding-top:0.75rem">No dishes yet.</p>`}
  </section>`;
}

function renderPrepAhead(meals, tomorrow) {
  const withDishes = meals.filter((m) => m.dishes.length);
  const items = withDishes
    .map(
      (m) => `<div>
        <h3>${escape(cap(m.slot))}</h3>
        <ul class="checks">${m.dishes
          .map((d) => `<li><span class="box" aria-hidden="true"></span><span>${escape(d.title)} <span class="servings">${servingsText(d.versions)}</span></span></li>`)
          .join("")}</ul>
      </div>`,
    )
    .join("");
  return `<section class="prep-ahead">
    <div class="meal-head"><h2>Prep ahead for tomorrow</h2><span class="meal-meta">${escape(longDate(tomorrow))}</span></div>
    ${items || `<p class="muted small" style="margin-top:0.5rem">Nothing planned for tomorrow.</p>`}
  </section>`;
}

/** Sets the day picker's label and disables the arrows that would leave the retreat. */
function setPicker(retreat) {
  dateLabel.textContent = shortDate(day);
  prevBtn.disabled = addDays(day, -1) < retreat.start_date;
  nextBtn.disabled = addDays(day, 1) > retreat.end_date;
  cardsLink.href = `/print-recipes.html?retreat=${encodeURIComponent(retreatId)}&date=${day}`;
}

async function load() {
  if (!retreatId || !day) {
    dateLabel.textContent = "No day chosen";
    prevBtn.disabled = nextBtn.disabled = true;
    sheet.innerHTML = notice("Open a day from the retreat page to see its sheet.");
    return;
  }
  sheet.innerHTML = skeleton(4);
  try {
    const data = await api(`/print/${encodeURIComponent(retreatId)}/day/${encodeURIComponent(day)}`);
    setPicker(data.retreat);
    const meals = data.meals.length ? data.meals.map(renderMeal).join("") : `<p class="muted">No meals planned for this day.</p>`;
    sheet.innerHTML = `<header class="sheet-head"><h1 class="sheet-title">${escape(longDate(data.date))}</h1><p class="sheet-subtitle">${escape(data.retreat.name)}</p></header>${meals}${renderPrepAhead(data.prep_ahead, addDays(data.date, 1))}`;
  } catch (err) {
    dateLabel.textContent = day;
    prevBtn.disabled = nextBtn.disabled = true;
    sheet.innerHTML = notice(`Could not load this sheet (${err.message}).`);
    toast(err.message, { error: true });
  }
}

load();
