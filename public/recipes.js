import { api, escape, icon, toast } from "/lib.js";

const list = document.getElementById("list");
const search = document.getElementById("q");
const filters = document.getElementById("filters");
const count = document.getElementById("count");
let category = "";
let recipes = [];

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function row(r) {
  const versions = r.alternatives ? ` · ${r.alternatives} other version${r.alternatives === 1 ? "" : "s"}` : "";
  const badge = r.category ? `<span class="badge badge-secondary">${escape(cap(r.category))}</span>` : "";
  return `<a class="item" href="/recipe.html?id=${r.id}">
    <span class="item-content">
      <span class="item-title">${escape(r.title)}</span>
      <span class="item-description">Serves ${r.servings}${versions}</span>
    </span>
    ${badge}
    ${icon("chevron-right")}
  </a>`;
}

function render() {
  const shown = category ? recipes.filter((r) => r.category === category) : recipes;
  const term = search.value.trim();
  if (shown.length) {
    list.innerHTML = shown.map(row).join("");
    return;
  }
  list.innerHTML = term || category
    ? `<div class="empty"><div class="empty-media">${icon("search", { size: 20 })}</div><p class="empty-title">No recipes match</p><p class="empty-description">Try another word${category ? " or meal" : ""}.</p></div>`
    : `<div class="empty"><div class="empty-media">${icon("book-open", { size: 20 })}</div><p class="empty-title">No recipes yet</p><p class="empty-description">Paste one in from your document and check what was read.</p><div class="actions"><a class="btn" href="/import.html">${icon("clipboard-paste")}Paste a recipe</a></div></div>`;
}

async function load() {
  try {
    recipes = await api(`/recipes?q=${encodeURIComponent(search.value.trim())}`);
    if (!search.value.trim()) count.textContent = `${recipes.length} recipe${recipes.length === 1 ? "" : "s"} in your library.`;
    render();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

filters.addEventListener("click", (e) => {
  const button = e.target.closest("[data-cat]");
  if (!button) return;
  category = button.dataset.cat;
  filters.querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  render();
});

let timer;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(load, 200);
});
load();
