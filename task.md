# TODO: Otomasi Aktivasi Alaflip

## Status Saat Ini
Debug CLI berhasil sampai form PIN, dan PIN sudah terkirim ke server.
Error terakhir: `400 invalid user credential` — karena status Alaflip masih `SUCCESS_REGISTER` (aktif), bukan `NEED_LINKAGE`. Ini **normal** — saat NEED_LINKAGE, server akan terima PIN dan return OAuth code.

---

## Yang Sudah Diketahui (Context Penting)

### Root Cause Dulu
`/api/shield` return `404 "Token B2B is mandatory"` karena browser dibuka **tanpa** header `x-authorization` (Aladin OAuth token), sehingga server Aladin tidak set cookie `authorization`.

### Fix yang Berhasil
**Sebelum buka WebView**, ambil Aladin OAuth token dari `/charge/challenge`:
```
GET https://api.flip.id/alaflip/api/v1/payments/charge/challenge?amount=10000&...
→ response.data.headers['X-AUTHORIZATION']  ← Aladin Hydra JWT
```
Kirim token itu sebagai header saat buka `get-auth-code`:
```
GET /v1/get-auth-code?...&seamlessSign=...
    x-authorization: <token dari challenge>
```
→ Server set cookie `authorization` → JS call `/api/shield` → 200 → navigasi ke login page → form PIN muncul ✅

### Flow Lengkap (Verified)
```
1. POST /customer.flip.id/alaflip/api/v1/users/{userId}/webview-url
   → dapat URL: https://flamingo.aladinbank.id/v1/get-auth-code?...&seamlessSign=...

2. GET https://api.flip.id/alaflip/api/v1/payments/charge/challenge?amount=10000&...
   headers: Authorization Bearer {flipToken}, x-device-id, api-key, x-internal-api-key
   → response.data.headers['X-AUTHORIZATION'] = Aladin JWT (valid ~1 jam)

3. Browser Playwright buka get-auth-code URL
   headers: x-authorization={aladInToken}, x-device-id, x-client-id, x-channel-id, x-partner-id,
            x-requested-with: id.flip, sec-ch-ua (Android WebView), user-agent: Android WebView
   → server set cookie: authorization, deviceId, partnerId, channelId, clientId

4. JS flamingo call GET /api/shield → 200
   → {redirectURL: "/v1/authentication/login?login_challenge=...&email=..."}
   → browser navigasi ke login page

5. JS flamingo call POST /api/whitelabel/v1/auth/handsake (ECDH key exchange)
   → {SecretID, PublicKey}

6. Form PIN muncul: input[data-input-otp="true"]

7. Ketik 6 digit PIN satu per satu (delay 100ms per digit)
   → JS flame enkripsi PIN dengan ECDH → POST /api/shield/login
   → response: {redirectURL: "https://storage.googleapis.com/...?code=xxx&scope=..."}

8. Extract OAuth code dari redirectURL:
   regex: /[?&]code=([^&]+)/

9. POST https://customer.flip.id/alaflip/api/v1/users/{userId}/auth-code
   headers: Authorization Bearer {flipToken}, x-device-id, api-key, x-internal-api-key
   body: {"auth_code": "<code dari step 8>"}
   → {success: true}

10. Verifikasi: GET /alaflip/api/v1/users/{userId}/status
    → {data: {status: "SUCCESS_REGISTER"}} ✅
```

### Headers Wajib untuk WebView (dari HAR)
```js
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64 Build/TE1A.240213.009; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36'

{
  'x-authorization':  aladInToken,          // ← KUNCI UTAMA
  'x-device-id':      deviceId,
  'x-client-id':      'c5751804-ff4c-4d22-a30d-e5c80722758f',
  'x-channel-id':     '6018',
  'x-partner-id':     'F2210240006',
  'x-requested-with': 'id.flip',
  'sec-ch-ua':        '"Android WebView";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'Accept-Language':  'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
}
```

### File Debug (Working)
- `apps/scraper/debug-alaflip.js` — sudah implementasi end-to-end, tinggal test saat NEED_LINKAGE

