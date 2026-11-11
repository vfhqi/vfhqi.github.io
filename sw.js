/* Viewforth offline helper. Version 2026-11-11.1 (Systems Architect).
   Covers every Viewforth site on vfhqi.github.io (scope "/").
   Online: always asks the website first, so pages are as live as before, and keeps a copy of what it gets.
   Offline (or no answer within a few seconds): serves the copy saved on this device.
   The Offline Page (/index.html) does the bulk saving; this file only answers page requests. */
"use strict";
const VERSION = "2026-11-11.1";
const CACHE = "vf-offline-v1";
const MODE_KEY = "/__offline__/mode.json";
const BYPASS = "x-vf-offline-fetch";
const WAIT_MS = 6000;                 // no first answer from the website within this time: use the saved copy
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

let preview = { on: false, until: 0 }; // "Browse as if offline" switch, set by the Offline Page
const modeReady = caches.open(CACHE).then(c => c.match(self.location.origin + MODE_KEY))
  .then(r => r ? r.json() : null).then(m => { if (m) preview = m; }).catch(() => {});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "mode") preview = { on: !!d.on, until: d.until || 0 };
  if (d.type === "version") {
    const to = (e.ports && e.ports[0]) || e.source;
    if (to) to.postMessage({ type: "version", version: VERSION });
  }
});

function previewOn() { return preview.on && Date.now() < preview.until; }

/* One saved copy per file: GitHub Pages serves the same file whatever the query string, so the key drops it,
   and a folder address is the folder's index.html. */
function keyOf(u, same) {
  if (!same) return u.href;
  let p = u.pathname;
  if (p.endsWith("/")) p += "index.html";
  return u.origin + p;
}

async function fromCache(key, u, same) {
  const c = await caches.open(CACHE);
  let r = await c.match(key);
  if (!r && same && !/\.[A-Za-z0-9]{1,6}$/.test(u.pathname)) r = await c.match(u.origin + u.pathname + "/index.html");
  return r || null;
}

function notSaved(u) {
  const esc = s => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Not saved for offline reading</title>
<style>body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f7f5ef;color:#23262d;margin:0;padding:12vh 20px}
.box{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3ddcf;border-radius:10px;padding:24px 26px}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 12px;color:#4a4f59}code{font-size:13px;word-break:break-all;color:#6b7280}
a.btn{display:inline-block;margin-top:6px;background:#1f4e79;color:#fff;text-decoration:none;padding:9px 16px;border-radius:7px;font-weight:600}</style></head>
<body><div class="box"><h1>This page is not saved on this device</h1>
<p>You are offline${previewOn() ? " (or browsing as if offline)" : ""}, and this page was not in the saved copy.</p>
<p><code>${esc(u.pathname)}</code></p>
<a class="btn" href="/">Open the Offline Page</a></div></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-vf-offline": "not-saved" } });
}

async function offlineAnswer(req, key, u, same) {
  const hit = await fromCache(key, u, same);
  if (hit) return hit;
  if (req.mode === "navigate") {
    if (same && u.pathname.startsWith("/repository/") && /-A(-and-|&|%26)J-Memo-\d{4}-\d\d-\d\d\.html$/.test(u.pathname)) {   // an old dated memo address: the Repository's own forwarder sends it to the current memo
      const fwd = await (await caches.open(CACHE)).match(u.origin + "/repository/404.html");
      if (fwd) return fwd;
    }
    return notSaved(u);
  }
  return Response.error();
}

function storable(res, same) {
  if (!res) return false;
  if (res.type === "opaque") return !same;           // Google Fonts style sheets only (other hosts are never handled)
  return res.status === 200 && (res.type === "basic" || res.type === "cors") && !res.redirected;
}

async function handle(e, req, u, same) {
  await modeReady;
  const key = keyOf(u, same);
  const offlinePageItself = same && ["/", "/index.html", "/offline-list.json"].includes(u.pathname);
  if (previewOn() && !offlinePageItself) return offlineAnswer(req, key, u, same);   // the switch itself stays reachable
  let stored = null;
  const net = fetch(req).then(res => {
    if (storable(res, same)) {
      const copy = res.clone();
      stored = caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
    }
    return res;
  });
  e.waitUntil(net.then(() => stored).catch(() => {}));
  try {
    const first = await Promise.race([net, new Promise(r => setTimeout(() => r(null), WAIT_MS))]);
    if (first) return first;
    const saved = await fromCache(key, u, same);    // slow or captive connection: saved copy now, the website's answer still updates it
    return saved || await net;
  } catch (err) {
    return offlineAnswer(req, key, u, same);
  }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has(BYPASS) || req.headers.has("range")) return;
  const u = new URL(req.url);
  const same = u.origin === self.location.origin;
  if (same) {
    if (u.pathname === "/sw.js" || u.pathname.startsWith("/__offline__/")) return;
  } else if (!FONT_HOSTS.includes(u.hostname)) {
    return;                                            // GitHub's file lists and every other site: untouched
  }
  e.respondWith(handle(e, req, u, same).catch(() => fetch(req)));
});
