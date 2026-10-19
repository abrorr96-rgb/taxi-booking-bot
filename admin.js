"use strict";

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const store = require("./store");

const RAW_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_USER = String(process.env.ADMIN_USER || "admin").trim();
const ADMIN_PASSWORD = RAW_PASSWORD.trim();
const PAGE = path.join(__dirname, "admin.html");

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function phoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function tgKey(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/t\.me\//, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");

  return /^[a-z0-9_]{5,32}$/.test(v) ? v : "";
}

function findBlock(phone, telegram) {
  const pk = phoneKey(phone);
  const tk = tgKey(telegram);

  return (
    store.getBlocked().find(
      (b) => (pk && b.key === pk) || (tk && b.tg && b.tg === tk)
    ) || null
  );
}

function isBlocked(phone, telegram) {
  return Boolean(findBlock(phone, telegram));
}

/* ---------- Admin login ---------- */

const fails = new Map();
const WINDOW = 10 * 60 * 1000;

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req) {
  return String(
    req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
  )
    .split(",")[0]
    .trim();
}

function text(res, code, message) {
  return res.status(code).type("text/plain; charset=utf-8").send(message);
}

function auth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return text(
      res,
      503,
      "ADMIN_PASSWORD созланмаган. Render Environment'да созланг."
    );
  }

  const ip = clientIp(req);
  const f = fails.get(ip);
  const recent = f && Date.now() - f.at < WINDOW;

  if (recent && f.n >= 10) {
    return text(
      res,
      429,
      "Жуда кўп уриниш. 10 дақиқадан кейин қайта уриниб кўринг."
    );
  }

  const header = req.headers.authorization || "";

  if (header.startsWith("Basic ")) {
    const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = raw.indexOf(":");
    const user = i < 0 ? raw : raw.slice(0, i);
    const pass = i < 0 ? "" : raw.slice(i + 1);

    const okUser = safeEqual(
      user.trim().toLowerCase(),
      ADMIN_USER.toLowerCase()
    );
    const okPass = safeEqual(pass, ADMIN_PASSWORD);

    if (okUser && okPass) {
      fails.delete(ip);
      return next();
    }

    fails.set(ip, { n: (recent ? f.n : 0) + 1, at: Date.now() });
  }

  res.set(
    "WWW-Authenticate",
    'Basic realm="Taxi admin", charset="UTF-8"'
  );

  return text(res, 401, "Кириш учун логин ва парол керак.");
}

/* ---------- Buyurtma ma'lumotlari ---------- */

function orderView(o) {
  const slots =
    o.slots && typeof o.slots === "object" ? o.slots : {};

  let status = "waiting";

  if (o.cancelled) status = "cancelled";
  else if (o.finished) status = "finished";
  else if (o.currentDriverId != null) status = "driver";

  let currentDriver = "";

  if (status === "driver") {
    const currentSlot =
      o.currentSlot != null ? slots[String(o.currentSlot)] : null;

    if (currentSlot && currentSlot.name) {
      currentDriver = String(currentSlot.name);
    } else {
      const matchingDriver = Object.values(slots).find(
        (driver) =>
          driver &&
          String(driver.id) === String(o.currentDriverId) &&
          driver.name
      );

      if (matchingDriver) {
        currentDriver = String(matchingDriver.name);
      }
    }
  }

  return {
    id: o.orderId || "",
    name: o.name || "",
    phone: o.phone || "",
    telegram: tgKey(o.telegramUsername),
    pickup: o.pickup || "",
    destination: o.destination || "",
    note: o.note || "",
    createdAt: o.createdAt || "",
    status: status,
    currentDriver: currentDriver,

    drivers: [1, 2, 3].map((n) => {
      const driver = slots[String(n)];
      return driver && driver.name ? String(driver.name) : "";
    }),

    blocked: isBlocked(o.phone, o.telegramUsername)
  };
}

function buildState(orders) {
  const views = [...orders.values()]
    .map(orderView)
    .sort((a, b) =>
      String(a.createdAt).localeCompare(String(b.createdAt))
    );

  const clients = new Map();

  views.forEach((o) => {
    const key = phoneKey(o.phone) || o.phone;

    const c = clients.get(key) || {
      key: key,
      name: "",
      phone: o.phone,
      telegram: "",
      orders: 0,
      firstAt: o.createdAt,
      lastAt: ""
    };

    c.orders += 1;
    c.name = o.name || c.name;
    c.phone = o.phone;
    c.telegram = o.telegram || c.telegram;
    c.lastAt = o.createdAt;

    clients.set(key, c);
  });

  store.getBlocked().forEach((b) => {
    if (!clients.has(b.key)) {
      clients.set(b.key, {
        key: b.key,
        name: b.name || "",
        phone: b.phone,
        telegram: b.tg || "",
        orders: 0,
        firstAt: b.blockedAt,
        lastAt: ""
      });
    }
  });

  const list = [...clients.values()].map((c) => {
    const b = findBlock(c.phone, c.telegram);

    return {
      ...c,
      blocked: Boolean(b),
      blockKey: b ? b.key : "",
      reason: b ? b.reason || "" : "",
      blockedAt: b ? b.blockedAt || "" : ""
    };
  });

  return {
    orders: views,
    clients: list,
    blockedCount: store.getBlocked().length
  };
}

/* ---------- Admin routes ---------- */

function setupAdmin(app, { orders, cancelOrder }) {
  const r = express.Router();

  r.use(auth);

  r.use((req, res, next) => {
    if (req.method !== "GET" && !req.is("application/json")) {
      return res.status(415).json({
        ok: false,
        message: "JSON керак."
      });
    }

    next();
  });

  r.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(PAGE);
  });

  r.get("/api/state", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(buildState(orders));
  });

  r.post("/api/block", (req, res) => {
    const b = req.body || {};
    const phone = clean(b.phone, 40);
    const key = phoneKey(phone);

    if (key.length < 7) {
      return res.status(400).json({
        ok: false,
        message: "Телефон рақами нотўғри."
      });
    }

    const list = store.getBlocked().filter((x) => x.key !== key);

    if (list.length >= 5000) {
      return res.status(400).json({
        ok: false,
        message: "Блок рўйхати тўлган."
      });
    }

    list.push({
      key: key,
      phone: phone,
      name: clean(b.name, 80),
      tg: tgKey(b.telegram),
      reason: clean(b.reason, 120),
      blockedAt: new Date().toISOString()
    });

    store.setBlocked(list);
    res.json({ ok: true });
  });

  r.post("/api/unblock", (req, res) => {
    const key = clean((req.body || {}).key, 20);

    store.setBlocked(
      store.getBlocked().filter((x) => x.key !== key)
    );

    res.json({ ok: true });
  });

  r.post("/api/orders/:id/cancel", async (req, res) => {
    const order = orders.get(req.params.id);

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Буюртма топилмади."
      });
    }

    if (order.finished) {
      return res.status(409).json({
        ok: false,
        message: "Бу буюртма аллақачон ёпилган."
      });
    }

    try {
      await cancelOrder(order);
      store.saveOrders();
      res.json({ ok: true });
    } catch (err) {
      console.error(
        "Буюртмани бекор қилиш хатоси:",
        err.message
      );

      res.status(500).json({
        ok: false,
        message: "Бекор қилинмади."
      });
    }
  });

  app.use("/admin", r);
}

module.exports = {
  setupAdmin,
  isBlocked
};
