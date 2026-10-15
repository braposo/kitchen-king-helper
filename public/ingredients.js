import { api, busy, confirmDialog, escape, icon, toast } from "/lib.js";

const $ = (id) => document.getElementById(id);
let suppliers = [];
let ingredients = [];
let editingIngredient = null;
let editingSupplier = null;

async function run(action) {
  try {
    await action();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

// ---------- ingredients ----------

function fillSupplierSelect() {
  $("i-supplier").innerHTML =
    `<option value="">None</option>` + suppliers.map((s) => `<option value="${s.id}">${escape(s.name)}</option>`).join("");
}

function showIngredients() {
  $("ingredients-count").textContent = `${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}`;
  $("ingredients").innerHTML = ingredients.length
    ? ingredients
        .map((i) => {
          const pack = i.pack_label || (i.pack_size ? `${i.pack_size} ${i.base_unit}` : "");
          const meta = [`in ${i.base_unit}`, i.supplier_name, pack].filter(Boolean).join(" · ");
          return `<button type="button" class="item" data-id="${i.id}">
            <span class="item-media">${icon(i.storage === "fresh" ? "leaf" : "carrot")}</span>
            <span class="item-content"><span class="item-title">${escape(i.name)}</span><span class="item-description">${escape(meta)}</span></span>
            ${i.storage === "fresh" ? `<span class="badge badge-secondary">Fresh</span>` : ""}
            ${icon("chevron-right")}
          </button>`;
        })
        .join("")
    : `<div class="empty"><div class="empty-media">${icon("carrot", { size: 20 })}</div><p class="empty-title">No ingredients yet</p><p class="empty-description">They are added when you save a recipe, or you can add one now.</p></div>`;
}

function editIngredient(i) {
  editingIngredient = i;
  $("ing-heading").textContent = i ? `Edit ${i.name}` : "Add an ingredient";
  $("ing-form").reset();
  $("i-name").value = i?.name ?? "";
  $("i-unit").value = i?.base_unit ?? "g";
  $("i-storage").value = i?.storage ?? "pantry";
  $("i-supplier").value = i?.supplier_id ?? "";
  $("i-pack").value = i?.pack_size ?? "";
  $("i-label").value = i?.pack_label ?? "";
  $("i-delete").hidden = !i;
  if ($("ing-dialog").open) return;
  $("ing-dialog").showModal();
}

function closeIngredient() {
  editingIngredient = null;
  $("ing-dialog").close();
}

$("ingredients").addEventListener("click", (e) => {
  const link = e.target.closest("[data-id]");
  if (!link) return;
  editIngredient(ingredients.find((i) => i.id === Number(link.dataset.id)));
});

$("add-ingredient").addEventListener("click", () => editIngredient(null));

$("ing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  busy(e.submitter ?? $("ing-form").querySelector("[type=submit]"), () => run(async () => {
    const body = {
      name: $("i-name").value,
      base_unit: $("i-unit").value,
      storage: $("i-storage").value,
      supplier_id: $("i-supplier").value ? Number($("i-supplier").value) : null,
      pack_size: $("i-pack").value ? Number($("i-pack").value) : null,
      pack_label: $("i-label").value,
    };
    await api(editingIngredient ? `/ingredients/${editingIngredient.id}` : "/ingredients", { method: editingIngredient ? "PUT" : "POST", body });
    toast("Saved");
    closeIngredient();
    await loadIngredients();
  }));
});

$("i-cancel").addEventListener("click", closeIngredient);
$("i-delete").addEventListener("click", () =>
  run(async () => {
    const name = editingIngredient.name;
    if (!(await confirmDialog({ title: `Delete ${name}?`, description: "It is removed from your pantry. Recipes that use it may need a look.", confirm: "Delete" }))) return;
    await api(`/ingredients/${editingIngredient.id}`, { method: "DELETE" });
    closeIngredient();
    toast(`Deleted ${name}`);
    await loadIngredients();
  }),
);

