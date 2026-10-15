import { api, busy, confirmDialog, escape, icon, qs, toast } from "/lib.js";
import { createRecipeForm } from "/recipe-editor.js";
import { mountRecipeTags } from "/jev.js";

const id = qs("id");
// tagged=0 is set right after a new recipe is saved (or imported): Jev has not looked at it yet.
const freshlySaved = qs("tagged") === "0";
const saveButton = document.getElementById("save");
const deleteButton = document.getElementById("delete");
let tagsView = null; // { ask, tags } for the Jev tags box, once a saved recipe is shown

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Keeps the Category select on the form in step when Jev changes the category, unless the chef has picked another one. */
function syncCategory(previous, next) {
  const select = document.getElementById("f-category");
  if (select.value === (previous ?? "")) select.value = next ?? "";
  showHint();
}

/**
 * The Category select is the one place to pick a category. Jev's side of it is a hint under the select:
 * "Suggested by Jev" when the select shows Jev's pick, "Jev suggests Dinner" with a Use link when it differs.
 */
function showHint() {
  const hint = document.getElementById("f-category-hint");
  const select = document.getElementById("f-category");
  const tags = tagsView?.tags();
  if (!hint || !select || !tags) return;
  if (tags.category && tags.category_source === "jev" && select.value === tags.category) {
    hint.innerHTML = `<span class="badge badge-secondary">${icon("sparkles")}Suggested by Jev</span>`;
  } else if (tags.category && tags.category_source === "jev") {
    hint.innerHTML = `${icon("sparkles")}<span>Jev suggests ${escape(cap(tags.category))}.</span><button type="button" class="btn btn-link" data-use="${escape(tags.category)}">Use it</button>`;
  } else if (!tags.category && !select.value) {
    hint.innerHTML = `${icon("sparkles")}<span>Leave it blank and Jev suggests one when you save.</span>`;
  } else {
    hint.innerHTML = "";
  }
  hint.hidden = !hint.innerHTML;
}

try {
  const ingredients = await api("/ingredients");
  const form = createRecipeForm(document.getElementById("form"), ingredients);
  const select = document.getElementById("f-category");
  select.addEventListener("change", showHint);
  document.getElementById("f-category-hint").addEventListener("click", (e) => {
    const use = e.target.closest("[data-use]");
    if (!use) return;
    select.value = use.dataset.use;
    showHint();
  });

  if (id) {
    const recipe = await api(`/recipes/${encodeURIComponent(id)}`);
    form.setRecipe(recipe);
    document.getElementById("heading").textContent = recipe.title;
    document.getElementById("subtitle").textContent = `Serves ${recipe.servings}`;
    document.title = `${recipe.title} · Kitchen King`;
    deleteButton.hidden = false;
    tagsView = await mountRecipeTags(document.getElementById("tags"), id, { tagNow: freshlySaved, onCategory: syncCategory, onTags: showHint });
    showHint();
    if (freshlySaved) {
      // Drop tagged=0 so a reload does not ask Jev again.
      const url = new URL(location.href);
      url.searchParams.delete("tagged");
      history.replaceState(null, "", url);
    }
  } else {
    document.getElementById("heading").textContent = "New recipe";
    document.getElementById("subtitle").textContent = "Add the ingredients, method and any other versions.";
    document.title = "New recipe · Kitchen King";
    form.setRecipe({});
  }

  saveButton.addEventListener("click", () =>
    busy(saveButton, async () => {
      try {
        const body = form.getRecipe();
        const saved = await api(id ? `/recipes/${encodeURIComponent(id)}` : "/recipes", { method: id ? "PUT" : "POST", body });
        toast("Saved");
        if (id) {
          form.setRecipe(saved); // shows new ingredients as normal lines and keeps version ids
          document.getElementById("heading").textContent = saved.title;
          document.getElementById("subtitle").textContent = `Serves ${saved.servings}`;
          showHint();
          tagsView?.ask(); // Jev looks again after the save; this does not hold up the page
        } else {
          location.href = `/recipe.html?id=${saved.id}&tagged=0`;
        }
      } catch (err) {
        toast(err.message, { error: true });
      }
    }),
  );

  deleteButton.addEventListener("click", async () => {
    const title = document.getElementById("heading").textContent;
    if (!(await confirmDialog({ title: `Delete ${title}?`, description: "The recipe and its other versions are removed. This can't be undone.", confirm: "Delete" }))) return;
    try {
      await api(`/recipes/${encodeURIComponent(id)}`, { method: "DELETE" });
      location.href = "/recipes.html";
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
} catch (err) {
  toast(err.message, { error: true });
}
