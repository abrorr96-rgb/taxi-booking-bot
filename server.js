
require("dotenv").config();

const express = require("express");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEB_APP_URL = (
  process.env.WEB_APP_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

let bot = null;

// Xotirada saqlanadi. Server qayta ishga tushsa,
// eski buyurtmalar va haydovchilar navbati yo'qoladi.
const orders = new Map();
const startedDrivers = new Set();

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function getDriverName(user) {
  if (user.username) return `@${user.username}`;

  const name = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ");

  return name || `Haydovchi ${user.id}`;
}

function getQueue(order) {
  return [1, 2, 3]
    .filter((slot) => order.slots[slot])
    .map((slot) => ({
      slot,
      ...order.slots[slot]
    }));
}

function getGroupText(order) {
  const drivers = [1, 2, 3].map((slot) => {
    const driver = order.slots[slot];
    return `${slot}. ${driver ? driver.name : "⏳ Bo'sh"}`;
  });

  return (
    `🚕 TAKSI BUYURTMASI\n\n` +
    `🆔 Buyurtma: ${order.orderId}\n` +
    `📍 Qayerdan: ${order.pickup}\n` +
    `🏁 Qayerga: ${order.destination}\n\n` +
    `👨‍✈️ Haydovchilar navbati:\n` +
    drivers.join("\n") +
    `\n\n${order.statusText || "🟢 Haydovchilar kutilmoqda"}`
  );
}

function getKeyboard(order) {
  return {
    inline_keyboard: [
      [1, 2, 3].map((slot) => {
        const driver = order.slots[slot];

        return {
          text: driver
            ? `${slot}️⃣ ${driver.name}`
            : `${slot}️⃣ Haydovchi`,
          callback_data: `join:${order.orderId}:${slot}`
        };
      })
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
    // Xabar o'zgarmagan bo'lsa Telegram xato qaytarishi mumkin.
    if (!String(err.message).includes("message is not modified")) {
      console.error("Guruh xabarini yangilash xatosi:", err.message);
    }
  }
}

async function sendOrderToDriver(order, queueItem) {
  const driver = queueItem;

  const details =
    `🚕 SIZGA BUYURTMA BERILDI\n\n` +
    `🆔 Buyurtma: ${order.orderId}\n` +
    `👤 Mijoz: ${order.name}\n` +
    `📞 Telefon: ${order.phone}\n` +
    `📍 Qayerdan: ${order.pickup}\n` +
    `🏁 Qayerga: ${order.destination}\n` +
    (order.note ? `📝 Izoh: ${order.note}\n` : "") +
    (order.telegramUsername
      ? `💬 Mijoz Telegrami: @${order.telegramUsername.replace(/^@/, "")}\n`
      : "") +
    `\nSiz ${driver.slot}-navbatdagi haydovchisiz.`;

  const keyboard = {
    inline_keyboard: [[
      {
        text: "➡️ Keyingi haydovchiga o‘tkazish",
        callback_data: `next:${order.orderId}`
      }
    ]]
  };

  await bot.sendMessage(driver.id, details, {
    reply_markup: keyboard
  });
}

async function dispatchNext(order) {
  if (order.finished || order.sending) return;

  const queue = getQueue(order);

  while (order.currentIndex + 1 < queue.length) {
    order.currentIndex += 1;

    const driver = queue[order.currentIndex];

    if (!startedDrivers.has(driver.id)) {
      order.statusText =
        `⚠️ ${driver.name} botda /start bosmagan. Keyingi haydovchi kutilmoqda.`;
      await updateGroup(order);
      continue;
    }

    order.sending = true;

    try {
      await sendOrderToDriver(order, driver);

      order.currentDriverId = driver.id;
      order.statusText = `🚕 Buyurtma ${driver.name} ga yuborildi`;
      await updateGroup(order);
      order.sending = false;
      return;
    } catch (err) {
      console.error("Haydovchiga shaxsiy xabar yuborilmadi:", err.message);

      order.statusText =
        `⚠️ ${driver.name} ga xabar yuborilmadi. Keyingi haydovchi tekshirilmoqda.`;
      await updateGroup(order);
      order.sending = false;
    }
  }

  order.currentDriverId = null;
  order.finished = true;
  order.statusText = "🏁 Navbat tugadi yoki hozircha haydovchi yo‘q.";
  await updateGroup(order);
}

if (BOT_TOKEN && BOT_TOKEN !== "PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE") {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/^\/start(?:\s.*)?$/, async (msg) => {
    if (msg.from) startedDrivers.add(msg.from.id);

    const keyboard = {
      inline_keyboard: [
        [{ text: "🚕 Buyurtma berish", web_app: { url: WEB_APP_URL } }],
        [{ text: "🌐 Saytni ochish", url: WEB_APP_URL }]
      ]
    };

    const welcome =
      "Assalomu alaykum! 🚕\n\n" +
      "Taxi Booking botiga xush kelibsiz.\n" +
      "Haydovchi bo‘lsangiz, buyurtmalarni shaxsiy qabul qilish uchun " +
      "ushbu botda /start ni bosib qo‘ying.\n\n" +
      "Buyurtma berish uchun quyidagi tugmani bosing.";

    try {
      await bot.sendMessage(msg.chat.id, welcome, {
        reply_markup: keyboard
      });
    } catch (err) {
      console.error("/start xatosi:", err.message);
    }
  });

  bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "Buyurtma berish uchun /start ni bosing. " +
      "Haydovchilar ham shaxsiy xabar olish uchun /start bosishlari kerak."
    ).catch((err) => console.error("/help xatosi:", err.message));
  });

  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    const user = query.from;

    try {
      if (data.startsWith("join:")) {
        const parts = data.split(":");
        const orderId = parts[1];
        const slot = Number(parts[2]);
        const order = orders.get(orderId);

        if (!order) {
          await bot.answerCallbackQuery(query.id, {
            text: "Buyurtma topilmadi yoki server qayta ishga tushgan."
          });
          return;
        }

        if (![1, 2, 3].includes(slot)) {
          await bot.answerCallbackQuery(query.id, {
            text: "Noto‘g‘ri navbat."
          });
          return;
        }

        if (order.slots[slot]) {
          await bot.answerCallbackQuery(query.id, {
            text: "Bu navbatni boshqa haydovchi olgan."
          });
          return;
        }

        if (Object.values(order.slots).some((d) => d.id === user.id)) {
          await bot.answerCallbackQuery(query.id, {
            text: "Siz bu buyurtmada allaqachon navbat olgansiz."
          });
          return;
        }

        const driver = {
          id: user.id,
          name: getDriverName(user)
        };

        order.slots[slot] = driver;
        startedDrivers.add(user.id);

        await bot.answerCallbackQuery(query.id, {
          text: `${slot}-navbat sizga biriktirildi.`
        });

        await updateGroup(order);

        // 1-navbat olinmaguncha buyurtma shaxsiy yuborilmaydi.
        // 1-navbat olingach, haydovchilarga navbat bo'yicha yuboriladi.
        if (order.slots[1] && order.currentIndex === -1) {
          await dispatchNext(order);
        }

        return;
      }

      if (data.startsWith("next:")) {
        const orderId = data.slice(5);
        const order = orders.get(orderId);

        if (!order) {
          await bot.answerCallbackQuery(query.id, {
            text: "Buyurtma topilmadi."
          });
          return;
        }

        if (order.currentDriverId !== user.id) {
          await bot.answerCallbackQuery(query.id, {
            text: "Bu buyurtmani hozir boshqa haydovchi olib turibdi."
          });
          return;
        }

        order.statusText = `${getDriverName(user)} buyurtmani keyingi haydovchiga uzatdi.`;
        order.currentDriverId = null;

        await bot.answerCallbackQuery(query.id, {
          text: "Keyingi haydovchiga uzatilmoqda."
        });

        await dispatchNext(order);
        return;
      }

      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error("Tugma ishlash xatosi:", err.message);

      try {
        await bot.answerCallbackQuery(query.id, {
          text: "Xatolik yuz berdi. Qayta urinib ko‘ring."
        });
      } catch (_) {}
    }
  });

  bot.on("polling_error", (err) => {
    console.error("Telegram polling xatosi:", err.message);
  });

  console.log("Telegram bot ishga tushdi.");
} else {
  console.warn("BOT_TOKEN yo‘q. Telegram bot o‘chirilgan.");
}

