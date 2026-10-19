Siz `store.js` o'rniga yana `server.js` ni yubordingiz. Uni ham tekshirdim, kamchiliklarni tuzatib, to'liq yangilangan kodni pastga qo'ydim. `store.js` ni hali ko'rmadim, uni oxirida so'rayman.
Kod ichiga yozilgan "kamchili bolsa togrilab yubor..." qatori funksiya o'rtasida qolib ketgan edi. Uni olib tashladim, yangi kodda u yo'q.
Topilgan kamchiliklar
1. Fayllar saytdan ochilib qolardi. `express.static(__dirname)` tufayli `/server.js` va `/package.json` ochilardi. Endi faqat `index.html`, `app.js` va `style.css` beriladi.
2. Buyurtma spamidan himoya yo'q edi. Kimdir `/api/orders` ga yuzlab so'rov yuborib guruhni to'ldirishi mumkin edi. Endi bir IP'dan 10 daqiqada 5 tagacha buyurtma qabul qilinadi.
3. Telefon tekshirilmasdi. "x" yozib ham buyurtma berish va blokdan qochish mumkin edi. Endi telefonda kamida 9 ta raqam bo'lishi shart.
4. `/start` bosgan haydovchilar ro'yxati xotirada edi. Server qayta ishga tushsa (Render'da tez-tez bo'ladi), hamma haydovchi "start bosmagan" deb o'tkazib yuborilardi. Endi bu oldindan tekshirilmaydi, to'g'ridan-to'g'ri xabar yuboriladi. Haydovchi `/start` bosmagan bo'lsa, Telegram xato qaytaradi va navbat baribir keyingisiga o'tadi.
5. Buyurtma ID'si takrorlanishi mumkin edi. Eski usul ~28 soatda aylanib qolardi. Endi ID tasodifiy (`TX-A1B2C3D4`).
6. Xavfsiz o'chirish yo'q edi. Render qayta deploy qilganda bot ikki nusxada ishlab, `409` xatosi chiqishi mumkin edi. Endi `SIGTERM` da polling to'xtaydi va buyurtmalar saqlanadi.
7. Xatolar serverni qulatishi mumkin edi. `unhandledRejection` va noto'g'ri JSON uchun ishlov berish qo'shildi.
8. Render orqasida IP noto'g'ri aniqlanardi. `trust proxy` qo'shildi.
Yangilangan `server.js`

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const store = require("./store");
const { setupAdmin, isBlocked } = require("./admin");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEB_APP_URL = (
  process.env.WEB_APP_URL ||
  "https://taxi-booking-bot-pb3t.onrender.com"
).replace(/\/$/, "");

app.use(express.json({ limit: "100kb" }));

// Фақат сайт учун керакли файллар очилади.
// Агар index.html да бошқа файллар (расм, иконка) бўлса, шу ерга қўшинг.
app.get("/app.js", (_req, res) =>
  res.sendFile(path.join(__dirname, "app.js"))
);
app.get("/style.css", (_req, res) =>
  res.sendFile(path.join(__dirname, "style.css"))
);

const orders = new Map();
store.loadOrders(orders);
store.startAutosave(orders);
let bot = null;

/* ---------- Ёрдамчи функциялар ---------- */

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function newOrderId() {
  let id;
  do {
    id = `TX-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  } while (orders.has(id));
  return id;
}

// Битта IP дан 10 дақиқада кўпи билан 5 та буюртма.
const orderHits = new Map();
const ORDER_WINDOW_MS = 10 * 60 * 1000;
const ORDER_MAX_PER_IP = 5;

function orderRateLimited(ip) {
  const now = Date.now();
  const hits = (orderHits.get(ip) || []).filter(
    (t) => now - t < ORDER_WINDOW_MS
  );

  if (hits.length >= ORDER_MAX_PER_IP) {
    orderHits.set(ip, hits);
    return true;
  }

  hits.push(now);
  orderHits.set(ip, hits);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of orderHits) {
    if (!hits.some((t) => now - t < ORDER_WINDOW_MS)) {
      orderHits.delete(ip);
    }
  }
}, ORDER_WINDOW_MS).unref();

function getDriverName(user) {
  if (user.username) return `@${user.username}`;

  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    `Ҳайдовчи ${user.id}`
  );
}

function getCustomerTelegram(value) {
  const input = cleanText(value, 200);
  if (!input) return "Кўрсатилмаган";

  const username = input.replace(/^@/, "");

  if (/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
    return `https://t.me/${username}`;
  }

  if (/^https:\/\/t\.me\/[a-zA-Z0-9_]+\/?$/.test(input)) {
    return input;
  }

  return input;
}

