// Shared helpers for every page. Import with:
//   import { api, escape, qs, toast } from "/lib.js";

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

/** Shows a short message at the bottom of the screen. */
export function toast(message, { error = false } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.className = error ? "show error" : "show";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.className = ""), 3000);
}
