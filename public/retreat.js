import { api, escape, qs, toast } from "/lib.js";
import { fetchSuggestions } from "/jev.js";

const app = document.getElementById("app");
const id = qs("id");
let retreat = null;
let recipes = null; // loaded the first time a picker opens

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (date) => dayFmt.format(new Date(date)).replace(",", "");
const SLOTS = ["brunch", "snacks", "dinner"];
// Same keys and labels as DIETS in src/lib/diets.ts.
const DIETS = [
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["gluten_free", "Gluten-free"],
  ["dairy_free", "Dairy-free"],
  ["nut_free", "Nut-free"],
];
const dietLabel = (key) => DIETS.find(([k]) => k === key)?.[1] ?? key;

// ---- rendering ------------------------------------------------------------

function render() {
  const r = retreat;
  // Keep the dietary list's sections open across re-renders.
  const open = new Set([...app.querySelectorAll("details[data-keep][open]")].map((d) => d.dataset.keep));
  document.title = `${r.name} · Kitchen King`;
  app.innerHTML = `
    <section class="card">
      <h2>${escape(r.name)}</h2>
      <p class="muted">${escape(dayLabel(r.start_date))} – ${escape(dayLabel(r.end_date))} · ${r.headcount} people · ${r.buffer_percent}% buffer</p>
      <p class="row">
        <a class="button" href="/orders.html?retreat=${r.id}">Order lists</a>
        <a class="button secondary" href="/retreats.html">All retreats</a>
      </p>
      <details>
        <summary>Edit retreat</summary>
        <form id="edit-form">
          <label>Name</label><input name="name" required value="${escape(r.name)}">
          <label>First day</label><input name="start_date" type="date" required value="${r.start_date}">
          <label>Last day</label><input name="end_date" type="date" required value="${r.end_date}">
          <label>People</label><input name="headcount" type="number" inputmode="numeric" min="1" max="200" required value="${r.headcount}">
          <label>Buffer %</label><input name="buffer_percent" type="number" inputmode="numeric" min="0" max="100" required value="${r.buffer_percent}">
          <p class="row"><button type="submit">Save</button><button type="button" class="danger" data-action="delete-retreat">Delete retreat</button></p>
        </form>
      </details>
    </section>
    ${renderDiets(open)}
    ${r.days.map(renderDay).join("")}`;
}

function renderDiets(open) {
  const r = retreat;
  const summary = r.diet_counts.length
    ? r.diet_counts.map((d) => `<span class="badge">${d.count} ${escape(d.label.toLowerCase())}</span>`).join("")
    : `<span class="muted">Nobody listed yet. Add the people with dietary needs and dishes will get the right versions.</span>`;
  const over = r.guest_total > r.headcount
    ? `<p class="warn">The list has ${r.guest_total} people but the retreat is set for ${r.headcount}.</p>`
    : "";
  return `
    <section class="card" id="diets">
      <h2>Dietary needs</h2>
      <p>${summary}</p>
      ${over}
      <details data-keep="people"${open.has("people") ? " open" : ""}>
        <summary>People (${r.guests.length})</summary>
        ${r.guests.map((g) => renderGuest(g, open)).join("")}
        <form class="guest" id="add-guest">
          <strong>Add someone</strong>
          ${guestFields({ name: "", count: 1, diets: [], note: "" }, "new")}
          <p class="row"><button type="submit">Add</button></p>
        </form>
      </details>
      <details data-keep="paste"${open.has("paste") ? " open" : ""}>
        <summary>Paste a list</summary>
        <p class="muted">One person per line, like "Tom - vegan", "Sam: gluten free, no mushrooms" or "3 dairy free". Names are optional.</p>
        <textarea id="guest-paste" aria-label="Pasted list"></textarea>
        <label class="inline"><input type="checkbox" id="guest-replace"> Replace the current list</label>
        <p class="row"><button class="secondary" data-action="preview-guests">Check list</button></p>
        <div id="guest-preview"></div>
      </details>
    </section>`;
}

/** Name, count, diet ticks and note. Rows on the list save as soon as a field changes. */
function guestFields(g, key) {
  const named = Boolean(g.name);
  return `
    <div class="row">
      <input data-guest="name" value="${escape(g.name ?? "")}" placeholder="Name (optional)" aria-label="Name" class="grow">
      <label class="inline${named ? " hidden" : ""}">× <input data-guest="count" type="number" inputmode="numeric" min="1" max="200" value="${g.count}" aria-label="How many people"></label>
    </div>
    <div class="diet-picks">
      ${DIETS.map(
        ([k, label]) =>
          `<label class="inline"><input type="checkbox" data-guest="diet" value="${k}"${g.diets.includes(k) ? " checked" : ""} id="diet-${key}-${k}"> ${label}</label>`,
      ).join("")}
    </div>
    <input data-guest="note" value="${escape(g.note ?? "")}" placeholder="Anything else (no mushrooms, allergies…)" aria-label="Note">`;
}