function getGroupText(order) {
  const drivers = [1, 2, 3].map((slot) => {
    const driver = order.slots[slot];

    if (!driver) return `${slot}. ⏳ Бўш`;

    return `${slot}. ${driver.name}`;
  });

  return (
    `🚕 ТАКСИ БУЮРТМАСИ\n\n` +
    `🆔 Буюртма: ${order.orderId}\n` +
    `📍 Қаердан: ${order.pickup}\n` +
    `🏁 Қаерга: ${order.destination}\n\n` +
    `👨‍✈️ Ҳайдовчилар:\n${drivers.join("\n")}\n\n` +
    `${order.statusText}`
  );
}

function getKeyboard(order) {
  return {
    inline_keyboard: [
      [1, 2, 3].map((slot) => ({
        text: order.slots[slot]
          ? `${slot}️⃣ ${order.slots[slot].name}`
          : `${slot}️⃣ Ҳайдовчи`,
        callback_data: `join:${order.orderId}:${slot}`
      }))
    ]
  };
}

async function updateGroup(order) {
  if (!bot || !order.chatId || !order.messageId) return;

  try {
    await bot.editMessageText(getGroupText(order), {
      chat_id: order.chatId,
      message_id: order.messageId,
      reply_markup: getKeyboard(order)
    });
  } catch (err) {
    if (!String(err.message).includes("message is not modified")) {
      console.error("Гуруҳни янгилаш хатоси:", err.message);
    }
  }
}

async function sendOrderToDriver(order, driver) {
  const details =
    `🚕 СИЗГА БУЮРТМА БЕРИЛДИ\n\n` +
    `🆔 Буюртма: ${order.orderId}\n` +
    `📞 Телефон: ${order.phone}\n` +
    `📍 Қаердан: ${order.pickup}\n` +
    `🏁 Қаерга: ${order.destination}\n` +
    (order.name ? `👤 Исм: ${order.name}\n` : "") +
    (order.note ? `📝 Изоҳ: ${order.note}\n` : "") +
    `💬 Мижоз Telegram: ${getCustomerTelegram(order.telegramUsername)}\n\n` +
    `Сиз ${driver.slot}-навбатдаги ҳайдовчисиз.`;

  await bot.sendMessage(driver.id, details, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "➡️ Кейинги ҳайдовчига ўтказиш",
            callback_data: `next:${order.orderId}`
          }
        ]
      ]
    }
  });
}

// Фақат ҳали ишлов берилмаган ҳайдовчига буюртма юборади.
// Кейинги ҳайдовчи ҳали навбат олмаган бўлса, буюртма очиқ қолади.
async function dispatchNext(order) {
  if (order.sending || order.finished || order.currentDriverId) {
    return;
  }

  order.sending = true;

  try {
    while (true) {
      const slot = [1, 2, 3].find(
        (n) => order.slots[n] && !order.processedSlots.has(n)
      );

      if (!slot) {
        const allSlotsFilled = [1, 2, 3].every((n) =>
          Boolean(order.slots[n])
        );

        const allProcessed = [1, 2, 3].every((n) =>
          order.processedSlots.has(n)
        );

        if (allSlotsFilled && allProcessed) {
          order.finished = true;
          order.statusText = "🏁 Барча ҳайдовчилар навбати тугади.";
        } else {
          order.finished = false;
          order.statusText = "🟢 Кейинги ҳайдовчи кутилмоқда.";
        }

        await updateGroup(order);
        return;
      }

      const driver = order.slots[slot];

      try {
        await sendOrderToDriver(order, driver);

        order.currentSlot = slot;
        order.currentDriverId = driver.id;
        order.statusText = `🚕 Буюртма ${driver.name} га юборилди.`;

        await updateGroup(order);
        return;
      } catch (err) {
        console.error(
          "Ҳайдовчига хабар юборилмади:",
          driver.name,
          err.message
        );

        order.processedSlots.add(slot);
        order.statusText =
          `⚠️ ${driver.name} га хабар бормади (ботда /start босмаган бўлиши мумкин). ` +
          `Кейинги ҳайдовчи текширилмоқда.`;

        await updateGroup(order);
      }
    }
  } finally {
    order.sending = false;
  }
}

// Админ буюртмани бекор қилади: гуруҳ хабари янгиланади, жорий ҳайдовчига хабар кетади.
async function cancelOrder(order) {
  order.cancelled = true;
  order.finished = true;
  order.statusText = "❌ Буюртма админ томонидан бекор қилинди.";

  if (bot && order.currentDriverId) {
    try {
      await bot.sendMessage(
        order.currentDriverId,
        `❌ Буюртма ${order.orderId} бекор қилинди.`
      );
    } catch (err) {
      console.error("Ҳайдовчига хабар юборилмади:", err.message);
    }
  }

  order.currentDriverId = null;
  order.currentSlot = null;
  await updateGroup(order);
}

