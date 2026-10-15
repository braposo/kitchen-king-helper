import { api, escape, icon, toast, busy } from "/lib.js";

const list = document.getElementById("list");
const form = document.getElementById("new-form");
const today = new Date().toISOString().slice(0, 10);

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const yearFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const fmt = (date) => dayFmt.format(new Date(date));

function dates(r) {
  const year = yearFmt.format(new Date(r.end_date));
  return r.start_date === r.end_date ? `${fmt(r.start_date)} ${year}` : `${fmt(r.start_date)} – ${fmt(r.end_date)} ${year}`;
}

/** A small calendar tile: month over day number. */
function dateTile(date) {
  const d = new Date(date);
  return `<span class="item-media date-tile" aria-hidden="true"><span>${monthFmt.format(d)}</span><strong>${d.getUTCDate()}</strong></span>`;
}

function row(r) {
  const running = r.start_date <= today && today <= r.end_date;
  return `
    <div class="retreat" data-id="${r.id}">
      <div class="item">
        <a class="item-link" href="/retreat.html?id=${r.id}">
          ${dateTile(r.start_date)}
          <span class="item-content">
            <span class="item-title">${escape(r.name)}</span>
            <span class="item-description">${escape(dates(r))} · ${r.headcount} people</span>
          </span>
        </a>
        ${running ? `<span class="badge">Now</span>` : ""}
        <button class="btn btn-ghost btn-icon btn-sm" data-action="duplicate" aria-expanded="false" aria-label="Duplicate ${escape(r.name)}" title="Duplicate">${icon("copy-plus")}</button>
      </div>
      <form class="dup" hidden>
        <p class="small muted">Copy the whole menu plan to new dates.</p>
        <div class="grid-2">
          <div class="field"><label for="dup-name-${r.id}">New name</label><input id="dup-name-${r.id}" name="name" required value="${escape(r.name)} (copy)"></div>
          <div class="field"><label for="dup-start-${r.id}">First day</label><input id="dup-start-${r.id}" name="start_date" type="date" required></div>
        </div>
        <div class="actions"><button class="btn btn-sm" type="submit">Copy retreat</button><button type="button" class="btn btn-ghost btn-sm" data-action="cancel">Cancel</button></div>
      </form>
    </div>`;
}

function group(title, retreats) {
  if (!retreats.length) return "";
  return `<h2 class="section-title">${title}</h2><div class="card card-flush"><div class="item-list">${retreats.map(row).join("")}</div></div>`;
}

async function load() {
  try {
    const retreats = await api("/retreats");
    if (!retreats.length) {
      list.innerHTML = `
        <div class="empty">
          <div class="empty-media">${icon("calendar", { size: 20 })}</div>
          <p class="empty-title">No retreats yet</p>
          <p class="empty-description">Create your first retreat below. Each day gets brunch, snacks and dinner to plan.</p>
        </div>`;
      return;
    }
    const upcoming = retreats.filter((r) => r.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const past = retreats.filter((r) => r.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date));
    list.innerHTML = group("Upcoming", upcoming) + group("Past", past);
  } catch (err) {
    list.innerHTML = `<div class="alert alert-destructive">${icon("circle-alert")}<p class="alert-title">Couldn't load retreats</p><p class="alert-description">${escape(err.message)}</p></div>`;
  }
}

list.addEventListener("click", (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const retreat = button.closest(".retreat");
  const dup = retreat.querySelector(".dup");
  const toggle = retreat.querySelector("[data-action=duplicate]");
  dup.hidden = button.dataset.action === "cancel" ? true : !dup.hidden;
  toggle.setAttribute("aria-expanded", String(!dup.hidden));
  if (!dup.hidden) dup.querySelector("[name=start_date]").focus();
});

list.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.closest(".retreat").dataset.id;
  const data = new FormData(e.target);
  try {
    await busy(e.target.querySelector("[type=submit]"), async () => {
      const copy = await api(`/retreats/${id}/duplicate`, { method: "POST", body: { name: data.get("name"), start_date: data.get("start_date") } });
      location.href = `/retreat.html?id=${copy.id}`;
    });
  } catch (err) {
    toast(err.message, { error: true });
  }
});

// If the last day is empty or before the first, follow the first day.
document.getElementById("start").addEventListener("change", (e) => {
  const end = document.getElementById("end");
  if (!end.value || end.value < e.target.value) end.value = e.target.value;
});

document.getElementById("new-link").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("new").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("name").focus({ preventScroll: true });
});
if (location.hash === "#new") setTimeout(() => document.getElementById("name").focus(), 50);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = (id) => document.getElementById(id).value;
  try {
    await busy(form.querySelector("[type=submit]"), async () => {
      const created = await api("/retreats", {
        method: "POST",
        body: {
          name: val("name"),
          start_date: val("start"),
          end_date: val("end"),
          headcount: Number(val("headcount")),
          buffer_percent: Number(val("buffer")),
        },
      });
      location.href = `/retreat.html?id=${created.id}`;
    });
  } catch (err) {
    toast(err.message, { error: true });
  }
});

await load();
