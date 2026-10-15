import { api, escape, icon, qs, toast, busy, skeleton } from "/lib.js";

const retreatId = qs("id") ?? qs("retreat");
const lists = document.getElementById("lists");
let data = null;
let tab = "delivery";
const open = new Set(); // keys of lines whose details panel is open

try {
  if (localStorage.getItem("orders-tab") === "supplier") tab = "supplier";
} catch {}

const key = (l) => `${l.ingredient_id}|${l.line_group}`;

/** "Thu 13 Nov" from YYYY-MM-DD. */
function day(date) {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(",", "");
}

/** "3 × 1 kg bag" when the line is bought in packs, else the plain amount. */
function packText(l) {
  if (!l.packs) return null;
  return `${l.packs} × ${l.pack_label || "pack"}`;
}

function lineHtml(l) {
  const k = key(l);
  const packs = packText(l);
  const spare = packs && l.leftover > 0 ? ` · ${escape(formatSpare(l))} spare` : "";
  const orderBy = l.order_by_date !== l.delivery_date ? ` · order by ${escape(day(l.order_by_date))}` : "";
  const uses = l.uses
    .map((u) => `<li><span>${escape(day(u.date))} ${escape(u.slot)} · ${escape(u.recipe_title)} (${escape(u.version_label)})</span><span class="num">${escape(formatAmount(l, u.amount))}</span></li>`)
    .join("");
  const suppliers = data.suppliers
    .map((s) => `<option value="${s.id}"${s.id === l.supplier_id ? " selected" : ""}>${escape(s.name)}</option>`)
    .join("");
  const fid = `${key(l).replace(/[^a-z0-9]/gi, "-")}`;
  return `<li class="order-line item${l.ticked ? " done" : ""}" data-ing="${l.ingredient_id}" data-group="${escape(l.line_group)}">
    <input type="checkbox" class="tick checkbox-lg" aria-label="Got ${escape(l.name)}"${l.ticked ? " checked" : ""}>
    <div class="line-body">
      <details${open.has(k) ? " open" : ""} data-key="${escape(k)}">
        <summary>
          <span class="line-main"><span class="name">${escape(l.name)}</span><span class="amount num">${escape(l.display)}</span></span>
          ${packs ? `<span class="meta">${escape(packs)}${spare}</span>` : ""}
          <span class="meta">${escape(l.supplier_name)}${orderBy}</span>
        </summary>
        <div class="panel">
          <p class="panel-title">What it's for</p>
          <ul class="uses">${uses}</ul>
          <div class="grid-2">
            <div class="field"><label for="date-${fid}">Delivery date</label><input id="date-${fid}" type="date" class="f-date" value="${escape(l.delivery_date)}"></div>
            <div class="field"><label for="sup-${fid}">Supplier</label><select id="sup-${fid}" class="f-supplier">${suppliers}</select></div>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-sm f-save">Save</button>
            <button type="button" class="btn btn-ghost btn-sm f-reset">Reset to automatic</button>
          </div>
        </div>
      </details>
    </div>
  </li>`;
}

// Leftover and use amounts are in the ingredient's base unit; reuse the server's wording style.
function formatAmount(l, value) {
  return formatBase(value, l.base_unit);
}
function formatSpare(l) {
  return formatBase(l.leftover, l.base_unit);
}
function formatBase(value, unit) {
  const trim = (v, d) => String(Number(v.toFixed(d)));
  if (unit === "each") return trim(value, 2);
  const small = value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  if (small >= 1000) return `${trim(value / 1000, 2)} ${unit === "g" ? "kg" : "l"}`;
  return `${trim(small, 1)} ${unit}`;
}

/** Ticked lines sink to the bottom, otherwise the server's order stays. */
const sinkTicked = (lines) => [...lines].sort((a, b) => Number(a.ticked) - Number(b.ticked));

function cardHtml(id, title, subtitle, bodyHtml, lines) {
  const left = lines.filter((l) => !l.ticked).length;
  const count = left === 0 ? "All ticked off" : `${left} of ${lines.length} to get`;
  return `<section class="card card-flush" data-card="${id}">
    <div class="card-header">
      <div>
        <h2 class="card-title">${title}</h2>
        <p class="card-description">${subtitle ? `${subtitle} · ` : ""}${count}</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm copy no-print">${icon("copy")}Copy list</button>
    </div>
    ${bodyHtml}
  </section>`;
}

function deliveryTitle(g) {
  const labels = [];
  if (g.pantry) labels.push("Opening order");
  const fresh = [...new Set(g.lines.filter((l) => l.line_group !== "pantry").map((l) => l.line_group))].sort();
  if (fresh.length) labels.push(`Fresh for ${fresh.map(day).join(", ")}`);
  return labels.join(" + ");
}

