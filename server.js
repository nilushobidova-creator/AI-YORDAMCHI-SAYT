// server.js — faqat yo'nalishlar (routes) va ularni bir-biriga bog'lash.
// Baza mantig'i -> db.js, AI mantig'i -> gemini.js, himoya -> middleware.js

const express = require("express");
const path = require("path");
const multer = require("multer");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const store = require("./db");
const ai = require("./gemini");
const { requireAuth, requireAdmin, asyncHandler, errorHandler } = require("./middleware");

const app = express();
app.set("trust proxy", 1); // Railway/Vercel kabi proxy orqasida to'g'ri IP va secure cookie uchun

// ---------- Xavfsizlik ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // oddiy inline <style>/<script> ishlatilgani uchun o'chirilgan
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "So'rovlar juda tez yuborildi. Biroz kuting." },
});

app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "sotuvai-maxfiy-kalit-almashtiring",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 kun
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);
app.use("/api/", apiLimiter);
app.use(express.static(__dirname));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ================= AUTH =================

app.post(
  "/api/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Login va parolni kiriting" });
    }
    const user = store.findUserByUsername(username.trim());
    if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Login yoki parol xato" });
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Sessiya xatosi" });
      req.session.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      };
      res.json({ user: req.session.user });
    });
  })
);

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// ================= MAHSULOT AI (CHAT) =================

app.post(
  "/api/chat",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: "Xabar bo'sh bo'lishi mumkin emas" });

    const product = store.getProduct();
    const history = store.getChatHistory(req.session.user.id, 12);
    const reply = await ai.chatReply(product, history, message.trim());

    store.saveChatMessage(req.session.user.id, "user", message.trim());
    store.saveChatMessage(req.session.user.id, "assistant", reply);

    res.json({ reply });
  })
);

app.get(
  "/api/chat/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ messages: store.getChatHistory(req.session.user.id, 50) });
  })
);

// ================= QO'NG'IROQ TAHLILI =================

app.post(
  "/api/analyze",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { transcript } = req.body || {};
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "Transkript bo'sh bo'lishi mumkin emas" });
    }
    const scriptSteps = store.getScriptSteps();
    const product = store.getProduct();
    const analysis = await ai.analyzeTranscript(scriptSteps, product, transcript.trim());

    const id = store.saveCallAnalysis(req.session.user.id, {
      source: "text",
      title: transcript.trim().slice(0, 60),
      transcript: transcript.trim(),
      analysis,
    });

    res.json({ id, ...analysis });
  })
);

app.post(
  "/api/analyze-audio",
  requireAuth,
  upload.single("audio"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Audio fayl topilmadi" });
    const scriptSteps = store.getScriptSteps();
    const product = store.getProduct();
    const analysis = await ai.analyzeAudio(scriptSteps, product, req.file.buffer, req.file.mimetype || "audio/mpeg");

    const id = store.saveCallAnalysis(req.session.user.id, {
      source: "audio",
      title: "🎙 " + (req.file.originalname || "audio"),
      transcript: analysis.transcript,
      analysis,
    });

    res.json({ id, ...analysis });
  })
);

app.get("/api/history", requireAuth, (req, res) => {
  res.json({ history: store.getUserHistory(req.session.user.id, 50) });
});

app.get("/api/history/:id", requireAuth, (req, res) => {
  const call = store.getCallById(+req.params.id);
  if (!call || (call.user_id !== req.session.user.id && req.session.user.role !== "admin")) {
    return res.status(404).json({ error: "Topilmadi" });
  }
  res.json({ call });
});

// ================= DASHBOARD STATISTIKASI =================

app.get("/api/stats", requireAuth, (req, res) => {
  const userId = req.session.user.role === "admin" && req.query.all === "1" ? null : req.session.user.id;
  res.json(store.getStats(userId));
});

// ================= OPERATOR UCHUN O'QISH (faqat ko'rish) =================

app.get("/api/script", requireAuth, (req, res) => {
  res.json({ scriptSteps: store.getScriptSteps() });
});

app.get("/api/product", requireAuth, (req, res) => {
  res.json({ product: store.getProduct() });
});

// ================= ADMIN: FOYDALANUVCHILAR =================

app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json({ users: store.listUsers() });
});

app.post(
  "/api/admin/users",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { username, password, full_name, role } = req.body || {};
    if (!username || !password || password.length < 4) {
      return res.status(400).json({ error: "Login va kamida 4 belgili parol kiriting" });
    }
    if (store.findUserByUsername(username.trim())) {
      return res.status(409).json({ error: "Bu login band" });
    }
    const id = store.createUser({ username: username.trim(), password, full_name, role });
    res.json({ ok: true, id });
  })
);

app.patch("/api/admin/users/:id/password", requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: "Parol juda qisqa" });
  store.updateUserPassword(+req.params.id, password);
  res.json({ ok: true });
});

app.patch("/api/admin/users/:id/active", requireAdmin, (req, res) => {
  store.setUserActive(+req.params.id, !!req.body?.active);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  if (+req.params.id === req.session.user.id) {
    return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  }
  store.deleteUser(+req.params.id);
  res.json({ ok: true });
});

// ================= ADMIN: MAHSULOT BOSHQARUVI =================

app.get("/api/admin/product", requireAdmin, (req, res) => {
  res.json({ product: store.getProduct() });
});

app.put("/api/admin/product", requireAdmin, (req, res) => {
  const { name, price, category, benefits, ingredients, notes } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Mahsulot nomi shart" });
  store.setProduct({ name, price, category, benefits, ingredients, notes });
  res.json({ ok: true });
});

// ================= ADMIN: SKRIPT =================

app.get("/api/admin/script", requireAdmin, (req, res) => {
  res.json({ scriptSteps: store.getScriptSteps() });
});

app.put("/api/admin/script", requireAdmin, (req, res) => {
  const { scriptSteps } = req.body || {};
  if (!Array.isArray(scriptSteps) || scriptSteps.length === 0) {
    return res.status(400).json({ error: "Kamida bitta bosqich kerak" });
  }
  store.setScriptSteps(scriptSteps.filter((s) => typeof s === "string" && s.trim()));
  res.json({ ok: true });
});

// ================= ADMIN: BARCHA TARIX =================

app.get("/api/admin/history", requireAdmin, (req, res) => {
  res.json({ history: store.getAllHistory(200) });
});

// ================= Statik sahifa + xatoliklar =================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[SotuvAI] ${PORT}-portda ishlamoqda`));
