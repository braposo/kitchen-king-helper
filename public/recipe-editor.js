// The recipe form shared by recipe.html and import.html.
//
// The chef thinks in totals for the whole recipe ("800 g tomatoes for 10 people"), so the
// lines editor shows amounts for the whole recipe in a friendly unit and converts to
// per-serving quantities in the ingredient's base unit when they save.
import { escape } from "/lib.js";

const ALL_UNITS = ["g", "kg", "ml", "l", "each"];
const UNITS_FOR = { g: ["g", "kg"], ml: ["ml", "l"], each: ["each"] };
const FACTOR = { g: 1, kg: 1000, ml: 1, l: 1000, each: 1 };
const BASE_OF = { g: "g", kg: "g", ml: "ml", l: "ml", each: "each" };
const CATEGORIES = ["brunch", "snack", "dinner", "side", "any"];

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/** A whole-recipe amount in base units to something friendly: 1500 g becomes 1.5 kg. */
export function friendly(totalBase, baseUnit) {
  const total = round(totalBase, 4);
  if (baseUnit === "g" && total >= 1000) return { amount: round(total / 1000, 3), unit: "kg" };
  if (baseUnit === "ml" && total >= 1000) return { amount: round(total / 1000, 3), unit: "l" };
  return { amount: round(total, 3), unit: baseUnit };
}

/** One shared <datalist> of ingredient names for every name box on the page. */
function ensureDatalist(ingredients) {
  let list = document.getElementById("ingredient-names");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "ingredient-names";
    document.body.append(list);
  }
  list.innerHTML = ingredients.map((i) => `<option value="${escape(i.name)}"></option>`).join("");
}

/**
 * Editor for a list of ingredient lines inside `root`.
 * Rows are { name, amount, unit, prep, storage, problem }.
 */
export function createLinesEditor(root, ingredients) {
  ensureDatalist(ingredients);
  const byName = new Map(ingredients.map((i) => [i.name.toLowerCase(), i]));
  root.innerHTML = `<div class="rows"></div><button type="button" class="secondary add">Add ingredient</button>`;
  const rows = root.querySelector(".rows");

  /** Updates the unit choices and "new" marker of one row from the name typed. */
  function refresh(el) {
    const known = byName.get(el.querySelector(".name").value.trim().toLowerCase());
    const unitSelect = el.querySelector(".unit");
    const choices = known ? UNITS_FOR[known.base_unit] : ALL_UNITS;
    const current = unitSelect.value || el.dataset.unit || choices[0];
    unitSelect.innerHTML = choices.map((u) => `<option${u === current ? " selected" : ""}>${u}</option>`).join("");
    if (!choices.includes(current)) unitSelect.value = choices[0];
    const isNew = !known && el.querySelector(".name").value.trim() !== "";
    el.querySelector(".new").hidden = !isNew;
    el.querySelector(".storage").hidden = !isNew;
  }

  function addRow(row = {}) {
    const el = document.createElement("div");
    el.className = row.problem ? "line warn" : "line";
    el.dataset.unit = row.unit ?? "";
    el.innerHTML = `
      <div class="row"><input class="name" list="ingredient-names" placeholder="Ingredient" aria-label="Ingredient" value="${escape(row.name)}"><span class="badge new" hidden>new</span></div>
      <div class="amt">
        <input class="amount" type="number" inputmode="decimal" step="any" min="0" placeholder="Amount" aria-label="Amount for the whole recipe" value="${escape(row.amount)}">
        <select class="unit" aria-label="Unit"></select>
      </div>
      <div class="extra">
        <input class="prep" placeholder="Prep note, e.g. finely diced" aria-label="Prep note" value="${escape(row.prep)}">
        <select class="storage" aria-label="Fresh or pantry" hidden><option value="pantry">pantry</option><option value="fresh">fresh</option></select>
        <button type="button" class="secondary remove" aria-label="Remove ingredient">Remove</button>
      </div>
      <p class="problem" ${row.problem ? "" : "hidden"}>${escape(row.problem)}</p>`;
    el.querySelector(".storage").value = row.storage ?? "pantry";
    refresh(el);
    // Touching the name, amount or unit means the chef has looked at the line.
    const clearProblem = () => {
      el.classList.remove("warn");
      el.querySelector(".problem").hidden = true;
    };
    el.querySelector(".name").addEventListener("input", () => {
      refresh(el);
      clearProblem();
    });
    el.querySelector(".amount").addEventListener("input", clearProblem);
    el.querySelector(".unit").addEventListener("change", clearProblem);
    el.querySelector(".remove").addEventListener("click", () => el.remove());
    rows.append(el);
    return el;
  }

  root.querySelector(".add").addEventListener("click", () => addRow().querySelector(".name").focus());

  const api = {
    /** Fills the editor from rows. */
    setRows(list) {
      rows.innerHTML = "";
      list.forEach((r) => addRow(r));
    },
    getRows() {
      return [...rows.children].map((el) => ({
        name: el.querySelector(".name").value,
        amount: el.querySelector(".amount").value,
        unit: el.querySelector(".unit").value,
        prep: el.querySelector(".prep").value,
        storage: el.querySelector(".storage").value,
      }));
    },
    /** Fills the editor from API lines (or parse drafts): { name, base_unit, quantity_per_serving, prep_note, problem? }. */
    setLines(lines, servings) {
      api.setRows(
        lines.map((l) => {
          const f = l.quantity_per_serving === null ? { amount: "", unit: l.base_unit } : friendly(l.quantity_per_serving * servings, l.base_unit);
          return { name: l.name, amount: f.amount, unit: f.unit, prep: l.prep_note ?? "", storage: l.storage ?? "pantry", problem: l.problem ?? "" };
        }),
      );
    },
    /** Lines ready to send to the API. Throws an Error the chef can read if one is incomplete. */
    getLines(servings) {
      const out = [];
      for (const r of api.getRows()) {
        const name = r.name.trim();
        if (!name && r.amount === "") continue;
        if (!name) throw new Error("A line has an amount but no ingredient name.");
        const amount = Number(r.amount);
        if (r.amount === "" || !Number.isFinite(amount) || amount < 0) throw new Error(`Enter an amount for ${name}.`);
        const known = byName.get(name.toLowerCase());
        const base = known ? known.base_unit : BASE_OF[r.unit];
        const perServing = round((amount * FACTOR[r.unit]) / servings, 6);
        const prep_note = r.prep.trim() || null;
        out.push(
          known
            ? { ingredient_id: known.id, quantity_per_serving: perServing, prep_note }
            : { name, base_unit: base, storage: r.storage, quantity_per_serving: perServing, prep_note },
        );
      }
      return out;
    },
  };
  return api;
}

