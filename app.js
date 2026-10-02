/* KendinParket PWA — Faz 4
 * ---------------------------------------------------------------------------
 *  GIZLI ANAHTAR BURADA YOKTUR (K7). Bu dosya yalnizca PUBLIC bilgi tasir:
 *  sunucu adresi, gate_id ve backend'in imzaladigi yetki belgesi (token).
 *
 *  Akis (docs/PROTOKOL.md §2 / §4):
 *    1) POST /api/pay/session     -> oturum (odeme saglayicisina yonlendirme)
 *    2) odeme saglayicisi webhook -> backend odeme verify eder + token uretir
 *    3) GET  /api/pay/status      -> token + kapi durumu (polling)
 *    4) push kanali kapida acilir; internetsizse YEREL kanal:
 *         http://192.168.4.1/ac#<token>   (mixed-content cozumu: fragment)
 *
 *  Hata kodlari ve kullanici mesajlari docs/PROTOKOL.md §4 tablosundadir.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const YEREL_KAPI = "http://192.168.4.1";
const ANAHTAR_API = "kpApi";
/* Yayinlanirken (GitHub Pages) backend adresiyle doldurulur; ornek:
 *   const VARSAYILAN_API = "https://api.kendinparket.example";
 * Bos birakilirsa kullanici "Sunucu adresi" baglantisindan girer (test icin). */
const VARSAYILAN_API = "";
const POLL_MS = 2000;
const POLL_SINIR = 90;               // ~3 dk

const HATA = {
  E_FMT:  "Geçersiz istek. Sayfayı yenileyip tekrar deneyin.",
  E_ALG:  "Yetki doğrulanamadı.",
  E_SIG:  "Yetki doğrulanamadı (belge değiştirilmiş olabilir).",
  E_ISS:  "Yetki doğrulanamadı.",
  E_GID:  "Bu kapı için yetkiniz yok.",
  E_ACT:  "Yetki doğrulanamadı.",
  E_IAT:  "Sistem saati hatalı, birkaç saniye sonra tekrar deneyin.",
  E_EXP:  "Yetkinizin süresi doldu. “Yetkiyi yenile” ile yenileyin.",
  E_JTI:  "Bu yetki daha önce kullanılmış.",
  E_CLOCK:"Bağlantıyı kontrol edin (saat senkron değil).",
  E_RATE: "Çok fazla deneme. Lütfen bekleyin.",
  E_LOCK: "Deneme limiti aşıldı. Yetkiliye başvurun.",
  E_STATE:"Kapı hazır değil (arıza).",
  E_CH:   "Bu kanal kapalı — kendinparket ağına bağlanın.",
  E_PAY_SIG:"Ödeme imzası doğrulanamadı.",
  E_PAY_STATUS:"Ödeme tamamlanmamış.",
  E_RECEIPT:"Ödeme kaydı bulunamadı.",
  E_SESSION:"Oturum bulunamadı. Sayfayı yenileyin.",
  E_AUTH: "Yetkiniz yok.",
  E_CFG:  "Sunucu yapılandırması eksik.",
  E_YOL:  "Bulunamadı.",
  E_RATE_BE: "Lütfen bekleyin."
};

let oturum = null;
let token = null;
let gate = "GATE_01";
let bekleme = null;
let testModu = false;
let mesajKilidi = 0;        // yenileme mesajinin polling ile 2 sn'de silinmemesi icin

/* ---------------------------------------------------------------- sunucu */
/* QR ile gelen adresteki parametreler (?gate=GATE_01&ucret=50&api=...) */
function apiBaz() {
  const p = new URLSearchParams(location.search);
  if (p.get("api")) localStorage.setItem(ANAHTAR_API, p.get("api"));

  if (p.get("gate")) {
    gate = (p.get("gate") || "").trim().toUpperCase();
    $("gate").value = gate;
    // Kapida asili QR'dan gelindi: teknik alan gizlenir, ad rozette gorunur
    const alan = $("kapAlan"), rozet = $("kapRozet");
    if (alan) alan.hidden = true;
    if (rozet) { rozet.hidden = false; rozet.textContent = "Kapı: " + gate; }
  }
  if (p.get("ucret")) {
    const u = Number(p.get("ucret"));
    if (u > 0) $("tutar").value = u;
  }
  return (localStorage.getItem(ANAHTAR_API) || VARSAYILAN_API || "")
    .replace(/\/+$/, "");
}

