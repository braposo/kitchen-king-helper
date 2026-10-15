import { api, escape, icon, qs, toast, busy, confirmDialog } from "/lib.js";
import { fetchSuggestions } from "/jev.js";

const app = document.getElementById("app");
const id = qs("id");
let retreat = null;
let recipes = null; // loaded the first time a picker opens

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (date) => dayFmt.format(new Date(date)).replace(",", "");
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
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
  // Keep the open collapsibles open across re-renders.
  const open = new Set([...app.querySelectorAll("details[data-keep][open]")].map((d) => d.dataset.keep));
  document.title = `${r.name} · Kitchen King`;
  const range = r.start_date === r.end_date ? shortFmt.format(new Date(r.start_date)) : `${shortFmt.format(new Date(r.start_date))} – ${shortFmt.format(new Date(r.end_date))}`;
  app.innerHTML = `
    <div class="page-header">
      <div>
        <a class="back-link" href="/retreats.html">${icon("chevron-left")}Retreats</a>
        <h1>${escape(r.name)}</h1>
        <div class="meta-row" style="margin-top:0.5rem">
          <span>${icon("calendar")}${escape(range)}</span>
          <span>${icon("users")}${r.headcount} people</span>
          <span>${r.buffer_percent}% extra food</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="/orders.html?retreat=${r.id}">${icon("shopping-basket")}Order lists</a>
        <a class="btn btn-outline" href="/print-recipes.html?retreat=${r.id}">${icon("book-open")}Recipe cards</a>
      </div>
    </div>
    <section class="card card-tight">
      <details class="collapsible" data-keep="edit"${open.has("edit") ? " open" : ""}>
        <summary><span class="summary-label">${icon("pencil")}Edit retreat</span></summary>
        <div class="collapsible-body">
          <form id="edit-form">
            <div class="field"><label for="edit-name">Name</label><input id="edit-name" name="name" required value="${escape(r.name)}"></div>
            <div class="grid-2">
              <div class="field"><label for="edit-start">First day</label><input id="edit-start" name="start_date" type="date" required value="${r.start_date}"></div>
              <div class="field"><label for="edit-end">Last day</label><input id="edit-end" name="end_date" type="date" required value="${r.end_date}"></div>
            </div>
            <div class="grid-2">
              <div class="field"><label for="edit-people">People</label><input id="edit-people" name="headcount" type="number" inputmode="numeric" min="1" max="200" required value="${r.headcount}"></div>
              <div class="field"><label for="edit-buffer">Extra food</label><div class="input-group"><input id="edit-buffer" name="buffer_percent" type="number" inputmode="numeric" min="0" max="100" required value="${r.buffer_percent}"><span class="input-addon">%</span></div></div>
            </div>
            <div class="actions spread">
              <button type="submit" class="btn">Save</button>
              <button type="button" class="btn btn-ghost-destructive" data-action="delete-retreat">${icon("trash-2")}Delete retreat</button>
            </div>
          </form>
        </div>
      </details>
    </section>
    ${renderDiets(open)}
    ${r.days.map((d) => renderDay(d, open)).join("")}`;
}

function renderDiets(open) {
  const r = retreat;
  const description = r.guests.length
    ? `${plural(r.guest_total, "person", "people")} on the list, so dishes get the right versions.`
    : "Nobody listed yet. Add the people with dietary needs and dishes will get the right versions.";
  const summary = r.diet_counts.length
    ? `<div class="badges">${r.diet_counts.map((d) => `<span class="badge badge-secondary">${d.count} ${escape(d.label.toLowerCase())}</span>`).join("")}</div>`
    : "";
  const over = r.guest_total > r.headcount
    ? `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">More people than the retreat</p><p class="alert-description">The list has ${r.guest_total} people but the retreat is set for ${r.headcount}.</p></div>`
    : "";
  return `
    <section class="card" id="diets">
      <div class="card-header">
        <div>
          <h2 class="card-title">Dietary needs</h2>
          <p class="card-description">${description}</p>
        </div>
      </div>
      ${summary}
      ${over}
      <div class="accordion">
        <details class="collapsible" data-keep="people"${open.has("people") ? " open" : ""}>
          <summary><span class="summary-label">${icon("users")}People</span><span class="summary-meta">${r.guests.length}</span></summary>
          <div class="collapsible-body">
            <div class="guest-list">${r.guests.map((g) => renderGuest(g, open)).join("")}</div>
            <form id="add-guest">
              <span class="form-title">Add someone</span>
              ${guestFields({ name: "", count: 1, diets: [], note: "" }, "new")}
              <div><button type="submit" class="btn btn-sm">${icon("user-plus")}Add to the list</button></div>
            </form>
          </div>
        </details>
        <details class="collapsible" data-keep="paste"${open.has("paste") ? " open" : ""}>
          <summary><span class="summary-label">${icon("clipboard-paste")}Paste a list</span></summary>
          <div class="collapsible-body">
            <div class="field">
              <label for="guest-paste">Pasted list</label>
              <textarea id="guest-paste" placeholder="Tom - vegan&#10;Sam: gluten free, no mushrooms&#10;3 dairy free"></textarea>
              <p class="field-description">One person per line. Names are optional.</p>
            </div>
            <div class="actions spread">
              <label class="check"><input type="checkbox" id="guest-replace"> Replace the current list</label>
              <button class="btn btn-outline btn-sm" data-action="preview-guests">Check list</button>
            </div>
            <div id="guest-preview"></div>
          </div>
        </details>
      </div>
    </section>`;
}

