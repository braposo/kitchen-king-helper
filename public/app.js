import { api, escape } from "/lib.js";

const list = document.getElementById("recipes");

try {
  const recipes = await api("/recipes");
  list.innerHTML = recipes.length
    ? `<li>${recipes.length} recipe${recipes.length === 1 ? "" : "s"} in the library</li>`
    : `<li class="muted">No recipes yet. Paste one in from the recipe library.</li>`;
} catch (err) {
  list.innerHTML = `<li class="muted">Could not load recipes (${escape(err.message)}).</li>`;
}
