import { api, escape, toast } from "/lib.js";

const list = document.getElementById("list");
const form = document.getElementById("new-form");

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const yearFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "UTC" });
const fmt = (date) => dayFmt.format(new Date(date));

function dates(r) {
  const year = yearFmt.format(new Date(r.end_date));
  return r.start_date === r.end_date ? `${fmt(r.start_date)} ${year}` : `${fmt(r.start_date)} – ${fmt(r.end_date)} ${year}`;
}

async function load() {
  try {
    const retreats = await api("/retreats");
    list.innerHTML = retreats.length
      ? retreats
          .map(
            (r) => `
      <div class="retreat" data-id="${r.id}">
        <div class="spread">
          <div><a href="/retreat.html?id=${r.id}"><strong>${escape(r.name)}</strong></a><br>
            <span class="muted">${escape(dates(r))} · ${r.headcount} people</span></div>
          <button class="secondary" data-action="duplicate">Duplicate</button>
        </div>
        <form class="dup" hidden>
          <label>New name</label>
          <input name="name" required value="${escape(r.name)} (copy)">
          <label>First day</label>
          <input name="start_date" type="date" required>
          <p class="row"><button type="submit">Copy retreat</button><button type="button" class="secondary" data-action="cancel">Cancel</button></p>
        </form>
        <hr>
      </div>`,
          )
          .join("")
      : `<p class="muted">No retreats yet. Create one below.</p>`;
  } catch (err) {
    list.innerHTML = `<p class="warn">Could not load retreats (${escape(err.message)}).</p>`;
  }
}

list.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  const dup = e.target.closest(".retreat")?.querySelector(".dup");
  if (action === "duplicate") dup.hidden = !dup.hidden;
  if (action === "cancel") dup.hidden = true;
});

list.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.closest(".retreat").dataset.id;
  const data = new FormData(e.target);
  try {
    const copy = await api(`/retreats/${id}/duplicate`, { method: "POST", body: { name: data.get("name"), start_date: data.get("start_date") } });
    location.href = `/retreat.html?id=${copy.id}`;
  } catch (err) {
    toast(err.message, { error: true });
  }
});

// If the last day is empty or before the first, follow the first day.
document.getElementById("start").addEventListener("change", (e) => {
  const end = document.getElementById("end");
  if (!end.value || end.value < e.target.value) end.value = e.target.value;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = (id) => document.getElementById(id).value;
  try {
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
  } catch (err) {
    toast(err.message, { error: true });
  }
});

await load();
