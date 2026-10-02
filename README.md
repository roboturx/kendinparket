# KendinParket PWA (Faz 4)

Statik, **APK gerektirmeyen** erişim arayüzü. GitHub Pages'te yayınlanır;
**repoda ve PWA'da hiçbir gizli anahtar yoktur** (K7).

## Dosyalar

| Dosya | Görev |
|---|---|
| `index.html` | Tek sayfa akış (durum makinesi) |
| `app.js` | İstemciler, hata kodu → Türkçe mesaj tablosu, polling |
| `styles.css` | Arayüz |
| `manifest.webmanifest` | "Ana ekrana ekle" — `display: standalone` |
| `sw.js` | Service worker — **sürümleme + eski cache temizliği** |
| `icon.svg` | PWA simgesi |

## Yapılandırma (gizli anahtar yok)

| Parametre | Nerede | Örnek |
|---|---|---|
| `api` | URL veya `localStorage.kpApi` | `?api=https://api.kendinparket.example` |
| `gate` | URL veya `localStorage.kpGate` | `?gate=GATE_01` |

`index.html?api=<backend>&gate=<gate>` — QR ile dağıtılabilir.

## Akış

```
sağlık kontrolü → oturum aç → ödeme (sağlayıcının sayfası) → status polling
   → paid + token → [ Kapıyı aç / Yerel ağda aç / Yenile ]
```

- **Server-push:** backend token'ı kapıya iletir; PWA beklemez, `gate_state`'i okur.
- **Yerel fallback:** `window.open('http://192.168.4.1/ac#' + token)` —
  **fragment sunucuya gitmez**, sayfa kendi origin'inden `POST /api/open` eder.
  `fetch` ile yapılsaydı **mixed-content** ihlali olurdu; bu yüzden `window.open`.
- **Yenileme (S6):** `POST /api/pay/refresh {session_id}` → idempotent, **admin anahtarsız**.

## Yerel test

```powershell
C:\Python313\python.exe -m http.server 8080 --bind 127.0.0.1 --directory pwa
# http://127.0.0.1:8080/index.html?api=http://127.0.0.1:8443&gate=GATE_01
```

## GitHub Pages dağıtımı

1. Repo → *Settings → Pages → Deploy from a branch* → `main` / `/ (root)`.
2. `pwa/` klasörünü Pages'in köküne koyun (`pwa/index.html` → kök `index.html`).
   Kök farklıysa: `sw.js` içindeki `KABUK` yollarını **kendine göre** düzeltin.
3. Backend adresi: `app.js` başındaki **`VARSAYILAN_API`** sabitini yayın
   backend adresine çevirin (ör. `https://api.kendinparket.example`).
   Boş bırakılırsa kullanıcı arayüzdeki "Sunucu adresi" bağlantısından girer
   (yalnız test için). `?api=` yalnızca acil/süreç dışı geçersiz kılmadır.
4. **Yedek URL (kontrol listesi §GH):** Pages erişilemezse ikinci bir
   statik sağlayıcıda aynı `pwa/` kopyası yayınlanır; adres QR'de ikinci
   satır olarak basılır. Backend URL'si değişmez → kapı etkilenmez.

## Kapı QR'si (asıl QR hedefi)

Kapıya/afişe basılan QR tek adresi kodlar — **parametreler QR'nin içinde gelir**,
kullanıcı hiçbir şey yazmaz:

| Parametre | Zorunlu | Etkisi |
|---|---|---|
| `gate` | evet | Kapı kimliği. Alan gizlenir, rozette **"Kapı: GATE_01"** görünür, istemci `sub`/`gid` alanını bu değerle doldurur. |
| `ucret` | hayır | Tutar önceden doldurulur (kapı tarifesi). Yoksa alan boş kalır, kullanıcı girer. |
| `api` | hayır | Acil override; normalde `VARSAYILAN_API` kullanılır. |

Örnek QR içeriği:

```
https://<kullanici>.github.io/<repo>/?gate=GATE_01&ucret=50
```

Kurulum:

1. QR'yü **adres üretiminden sonra** basın (adres henüz yokken basılan QR işe yaramaz).
2. Adres `https` olmalı (Pages varsayılanı zaten öyledir); kapıya **http** basmayın.
3. Birden çok kapı varsa **her kapıya ayrı QR** — içindeki `gate` farklı olsun.
4. Baskı: en az **3 × 3 cm**, siyah-beyaz, dümdüz yüzeye; telefon kamerasıyla
   ~30 cm mesafeden okunabilmeli (saat: kapıyı okutana kadar 60 sn token
   geçerli — okuma > ödeme akışından sonra yapılmalı).
5. Doğrulama: `index.html?gate=GATE_07&ucret=75` ile açıldığında rozet
   **"Kapı: GATE_07"** görünmeli ve "Kapı" alanı gizlenmeli (2026-10-02'de
   yerel sunucuda doğrulandı).

### QR üretimi

```powershell
C:\Python313\python.exe -m pip install --user qrcode     # saf Python, Pillow şart değil
C:\Python313\python.exe tools\qr_uret.py "https://roboturx.github.io/kendinparket/?gate=GATE_01&ucret=50" pwa\qr_gate01.svg
```

- Çıktı **SVG** (vektör): 3 cm'den büyük boyutta da net basılır.
- Örnek çıktı: `pwa/qr_gate01.svg` (sürüm 4, 33×33 modül, 62 karakter).
- **Okunabilirlik gerçekten doğrulandı** (2026-10-02): SVG tarayıcıda
  açıldı → ekran görüntüsü alındı → `zxing-cpp` dekoderi ile okundu →
  adres birebir eşleşti. Kodu okutmadan önce kendi telefonunuzla bir kez
  deneyin.

## Sürüm artışı ZORUNLU

`sw.js` `KABUK` içindeki dosyalardan biri değiştiğinde **`SURUM` değerini artırın**:

```js
const SURUM = "kp-2026-10-02-3";
```

Eski sürüm cache'i `activate` aşamasında silinir. Sürüm artırılmazsa tarayıcı
**eski `app.js`'i önbellekten servis eder** — bu, 2026-10-02 testinde gerçekten
yaşandı ve yakalandı (`docs/GUVENLIK_TESTI.md` §6).

> `/api/*` yanıtları **asla önbelleğe alınmaz** (yanıtta yetki belgesi var).

## Güvenlik kuralları

- PWA'da `SECRET`/private key **bulunmaz**; Ed25519 private key backend/KMS'de (K6).
- Yanıtlar yalnız backend'den okunur; önbellek yalnız kabuk dosyaları.
- Ödeme bilgisi yalnız sağlayıcının barındırdığı sayfada (KVKK/PCI).
