import { api, escape, icon } from "/lib.js";

const today = new Date().toISOString().slice(0, 10);
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const short = (date) => shortFmt.format(new Date(`${date}T00:00:00Z`));
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const hour = new Date().getHours();
document.getElementById("greeting").textContent = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
document.getElementById("today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** The retreat happening now, else the next one, else the latest past one. */
function pick(retreats) {
  const sorted = [...retreats].sort((a, b) => a.start_date.localeCompare(b.start_date));
  return sorted.find((r) => r.end_date >= today) ?? sorted.at(-1) ?? null;
}

function nextCard(r) {
  const running = r.start_date <= today && today <= r.end_date;
  const past = r.end_date < today;
  const days = daysBetween(today, r.start_date);
  const status = running
    ? `<span class="badge">In progress</span>`
    : past
      ? `<span class="badge badge-secondary">Last retreat</span>`
      : `<span class="badge badge-outline">${days === 1 ? "Tomorrow" : `In ${days} days`}</span>`;
  const dates = r.start_date === r.end_date ? short(r.start_date) : `${short(r.start_date)} – ${short(r.end_date)}`;
  const sheet = running
    ? `<a class="btn btn-outline" href="/print-day.html?retreat=${r.id}&date=${today}">${icon("printer")}Today's sheet</a>`
    : "";
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <p class="xs muted medium" style="margin-bottom:0.5rem">${running ? "Now" : past ? "Most recent" : "Up next"}</p>
          <h2 class="card-title" style="font-size:1.25rem">${escape(r.name)}</h2>
        </div>
        ${status}
      </div>
      <div class="meta-row">
        <span>${icon("calendar")}${escape(dates)}</span>
        <span>${icon("users")}${r.headcount} people</span>
      </div>
      <div class="card-footer">
        <a class="btn" href="/retreat.html?id=${r.id}">Open menu plan</a>
        <a class="btn btn-outline" href="/orders.html?retreat=${r.id}">${icon("shopping-basket")}Orders</a>
        ${sheet}
      </div>
    </section>`;
}

const next = document.getElementById("next");
const stat = (name, value) => (document.querySelector(`[data-stat=${name}]`).textContent = value);

const [retreats, recipes, ingredients] = await Promise.all(
  ["/retreats", "/recipes", "/ingredients"].map((path) => api(path).catch(() => null)),
);
stat("retreats", retreats?.length ?? "–");
stat("recipes", recipes?.length ?? "–");
stat("ingredients", ingredients?.length ?? "–");

const r = retreats && pick(retreats);
next.innerHTML = r
  ? nextCard(r)
  : `<div class="empty">
      <div class="empty-media">${icon("calendar", { size: 20 })}</div>
      <p class="empty-title">${retreats ? "No retreats yet" : "Couldn't load retreats"}</p>
      <p class="empty-description">${retreats ? "Create a retreat to start planning its menu and orders." : "Check your connection and reload the page."}</p>
      ${retreats ? `<div class="actions"><a class="btn" href="/retreats.html#new">${icon("plus")}New retreat</a></div>` : ""}
    </div>`;