async function loadIngredients() {
  ingredients = await api("/ingredients");
  showIngredients();
}

// ---------- suppliers ----------

function showSuppliers() {
  $("suppliers-count").textContent = `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}`;
  $("suppliers").innerHTML = suppliers.length
    ? suppliers
        .map((s) => {
          const meta = [`${s.lead_days} day${s.lead_days === 1 ? "" : "s"} notice`, s.contact].filter(Boolean).join(" · ");
          return `<button type="button" class="item" data-id="${s.id}">
            <span class="item-media">${icon(s.kind === "specialist" ? "store" : "truck")}</span>
            <span class="item-content"><span class="item-title">${escape(s.name)}</span><span class="item-description">${escape(meta)}</span></span>
            <span class="badge badge-secondary">${s.kind === "specialist" ? "Specialist" : "Supermarket"}</span>
            ${icon("chevron-right")}
          </button>`;
        })
        .join("")
    : `<div class="empty"><div class="empty-media">${icon("truck", { size: 20 })}</div><p class="empty-title">No suppliers yet</p><p class="empty-description">Add the shops and suppliers you order from.</p></div>`;
}

function editSupplier(s) {
  editingSupplier = s;
  $("sup-heading").textContent = s ? `Edit ${s.name}` : "Add a supplier";
  $("sup-form").reset();
  $("s-name").value = s?.name ?? "";
  $("s-kind").value = s?.kind ?? "supermarket";
  $("s-lead").value = s?.lead_days ?? 1;
  $("s-contact").value = s?.contact ?? "";
  $("s-delete").hidden = !s;
  if ($("sup-dialog").open) return;
  $("sup-dialog").showModal();
}

function closeSupplier() {
  editingSupplier = null;
  $("sup-dialog").close();
}

$("suppliers").addEventListener("click", (e) => {
  const link = e.target.closest("[data-id]");
  if (!link) return;
  editSupplier(suppliers.find((s) => s.id === Number(link.dataset.id)));
});

$("add-supplier").addEventListener("click", () => editSupplier(null));

$("sup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  busy(e.submitter ?? $("sup-form").querySelector("[type=submit]"), () => run(async () => {
    const body = { name: $("s-name").value, kind: $("s-kind").value, lead_days: Number($("s-lead").value), contact: $("s-contact").value };
    await api(editingSupplier ? `/suppliers/${editingSupplier.id}` : "/suppliers", { method: editingSupplier ? "PUT" : "POST", body });
    toast("Saved");
    closeSupplier();
    await loadSuppliers();
    await loadIngredients(); // supplier names show on ingredients
  }));
});

$("s-cancel").addEventListener("click", closeSupplier);
$("s-delete").addEventListener("click", () =>
  run(async () => {
    const name = editingSupplier.name;
    if (!(await confirmDialog({ title: `Delete ${name}?`, description: "Ingredients that use it will have no supplier.", confirm: "Delete" }))) return;
    await api(`/suppliers/${editingSupplier.id}`, { method: "DELETE" });
    closeSupplier();
    toast(`Deleted ${name}`);
    await loadSuppliers();
    await loadIngredients();
  }),
);

async function loadSuppliers() {
  suppliers = await api("/suppliers");
  showSuppliers();
  fillSupplierSelect();
}

run(async () => {
  await loadSuppliers();
  await loadIngredients();
});

// ---------- the two parts ----------

const parts = $("parts");
function showPart(name) {
  parts.querySelectorAll("[data-part]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.part === name)));
  $("part-ingredients").hidden = name !== "ingredients";
  $("part-suppliers").hidden = name !== "suppliers";
  try { sessionStorage.setItem("pantry-part", name); } catch {}
}
parts.addEventListener("click", (e) => {
  const b = e.target.closest("[data-part]");
  if (b) showPart(b.dataset.part);
});
try {
  const saved = location.hash === "#suppliers" ? "suppliers" : sessionStorage.getItem("pantry-part");
  if (saved === "suppliers") showPart("suppliers");
} catch {}
