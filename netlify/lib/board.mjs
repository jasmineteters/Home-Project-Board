// Board logic, kept separate from the Netlify wiring so it can be tested with a fake store.
import { createHmac, timingSafeEqual, createHash, randomBytes } from "node:crypto";
import seed from "./seed.mjs";

const TOKEN_DAYS = 60;
const STATUS = { planned: "Planned", next: "Up next", doing: "In progress", done: "Done" };
const SEASON = { Q1: "Winter", Q2: "Spring", Q3: "Summer", Q4: "Fall" };
const EDITABLE = ["title", "status", "quarter", "who", "costLow", "costHigh", "spent", "notes", "checklist", "order"];
const MAX_ACTIVITY = 400;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const qLabel = (q) => { if (!q) return "not scheduled"; const [y, n] = q.split("-"); return `${SEASON[n] || n} ’${y.slice(2)}`; };
const money = (n) => "$" + Math.round(+n || 0).toLocaleString("en-US");

function secretFrom(env) {
  return createHash("sha256").update("house-ready:" + (env.BOARD_SECRET || "") + ":" + (env.BOARD_PASSWORD || "")).digest();
}
function sign(env, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secretFrom(env)).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(env, token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [body, mac] = token.split(".");
  const expect = createHmac("sha256", secretFrom(env)).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now(); } catch { return false; }
}
function passwordMatches(env, given) {
  const a = createHash("sha256").update(String(given || "")).digest();
  const b = createHash("sha256").update(String(env.BOARD_PASSWORD || "")).digest();
  return !!env.BOARD_PASSWORD && timingSafeEqual(a, b);
}

async function ensureSeeded(store) {
  const meta = await store.get("meta", { type: "json" });
  if (meta) return;
  for (const [id, p] of Object.entries(seed.projects)) await store.setJSON("projects/" + id, p);
  await store.setJSON("family", seed.family);
  await store.setJSON("activity", []);
  await store.setJSON("meta", seed.meta);
}

async function readAll(store) {
  const { blobs } = await store.list({ prefix: "projects/" });
  const projects = (await Promise.all(blobs.map(async (b) => {
    const p = await store.get(b.key, { type: "json" });
    return p ? { id: b.key.slice("projects/".length), ...p } : null;
  }))).filter(Boolean);
  const [meta, family, activity] = await Promise.all([
    store.get("meta", { type: "json" }), store.get("family", { type: "json" }), store.get("activity", { type: "json" }),
  ]);
  return { projects, meta: meta || seed.meta, family: family || [], activity: (activity || []).slice(0, 80) };
}

async function log(store, who, texts, projectId) {
  if (!Array.isArray(texts)) texts = [texts];
  if (!texts.length) return;
  const list = (await store.get("activity", { type: "json" })) || [];
  const at = new Date().toISOString();
  for (const text of texts) list.unshift({ who, text, projectId: projectId || null, at });
  await store.setJSON("activity", list.slice(0, MAX_ACTIVITY));
}

function clean(patch) {
  const out = {};
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (["costLow", "costHigh", "spent", "order"].includes(k)) v = Math.max(0, Math.round(+v || 0));
    else if (k === "checklist") v = Array.isArray(v) ? v.slice(0, 100).map((c) => ({ t: String(c.t || "").slice(0, 300), done: !!c.done })).filter((c) => c.t) : [];
    else if (k === "status") v = STATUS[v] ? v : "planned";
    else if (k === "who") v = ["DIY", "Hire", "Mix"].includes(v) ? v : "DIY";
    else v = String(v ?? "").slice(0, k === "notes" ? 5000 : 200);
    out[k] = v;
  }
  return out;
}

