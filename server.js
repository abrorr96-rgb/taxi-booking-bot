
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
  "https://taxi-booking-bot-pb3t.onrender.com"
).replace(/\/$/, "");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname, { index: false }));

const orders = new Map();
const startedDrivers = new Set();

let bot = null;

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function getDriverName(user) {
  if (user.username) return `@${user.username}`;

  const name = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ");

  return name || `Ҳайдовчи ${user.id}`;
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
    return `${slot}. ${driver ? driver.name : "⏳ Бўш"}`;
  });

  return (
    `🚕 ТАКСИ БУЮРТМАСИ\n\n` +
    `🆔 Буюртма: ${order.orderId}\n` +
    `📍 Қаердан: ${order.pickup}\n` +
    `🏁 Қаерга: ${order.destination}\n\n` +
    `👨‍✈️ Ҳайдовчилар навбати:\n` +
    drivers.join("\n") +
    `\n\n${order.statusText || "🟢 Ҳайдовчилар кутилмоқда"}`
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
            : `${slot}️⃣ Ҳайдовчи`,
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
    if (!String(err.message).includes("message is not modified")) {
      console.error("Гуруҳ хабарини янгилаш хатоси:", err.message);
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
    (order.telegramUsername
      ? `💬 Мижоз Telegram: ${order.telegramUsername}\n`
      : "") +
    `\nСиз ${driver.slot}-навбатдаги ҳайдовчисиз.`;

  await bot.sendMessage(driver.id, details, {
    reply_markup: {
      inline_keyboard: [[
        {
          text: "➡️ Кейинги ҳайдовчига ўтказиш",
          callback_data: `next:${order.orderId}`
        }
      ]]
    }
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
        `⚠️ ${driver.name} ботда /start босмаган.`;
      await updateGroup(order);
      continue;
    }

    order.sending = true;

    try {
      await sendOrderToDriver(order, driver);

      order.currentDriverId = driver.id;
      order.statusText = `🚕 Буюртма ${driver.name} га юборилди`;
      order.sending = false;
      await updateGroup(order);
      return;
    } catch (err) {
      console.error(
        "Ҳайдовчига шахсий хабар юборилмади:",
        driver.name,
        err.message
      );

      order.statusText =
        `⚠️ ${driver.name} га хабар юборилмади. Кейинги навбат текширилмоқда.`;

      order.sending = false;
      await updateGroup(order);
    }
  }

  order.currentDriverId = null;
  order.finished = true;
  order.statusText = "🏁 Навбат тугади ёки ҳозирча ҳайдовчи йўқ.";
  await updateGroup(order);
}

if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/^\/start(?:\s.*)?$/, async (msg) => {
    if (msg.from && msg.chat.type === "private") {
      startedDrivers.add(msg.from.id);
    }

    try {
      await bot.sendMessage(
        msg.chat.id,
        "Ассалому алайкум! 🚕\n\n" +
        "Такси буюртма ботига хуш келибсиз.\n" +
        "Ҳайдовчи бўлсангиз, шахсий хабарларни олиш учун " +
        "ушбу ботда /start босиб қўйинг.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚕 Буюртма бериш", web_app: { url: WEB_APP_URL } }],
              [{ text: "🌐 Сайтни очиш", url: WEB_APP_URL }]
            ]
          }
        }
      );
    } catch (err) {
      console.error("/start хатоси:", err.message);
    }
  });

  bot.onText(/^\/help$/, async (msg) => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "Буюртма бериш учун /start ни босинг.\n" +
        "Ҳайдовчилар шахсий буюртма олиш учун ботда /start босишлари керак."
      );
    } catch (err) {
      console.error("/help хатоси:", err.message);
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

      if (data.startsWith("join:")) {
        const parts = data.split(":");
        const orderId = parts[1];
        const slot = Number(parts[2]);
        const order = orders.get(orderId);

        if (!order) {
          await bot.answerCallbackQuery(query.id, {
            text: "Буюртма топилмади. Сервер қайта ишга тушган бўлиши мумкин."
          });
          return;
        }

        if (![1, 2, 3].includes(slot)) {
          await bot.answerCallbackQuery(query.id, {
            text: "Навбат рақами нотўғри."
          });
          return;
        }

        if (order.finished) {
          await bot.answerCallbackQuery(query.id, {
            text: "Бу буюртма якунланган."
          });
          return;
        }

        if (order.slots[slot]) {
          await bot.answerCallbackQuery(query.id, {
            text: "Бу навбатни бошқа ҳайдовчи олган."
          });
          return;
        }

        if (Object.values(order.slots).some(
          (driver) => driver && driver.id === user.id
        )) {
          await bot.answerCallbackQuery(query.id, {
            text: "Сиз бу буюртмада аллақачон навбат олгансиз."
          });
          return;
        }

        order.slots[slot] = {
          id: user.id,
          name: getDriverName(user)
        };

        await bot.answerCallbackQuery(query.id, {
          text: `${slot}-навбат сизга бириктирилди.`
        });

        await updateGroup(order);

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
          text: "Кейинги ҳайдовчига ўтказилмоқда."
        });

        order.currentDriverId = null;
        await dispatchNext(order);
        return;
      }

      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.error("Тугма ишлаш хатоси:", err.stack || err.message);

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

app.post("/api/orders", async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const pickup = cleanText(req.body.pickup, 200);
  const destination = cleanText(req.body.destination, 200);
  const note = cleanText(req.body.note, 500);
  const telegramUsername = cleanText(req.body.telegramUsername, 200);

  if (!phone || !pickup || !destination) {
    return res.status(400).json({
      ok: false,
      message: "Телефон рақами, қаердан ва қаерга майдонларини тўлдиринг."
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
    statusText: "🟢 Ҳайдовчилар кутилмоқда",
    createdAt: new Date().toISOString()
  };

  orders.set(orderId, order);

  if (bot && ADMIN_CHAT_ID) {
    try {
      const sent = await bot.sendMessage(
        ADMIN_CHAT_ID,
        getGroupText(order),
        { reply_markup: getKeyboard(order) }
      );

      order.messageId = sent.message_id;
    } catch (err) {
      console.error("Гуруҳга буюртма юборилмади:", err.message);

      return res.status(502).json({
        ok: false,
        message: "Буюртма гуруҳга юборилмади. Илтимос, қайта урининг."
      });
    }
  } else {
    return res.status(500).json({
      ok: false,
      message: "Бот ёки гуруҳ созламаси топилмади."
    });
  }

  console.log("Янги буюртма қабул қилинди:", orderId);

  return res.status(201).json({
    ok: true,
    orderId,
    message: "Буюртмангиз қабул қилинди!"
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, botEnabled: Boolean(bot) });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("*", (req, res) => {
  if (req.path === "/style.css" || req.path === "/app.js") {
    return res.status(404).send("Файл топилмади");
  }

  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Такси сайти ишга тушди: порт ${PORT}`);
});