async function istek(yol, veri) {
  const baz = apiBaz();
  if (!baz) throw { kp: "E_CFG" };
  const secim = { method: veri ? "POST" : "GET", cache: "no-store" };
  if (veri) {
    secim.headers = { "Content-Type": "application/json" };
    secim.body = JSON.stringify(veri);
  }
  let cevap;
  try {
    cevap = await fetch(baz + yol, secim);
  } catch (e) {
    throw { kp: "AG_YOK" };
  }
  let govde = {};
  try { govde = await cevap.json(); } catch (e) { throw { kp: "E_FMT" }; }
  if (!cevap.ok || (govde.r && govde.r !== "ACCEPT" && cevap.ok)) {
    if (govde.r && govde.r !== "ACCEPT") throw { kp: govde.r };
    if (!cevap.ok) throw { kp: "E_FMT" };
  }
  return govde;
}

/* ---------------------------------------------------------------- ekran */
function durumGoster(yazi, tip, ayrinti) {
  $("durumKutu").classList.remove("gizli", "ok", "hata", "uyari");
  $("durumKutu").classList.add(tip || "uyari");
  $("durum").textContent = yazi;
  $("ayrinti").textContent = ayrinti || "";
}
function gizle() { $("durumKutu").classList.add("gizli"); }
function mesaj(kod) {
  return HATA[kod] || "Beklenmeyen hata (" + kod + ").";
}
function dugmeler(yenile, yerel, tekrar) {
  $("btnYenile").hidden = !yenile;
  $("btnYerel").hidden = !yerel;
  $("btnTekrar").hidden = !tekrar;
}

async function agGuncelle() {
  const etiket = $("ag");
  if (!navigator.onLine) {
    etiket.textContent = "çevrimdışı — yerel ağ hazır";
    etiket.className = "rozet rozet-kotu";
    return;
  }
  try {
    const c = await istek("/health");
    etiket.textContent = apiBaz() ? "sunucu bağlı" : "sunucu adresi girilmedi";
    etiket.className = "rozet " + (apiBaz() && c.ok ? "rozet-iyi" : "rozet-?");
    if (c && c.ok && !apiBaz()) { /* bos */ }
  } catch (e) {
    etiket.textContent = "sunucuya ulaşılamıyor";
    etiket.className = "rozet rozet-kotu";
  }
}

/* ---------------------------------------------------------------- akis */
async function odemeBaslat() {
  gate = ($("gate").value || "").trim().toUpperCase() || "GATE_01";
  const tutar = Number($("tutar").value) || 0;
  if (!tutar || tutar <= 0) { durumGoster("Geçersiz tutar", "hata"); return; }

  token = null;
  oturum = null;
  dugmeler(false, false, false);
  $("btnOdeme").disabled = true;
  $("btnTest").hidden = true;
  durumGoster("Ödeme başlatılıyor…", "uyari");

  try {
    const c = await istek("/api/pay/session",
      { gate_id: gate, amount: tutar, currency: "TRY" });
    oturum = c.session_id;
    testModu = !!(c.fields && c.fields.test);
    if (testModu) $("btnTest").hidden = false;
    durumGoster("Ödeme bekleniyor", "uyari",
      testModu ? "Test modu: “Test ödemesi yap” düğmesine basın."
               : "Ödeme sayfasına yönlendiriliyorsunuz…");
    if (!testModu && c.action && c.action.indexOf("#") !== 0) {
      // Saglayicinin barindirdigi odeme sayfasina GEC (PWA'da sifir sır)
      const f = document.createElement("form");
      f.method = "POST"; f.action = c.action;
      Object.keys(c.fields || {}).forEach((k) => {
        const i = document.createElement("input");
        i.name = k; i.value = c.fields[k]; f.appendChild(i);
      });
      document.body.appendChild(f); f.submit();
      return;
    }
    beklemeBaslat();
  } catch (e) {
    durumGoster("Ödeme başlatılamadı", "hata", mesaj(e.kp));
    $("btnOdeme").disabled = false;
  }
}

async function testOdeme() {
  if (!oturum) return;
  $("btnTest").hidden = true;
  try {
    await istek("/api/pay/verify",
      { receipt: oturum, amount: Number($("tutar").value) || 0,
        currency: "TRY", status: "ok" });
    durumGoster("Ödeme alındı", "uyari", "Yetki belgesi isteniyor…");
    beklemeBaslat();
  } catch (e) {
    durumGoster("Test ödemesi başarısız", "hata", mesaj(e.kp));
  }
}

