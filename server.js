require("dotenv").config();

const express = require("express");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEB_APP_URL = (process.env.WEB_APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

app.use(express.json({ limit: "100kb" }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (_req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js")));

let bot = null;
if (BOT_TOKEN && BOT_TOKEN !== "PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE") {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/^\/start(?:\s.*)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const keyboard = {
      inline_keyboard: [[
        { text: "🚕 Buyurtma berish", web_app: { url: WEB_APP_URL } }
      ], [
        { text: "🌐 Saytni ochish", url: WEB_APP_URL }
      ]]
    };
    const welcome =
      "Assalomu alaykum! 🚕\\n\\n" +
      "Taxi Booking xizmatiga xush kelibsiz.\\n" +
      "Buyurtma berish uchun quyidagi tugmani bosing.\\n\\n" +
      "Buyruqlar: /start — bosh menyu, /help — yordam";
    try {
      await bot.sendMessage(chatId, welcome, { reply_markup: keyboard });
    } catch (err) {
      console.error("Telegram /start error:", err.message);
    }
  });

  bot.onText(/^\/help$/, async (msg) => {
    bot.sendMessage(msg.chat.id,
      "Buyurtma berish uchun /start buyrug'ini yuboring va «Buyurtma berish» tugmasini bosing.\\n" +
      "Saytdagi forma orqali ism, telefon, olib ketish manzili va borish manzilini kiriting."
    ).catch((err) => console.error("Telegram /help error:", err.message));
  });

  bot.on("polling_error", (err) => console.error("Telegram polling error:", err.message));
  console.log("Telegram bot polling started.");
} else {
  console.warn("BOT_TOKEN kiritilmagan. Web-ilova ishlaydi, Telegram bot o'chirilgan.");
}

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

app.post("/api/orders", async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const phone = cleanText(req.body.phone, 40);
  const pickup = cleanText(req.body.pickup, 200);
  const destination = cleanText(req.body.destination, 200);
  const note = cleanText(req.body.note, 500);
  const telegramUsername = cleanText(req.body.telegramUsername, 80);

  if (!name || !phone || !pickup || !destination) {
    return res.status(400).json({ ok: false, message: "Barcha majburiy maydonlarni to'ldiring." });
  }

  const orderId = `TX-${Date.now().toString().slice(-8)}`;
  const order = {
    orderId, name, phone, pickup, destination, note, telegramUsername,
    createdAt: new Date().toISOString()
  };

  console.log("NEW TAXI ORDER:", JSON.stringify(order, null, 2));

  if (bot && ADMIN_CHAT_ID) {
    const message =
      `🚕 YANGI TAKSI BUYURTMASI\\n\\n` +
      `🆔 Buyurtma: ${orderId}\\n` +
      `👤 Ism: ${name}\\n` +
      `📞 Telefon: ${phone}\\n` +
      `📍 Qayerdan: ${pickup}\\n` +
      `🏁 Qayerga: ${destination}\\n` +
      (note ? `📝 Izoh: ${note}\\n` : "") +
      (telegramUsername ? `💬 Telegram: @${telegramUsername.replace(/^@/, "")}\\n` : "") +
      `🕒 Vaqt: ${new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`;
    try {
      await bot.sendMessage(ADMIN_CHAT_ID, message);
    } catch (err) {
      console.error("Admin notification failed:", err.message);
      // Order is still accepted; notification configuration can be fixed separately.
    }
  }

  return res.status(201).json({
    ok: true,
    orderId,
    message: "Buyurtmangiz qabul qilindi!"
  });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, botEnabled: Boolean(bot) }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Taxi Booking web app running on port ${PORT}`);
  console.log(`Local URL: http://localhost:${PORT}`);
});
