// Shared helpers for every page. Import with:
//   import { api, escape, qs, toast, confirmDialog, skeleton, busy } from "/lib.js";
import { icon } from "/icons.js";
export { icon };

/** Calls the JSON API. Throws an Error with the server's message on failure. */
export async function api(path, { method = "GET", body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

/** Escapes text for safe use inside HTML. */
export function escape(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Reads a query-string parameter from the current URL. */
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Shows a short message near the bottom of the screen (shadcn Sonner style). */
export function toast(message, { error = false } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.append(el);
  }
  el.innerHTML = `${icon(error ? "circle-alert" : "check")}<span>${escape(message)}</span>`;
  el.className = error ? "show error" : "show";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.className = error ? "error" : ""), error ? 4500 : 2600);
}

/**
 * Asks the chef to confirm, in a shadcn-style alert dialog. Resolves true when they confirm.
 *   if (!(await confirmDialog({ title: "Delete this meal?", description: "Its dishes go too.", confirm: "Delete" }))) return;
 */
export function confirmDialog({ title, description = "", confirm = "Continue", cancel = "Cancel", destructive = true }) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog";
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.innerHTML = `
    <h2 class="dialog-title" id="dialog-title">${escape(title)}</h2>
    ${description ? `<p class="dialog-description">${escape(description)}</p>` : ""}
    <form method="dialog" class="dialog-footer">
      <button class="btn btn-outline" value="cancel">${escape(cancel)}</button>
      <button class="btn ${destructive ? "btn-destructive" : ""}" value="ok">${escape(confirm)}</button>
    </form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok");
      dialog.remove();
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close("cancel"); // a tap on the backdrop cancels
    });
    dialog.showModal();
    dialog.querySelector("[value=ok]").focus();
  });
}

/** Placeholder lines while something loads: skeleton(3). */
export function skeleton(lines = 3) {
  return `<div class="stack-sm" aria-busy="true" aria-label="Loading">${Array.from(
    { length: lines },
    (_, i) => `<div class="skeleton skeleton-line" style="width:${[92, 70, 84, 60][i % 4]}%"></div>`,
  ).join("")}</div>`;
}

/** Shows a spinner on a button while `work` runs, and stops double taps. */
export async function busy(button, work) {
  const before = button.innerHTML;
  button.classList.add("is-busy");
  button.disabled = true;
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${button.textContent.trim()}`;
  try {
    return await work();
  } finally {
    button.classList.remove("is-busy");
    button.disabled = false;
    button.innerHTML = before;
  }
}

/** Swaps every <span data-icon="name"> inside `root` for its Lucide icon. Runs once on load. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    el.outerHTML = icon(el.dataset.icon, { size: Number(el.dataset.size) || 16 });
  }
}
hydrateIcons();
