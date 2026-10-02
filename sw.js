/* sw.js — KendinParket PWA service worker (Faz 4)
 * ---------------------------------------------------------------------------
 *  KURAL: /api/* YANITLARI ASLA ONBELLEKTE SAKLANMAZ.
 *  Yanitlar icinde yetki belgesi (token) tasir; onbellege alinmak demek
 *  cihazda uzun omurlu bir yetki birakmak demektir. Bu yuzden API hep
 *  agdan okunur, ag yoksa sunucuya benzer {r:"AG_YOK"} doner (PWA da
 *  kullaniciya "baglanti yok" gosterir, token'i asla sahtelemek zorunda kalmaz).
 *
 *  Sürüm: index.html/app.js/styles.css degistiginde SURUMU ARTIR; eski
 *  onbellekler activate asamasinda silinir (destek dosyaları = yedek URL).
 */
"use strict";

const SURUM = "kp-2026-10-02-3";
const KABUK = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SURUM).then((k) => k.addAll(KABUK)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((anahtarlar) =>
        Promise.all(anahtarlar.filter((a) => a !== SURUM)
                              .map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;               // POSTlar agdan

  // API: ag birincil, onbellek YOK (token siziidence yuzunden)
  if (u.pathname.indexOf("/api/") === 0 || u.pathname.endsWith("/health")) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ r: "AG_YOK" }),
          { status: 503, headers: { "Content-Type": "application/json" } }))
    );
    return;
  }

  // Kabuk: once onbellek, sonra ag (cevrimdisi acilir)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((v) =>
      v || fetch(e.request).then((c) => {
        if (c && c.status === 200 && c.type === "basic") {
          const kopya = c.clone();
          caches.open(SURUM).then((k) => k.put(e.request, kopya));
        }
        return c;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
