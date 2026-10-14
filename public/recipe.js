import { api, qs, toast } from "/lib.js";
import { createRecipeForm } from "/recipe-editor.js";

const id = qs("id");
const saveButton = document.getElementById("save");
const deleteButton = document.getElementById("delete");

try {
  const ingredients = await api("/ingredients");
  const form = createRecipeForm(document.getElementById("form"), ingredients);

  if (id) {
    const recipe = await api(`/recipes/${encodeURIComponent(id)}`);
    form.setRecipe(recipe);
    document.getElementById("heading").textContent = recipe.title;
    document.title = `${recipe.title} - Kitchen King`;
    deleteButton.hidden = false;
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
      } else {
        location.href = `/recipe.html?id=${saved.id}`;
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
