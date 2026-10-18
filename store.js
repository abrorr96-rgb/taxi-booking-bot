"use strict";

// Буюртмалар ва блокланган мижозлар рўйхатини JSON файлда сақлайди.
// Файл йўли: DATA_FILE (.env) ёки лойиҳа папкасидаги taxi-data.json.

const fs = require("fs");
const path = require("path");

const FILE = process.env.DATA_FILE || path.join(__dirname, "taxi-data.json");

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

  setInterval(save, 10000);

  const flush = () => {
    save();
    process.exit(0);
  };

  process.on("SIGTERM", flush);
  process.on("SIGINT", flush);
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