function renderGuest(g, open) {
  const key = `guest-${g.id}`;
  return `
    <details class="guest" data-guest-id="${g.id}" data-keep="${key}"${open.has(key) ? " open" : ""}>
      <summary>${describeGuest(g)}</summary>
      ${guestFields(g, g.id)}
      <p class="row"><button class="linklike" data-action="delete-guest">Remove from the list</button></p>
    </details>`;
}

/** Reads a guest's fields from its row or form. */
function readGuest(el) {
  const name = el.querySelector("[data-guest=name]").value.trim();
  return {
    name: name || null,
    count: name ? 1 : Number(el.querySelector("[data-guest=count]").value || 1),
    diets: [...el.querySelectorAll("[data-guest=diet]:checked")].map((c) => c.value),
    note: el.querySelector("[data-guest=note]").value.trim() || null,
  };
}

function describeGuest(g) {
  const who = g.name ? escape(g.name) : `${g.count} ${g.count === 1 ? "person" : "people"}`;
  const needs = [...g.diets.map(dietLabel), ...(g.note ? [g.note] : [])].map(escape).join(", ");
  return `${who} · ${needs}`;
}

let pendingImport = null; // what "Check list" read, waiting for the chef to confirm

async function previewGuests() {
  const text = document.getElementById("guest-paste").value;
  const box = document.getElementById("guest-preview");
  try {
    const result = await api(`/retreats/${id}/guests/import`, { method: "POST", body: { text, preview: true } });
    const replace = document.getElementById("guest-replace").checked;
    pendingImport = { text, replace };
    box.innerHTML = `
      ${result.guests.length ? `<ul>${result.guests.map((g) => `<li>${describeGuest(g)}</li>`).join("")}</ul>` : `<p class="warn">No dietary needs found in that list.</p>`}
      ${result.skipped.length ? `<p class="warn">Skipped (no dietary need found): ${result.skipped.map(escape).join(", ")}</p>` : ""}
      ${result.guests.length ? `<p class="row"><button data-action="import-guests">${replace ? "Replace the list with these" : `Add ${result.guests.length} to the list`}</button></p>` : ""}`;
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function renderDay(day) {
  return `
    <section class="card" data-date="${day.date}">
      <div class="spread">
        <h2>${escape(dayLabel(day.date))}</h2>
        <a class="no-print" href="/print-day.html?retreat=${retreat.id}&date=${day.date}">Print day sheet</a>
      </div>
      ${day.meals.map((m) => renderMeal(m, day.date)).join("")}
      <details>
        <summary>Add meal</summary>
        <div class="row">
          <select data-add-slot>${[...SLOTS, "other"].map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
          <input data-add-custom placeholder="Name (for other)">
          <button data-action="add-meal" data-date="${day.date}">Add</button>
        </div>
      </details>
    </section>`;
}

function renderMeal(m, date) {
  const dayOptions = retreat.days
    .map((d) => `<option value="${d.date}"${d.date === date ? " selected" : ""}>${escape(dayLabel(d.date))}</option>`)
    .join("");
  const slotOptions = [...new Set([m.slot, ...SLOTS])].map((s) => `<option value="${escape(s)}"${s === m.slot ? " selected" : ""}>${escape(s)}</option>`).join("");
  return `
    <div class="meal" data-meal-id="${m.id}">
      <div class="meal-head">
        <span class="slot">${escape(m.slot)}</span>
        <input data-field="time" value="${escape(m.time_label ?? "")}" placeholder="time" aria-label="Time for ${escape(m.slot)}">
      </div>
      <div class="people">
        <label for="people-${m.id}" style="margin:0">People</label>
        <input id="people-${m.id}" data-field="people" type="number" inputmode="numeric" min="1" max="200" value="${m.headcount ?? ""}" placeholder="${retreat.headcount}">
        ${m.headcount === null ? `<span class="muted">(retreat default)</span>` : `<button class="linklike" data-action="reset-people">reset to ${retreat.headcount}</button>`}
      </div>
      ${m.dishes.length ? m.dishes.map(renderDish).join("") : `<div class="suggestions" data-meal-id="${m.id}"><button class="secondary" data-action="suggest-dishes">Suggest dishes</button></div>`}
      <details data-picker>
        <summary>Add dish</summary>
        <input data-picker-search type="search" placeholder="Search recipes" aria-label="Search recipes">
        <ul class="picker-list"></ul>
      </details>
      <details>
        <summary>Move or delete</summary>
        <div class="row">
          <select data-move-date aria-label="Day">${dayOptions}</select>
          <select data-move-slot aria-label="Slot">${slotOptions}</select>
          <button class="secondary" data-action="move-meal">Move</button>
          <button class="danger" data-action="delete-meal">Delete meal</button>
        </div>
      </details>
    </div>`;
}

function renderDish(d) {
  const alts = d.available_alternatives
    .map((a) => {
      const set = d.alternatives.find((x) => x.alternative_id === a.id);
      return `<label>${escape(a.label)} <input data-field="alt" data-alt-id="${a.id}" type="number" inputmode="numeric" min="0" value="${set ? set.servings : ""}" placeholder="0"></label>`;
    })
    .join("");
  return `
    <div class="dish" data-dish-id="${d.id}">
      <div class="spread"><strong>${escape(d.title)}</strong><button class="linklike" data-action="delete-dish">Remove</button></div>
      <div class="versions">
        <label>Main <input data-field="main" type="number" inputmode="numeric" min="0" value="${d.servings ?? ""}" placeholder="${d.main_servings}"></label>
        ${alts}
      </div>
      ${d.servings === null ? `<div class="muted">Main is automatic (${d.main_servings}). Type a number to set it yourself.</div>` : `<button class="linklike" data-action="auto-main">Back to automatic</button>`}
      ${dishDietNote(d)}
    </div>`;
}

/** Where the version numbers come from, and anyone on the dietary list no version suits. */
function dishDietNote(d) {
  const hasList = retreat.guests.length > 0;
  let source = "";
  if (d.versions_from_guests && hasList && d.available_alternatives.length) source = `<div class="muted">Versions follow the dietary list.</div>`;
  if (!d.versions_from_guests && hasList) source = `<div class="muted">Versions set by you. <button class="linklike" data-action="versions-from-list">Use the dietary list</button></div>`;
  const missing = d.unmatched.length
    ? `<div class="warn">No version suits ${d.unmatched
        .map((g) => `${g.name ? escape(g.name) : `${g.count} ×`} (${g.diets.map(dietLabel).join(", ")})`)
        .join("; ")}. They're counted in Main.</div>`
    : "";
  return source + missing;
}

// ---- talking to the server ------------------------------------------------

/** Runs a request that answers with the whole retreat, then re-renders. */
async function update(path, method, body) {
  try {
    retreat = await api(path, { method, body });
    render();
  } catch (err) {
    toast(err.message, { error: true });
    await load(); // put the screen back in step with the server
  }
}

async function load() {
  try {
    retreat = await api(`/retreats/${id}`);
    render();
  } catch (err) {
    app.innerHTML = `<p class="warn">Could not load this retreat (${escape(err.message)}). <a href="/retreats.html">Back to retreats</a></p>`;
  }
}

const numberOrNull = (text) => (text.trim() === "" ? null : Number(text));

// ---- events ---------------------------------------------------------------

app.addEventListener("change", (e) => {
  const input = e.target;
  const guestRow = input.closest("[data-guest-id]");
  if (guestRow && input.dataset.guest) return update(`/retreats/guests/${guestRow.dataset.guestId}`, "PUT", readGuest(guestRow));
  if (input.closest("#add-guest") && input.dataset.guest === "name") {
    // A named person counts as one, so hide the count.
    input.closest("#add-guest").querySelector("[data-guest=count]").closest("label").classList.toggle("hidden", Boolean(input.value.trim()));
    return;
  }
  const field = input.dataset.field;
  if (!field) return;
  const mealId = input.closest(".meal")?.dataset.mealId;
  if (field === "time") return update(`/retreats/meals/${mealId}`, "PUT", { time_label: input.value });
  if (field === "people") return update(`/retreats/meals/${mealId}`, "PUT", { headcount: numberOrNull(input.value) });
  const dish = input.closest(".dish");
  const dishId = dish.dataset.dishId;
  if (field === "main") return update(`/retreats/dishes/${dishId}`, "PUT", { servings: numberOrNull(input.value) });
  if (field === "alt") {
    const alternatives = [...dish.querySelectorAll("[data-field=alt]")].map((el) => ({
      alternative_id: Number(el.dataset.altId),
      servings: Number(el.value || 0),
    }));
    return update(`/retreats/dishes/${dishId}`, "PUT", { alternatives });
  }
});

app.addEventListener("input", (e) => {
  if (e.target.matches("[data-picker-search]")) fillPicker(e.target.closest("[data-picker]"));
});

// Loads the recipe list once, when the first picker opens.
app.addEventListener(
  "toggle",
  async (e) => {
    const picker = e.target;
    if (!picker.matches?.("[data-picker]") || !picker.open) return;
    if (!recipes) {
      try {
        recipes = await api("/recipes");
      } catch (err) {
        return toast(err.message, { error: true });
      }
    }
    fillPicker(picker);
    picker.querySelector("[data-picker-search]").focus();
  },
  true,
);

function fillPicker(picker) {
  const term = picker.querySelector("[data-picker-search]").value.trim().toLowerCase();
  const matches = (recipes ?? []).filter((r) => r.title.toLowerCase().includes(term)).slice(0, 30);
  picker.querySelector(".picker-list").innerHTML = matches.length
    ? matches.map((r) => `<li><button data-action="pick-recipe" data-recipe-id="${r.id}">${escape(r.title)}</button></li>`).join("")
    : `<li class="muted">${recipes?.length ? "No recipe matches." : "No recipes yet."}</li>`;
}

app.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const meal = button.closest(".meal");
  const mealId = meal?.dataset.mealId;
  const dishId = button.closest(".dish")?.dataset.dishId;

  if (action === "pick-recipe") return update(`/retreats/meals/${mealId}/dishes`, "POST", { recipe_id: Number(button.dataset.recipeId) });
  if (action === "suggest-dishes") {
    // Asked only when the chef taps, one meal at a time. Each suggestion is a button that adds the dish.
    const box = button.closest(".suggestions");
    button.disabled = true;
    button.textContent = "Asking Jev…";
    try {
      const list = await fetchSuggestions(mealId);
      box.innerHTML = list.length
        ? `<div class="row">${list
            .slice(0, 3)
            .map((s) => `<button class="secondary" data-action="pick-recipe" data-recipe-id="${s.recipe_id}">＋ ${escape(s.title)}</button>`)
            .join("")}</div>`
        : `<p class="muted">No recipes fit this meal yet.</p>`;
    } catch (err) {
      toast(err.message, { error: true });
      button.disabled = false;
      button.textContent = "Suggest dishes";
    }
    return;
  }
  if (action === "delete-guest") return update(`/retreats/guests/${button.closest("[data-guest-id]").dataset.guestId}`, "DELETE");
  if (action === "preview-guests") return previewGuests();
  if (action === "import-guests") {
    if (!pendingImport) return;
    const { text, replace } = pendingImport;
    pendingImport = null;
    try {
      const result = await api(`/retreats/${id}/guests/import`, { method: "POST", body: { text, replace } });
      retreat = result;
      render();
      toast(replace ? "Dietary list replaced." : "Added to the dietary list.");
    } catch (err) {
      toast(err.message, { error: true });
    }
    return;
  }
  if (action === "versions-from-list") return update(`/retreats/dishes/${dishId}`, "PUT", { versions_from_guests: true });
  if (action === "delete-dish") return update(`/retreats/dishes/${dishId}`, "DELETE");
  if (action === "auto-main") return update(`/retreats/dishes/${dishId}`, "PUT", { servings: null });
  if (action === "reset-people") return update(`/retreats/meals/${mealId}`, "PUT", { headcount: null });
  if (action === "delete-meal") {
    if (confirm("Delete this meal and its dishes?")) update(`/retreats/meals/${mealId}`, "DELETE");
    return;
  }
  if (action === "move-meal") {
    return update(`/retreats/meals/${mealId}`, "PUT", {
      date: meal.querySelector("[data-move-date]").value,
      slot: meal.querySelector("[data-move-slot]").value,
    });
  }
  if (action === "add-meal") {
    const row = button.parentElement;
    const choice = row.querySelector("[data-add-slot]").value;
    const slot = choice === "other" ? row.querySelector("[data-add-custom]").value.trim() : choice;
    if (!slot) return toast("Type a name for this meal.", { error: true });
    return update(`/retreats/${id}/meals`, "POST", { date: button.dataset.date, slot });
  }
  if (action === "delete-retreat") {
    if (!confirm(`Delete "${retreat.name}" and its whole plan?`)) return;
    try {
      await api(`/retreats/${id}`, { method: "DELETE" });
      location.href = "/retreats.html";
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
});

app.addEventListener("submit", (e) => {
  if (e.target.id === "add-guest") {
    e.preventDefault();
    return update(`/retreats/${id}/guests`, "POST", readGuest(e.target));
  }
  if (e.target.id !== "edit-form") return;
  e.preventDefault();
  const data = new FormData(e.target);
  update(`/retreats/${id}`, "PUT", {
    name: data.get("name"),
    start_date: data.get("start_date"),
    end_date: data.get("end_date"),
    headcount: Number(data.get("headcount")),
    buffer_percent: Number(data.get("buffer_percent")),
  });
});

await load();
