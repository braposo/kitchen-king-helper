import { api, escape, qs, toast } from "/lib.js";

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
  const spare = packs && l.leftover > 0 ? ` <span class="muted">${escape(formatSpare(l))} spare</span>` : "";
  const orderBy = l.order_by_date !== l.delivery_date ? ` · order by ${escape(day(l.order_by_date))}` : "";
  const uses = l.uses
    .map((u) => `<li>${escape(day(u.date))} ${escape(u.slot)} · ${escape(u.recipe_title)} (${escape(u.version_label)}) · ${escape(formatAmount(l, u.amount))}</li>`)
    .join("");
  const suppliers = data.suppliers
    .map((s) => `<option value="${s.id}"${s.id === l.supplier_id ? " selected" : ""}>${escape(s.name)}</option>`)
    .join("");
  return `<li class="order-line${l.ticked ? " done" : ""}" data-ing="${l.ingredient_id}" data-group="${escape(l.line_group)}">
    <input type="checkbox" class="tick" aria-label="Got ${escape(l.name)}"${l.ticked ? " checked" : ""}>
    <div class="line-body">
      <details${open.has(k) ? " open" : ""} data-key="${escape(k)}">
        <summary>
          <div><span class="name">${escape(l.name)}</span> — <span class="amount">${escape(l.display)}</span></div>
          ${packs ? `<div class="meta">${escape(packs)}${spare}</div>` : ""}
          <div class="meta muted">${escape(l.supplier_name)}${orderBy}</div>
        </summary>
        <div class="panel">
          <strong>What it's for</strong>
          <ul>${uses}</ul>
          <label>Delivery date<input type="date" class="f-date" value="${escape(l.delivery_date)}"></label>
          <label>Supplier<select class="f-supplier">${suppliers}</select></label>
          <div class="row" style="margin-top:12px">
            <button type="button" class="f-save">Save</button>
            <button type="button" class="secondary f-reset">Reset to automatic</button>
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

function cardHtml(id, title, subtitle, bodyHtml) {
  return `<section class="card" data-card="${id}">
    <h2>${title}</h2>
    ${subtitle ? `<p class="muted">${subtitle}</p>` : ""}
    ${bodyHtml}
    <p class="card-actions"><button type="button" class="secondary copy">Copy list</button></p>
  </section>`;
}

function deliveryTitle(g) {
  const labels = [];
  if (g.pantry) labels.push("Opening order");
  const fresh = [...new Set(g.lines.filter((l) => l.line_group !== "pantry").map((l) => l.line_group))].sort();
  if (fresh.length) labels.push(`Fresh for ${fresh.map(day).join(", ")}`);
  return `${labels.join(" + ")} · delivered ${day(g.delivery_date)}`;
}

function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  if (!data.lines.length) {
    lists.innerHTML = `<section class="card"><p class="muted">Add dishes to the menu to see what to order.</p></section>`;
    return;
  }
  if (tab === "delivery") {
    lists.innerHTML = data.by_delivery
      .map((g, i) => cardHtml(`d${i}`, escape(deliveryTitle(g)), "", `<ul class="order-lines">${sinkTicked(g.lines).map(lineHtml).join("")}</ul>`))
      .join("");
  } else {
    lists.innerHTML = data.by_supplier
      .map((g, i) => {
        const dates = [...new Set(g.lines.map((l) => l.delivery_date))].sort();
        const body = dates
          .map((d) => {
            const lines = g.lines.filter((l) => l.delivery_date === d);
            return `<p class="when">Delivered ${escape(day(d))}</p><ul class="order-lines">${sinkTicked(lines).map(lineHtml).join("")}</ul>`;
          })
          .join("");
        return cardHtml(`s${i}`, escape(g.supplier_name), "", body);
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
    await send("PUT", linesPath(), body);
    toast("Saved");
  } else if (btn.classList.contains("f-reset")) {
    const { ingredient_id, line_group } = lineOf(btn);
    await send("DELETE", linesPath(), { ingredient_id, line_group });
    toast("Back to automatic");
  }
});

document.querySelector(".tabs").addEventListener("click", (e) => {
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
    lists.innerHTML = `<p class="muted">Open this page from a retreat.</p>`;
    return;
  }
  document.getElementById("back").href = `/retreat.html?id=${encodeURIComponent(retreatId)}`;
  try {
    data = await api(`/orders/${encodeURIComponent(retreatId)}`);
  } catch (err) {
    lists.innerHTML = `<p class="warn">${escape(err.message)}</p>`;
    return;
  }
  const r = data.retreat;
  document.title = `Orders · ${r.name}`;
  document.getElementById("title").textContent = r.name;
  document.getElementById("dates").textContent = `${day(r.start_date)} – ${day(r.end_date)}`;
  render();
}

init();
