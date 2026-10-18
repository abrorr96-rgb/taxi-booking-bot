
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
  if (
    order.sending ||
    order.finished ||
    order.currentDriverId
  ) {
    return;
  }

  order.sending = true;

  try {
    while (true) {
      const slot = [1, 2, 3].find(
        (n) =>
          order.slots[n] &&
          !order.processedSlots.has(n)
      );

      if (!slot) {
        const allSlotsFilled = [1, 2, 3].every(
          (n) => Boolean(order.slots[n])
        );

        const allProcessed = [1, 2, 3].every(
          (n) => order.processedSlots.has(n)
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

      if (!startedDrivers.has(driver.id)) {
        order.processedSlots.add(slot);
        order.statusText =
          `⚠️ ${driver.name} ботда /start босмаган. Навбати ўтказилди.`;

        await updateGroup(order);
        continue;
      }

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
          `⚠️ ${driver.name} га хабар бормади. Кейинги ҳайдовчи текширилмоқда.`;

        await updateGroup(order);
      }
    }
  } finally {
    order.sending = false;
  }
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
      console.error(
        "Тугма хатоси:",
        err.stack || err.message
      );

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

  if (!bot || !ADMIN_CHAT_ID) {
    return res.status(500).json({
      ok: false,
      message: "Бот ёки гуруҳ созламаси топилмади."
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Такси сайти ишга тушди: порт ${PORT}`);
});
