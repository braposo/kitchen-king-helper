const list = document.getElementById("recipes");
const status = document.getElementById("status");

async function load() {
  try {
    const res = await fetch("/api/recipes");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const recipes = await res.json();
    list.innerHTML = recipes.length
      ? recipes.map((r) => `<li>${escape(r.title)} <span class="muted">serves ${r.servings}</span></li>`).join("")
      : `<li class="muted">No recipes yet.</li>`;
  } catch (err) {
    list.innerHTML = "";
    status.textContent = `Could not load recipes (${err.message}).`;
  }
}

function escape(text) {
  return String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

load();
