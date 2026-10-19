`store.js` yaxshi yozilgan, jiddiy xato yo'q. Avvalgi xabarimdagi `Set` xavotiri ham o'z-o'zidan yo'qoldi: `freeze` va `revive` `processedSlots` ni to'g'ri saqlaydi va tiklaydi. Fayl avval vaqtinchalik nusxaga yoziladi, keyin almashtiriladi, buzilgan fayl esa zaxiraga ko'chiriladi. Bu to'g'ri yondashuv.
Topilgan muammolar
1. Signal handlerlar `server.js` bilan to'qnashadi (eng muhimi).
   ▸ `startAutosave` ichida `SIGTERM` da `process.exit(0)` bor.
   ▸ Yangi `server.js` da ham `SIGTERM` handleri bor, u botni `stopPolling` bilan to'xtatadi.
   ▸ Ikkalasi birga ishlasa, `store.js` dastur o'zini darhol yopadi va bot to'xtatilmay qoladi. Render deployida `409 Conflict` xatosi chiqishi mumkin.
   ▸ Yechim: `store.js` dagi signal handlerlarni olib tashlash.
2. Ma'lumotlar Render'da o'chib ketadi. `taxi-data.json` loyiha papkasiga yoziladi. Render'ning bepul tarifida fayllar har deploy yoki qayta ishga tushishda tozalanadi. Natijada buyurtmalar va bloklangan mijozlar ro'yxati yo'qoladi.
   ▸ Yechim A: pullik tarifda Persistent Disk ulang (masalan, `/var/data`) va `DATA_FILE=/var/data/taxi-data.json` ni Environment'ga qo'shing.
   ▸ Yechim B: tashqi baza (masalan, Supabase yoki MongoDB Atlas). Bepul tarif shartlari o'zgarib turadi, shuning uchun saytlarida tekshirib oling.
3. Eski buyurtmalar to'planib boradi. Buyurtmalar hech qachon o'chirilmaydi, fayl va admin panel vaqt o'tishi bilan og'irlashadi. Yopilgan buyurtmalarni 30 kundan keyin tozalaydigan funksiya qo'shdim (`KEEP_DAYS` bilan o'zgartirish mumkin).
Yangilangan `store.js`

"use strict";

// Буюртмалар ва блокланган мижозлар рўйхатини JSON файлда сақлайди.
// Файл йўли: DATA_FILE (.env) ёки лойиҳа папкасидаги taxi-data.json.
// Тўхтатиш (SIGTERM/SIGINT) server.js да бошқарилади.

const fs = require("fs");
const path = require("path");

const FILE = process.env.DATA_FILE || path.join(__dirname, "taxi-data.json");
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 30);

let blocked = [];
let ordersRef = null;
let lastSaved = "";

function freeze(order) {
  return { ...order, processedSlots: [...(order.processedSlots || [])] };
}

function revive(order) {
  return {
    ...order,
    processedSlots: new Set(
      Array.isArray(order.processedSlots) ? order.processedSlots : []
    ),
    sending: false
  };
}

// Ёпилган ёки бекор қилинган эски буюртмаларни ўчиради.
function prune() {
  if (!ordersRef || !(KEEP_DAYS > 0)) return;

  const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;

  for (const [id, order] of ordersRef) {
    const closed = order.finished || order.cancelled;
    const created = Date.parse(order.createdAt);

    if (closed && Number.isFinite(created) && created < limit) {
      ordersRef.delete(id);
    }
  }
}

function save() {
  if (!ordersRef) return;

  const text = JSON.stringify({
    orders: [...ordersRef.values()].map(freeze),
    blocked
  });

  if (text === lastSaved) return;

  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, FILE);
    lastSaved = text;
  } catch (err) {
    console.error("Маълумотни сақлаш хатоси:", err.message);
  }
}

function loadOrders(map) {
  ordersRef = map;

  let text;
  try {
    text = fs.readFileSync(FILE, "utf8");
  } catch (_) {
    return; // Файл ҳали йўқ — биринчи ишга тушиш.
  }

  try {
    const data = JSON.parse(text);

    blocked = Array.isArray(data.blocked) ? data.blocked : [];

    (Array.isArray(data.orders) ? data.orders : []).forEach((order) => {
      if (order && order.orderId) map.set(order.orderId, revive(order));
    });

    prune();
    lastSaved = text;

    console.log(
      `Файлдан юкланди: ${map.size} та буюртма, ${blocked.length} та блок.`
    );
  } catch (err) {
    const backup = `${FILE}.corrupt-${Date.now()}`;
    console.error(`Маълумот файли бузилган. Нусха: ${backup}`);
    try {
      fs.renameSync(FILE, backup);
    } catch (_) {}
  }
}

function startAutosave(map) {
  ordersRef = map;

  setInterval(() => {
    prune();
    save();
  }, 10000).unref();
}

function getBlocked() {
  return blocked;
}

function setBlocked(list) {
  blocked = list;
  save();
}

module.exports = {
  loadOrders,
  saveOrders: save,
  startAutosave,
  getBlocked,
  setBlocked
};

Asosiy o'zgarishlar:
• `startAutosave` dan `SIGTERM` va `SIGINT` handlerlari olib tashlandi, to'xtatishni endi faqat `server.js` boshqaradi (u `store.saveOrders()` ni o'zi chaqiradi).
• `prune()` qo'shildi.
• Interval `.unref()` qilindi, shunda u jarayonni ushlab turmaydi.
`.gitignore` qo'shing
Skrinshotda `.gitignore` ko'rinmadi. Mijozlarning telefon raqamlari bor `taxi-data.json` va `.env` GitHub'ga tushib ketmasligi uchun repozitoriy ildiziga `.gitignore` faylini yarating:

node_modules
.env
taxi-data.json
taxi-data.json.tmp
taxi-data.json.corrupt-*

Deploy tartibi
1. `server.js`, `store.js` va `admin.js` (`clientIp` tuzatishi bilan) ni yangilab GitHub'ga yuklang.
2. Doimiy saqlash kerak bo'lsa, Render'da Disk ulang va `DATA_FILE` ni sozlang.
3. Deploydan keyin Render loglarida "Файлдан юкланди..." yoki xatosiz ishga tushganini tekshiring.
4. Test buyurtma bering, Render'da Manual Deploy qilib, `/admin` da buyurtma va bloklar saqlanib qolganini ko'ring. Bu doimiy saqlash ishlayotganini isbotlaydi.
Hozir bot yangi va ma'lumot kam bo'lgani uchun bu bosqichda Disk majburiy emas. Lekin haqiqiy mijozlar kela boshlashidan oldin uni albatta sozlang, aks holda har deployda bloklar ro'yxati yo'qoladi.
Yana bir narsa: `index.html` ichida `app.js` va `style.css` dan boshqa fayllar (rasm, ikonka, shrift) ulangan bo'lsa, yangi `server.js` ularni bermaydi. Saytni ochib, hammasi to'g'ri ko'rinayotganini tekshiring, kerak bo'lsa `index.html` ni yuboring, qo'shib beraman.
