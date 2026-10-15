import { api, busy, escape, icon, toast } from "/lib.js";
import { createRecipeForm } from "/recipe-editor.js";

const $ = (id) => document.getElementById(id);
let form = null;

$("read").addEventListener("click", () =>
  busy($("read"), async () => {
    const text = $("text").value;
    if (!text.trim()) return toast("Paste the recipe first.", { error: true });
    try {
      const [draft, ingredients] = await Promise.all([api("/recipes/parse", { method: "POST", body: { text } }), api("/ingredients")]);
      form = createRecipeForm($("form"), ingredients);
      form.setRecipe({
        title: draft.title,
        servings: draft.servings,
        method: draft.method,
        notes: draft.notes,
        // A matched line uses the existing ingredient's name and unit; others are shown as "New".
        ingredients: draft.lines.map((l) => ({
          name: l.match ? l.match.name : l.name,
          base_unit: l.match ? l.match.base_unit : l.base_unit,
          quantity_per_serving: l.quantity_per_serving,
          prep_note: l.prep_note,
          problem: l.problem,
        })),
      });
      $("problems").innerHTML = draft.problems.length
        ? `<div class="alert alert-warning">${icon("circle-alert")}<p class="alert-title">${draft.problems.length === 1 ? "One thing to check" : "A few things to check"}</p><div class="alert-description"><ul class="problem-list">${draft.problems.map((p) => `<li>${escape(p)}</li>`).join("")}</ul></div></div>`
        : "";
      $("heading").textContent = "Check the recipe";
      $("subtitle").textContent = "Fix anything that was misread, then save.";
      $("paste").hidden = true;
      $("draft").hidden = false;
      window.scrollTo(0, 0);
    } catch (err) {
      toast(err.message, { error: true });
    }
  }),
);

$("again").addEventListener("click", () => {
  $("draft").hidden = true;
  $("paste").hidden = false;
  $("heading").textContent = "Paste a recipe";
  $("subtitle").textContent = "Paste it from your document and check what was read.";
  window.scrollTo(0, 0);
});

$("save").addEventListener("click", () =>
  busy($("save"), async () => {
    try {
      const saved = await api("/recipes", { method: "POST", body: form.getRecipe() });
      location.href = `/recipe.html?id=${saved.id}&tagged=0`;
    } catch (err) {
      toast(err.message, { error: true });
    }
  }),
);