function render() {
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  if (!data.lines.length) {
    lists.innerHTML = `
      <div class="empty">
        <div class="empty-media">${icon("shopping-basket", { size: 20 })}</div>
        <p class="empty-title">Nothing to order yet</p>
        <p class="empty-description">Add dishes to the menu to see what to order.</p>
        <div class="actions"><a class="btn btn-outline" href="/retreat.html?id=${encodeURIComponent(retreatId)}">Back to the menu</a></div>
      </div>`;
    return;
  }
  const list = (lines) => `<ul class="item-list order-lines">${sinkTicked(lines).map(lineHtml).join("")}</ul>`;
  if (tab === "delivery") {
    lists.innerHTML = data.by_delivery.map((g, i) => cardHtml(`d${i}`, `Delivered ${escape(day(g.delivery_date))}`, escape(deliveryTitle(g)), list(g.lines), g.lines)).join("");
  } else {
    lists.innerHTML = data.by_supplier
      .map((g, i) => {
        const dates = [...new Set(g.lines.map((l) => l.delivery_date))].sort();
        const body = dates
          .map((d) => {
            const lines = g.lines.filter((l) => l.delivery_date === d);
            return `<p class="when">Delivered ${escape(day(d))}</p>${list(lines)}`;
          })
          .join("");
        return cardHtml(`s${i}`, escape(g.supplier_name), "", body, g.lines);
      })
      .join("");
  }
}

function groupOfCard(card) {
  const id = card.dataset.card;
  const i = Number(id.slice(1));
  return id[0] === "d" ? data.by_delivery[i] : data.by_supplier[i];
}

/** Plain text for pasting into a basket search or an email. Ticked lines are already done, so they are left out. */
function listText(group) {
  return group.lines
    .filter((l) => !l.ticked)
    .map((l) => `${l.name} — ${packText(l) ?? l.display}`)
    .join("\n");
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("Couldn't copy");
  }
}

async function send(method, path, body) {
  try {
    data = await api(path, { method, body });
    render();
  } catch (err) {
    toast(err.message, { error: true });
    render(); // put an un-saved tick back
  }
}

const linesPath = () => `/orders/${encodeURIComponent(retreatId)}/lines`;
const lineOf = (el) => {
  const li = el.closest(".order-line");
  return { ingredient_id: Number(li.dataset.ing), line_group: li.dataset.group, li };
};

lists.addEventListener("change", (e) => {
  if (!e.target.classList.contains("tick")) return;
  const { ingredient_id, line_group } = lineOf(e.target);
  send("PUT", linesPath(), { ingredient_id, line_group, ticked: e.target.checked });
});

lists.addEventListener("toggle", (e) => {
  const k = e.target.dataset?.key;
  if (!k) return;
  if (e.target.open) open.add(k);
  else open.delete(k);
}, true);

lists.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.classList.contains("copy")) {
    const text = listText(groupOfCard(btn.closest(".card")));
    if (!text) return toast("Everything here is ticked off.");
    try {
      await copy(text);
      toast("List copied");
    } catch (err) {
      toast(err.message, { error: true });
    }
  } else if (btn.classList.contains("f-save")) {
    const { ingredient_id, line_group, li } = lineOf(btn);
    const line = data.lines.find((l) => l.ingredient_id === ingredient_id && l.line_group === line_group);
    const body = { ingredient_id, line_group };
    const date = li.querySelector(".f-date").value;
    const supplier = Number(li.querySelector(".f-supplier").value);
    if (date && date !== line.delivery_date) body.delivery_date = date;
    if (supplier && supplier !== line.supplier_id) body.supplier_id = supplier;
    if (Object.keys(body).length === 2) return toast("Nothing to change.");
    await busy(btn, () => send("PUT", linesPath(), body));
    toast("Saved");
  } else if (btn.classList.contains("f-reset")) {
    const { ingredient_id, line_group } = lineOf(btn);
    await busy(btn, () => send("DELETE", linesPath(), { ingredient_id, line_group }));
    toast("Back to automatic");
  }
});

document.getElementById("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  tab = b.dataset.tab;
  try {
    localStorage.setItem("orders-tab", tab);
  } catch {}
  if (data) render();
});

document.getElementById("print").addEventListener("click", () => window.print());

async function init() {
  if (!retreatId) {
    lists.innerHTML = `<div class="empty"><p class="empty-title">Open this page from a retreat</p><div class="actions"><a class="btn btn-outline" href="/retreats.html">Go to retreats</a></div></div>`;
    return;
  }
  document.getElementById("back").href = `/retreat.html?id=${encodeURIComponent(retreatId)}`;
  try {
    data = await api(`/orders/${encodeURIComponent(retreatId)}`);
  } catch (err) {
    lists.innerHTML = `<div class="alert alert-destructive">${icon("circle-alert")}<p class="alert-title">Couldn't load the order lists</p><p class="alert-description">${escape(err.message)}</p></div>`;
    return;
  }
  const r = data.retreat;
  document.title = `Orders · ${r.name}`;
  document.getElementById("title").textContent = r.name;
  document.getElementById("dates").textContent = `Order lists · ${day(r.start_date)} – ${day(r.end_date)}`;
  render();
}

init();