// Plain-English description of what changed, for the activity log.
export function describe(before, after) {
  const t = `“${after.title || before.title}”`;
  const parts = [];
  if (after.title !== undefined && after.title !== before.title) parts.push(`renamed “${before.title}” to “${after.title}”`);
  if (after.status !== undefined && after.status !== before.status) parts.push(`moved ${t} to ${STATUS[after.status]}`);
  if (after.quarter !== undefined && after.quarter !== before.quarter) parts.push(`rescheduled ${t} to ${qLabel(after.quarter)}`);
  if (after.who !== undefined && after.who !== before.who) parts.push(`set ${t} to ${after.who}`);
  if (after.spent !== undefined && +after.spent !== +(before.spent || 0)) parts.push(`updated spent on ${t} to ${money(after.spent)}`);
  const lo = after.costLow ?? before.costLow, hi = after.costHigh ?? before.costHigh;
  if ((after.costLow !== undefined && +after.costLow !== +(before.costLow || 0)) || (after.costHigh !== undefined && +after.costHigh !== +(before.costHigh || 0)))
    parts.push(`changed the estimate for ${t} to ${money(lo)}–${money(hi)}`);
  if (after.notes !== undefined && after.notes !== (before.notes || "")) parts.push(`edited notes on ${t}`);
  if (after.checklist) {
    const old = before.checklist || [];
    const oldMap = new Map(old.map((c) => [c.t, c.done]));
    const newMap = new Map(after.checklist.map((c) => [c.t, c.done]));
    for (const c of after.checklist) {
      if (!oldMap.has(c.t)) parts.push(`added step “${c.t}” to ${t}`);
      else if (oldMap.get(c.t) !== c.done) parts.push(`${c.done ? "checked off" : "unchecked"} “${c.t}” on ${t}`);
    }
    for (const c of old) if (!newMap.has(c.t)) parts.push(`removed step “${c.t}” from ${t}`);
  }
  return parts;
}

export async function handle(req, store, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = req.method.toUpperCase();
  let body = {};
  if (method !== "GET" && method !== "HEAD") { try { body = await req.json(); } catch { body = {}; } }

  if (path === "login" && method === "POST") {
    if (!env.BOARD_PASSWORD) return json(500, { error: "The site owner hasn't set BOARD_PASSWORD in Netlify yet." });
    if (!passwordMatches(env, body.password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return json(401, { error: "That password isn't right." });
    }
    return json(200, { token: sign(env, { exp: Date.now() + TOKEN_DAYS * 864e5, n: randomBytes(6).toString("hex") }) });
  }

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!verify(env, auth)) return json(401, { error: "Please sign in again." });

  await ensureSeeded(store);

  if (path === "state" && method === "GET") return json(200, await readAll(store));

  const family = (await store.get("family", { type: "json" })) || [];

  if (path === "family" && method === "POST") {
    const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return json(400, { error: "Type a name first." });
    if (family.some((f) => f.toLowerCase() === name.toLowerCase())) return json(200, { family, name: family.find((f) => f.toLowerCase() === name.toLowerCase()) });
    const next = [...family, name];
    await store.setJSON("family", next);
    await log(store, name, "joined the board");
    return json(200, { family: next, name });
  }

  const who = String(body.name || "");
  if (!family.includes(who)) return json(400, { error: "Pick your name before making changes." });

  if (path === "meta" && method === "PUT") {
    const meta = (await store.get("meta", { type: "json" })) || seed.meta;
    const lt = String(body.listTarget || "");
    if (!/^\d{4}-\d{2}-01$/.test(lt)) return json(400, { error: "That date doesn't look right." });
    if (lt !== meta.listTarget) {
      const next = { ...meta, listTarget: lt };
      await store.setJSON("meta", next);
      const d = new Date(lt + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      await log(store, who, `moved the target listing date to ${d}`);
      return json(200, { meta: next });
    }
    return json(200, { meta });
  }

  if (path === "projects" && method === "POST") {
    const id = "p" + Date.now().toString(36) + randomBytes(3).toString("hex");
    const data = { title: "New project", status: "planned", quarter: "", who: "DIY", costLow: 0, costHigh: 0, spent: 0, notes: "", checklist: [], order: Date.now(), ...clean(body.data || {}) };
    data.updatedBy = who; data.updatedAt = new Date().toISOString();
    await store.setJSON("projects/" + id, data);
    await log(store, who, `added “${data.title}”`, id);
    return json(200, { project: { id, ...data } });
  }

  const m = path.match(/^projects\/([A-Za-z0-9_-]{1,60})$/);
  if (m) {
    const key = "projects/" + m[1];
    const before = await store.get(key, { type: "json" });
    if (!before) return json(404, { error: "That project was deleted." });
    if (method === "DELETE") {
      await store.delete(key);
      await log(store, who, `deleted “${before.title}”`, m[1]);
      return json(200, { ok: true });
    }
    if (method === "PATCH") {
      const patch = clean(body.patch || {});
      const changes = describe(before, patch);
      const next = { ...before, ...patch };
      if (changes.length) { next.updatedBy = who; next.updatedAt = new Date().toISOString(); }
      await store.setJSON(key, next);
      await log(store, who, changes, m[1]);
      return json(200, { project: { id: m[1], ...next } });
    }
  }
  return json(404, { error: "Not found." });
}