function beklemeBaslat() {
  if (bekleme) clearInterval(bekleme);
  let sayac = 0;
  bekleme = setInterval(async () => {
    sayac++;
    if (sayac > POLL_SINIR) {
      clearInterval(bekleme); bekleme = null;
      durumGoster("Yanıt alınamadı", "hata",
        "Sunucuya ulaşılamıyor. İnternetinizi kontrol edip tekrar deneyin.");
      dugmeler(true, false, true);
      return;
    }
    try {
      const c = await istek("/api/pay/status?session_id=" + encodeURIComponent(oturum));
      if (c.status === "paid" && c.token) {
        token = c.token;
        localStorage.setItem("kpToken", token);
        localStorage.setItem("kpGate", gate);
        if (c.gate_state === "opened" || c.gate_state === "opening") {
          clearInterval(bekleme); bekleme = null;
          durumGoster(c.gate_state === "opened" ? "Kapı açıldı" : "Kapı açılıyor",
            "ok", "");
          dugmeler(false, true, false);
          return;
        }
        if (Date.now() < mesajKilidi) return;   // yenileme mesaji ekranda kalsin
        durumGoster("Yetki alındı", "uyari",
          "Kapıya komut gönderildi. Kapı açılmazsa “Kapıyı yerel ağda aç” ile deneyin.");
        dugmeler(true, true, true);
        return;
      }
      durumGoster("Ödeme bekleniyor", "uyari", "Doğrulanıyor… (" + sayac + ")");
    } catch (e) {
      // sunucuya ulaşılamıyorsa sessizce devam; token varsa yerel kanal açık
      if (e.kp === "AG_YOK") {
        durumGoster("Bağlantı yok", "uyari",
          "Sunucuya ulaşılamıyor. Elinizde yetki varsa yerel ağdan açabilirsiniz.");
        dugmeler(true, !!token, true);
      }
    }
  }, POLL_MS);
}

/* Idempotent yeniden-imzalama (docs §2 S6): ayni makbuz, taze belge */
async function yetkiYenile() {
  if (!oturum) return;
  $("btnYenile").disabled = true;
  try {
    const c = await istek("/api/pay/refresh", { session_id: oturum });
    token = c.token;
    localStorage.setItem("kpToken", token);
    mesajKilidi = Date.now() + 4000;      // 4 sn boyunca polling mesaji ezmesin
    durumGoster("Yetki yenilendi", "ok", "Kapıya gönderiliyor…");
    dugmeler(true, true, false);
  } catch (e) {
    durumGoster("Yetki yenilenemedi", "hata", mesaj(e.kp));
  }
  $("btnYenile").disabled = false;
}

/* Yerel kanal (CH_LOCAL): mixed-content nedeniyle fetch DEGIL, sayfa acilir.
   Token adresteki fragment'ta gider; sunucuya hicbir zaman gitmez. */
function yerelAc() {
  const t = token || localStorage.getItem("kpToken");
  if (!t) { durumGoster("Yetki belgesi yok", "hata"); return; }
  const url = YEREL_KAPI + "/ac#" + encodeURIComponent(t);
  const w = window.open(url, "_blank");
  if (!w) location.href = url;
}

function tekrarDene() {
  $("btnOdeme").disabled = false;
  gizle();
  if (oturum) beklemeBaslat();
  else odemeBaslat();
}

/* ---------------------------------------------------------------- kurulum */
$("btnOdeme").addEventListener("click", odemeBaslat);
$("btnTest").addEventListener("click", testOdeme);
$("btnYenile").addEventListener("click", yetkiYenile);
$("btnYerel").addEventListener("click", yerelAc);
$("btnTekrar").addEventListener("click", tekrarDene);
$("lnkAyar").addEventListener("click", (e) => {
  e.preventDefault();
  const v = prompt("Backend adresi (HTTPS):", apiBaz() || "https://");
  if (v) { localStorage.setItem(ANAHTAR_API, v.replace(/\/+$/, "")); agGuncelle(); }
});
window.addEventListener("online", agGuncelle);
window.addEventListener("offline", agGuncelle);

if (localStorage.getItem("kpGate")) $("gate").value = localStorage.getItem("kpGate");
apiBaz();
agGuncelle();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
