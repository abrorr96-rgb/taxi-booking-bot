# Taksi bot + admin panel (sinov uchun tayyorlangan fayllar)

## Nimalar bor
- `server.js` — siz yuborgan bot serveri, asosiy ish oqimi saqlangan.
- `admin.js` — Basic Auth bilan himoyalangan `/admin` va admin API.
- `admin.html` — yuborgan admin panel sahifasi.
- `store.js` — JSON faylga saqlash; eski buyurtmalarda `processedSlots` bo‘lmasa ham xatoga tushmasligi uchun kichik himoya qo‘shilgan.
- `package.json` — kerakli Node.js bog‘liqliklari.

## Render Environment Variables
Render Dashboard → `taxi-booking-bot` → Environment bo‘limida mavjud bot sozlamalarini saqlab qoling:
- `BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `WEB_APP_URL` (agar ishlatilayotgan bo‘lsa)

Admin panel uchun qo‘shing:
- `ADMIN_USER` — admin login (masalan `admin`)
- `ADMIN_PASSWORD` — kuchli, noyob parol

Parolni chatga yoki GitHub kodiga yozmang. Environment o‘zgaruvchilarini tahrirlash Render’da deploy/restart keltirib chiqarishi mumkin.

## Admin panel manzili
`https://taxi-booking-bot-pb3t.onrender.com/admin`

Login va parol brauzerning Basic Auth oynasida so‘raladi. Agar `ADMIN_PASSWORD` sozlanmagan bo‘lsa, panel 503 javob beradi.

## MUHIM — jonli botga darhol joylamang
Bu paket fayllar mosligi tekshirilishi uchun tayyorlangan, ammo Render’da jonli buyurtmalar bilan to‘liq integratsion test o‘tkazilmagan.
1. GitHub’da alohida branch yarating (masalan `admin-panel-test`).
2. Fayllarni shu branch’ga joylang; asosiy branch’ga darhol merge qilmang.
3. Avval Render’da alohida test web service yarating yoki lokal test qiling. Alohida test xizmatiga haqiqiy `BOT_TOKEN` bermang — aks holda ikki bot bir token bilan polling qilishi mumkin.
4. Hozirgi `taxi-data.json` faylini alohida xavfsiz zaxiralang. Uni chatga yubormang, chunki unda mijozlarning shaxsiy ma’lumotlari bor.
5. Faqat test muvaffaqiyatli bo‘lgach, jonli deploy vaqtini rejalashtiring.

## Ma’lumotlarni saqlash haqida
`store.js` hozir JSON fayl ishlatadi. Render Free diskida bu fayl doimiy saqlanishi kafolatlanmaydi. Ushbu paket PostgreSQL’ga ko‘chirmaydi va avtomatik kundalik backup ham sozlamaydi. Buni keyingi bosqichda, alohida migratsiya va tiklash sinovi bilan bajarish kerak.
