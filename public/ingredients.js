import { api, escape, toast } from "/lib.js";

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
  $("ingredients").innerHTML = ingredients.length
    ? ingredients
        .map((i) => {
          const pack = i.pack_label || (i.pack_size ? `${i.pack_size} ${i.base_unit}` : "");
          const meta = [i.storage, `in ${i.base_unit}`, i.supplier_name, pack].filter(Boolean).join(" · ");
          return `<li><a href="#" data-id="${i.id}"><span class="title">${escape(i.name)}</span><br><span class="muted">${escape(meta)}</span></a></li>`;
        })
        .join("")
    : `<li class="muted">No ingredients yet. They are added when you save a recipe, or add one above.</li>`;
}

function editIngredient(i) {
  editingIngredient = i;
  $("ing-heading").textContent = i ? `Edit ${i.name}` : "Add an ingredient";
  $("i-name").value = i?.name ?? "";
  $("i-unit").value = i?.base_unit ?? "g";
  $("i-storage").value = i?.storage ?? "pantry";
  $("i-supplier").value = i?.supplier_id ?? "";
  $("i-pack").value = i?.pack_size ?? "";
  $("i-label").value = i?.pack_label ?? "";
  $("i-cancel").hidden = $("i-delete").hidden = !i;
  if (i) $("ing-form").scrollIntoView({ behavior: "smooth" });
}

$("ingredients").addEventListener("click", (e) => {
  const link = e.target.closest("a[data-id]");
  if (!link) return;
  e.preventDefault();
  editIngredient(ingredients.find((i) => i.id === Number(link.dataset.id)));
});

$("ing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(async () => {
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
    editIngredient(null);
    await loadIngredients();
  });
});

$("i-cancel").addEventListener("click", () => editIngredient(null));
$("i-delete").addEventListener("click", () =>
  run(async () => {
    if (!confirm(`Delete ${editingIngredient.name}?`)) return;
    await api(`/ingredients/${editingIngredient.id}`, { method: "DELETE" });
    editIngredient(null);
    await loadIngredients();
  }),
);

async function loadIngredients() {
  ingredients = await api("/ingredients");
  showIngredients();
}

// ---------- suppliers ----------

function showSuppliers() {
  $("suppliers").innerHTML = suppliers.length
    ? suppliers
        .map((s) => {
          const meta = [s.kind, `${s.lead_days} day${s.lead_days === 1 ? "" : "s"} notice`, s.contact].filter(Boolean).join(" · ");
          return `<li><a href="#" data-id="${s.id}"><span class="title">${escape(s.name)}</span><br><span class="muted">${escape(meta)}</span></a></li>`;
        })
        .join("")
    : `<li class="muted">No suppliers yet.</li>`;
}

function editSupplier(s) {
  editingSupplier = s;
  $("sup-heading").textContent = s ? `Edit ${s.name}` : "Add a supplier";
  $("s-name").value = s?.name ?? "";
  $("s-kind").value = s?.kind ?? "supermarket";
  $("s-lead").value = s?.lead_days ?? 1;
  $("s-contact").value = s?.contact ?? "";
  $("s-cancel").hidden = $("s-delete").hidden = !s;
  if (s) $("sup-form").scrollIntoView({ behavior: "smooth" });
}

$("suppliers").addEventListener("click", (e) => {
  const link = e.target.closest("a[data-id]");
  if (!link) return;
  e.preventDefault();
  editSupplier(suppliers.find((s) => s.id === Number(link.dataset.id)));
});

$("sup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  run(async () => {
    const body = { name: $("s-name").value, kind: $("s-kind").value, lead_days: Number($("s-lead").value), contact: $("s-contact").value };
    await api(editingSupplier ? `/suppliers/${editingSupplier.id}` : "/suppliers", { method: editingSupplier ? "PUT" : "POST", body });
    toast("Saved");
    editSupplier(null);
    await loadSuppliers();
    await loadIngredients(); // supplier names show on ingredients
  });
});

$("s-cancel").addEventListener("click", () => editSupplier(null));
$("s-delete").addEventListener("click", () =>
  run(async () => {
    if (!confirm(`Delete ${editingSupplier.name}? Ingredients using it will have no supplier.`)) return;
    await api(`/suppliers/${editingSupplier.id}`, { method: "DELETE" });
    editSupplier(null);
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
