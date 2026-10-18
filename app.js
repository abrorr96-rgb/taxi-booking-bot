const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const statusEl = document.getElementById("status");

const fields = {
  pickup: document.getElementById("pickup"),
  destination: document.getElementById("destination"),
  phone: document.getElementById("phone"),
  note: document.getElementById("note"),
  telegram: document.getElementById("telegram")
};

function setStatus(text, type) {
  statusEl.textContent = text;
  statusEl.className = "status" + (type ? " " + type : "");
}

function normalizeTelegram(value) {
  const v = value.trim();
  const m = v.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i);
  if (m) return m[1];
  return v.replace(/^@/, "");
}

// Telegram ichida ochilsa, ism va usernameni avtomatik olamiz
const tgUser = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
if (tgUser && tgUser.username && !fields.telegram.value) {
  fields.telegram.value = "@" + tgUser.username;
}

Object.values(fields).forEach((el) => {
  el.addEventListener("input", () => el.classList.remove("invalid"));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("", "");

  const required = ["pickup", "destination", "phone"];
  let hasError = false;
  required.forEach((key) => {
    if (!fields[key].value.trim()) {
      fields[key].classList.add("invalid");
      hasError = true;
    }
  });
  if (hasError) {
    setStatus("Iltimos, majburiy maydonlarni to‘ldiring.", "error");
    return;
  }

  const customerName =
    (tgUser && [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ")) || "Mijoz";

  const payload = {
    name: customerName,
    phone: fields.phone.value.trim(),
    pickup: fields.pickup.value.trim(),
    destination: fields.destination.value.trim(),
    note: fields.note.value.trim(),
    telegramUsername: normalizeTelegram(fields.telegram.value)
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Yuborilmoqda...";

  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (response.ok && data.ok) {
      setStatus(`✅ ${data.message} Buyurtma raqami: ${data.orderId}`, "ok");
      form.reset();
    } else {
      setStatus(data.message || "Xatolik yuz berdi. Qayta urinib ko‘ring.", "error");
    }
  } catch (err) {
    setStatus("Internet bilan aloqa yo‘q. Qayta urinib ko‘ring.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "🚖 Buyurtma berish ➔";
  }
});
