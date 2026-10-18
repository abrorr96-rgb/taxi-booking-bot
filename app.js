const form = document.querySelector("#order-form");
const submitButton = document.querySelector("#submit-button");
const messageBox = document.querySelector("#form-message");
const telegramLink = document.querySelector("#telegram-link");

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = `form-message ${type}`;
}

function cleanTelegramUsername(value) {
  return value.trim().replace(/^@/, "");
}

// Add your bot username here after creating the bot with @BotFather.
// Example: const TELEGRAM_BOT_USERNAME = "MyTaxiBookingBot";
const TELEGRAM_BOT_USERNAME = "";
if (TELEGRAM_BOT_USERNAME) {
  telegramLink.href = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
} else {
  telegramLink.href = "https://t.me/";
  telegramLink.addEventListener("click", (event) => {
    event.preventDefault();
    alert("Bot username'ini public/app.js faylidagi TELEGRAM_BOT_USERNAME o'zgaruvchisiga kiriting.");
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageBox.className = "form-message";
  submitButton.disabled = true;
  submitButton.innerHTML = "Yuborilmoqda…";

  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.telegramUsername = cleanTelegramUsername(payload.telegramUsername || "");

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Buyurtmani yuborib bo'lmadi.");
    }

    showMessage(`${result.message} Buyurtma raqami: ${result.orderId}. Operator siz bilan bog'lanadi.`, "success");
    form.reset();
  } catch (error) {
    showMessage(error.message || "Xatolik yuz berdi. Internet aloqasini tekshirib, qayta urinib ko'ring.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Buyurtmani yuborish <span>→</span>';
  }
});