/* ---------- Telegram бот ---------- */

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/^\/start(?:\s.*)?$/, async (msg) => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "Такси буюртма ботига хуш келибсиз!\n\n" +
          "🚕 Мижозлар, бот орқали таксига буюртма беринг!",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚕 Буюртма бериш",
                  web_app: { url: WEB_APP_URL }
                }
              ],
              [
                {
                  text: "🌐 Сайтни очиш",
                  url: WEB_APP_URL
                }
              ]
            ]
          }
        }
      );
    } catch (err) {
      console.error("/start хатоси:", err.message);
    }
  });

  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    const user = query.from;

    try {
      if (!user || !user.id) {
        await bot.answerCallbackQuery(query.id, {
          text: "Ҳайдовчи маълумоти топилмади."
        });
        return;
      }

      // Ҳайдовчи 1-, 2- ёки 3-навбатни танлайди.
      if (data.startsWith("join:")) {
        const [, orderId, slotText] = data.split(":");
        const slot = Number(slotText);
        const order = orders.get(orderId);

        if (!order) {
          await bot.answerCallbackQuery(query.id, {
            text: "Буюртма топилмади."
          });
          return;
        }

        if (order.finished) {
          await bot.answerCallbackQuery(query.id, {
            text: "Бу буюртманинг навбати тугаган."
          });
          return;
        }

        if (![1, 2, 3].includes(slot)) {
          await bot.answerCallbackQuery(query.id, {
            text: "Навбат рақами нотўғри."
          });
          return;
        }

        if (order.slots[slot]) {
          await bot.answerCallbackQuery(query.id, {
            text: "Бу навбатни бошқа ҳайдовчи олган."
          });
          return;
        }

        if (
          Object.values(order.slots).some(
            (driver) => driver && driver.id === user.id
          )
        ) {
          await bot.answerCallbackQuery(query.id, {
            text: "Сиз бу буюртмада аллақачон навбат олгансиз."
          });
          return;
        }

        order.slots[slot] = {
          id: user.id,
          name: getDriverName(user),
          slot
        };

        await bot.answerCallbackQuery(query.id, {
          text: `${slot}-навбат сизга бириктирилди.`
        });

        await updateGroup(order);

        // Биринчи навбат олинмагунча буюртма тарқатилмайди.
        if (order.slots[1] && !order.currentDriverId) {
          await dispatchNext(order);
        }

        return;
      }

      // Ҳозирги ҳайдовчи буюртмани кейингига ўтказади.
      if (data.startsWith("next:")) {
        const orderId = data.slice(5);
        const order = orders.get(orderId);

        if (!order) {
          await bot.answerCallbackQuery(query.id, {
            text: "Буюртма топилмади."
          });
          return;
        }

        if (order.currentDriverId !== user.id) {
          await bot.answerCallbackQuery(query.id, {
            text: "Ҳозир бу буюртма сизда эмас."
          });
          return;
        }

        await bot.answerCallbackQuery(query.id, {
          text: "Кейинги ҳайдовчи текширилмоқда."
        });

        if (order.currentSlot !== null) {
          order.processedSlots.add(order.currentSlot);
        }

        order.currentSlot = null;
        order.currentDriverId = null;

        await dispatchNext(order);
        return;
      }

      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error("Тугма хатоси:", err.stack || err.message);

      try {
        await bot.answerCallbackQuery(query.id, {
          text: "Хатолик юз берди. Қайта уриниб кўринг."
        });
      } catch (_) {}
    }
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram polling хатоси:", err.message);
  });

  console.log("Telegram бот ишга тушди.");
} else {
  console.warn("BOT_TOKEN йўқ. Telegram бот ўчирилган.");
}

/* ---------- Сайт API ---------- */

