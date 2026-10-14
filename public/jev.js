// Jev on the page: a recipe's category and diet tags, and dish suggestions for a meal.
// Everything here is best effort. A failed call shows a toast and never blocks saving.
import { api, escape, toast } from "/lib.js";

const CATEGORIES = ["brunch", "snack", "dinner", "side", "any"];
const DIET_TAGS = ["vegetarian", "vegan", "gluten_free", "dairy_free", "contains_nuts"];
const TAG_LABELS = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  contains_nuts: "Contains nuts",
};
const OFFLINE_NOTE = "Suggestions are rough guesses until the Jev key is added.";

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Whether Jev has its key. Asked once per page; a failed check counts as offline.
let liveCheck = null;
function jevLive() {
  liveCheck ??= api("/ai/status")
    .then((s) => Boolean(s.live))
    .catch(() => false);
  return liveCheck;
}

/**
 * Shows the category and diet tags of a recipe inside `root` (the #tags box on recipe.html),
 * with "Check tags" and "Ask Jev again". `tagNow` asks Jev straight away (used after a save).
 * `onCategory(previous, next)` runs whenever the category changes, so the form can follow it.
 * Returns { ask } so the page can ask Jev again after a save.
 */
export async function mountRecipeTags(root, recipeId, { tagNow = false, onCategory = () => {} } = {}) {
  const base = `/ai/recipes/${encodeURIComponent(recipeId)}`;
  let tags = null; // the last RecipeTags from the server
  let editing = false;
  root.innerHTML = `<p class="muted">Loading tags…</p>`;

  const [live, loaded] = await Promise.all([
    jevLive(),
    api(`${base}/tags`).catch((err) => {
      toast(err.message, { error: true });
      return null;
    }),
  ]);
  tags = loaded;

  // Replaces what is shown with new tags from the server, and tells the page if the category moved.
  function apply(next) {
    const before = tags?.category ?? null;
    tags = next;
    if (before !== (next.category ?? null)) onCategory(before, next.category ?? null);
    render();
  }

  // Asks Jev about the recipe again. Errors are toasted; the buttons come back either way.
  async function ask() {
    const again = root.querySelector("[data-act=again]");
    if (again) {
      again.disabled = true;
      again.textContent = "Asking Jev…";
    }
    try {
      apply(await api(`${base}/tag`, { method: "POST" }));
    } catch (err) {
      toast(err.message, { error: true });
      render();
    }
  }

  function badges(version) {
    const shown = version.tags.filter((t) => t.value);
    if (!shown.length) return `<span class="muted">No dietary tags</span>`;
    return shown
      .map((t) => `<span class="badge${t.unsure ? " unsure" : ""}">${TAG_LABELS[t.tag]}${t.unsure ? "?" : ""}</span>`)
      .join("");
  }

  // One chip per diet tag: not set, yes or no. Tapping cycles between yes and no.
  function chip(version, index, tag) {
    const found = version.tags.find((t) => t.tag === tag);
    const state = found ? (found.value ? "yes" : "no") : "";
    const unsure = found?.unsure ? " unsure" : "";
    return `<button type="button" class="chip${unsure}" data-version="${index}" data-tag="${tag}" data-state="${state}">${TAG_LABELS[tag]}: ${state || "not set"}</button>`;
  }

  function editor() {
    const current = tags.category ?? "";
    return `
      <div class="tag-editor">
        <label for="tag-category">Category</label>
        <select id="tag-category" data-initial="${current}">
          <option value="">Let Jev suggest</option>
          ${CATEGORIES.map((c) => `<option value="${c}"${c === current ? " selected" : ""}>${cap(c)}</option>`).join("")}
        </select>
        ${tags.versions
          .map((v, i) => `<h3>${escape(v.label)}</h3><div class="chips">${DIET_TAGS.map((t) => chip(v, i, t)).join("")}</div>`)
          .join("")}
        <p class="muted">Tap a tag to say yes or no. Tags left "not set" are not saved. Saving makes everything shown yours, so Jev will not change it.</p>
        <div class="actions">
          <button type="button" data-act="save">Save tags</button>
          <button type="button" class="secondary" data-act="cancel">Cancel</button>
        </div>
      </div>`;
  }

  function render() {
    if (!tags) {
      root.innerHTML = `<p class="muted">Tags are not available right now.</p>`;
      return;
    }
    const category = tags.category
      ? `<p><strong>${cap(tags.category)}</strong>${tags.category_source === "jev" ? ` <span class="muted">· suggested</span>` : ""}</p>`
      : `<p class="muted">No category yet.</p>`;
    const versions = tags.versions
      .map((v) => `<div class="tag-version"><strong>${escape(v.label)}</strong><div>${badges(v)}</div></div>`)
      .join("");
    root.innerHTML = `
      ${category}
      ${versions}
      ${live ? "" : `<p class="muted jev-note">${OFFLINE_NOTE}</p>`}
      <div class="row">
        <button type="button" class="secondary" data-act="edit" aria-expanded="${editing}">Check tags</button>
        <button type="button" class="secondary" data-act="again">Ask Jev again</button>
      </div>
      ${editing ? editor() : ""}`;
  }

  // Clicks on the chips and buttons. The box is never replaced, so one listener is enough.
  root.addEventListener("click", async (e) => {
    const chipEl = e.target.closest(".chip");
    if (chipEl) {
      const next = { "": "yes", yes: "no", no: "yes" }[chipEl.dataset.state];
      chipEl.dataset.state = next;
      chipEl.textContent = `${chipEl.textContent.split(":")[0]}: ${next}`;
      chipEl.classList.remove("unsure"); // the chef has now looked at it
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "edit" || act === "cancel") {
      editing = act === "edit" && !editing;
      render();
    } else if (act === "again") {
      ask();
    } else if (act === "save") {
      await save();
    }
  });

  // Saves the chef's tags (every tag shown with yes or no) and category, as the chef's choice.
  async function save() {
    const select = root.querySelector("#tag-category");
    const body = { tags: [] };
    if (select.value !== select.dataset.initial) body.category = select.value || null;
    for (const el of root.querySelectorAll(".chip")) {
      if (!el.dataset.state) continue;
      const version = tags.versions[Number(el.dataset.version)];
      body.tags.push({ alternative_id: version.alternative_id, tag: el.dataset.tag, value: el.dataset.state === "yes" });
    }
    const saveButton = root.querySelector("[data-act=save]");
    saveButton.disabled = true;
    try {
      const saved = await api(`${base}/tags`, { method: "PUT", body });
      editing = false;
      toast("Tags saved");
      apply(saved);
      // A cleared category goes back to Jev, so it gets a suggestion again straight away.
      if (body.category === null) ask();
    } catch (err) {
      toast(err.message, { error: true });
      saveButton.disabled = false;
    }
  }

  render();
  if (tagNow) ask();
  return { ask };
}

/** Jev's best dishes for an empty meal: up to three { recipe_id, title, probability }. Throws if Jev fails. */
export async function fetchSuggestions(mealId) {
  const { suggestions } = await api(`/ai/meals/${encodeURIComponent(mealId)}/suggestions`);
  return suggestions;
}
