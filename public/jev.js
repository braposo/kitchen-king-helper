// Jev on the page: a recipe's category and diet tags, and dish suggestions for a meal.
// Everything here is best effort. A failed call shows a toast and never blocks saving.
import { api, busy, escape, icon, toast } from "/lib.js";

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
 * Shows the diet tags of a recipe inside `root` (the #tags box on recipe.html),
 * with "Check tags" and "Ask Jev again". `tagNow` asks Jev straight away (used after a save).
 * The category is picked on the recipe form, not here. The page hears about it through:
 *   `onCategory(previous, next)` when the category changes, so the form can follow it;
 *   `onTags(tags)` whenever the tags are loaded or change, so the form can show Jev's suggestion.
 * Returns { ask, tags } so the page can ask Jev again after a save and read the latest tags.
 */
export async function mountRecipeTags(root, recipeId, { tagNow = false, onCategory = () => {}, onTags = () => {} } = {}) {
  const base = `/ai/recipes/${encodeURIComponent(recipeId)}`;
  let tags = null; // the last RecipeTags from the server
  let editing = false;
  root.innerHTML = `<section class="card" aria-busy="true" aria-label="Loading tags"><div class="skeleton skeleton-line" style="width:40%"></div><div class="skeleton skeleton-line" style="width:70%"></div></section>`;

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
    onTags(tags);
    render();
  }

  // Asks Jev about the recipe again. Errors are toasted; the buttons come back either way.
  async function ask() {
    const again = root.querySelector("[data-act=again]");
    const work = async () => {
      try {
        apply(await api(`${base}/tag`, { method: "POST" }));
      } catch (err) {
        toast(err.message, { error: true });
        render();
      }
    };
    if (again) await busy(again, work);
    else await work();
  }

  function badges(version) {
    const shown = version.tags.filter((t) => t.value);
    if (!shown.length) return `<span class="muted small">No dietary tags</span>`;
    return shown
      .map((t) => `<span class="badge ${t.unsure ? "badge-dashed" : "badge-secondary"}">${TAG_LABELS[t.tag]}${t.unsure ? "?" : ""}</span>`)
      .join("");
  }

  // One toggle per diet tag: not set, yes or no. Tapping cycles between yes and no.
  function chipInner(label, state) {
    const mark = state === "yes" ? icon("check") : state === "no" ? icon("x") : "";
    return `${mark}${label}`;
  }
  function chip(version, index, tag) {
    const found = version.tags.find((t) => t.tag === tag);
    const state = found ? (found.value ? "yes" : "no") : "";
    const unsure = found?.unsure ? " unsure" : "";
    return `<button type="button" class="toggle${unsure}" data-version="${index}" data-tag="${tag}" data-state="${state}" aria-label="${TAG_LABELS[tag]}: ${state || "not set"}">${chipInner(TAG_LABELS[tag], state)}</button>`;
  }

  function editor() {
    return `
      <hr>
      <div class="stack tag-editor">
        ${tags.versions
          .map((v, i) => `<div class="stack-sm"><h3 class="tag-version-name">${escape(v.label)}</h3><div class="toggle-group">${DIET_TAGS.map((t) => chip(v, i, t)).join("")}</div></div>`)
          .join("")}
        <p class="field-description">Tap a tag to say yes or no. Tags left unset are not saved. Saving makes everything shown yours, so Jev will not change it.</p>
        <div class="row">
          <button type="button" class="btn btn-sm" data-act="save">Save tags</button>
          <button type="button" class="btn btn-outline btn-sm" data-act="cancel">Cancel</button>
        </div>
      </div>`;
  }

  function render() {
    if (!tags) {
      root.innerHTML = `<section class="card"><p class="muted">Tags are not available right now.</p></section>`;
      return;
    }
    const versions = tags.versions
      .map((v) => `<div class="tag-version"><span class="tag-version-name">${escape(v.label)}</span><div class="badges">${badges(v)}</div></div>`)
      .join("");
    root.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title jev-title">${icon("sparkles")}Dietary tags</h2>
            <p class="card-description">What Jev found in each version.</p>
          </div>
        </div>
        <div class="stack-sm tag-versions">${versions}</div>
        ${live ? "" : `<p class="field-description">${OFFLINE_NOTE}</p>`}
        <div class="card-footer">
          <button type="button" class="btn btn-outline btn-sm" data-act="edit" aria-expanded="${editing}">Check tags</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="again">${icon("refresh-cw")}Ask Jev again</button>
        </div>
        ${editing ? editor() : ""}
      </section>`;
  }

  // Clicks on the chips and buttons. The box is never replaced, so one listener is enough.
  root.addEventListener("click", async (e) => {
    const chipEl = e.target.closest(".toggle");
    if (chipEl) {
      const next = { "": "yes", yes: "no", no: "yes" }[chipEl.dataset.state];
      const label = TAG_LABELS[chipEl.dataset.tag];
      chipEl.dataset.state = next;
      chipEl.innerHTML = chipInner(label, next);
      chipEl.setAttribute("aria-label", `${label}: ${next}`);
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

  // Saves the chef's tags (every tag shown with yes or no) as the chef's choice.
  // The category is saved with the recipe, so it is not sent from here.
  async function save() {
    const body = { tags: [] };
    for (const el of root.querySelectorAll(".toggle")) {
      if (!el.dataset.state) continue;
      const version = tags.versions[Number(el.dataset.version)];
      body.tags.push({ alternative_id: version.alternative_id, tag: el.dataset.tag, value: el.dataset.state === "yes" });
    }
    await busy(root.querySelector("[data-act=save]"), async () => {
      try {
        const saved = await api(`${base}/tags`, { method: "PUT", body });
        editing = false;
        toast("Tags saved");
        apply(saved);
      } catch (err) {
        toast(err.message, { error: true });
      }
    });
  }

  render();
  onTags(tags);
  if (tagNow) ask();
  return { ask, tags: () => tags };
}

/** Jev's best dishes for an empty meal: up to three { recipe_id, title, probability }. Throws if Jev fails. */
export async function fetchSuggestions(mealId) {
  const { suggestions } = await api(`/ai/meals/${encodeURIComponent(mealId)}/suggestions`);
  return suggestions;
}