---

## TODO

### [ ] 1. Test End-to-End saat Status NEED_LINKAGE
- Buat status NEED_LINKAGE dulu (unlink dari app Flip, atau tunggu expired)
- Jalankan `node --env-file=../../.env debug-alaflip.js` dari `apps/scraper/`
- Verifikasi `🎉 AKTIVASI ALAFLIP BERHASIL!`

### [ ] 2. Update `flipBrowser.js` (Production)
File: `apps/scraper/src/scrapers/flipBrowser.js`

Refactor fungsi `activateAlaflip(webviewUrl, pin, deviceId, aladInToken)`:
```js
// Hapus mock /api/shield yang lama
// Implementasi mengikuti logic di debug-alaflip.js:
//   - Set x-authorization = aladInToken di extraHTTPHeaders
//   - Route intercept: inject header ke document request
//   - waitForSelector: input[data-input-otp="true"]
//   - waitForResponse: /api/shield/login (POST)
//   - Ketik PIN digit per digit
//   - Extract code dari redirectURL
//   - Return { oauthCode }  ← caller yang POST ke /auth-code
```

### [ ] 3. Update `flipWorker.js` (Production)
File: `apps/scraper/src/workers/flipWorker.js`

Di bagian `isAlaflipInactive`:
```js
// 1. Ambil aladInToken dari challengeRes (sudah ada X-AUTHORIZATION meski inactive)
const aladInToken = challengeRes?.data?.headers?.['X-AUTHORIZATION'] || null

// 2. Panggil activateAlaflip dengan token
const { oauthCode } = await flipBrowser.activateAlaflip(webviewUrl, pinStr, devId, aladInToken)

// 3. POST auth-code ke Flip API
await fetch(`https://customer.flip.id/alaflip/api/v1/users/${userId}/auth-code`, {
  method: 'POST',
  headers: { ...flipHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({ auth_code: oauthCode })
})
```

> ⚠️ **Penting**: Perlu verifikasi apakah `X-AUTHORIZATION` masih ada di challenge response ketika status `NEED_LINKAGE`. Dari test sebelumnya status masih `SUCCESS_REGISTER` saat dicek. Test saat NEED_LINKAGE.

### [ ] 4. Update Admin Endpoint (opsional)
File: `apps/api/src/routes/admin/flipLogin.js` (atau setara)

Endpoint `POST /v1/admin/flip-login/activate-alaflip`:
- Ambil token dari DB
- Call `/charge/challenge` untuk dapat `aladInToken`
- Panggil scraper service dengan `aladInToken`
- Atau langsung hit logic dari API jika tidak pakai scraper service terpisah

### [ ] 5. Cleanup
- Hapus atau pindahkan `apps/scraper/debug-alaflip.js` ke `scripts/`
- Hapus `scripts/debug-alaflip-browser.js` jika duplikat
- Test production flow (withdrawal → isAlaflipInactive → auto-activate → retry)

---

## Catatan Penting

- `X-AUTHORIZATION` dari `/charge/challenge` valid ~1 jam (exp dari JWT)
- Jika token expired saat aktivasi: perlu refresh dulu atau ambil ulang
- `deviceId` diambil dari JWT payload: `payload.data.device_identifier`
- `userId` dari `provider.userId` di DB
- Selector form PIN: `input[data-input-otp="true"]` (paling reliable)
- `forgot-pin` page juga muncul di flow tapi tidak menghalangi — JS tetap render form PIN di `/authentication/login`

## File Terkait
- `apps/scraper/debug-alaflip.js` — script debug end-to-end (WORKING)
- `apps/scraper/src/scrapers/flipBrowser.js` — production browser automation
- `apps/scraper/src/workers/flipWorker.js` — worker yang trigger aktivasi
- `apps/scraper/src/lib/flipClient.js` — HTTP client Flip API (ada `getTokenTransfer`)
- `/Users/cand62/Documents/pinning/all_request_alaflip.har` — HAR rekaman lengkap
