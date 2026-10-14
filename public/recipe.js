import { api, qs, toast } from "/lib.js";
import { createRecipeForm } from "/recipe-editor.js";
import { mountRecipeTags } from "/jev.js";

const id = qs("id");
// tagged=0 is set right after a new recipe is saved (or imported): Jev has not looked at it yet.
const freshlySaved = qs("tagged") === "0";
const saveButton = document.getElementById("save");
const deleteButton = document.getElementById("delete");
let tagsView = null; // { ask } for the Jev tags box, once a saved recipe is shown

/** Keeps the Category select on the form in step when Jev changes the category, unless the chef has picked another one. */
function syncCategory(previous, next) {
  const select = document.getElementById("f-category");
  if (select.value === (previous ?? "")) select.value = next ?? "";
}

try {
  const ingredients = await api("/ingredients");
  const form = createRecipeForm(document.getElementById("form"), ingredients);

  if (id) {
    const recipe = await api(`/recipes/${encodeURIComponent(id)}`);
    form.setRecipe(recipe);
    document.getElementById("heading").textContent = recipe.title;
    document.title = `${recipe.title} - Kitchen King`;
    deleteButton.hidden = false;
    tagsView = await mountRecipeTags(document.getElementById("tags"), id, { tagNow: freshlySaved, onCategory: syncCategory });
    if (freshlySaved) {
      // Drop tagged=0 so a reload does not ask Jev again.
      const url = new URL(location.href);
      url.searchParams.delete("tagged");
      history.replaceState(null, "", url);
    }
  } else {
    document.getElementById("heading").textContent = "New recipe";
    form.setRecipe({});
  }

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      const body = form.getRecipe();
      const saved = await api(id ? `/recipes/${encodeURIComponent(id)}` : "/recipes", { method: id ? "PUT" : "POST", body });
      toast("Saved");
      if (id) {
        form.setRecipe(saved); // shows new ingredients as normal lines and keeps version ids
        tagsView?.ask(); // Jev looks again after the save; this does not hold up the page
      } else {
        location.href = `/recipe.html?id=${saved.id}&tagged=0`;
      }
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton.addEventListener("click", async () => {
    if (!confirm("Delete this recipe? This can't be undone.")) return;
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
