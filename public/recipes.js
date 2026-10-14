import { api, escape, toast } from "/lib.js";

const list = document.getElementById("list");
const search = document.getElementById("q");

function row(r) {
  const alts = r.alternatives ? `${r.alternatives} alternative${r.alternatives === 1 ? "" : "s"}` : "";
  const badge = r.category ? `<span class="badge">${escape(r.category)}</span>` : "";
  const meta = [`serves ${r.servings}`, alts].filter(Boolean).join(" · ");
  return `<li><a href="/recipe.html?id=${r.id}"><span class="title">${escape(r.title)}</span> ${badge}<br><span class="muted">${escape(meta)}</span></a></li>`;
}

async function load() {
  try {
    const recipes = await api(`/recipes?q=${encodeURIComponent(search.value.trim())}`);
    list.innerHTML = recipes.length
      ? recipes.map(row).join("")
      : `<li class="muted">${search.value.trim() ? "No recipes match." : "No recipes yet. Paste one in from your document."}</li>`;
  } catch (err) {
    toast(err.message, { error: true });
  }
}

let timer;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(load, 200);
});
load();