app.post("/api/orders", async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const pickup = cleanText(req.body.pickup, 200);
  const destination = cleanText(req.body.destination, 200);
  const note = cleanText(req.body.note, 500);
  const telegramUsername = cleanText(req.body.telegramUsername, 80);

  if (!name || !phone || !pickup || !destination) {
    return res.status(400).json({
      ok: false,
      message: "Barcha majburiy maydonlarni to‘ldiring."
    });
  }

  const orderId = `TX-${Date.now().toString().slice(-8)}`;

  const order = {
    orderId,
    name,
    phone,
    pickup,
    destination,
    note,
    telegramUsername,
    slots: { 1: null, 2: null, 3: null },
    chatId: ADMIN_CHAT_ID,
    messageId: null,
    currentIndex: -1,
    currentDriverId: null,
    sending: false,
    finished: false,
    statusText: "🟢 Haydovchilar kutilmoqda",
    createdAt: new Date().toISOString()
  };

  orders.set(orderId, order);

  if (bot && ADMIN_CHAT_ID) {
    try {
      // Guruhga mijozning shaxsiy ma'lumotlari yuborilmaydi.
      const sent = await bot.sendMessage(
        ADMIN_CHAT_ID,
        getGroupText(order),
        { reply_markup: getKeyboard(order) }
      );

      order.messageId = sent.message_id;
    } catch (err) {
      console.error("Guruhga buyurtma yuborilmadi:", err.message);
    }
  }

  console.log("Yangi buyurtma qabul qilindi:", orderId);

  return res.status(201).json({
    ok: true,
    orderId,
    message: "Buyurtmangiz qabul qilindi!"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    botEnabled: Boolean(bot)
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Taxi Booking ishga tushdi: port ${PORT}`);
});