/** Name, count, diet ticks and note. Rows on the list save as soon as a field changes. */
function guestFields(g, key) {
  const named = Boolean(g.name);
  return `
    <div class="fields">
      <input data-guest="name" value="${escape(g.name ?? "")}" placeholder="Name (optional)" aria-label="Name" autocomplete="off">
      <div class="input-group count-wrap${named ? " hidden" : ""}"><input data-guest="count" type="number" inputmode="numeric" min="1" max="200" value="${g.count}" aria-label="How many people"><span class="input-addon">people</span></div>
    </div>
    <div class="toggle-group">
      ${DIETS.map(
        ([k, label]) =>
          `<label class="toggle"><input type="checkbox" data-guest="diet" value="${k}"${g.diets.includes(k) ? " checked" : ""} id="diet-${key}-${k}">${label}</label>`,
      ).join("")}
    </div>
    <input data-guest="note" value="${escape(g.note ?? "")}" placeholder="Anything else (no mushrooms, allergies…)" aria-label="Note" autocomplete="off">`;
}

function renderGuest(g, open) {
  const key = `guest-${g.id}`;
  const who = g.name ? escape(g.name) : plural(g.count, "person", "people");
  const needs = [...g.diets.map(dietLabel), ...(g.note ? [g.note] : [])].map(escape).join(", ");
  return `
    <details class="collapsible guest" data-guest-id="${g.id}" data-keep="${key}"${open.has(key) ? " open" : ""}>
      <summary><span class="g-main"><span>${who}</span><span class="g-needs">${needs || "No dietary need"}</span></span></summary>
      <div class="guest-body">
        ${guestFields(g, g.id)}
        <div class="guest-actions"><button type="button" class="btn btn-ghost-destructive btn-sm" data-action="delete-guest">${icon("trash-2")}Remove from the list</button></div>
      </div>
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
      ${result.guests.length ? `<ul>${result.guests.map((g) => `<li>${describeGuest(g)}</li>`).join("")}</ul>` : `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">No dietary needs found in that list</p></div>`}
      ${result.skipped.length ? `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">Skipped, no dietary need found</p><p class="alert-description">${result.skipped.map(escape).join(", ")}</p></div>` : ""}
      ${result.guests.length ? `<div><button class="btn btn-sm" data-action="import-guests">${replace ? "Replace the list with these" : `Add ${result.guests.length} to the list`}</button></div>` : ""}`;
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function renderDay(day, open) {
  const dishes = day.meals.reduce((n, m) => n + m.dishes.length, 0);
  return `
    <section class="card day-card" data-date="${day.date}">
      <div class="card-header">
        <div>
          <h2 class="card-title day-title">${escape(dayLabel(day.date))}</h2>
          <p class="card-description">${plural(day.meals.length, "meal", "meals")} · ${plural(dishes, "dish", "dishes")}</p>
        </div>
        <a class="btn btn-outline btn-sm no-print" href="/print-day.html?retreat=${retreat.id}&date=${day.date}">${icon("printer")}Day sheet</a>
      </div>
      ${day.meals.map((m) => renderMeal(m, day.date, open)).join("")}
      <details class="collapsible add-meal" data-keep="add-meal-${day.date}"${open.has(`add-meal-${day.date}`) ? " open" : ""}>
        <summary><span class="summary-label">${icon("plus")}Add meal</span></summary>
        <div class="collapsible-body">
          <div class="add-meal-row">
            <select data-add-slot aria-label="Meal">${[...SLOTS, "other"].map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
            <input class="grow hidden" data-add-custom placeholder="Name of the meal" aria-label="Name of the meal">
            <button class="btn btn-sm" data-action="add-meal" data-date="${day.date}">Add</button>
          </div>
        </div>
      </details>
    </section>`;
}

function renderMeal(m, date, open) {
  const dayOptions = retreat.days
    .map((d) => `<option value="${d.date}"${d.date === date ? " selected" : ""}>${escape(dayLabel(d.date))}</option>`)
    .join("");
  const slotOptions = [...new Set([m.slot, ...SLOTS])].map((s) => `<option value="${escape(s)}"${s === m.slot ? " selected" : ""}>${escape(s)}</option>`).join("");
  const people = m.headcount ?? retreat.headcount;
  const toolsKey = `meal-${m.id}`;
  return `
    <div class="meal" data-meal-id="${m.id}">
      <div class="meal-head">
        <div>
          <h3 class="meal-name">${escape(m.slot)}</h3>
          <p class="meal-sub">${plural(people, "person", "people")}${m.headcount === null ? "" : " (changed)"}</p>
        </div>
        <div class="meal-time"><input data-field="time" value="${escape(m.time_label ?? "")}" placeholder="Time" aria-label="Time for ${escape(m.slot)}" autocomplete="off"></div>
      </div>
      ${
        m.dishes.length
          ? `<div class="dishes">${m.dishes.map(renderDish).join("")}</div>`
          : `<div class="suggestions" data-meal-id="${m.id}"><p class="meal-empty">No dishes yet.</p><button class="btn btn-outline btn-sm" data-action="suggest-dishes">${icon("sparkles")}Suggest dishes</button></div>`
      }
      <div class="meal-tools">
        <details class="collapsible" data-picker>
          <summary><span class="summary-label">${icon("plus")}Add dish</span></summary>
          <div class="collapsible-body">
            <div class="input-icon">${icon("search")}<input data-picker-search type="search" placeholder="Search recipes" aria-label="Search recipes" autocomplete="off"></div>
            <ul class="picker-list item-list"></ul>
          </div>
        </details>
        <details class="collapsible" data-keep="${toolsKey}"${open.has(toolsKey) ? " open" : ""}>
          <summary><span class="summary-label">${icon("ellipsis")}Meal options</span></summary>
          <div class="collapsible-body">
            <div class="tool-block">
              <div class="field">
                <label for="people-${m.id}">People at this meal</label>
                <div class="input-group"><input id="people-${m.id}" data-field="people" type="number" inputmode="numeric" min="1" max="200" value="${m.headcount ?? ""}" placeholder="${retreat.headcount}"><span class="input-addon">people</span></div>
                <p class="field-description">${m.headcount === null ? "Using the retreat's number." : `The retreat has ${retreat.headcount}. <button class="btn btn-link" data-action="reset-people">Reset to ${retreat.headcount}</button>`}</p>
              </div>
            </div>
            <div class="tool-block">
              <div class="grid-2">
                <div class="field"><label>Day</label><select data-move-date aria-label="Day">${dayOptions}</select></div>
                <div class="field"><label>Meal</label><select data-move-slot aria-label="Slot">${slotOptions}</select></div>
              </div>
              <div class="spread">
                <button class="btn btn-outline btn-sm" data-action="move-meal">Move meal</button>
                <button class="btn btn-ghost-destructive btn-sm" data-action="delete-meal">${icon("trash-2")}Delete meal</button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>`;
}

function renderDish(d) {
  const alts = d.available_alternatives
    .map((a) => {
      const set = d.alternatives.find((x) => x.alternative_id === a.id);
      return `<div class="ver"><label for="alt-${d.id}-${a.id}" title="${escape(a.label)}">${escape(a.label)}</label><input id="alt-${d.id}-${a.id}" data-field="alt" data-alt-id="${a.id}" type="number" inputmode="numeric" min="0" value="${set ? set.servings : ""}" placeholder="0"></div>`;
    })
    .join("");
  return `
    <div class="dish" data-dish-id="${d.id}">
      <div class="dish-head">
        <span class="dish-title">${escape(d.title)}</span>
        <button class="btn btn-ghost btn-icon btn-sm" data-action="delete-dish" aria-label="Remove ${escape(d.title)}" title="Remove">${icon("x")}</button>
      </div>
      <div class="versions">
        <div class="ver"><label for="main-${d.id}">Main${d.servings === null ? ` <span class="auto">auto</span>` : ""}</label><input id="main-${d.id}" data-field="main" type="number" inputmode="numeric" min="0" value="${d.servings ?? ""}" placeholder="${d.main_servings}"></div>
        ${alts}
      </div>
      ${dishNotes(d)}
    </div>`;
}

/** Notes under a dish, only when something differs from the automatic plan. */
function dishNotes(d) {
  const notes = (d.servings === null ? "" : `<span>Main set by you. <button class="btn btn-link" data-action="auto-main">Back to automatic</button></span>`) + dishDietNote(d);
  return notes ? `<div class="dish-notes">${notes}</div>` : "";
}

/** Where the version numbers come from, and anyone on the dietary list no version suits. */
function dishDietNote(d) {
  const hasList = retreat.guests.length > 0;
  let source = "";
  if (!d.versions_from_guests && hasList) source = `<span>Versions set by you. <button class="btn btn-link" data-action="versions-from-list">Use the dietary list</button></span>`;
  const missing = d.unmatched.length
    ? `<span class="warn">${icon("circle-alert")}<span>No version suits ${d.unmatched
        .map((g) => `${g.name ? escape(g.name) : `${g.count} ×`} (${g.diets.map(dietLabel).join(", ")})`)
        .join("; ")}. They're counted in Main.</span></span>`
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
    app.innerHTML = `
      <a class="back-link" href="/retreats.html">${icon("chevron-left")}Retreats</a>
      <div class="alert alert-destructive">${icon("circle-alert")}<p class="alert-title">Couldn't load this retreat</p><p class="alert-description">${escape(err.message)}</p></div>`;
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
    input.closest("#add-guest").querySelector(".count-wrap").classList.toggle("hidden", Boolean(input.value.trim()));
    return;
  }
  if (input.matches("[data-add-slot]")) {
    // The name box only matters for "other".
    input.closest(".add-meal-row").querySelector("[data-add-custom]").classList.toggle("hidden", input.value !== "other");
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
    ? matches.map((r) => `<li><button class="item" data-action="pick-recipe" data-recipe-id="${r.id}"><span class="item-content"><span class="item-title">${escape(r.title)}</span></span>${icon("plus")}</button></li>`).join("")
    : `<li class="picker-empty">${recipes?.length ? "No recipe matches." : "No recipes yet."}</li>`;
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
    try {
      await busy(button, async () => {
        const list = await fetchSuggestions(mealId);
        box.innerHTML = list.length
          ? `<div class="badges">${list
              .slice(0, 3)
              .map((s) => `<button class="btn btn-secondary btn-sm" data-action="pick-recipe" data-recipe-id="${s.recipe_id}">${icon("plus")}${escape(s.title)}</button>`)
              .join("")}</div>`
          : `<p class="meal-empty">No recipes fit this meal yet.</p>`;
      });
    } catch (err) {
      toast(err.message, { error: true });
    }
    return;
  }
  if (action === "delete-guest") return update(`/retreats/guests/${button.closest("[data-guest-id]").dataset.guestId}`, "DELETE");
  if (action === "preview-guests") return busy(button, previewGuests);
  if (action === "import-guests") {
    if (!pendingImport) return;
    const { text, replace } = pendingImport;
    pendingImport = null;
    try {
      const result = await busy(button, () => api(`/retreats/${id}/guests/import`, { method: "POST", body: { text, replace } }));
      retreat = result;
      render();
      toast(replace ? "Dietary list replaced." : "Added to the dietary list.");
    } catch (err) {
      toast(err.message, { error: true });
    }
    return;
  }
  if (action === "versions-from-list") return update(`/retreats/dishes/${dishId}`, "PUT", { versions_from_guests: true });
  if (action === "delete-dish") {
    const title = button.closest(".dish").querySelector(".dish-title").textContent;
    const ok = await confirmDialog({ title: "Remove this dish?", description: `${title} comes off this meal. The order lists update.`, confirm: "Remove" });
    if (ok) await update(`/retreats/dishes/${dishId}`, "DELETE");
    return;
  }
  if (action === "auto-main") return update(`/retreats/dishes/${dishId}`, "PUT", { servings: null });
  if (action === "reset-people") return update(`/retreats/meals/${mealId}`, "PUT", { headcount: null });
  if (action === "delete-meal") {
    const ok = await confirmDialog({ title: "Delete this meal?", description: "The meal and its dishes are removed from the menu.", confirm: "Delete" });
    if (ok) await update(`/retreats/meals/${mealId}`, "DELETE");
    return;
  }
  if (action === "move-meal") {
    return update(`/retreats/meals/${mealId}`, "PUT", {
      date: meal.querySelector("[data-move-date]").value,
      slot: meal.querySelector("[data-move-slot]").value,
    });
  }
  if (action === "add-meal") {
    const row = button.closest(".add-meal-row");
    const choice = row.querySelector("[data-add-slot]").value;
    const slot = choice === "other" ? row.querySelector("[data-add-custom]").value.trim() : choice;
    if (!slot) return toast("Type a name for this meal.", { error: true });
    return update(`/retreats/${id}/meals`, "POST", { date: button.dataset.date, slot });
  }
  if (action === "delete-retreat") {
    const ok = await confirmDialog({ title: `Delete ${retreat.name}?`, description: "The whole menu plan and its order lists are removed. This can't be undone.", confirm: "Delete retreat" });
    if (!ok) return;
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