/**
 * The whole recipe form: title, servings, category, method, notes, main lines and alternatives.
 * Returns { setRecipe(recipe), getRecipe() }.
 */
export function createRecipeForm(root, ingredients) {
  root.innerHTML = `
    <label for="f-title">Title</label>
    <input id="f-title" autocomplete="off">
    <div id="tags"></div>
    <div class="row">
      <div style="flex:1"><label for="f-servings">Servings</label><input id="f-servings" type="number" inputmode="numeric" min="1" step="1" value="1"></div>
      <div style="flex:1"><label for="f-category">Category</label>
        <select id="f-category"><option value=""></option>${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div>
    </div>
    <h2>Ingredients</h2>
    <p class="muted">Amounts are for the whole recipe, for the servings above.</p>
    <div id="f-main"></div>
    <h2>Method</h2>
    <textarea id="f-method" aria-label="Method"></textarea>
    <label for="f-notes">Notes</label>
    <textarea id="f-notes" style="min-height:80px"></textarea>
    <h2>Other versions</h2>
    <p class="muted">A vegan or gluten-free version has its own full ingredient list.</p>
    <div id="f-alts"></div>
    <button type="button" class="secondary" id="f-add-alt">Add a version</button>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const main = createLinesEditor($("f-main"), ingredients);
  const alts = [];

  function addAlternative(alt = {}) {
    const el = document.createElement("section");
    el.className = "card alt";
    el.innerHTML = `
      <label>Version name</label><input class="alt-label" placeholder="e.g. Vegan version" value="${escape(alt.label)}">
      <label>Notes</label><input class="alt-notes" value="${escape(alt.notes)}">
      <div class="alt-lines"></div>
      <div class="actions">
        <button type="button" class="secondary copy">Start from main version</button>
        <button type="button" class="secondary drop">Remove this version</button>
      </div>`;
    const editor = createLinesEditor(el.querySelector(".alt-lines"), ingredients);
    const entry = { el, id: alt.id ?? null, editor };
    if (alt.ingredients) editor.setLines(alt.ingredients, alt.servings);
    el.querySelector(".copy").addEventListener("click", () => {
      editor.setRows(main.getRows().map((r) => ({ ...r, problem: "" })));
    });
    el.querySelector(".drop").addEventListener("click", () => {
      if (!confirm("Remove this version?")) return;
      el.remove();
      alts.splice(alts.indexOf(entry), 1);
    });
    alts.push(entry);
    $("f-alts").append(el);
    return entry;
  }

  $("f-add-alt").addEventListener("click", () => addAlternative().el.querySelector(".alt-label").focus());

  return {
    /** recipe: { title, servings, category, method, notes, ingredients, alternatives } with API line shapes. */
    setRecipe(r) {
      $("f-title").value = r.title ?? "";
      $("f-servings").value = r.servings ?? 1;
      $("f-category").value = r.category ?? "";
      $("f-method").value = r.method ?? "";
      $("f-notes").value = r.notes ?? "";
      main.setLines(r.ingredients ?? [], r.servings ?? 1);
      $("f-alts").innerHTML = "";
      alts.length = 0;
      for (const a of r.alternatives ?? []) addAlternative({ ...a, servings: r.servings });
    },
    /** The request body for POST/PUT. Throws an Error the chef can read if something is missing. */
    getRecipe() {
      const title = $("f-title").value.trim();
      if (!title) throw new Error("Give the recipe a title.");
      const servings = Number($("f-servings").value);
      if (!Number.isInteger(servings) || servings < 1) throw new Error("Servings must be a whole number, 1 or more.");
      return {
        title,
        servings,
        category: $("f-category").value,
        method: $("f-method").value,
        notes: $("f-notes").value,
        ingredients: main.getLines(servings),
        alternatives: alts.map((a) => {
          const label = a.el.querySelector(".alt-label").value.trim();
          if (!label) throw new Error("Give each version a name, such as Vegan version.");
          const alt = { label, notes: a.el.querySelector(".alt-notes").value, ingredients: a.editor.getLines(servings) };
          if (a.id !== null) alt.id = a.id;
          return alt;
        }),
      };
    },
  };
}
