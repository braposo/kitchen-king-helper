import { api, escape, toast } from "/lib.js";
import { createRecipeForm } from "/recipe-editor.js";

const $ = (id) => document.getElementById(id);
let form = null;

$("read").addEventListener("click", async () => {
  const text = $("text").value;
  if (!text.trim()) return toast("Paste the recipe first.", { error: true });
  $("read").disabled = true;
  try {
    const [draft, ingredients] = await Promise.all([api("/recipes/parse", { method: "POST", body: { text } }), api("/ingredients")]);
    form = createRecipeForm($("form"), ingredients);
    form.setRecipe({
      title: draft.title,
      servings: draft.servings,
      method: draft.method,
      notes: draft.notes,
      // A matched line uses the existing ingredient's name and unit; others are shown as "new".
      ingredients: draft.lines.map((l) => ({
        name: l.match ? l.match.name : l.name,
        base_unit: l.match ? l.match.base_unit : l.base_unit,
        quantity_per_serving: l.quantity_per_serving,
        prep_note: l.prep_note,
        problem: l.problem,
      })),
    });
    $("problems").innerHTML = draft.problems.map((p) => `<p class="warn">${escape(p)}</p>`).join("");
    $("paste").hidden = true;
    $("draft").hidden = false;
    window.scrollTo(0, 0);
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    $("read").disabled = false;
  }
});

$("again").addEventListener("click", () => {
  $("draft").hidden = true;
  $("paste").hidden = false;
});

$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  try {
    const saved = await api("/recipes", { method: "POST", body: form.getRecipe() });
    location.href = `/recipe.html?id=${saved.id}`;
  } catch (err) {
    toast(err.message, { error: true });
    $("save").disabled = false;
  }
});