app.post("/api/orders", async (req, res) => {
  const body = req.body || {};

  const name = cleanText(body.name, 80);
  const phone = cleanText(body.phone, 40);
  const pickup = cleanText(body.pickup, 200);
  const destination = cleanText(body.destination, 200);
  const note = cleanText(body.note, 500);
  const telegramUsername = cleanText(
    body.telegramUsername || body.telegram,
    200
  );

  if (!phone || !pickup || !destination) {
    return res.status(400).json({
      ok: false,
      message:
        "Телефон рақами, қаердан ва қаерга майдонларини тўлдиринг."
    });
  }

  const digits = phone.replace(/\D/g, "");

  if (digits.length < 9 || digits.length > 15) {
    return res.status(400).json({
      ok: false,
      message: "Телефон рақами нотўғри."
    });
  }

  if (isBlocked(phone, telegramUsername)) {
    return res.status(403).json({
      ok: false,
      message: "Кечирасиз, ҳозирча буюртмангизни қабул қила олмаймиз."
    });
  }

  if (!bot || !ADMIN_CHAT_ID) {
    return res.status(500).json({
      ok: false,
      message: "Бот ёки гуруҳ созламаси топилмади."
    });
  }

  if (orderRateLimited(req.ip || "")) {
    return res.status(429).json({
      ok: false,
      message: "Жуда кўп буюртма. Бироз кутиб, қайта уриниб кўринг."
    });
  }

  const orderId = newOrderId();

  const order = {
    orderId,
    name,
    phone,
    pickup,
    destination,
    note,
    telegramUsername,

    slots: {
      1: null,
      2: null,
      3: null
    },

    processedSlots: new Set(),
    currentSlot: null,
    currentDriverId: null,
    sending: false,
    finished: false,

    chatId: ADMIN_CHAT_ID,
    messageId: null,
    statusText: "🟢 Ҳайдовчилар кутилмоқда",
    createdAt: new Date().toISOString()
  };

  try {
    const sent = await bot.sendMessage(
      ADMIN_CHAT_ID,
      getGroupText(order),
      { reply_markup: getKeyboard(order) }
    );

    order.messageId = sent.message_id;
    orders.set(orderId, order);
    store.saveOrders();

    return res.status(201).json({
      ok: true,
      orderId,
      message: "Буюртмангиз қабул қилинди!"
    });
  } catch (err) {
    console.error("Гуруҳга буюртма юборилмади:", err.message);

    return res.status(502).json({
      ok: false,
      message: "Буюртма гуруҳга юборилмади. Қайта уриниб кўринг."
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    botEnabled: Boolean(bot)
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

setupAdmin(app, { orders, cancelOrder });

// Хато ушлагич (масалан, noto'g'ri JSON).
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      ok: false,
      message: "JSON нотўғри."
    });
  }

  console.error("Сервер хатоси:", err && err.message);

  return res.status(500).json({
    ok: false,
    message: "Сервер хатоси."
  });
});

/* ---------- Ишга тушириш ва тўхтатиш ---------- */

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

function shutdown(signal) {
  console.log(`${signal} олинди, сервер тўхтатилмоқда...`);

  try {
    store.saveOrders();
  } catch (err) {
    console.error("Сақлаш хатоси:", err.message);
  }

  const done = () => process.exit(0);
  setTimeout(done, 5000).unref();

  if (bot) {
    Promise.resolve(bot.stopPolling()).catch(() => {}).then(done);
  } else {
    done();
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Такси сайти ишга тушди: порт ${PORT}`);
});

`admin.js` da bitta kichik tuzatish
Hozir `clientIp` funksiyasi `x-forwarded-for` ning birinchi qiymatini oladi. Uni soxtalashtirish mumkin, shunda parol topishga qarshi himoya (10 ta urinish limiti) aylanib o'tiladi. `admin.js` dagi funksiyani shunday almashtiring (`trust proxy` endi `server.js` da yoqilgan):

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "";
}

Yangilagandan keyin tekshiring
1. GitHub'ga yuklab, Render'da deploy qiling.
2. `https://taxi-booking-bot-pb3t.onrender.com/server.js` ni oching. Endi 404 chiqishi kerak.
3. Saytni oching va `index.html` to'g'ri ko'rinayotganini, buyurtma ketayotganini tekshiring. Sahifa "buzuq" (stilsiz) chiqsa, `index.html` boshqa fayllarni ham ishlatayotgan bo'lishi mumkin, ayting.
4. `/admin` ga kirib, test buyurtmani bloklash va bekor qilishni sinab ko'ring.
Hali ko'rmagan narsam: `store.js`
Bu juda muhim. `processedSlots` bu `Set`, JSON'ga yozilganda oddiy `Set` bo'sh obyekt `{}` bo'lib qoladi. `store.js` uni massivga aylantirib saqlamasa va o'qiganda qayta `Set` qilmasa, server qayta ishga tushgandan keyin eski buyurtmalarda `processedSlots.has is not a function` xatosi chiqadi. Bundan tashqari, saqlash fayli Render'da o'chib ketmasligi ham tekshirilishi kerak.
`store.js` kodini yuboring (token va parollarsiz), uni ham shu tarzda tekshirib beraman.
