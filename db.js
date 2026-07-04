// db.js — SQLite ulanishi va barcha ma'lumotlar bilan ishlash funksiyalari.
// Marta shu joyga to'plangan, shunda server.js faqat yo'nalishlar (routes) bilan shug'ullanadi.

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = process.env.DB_PATH || "./sotuvai.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- Sxema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('text', 'audio')),
    title TEXT,
    transcript TEXT,
    honesty_score INTEGER,
    script_completion INTEGER,
    confidence_score INTEGER,
    politeness_score INTEGER,
    product_knowledge_score INTEGER,
    closing_skill_score INTEGER,
    summary TEXT,
    steps_json TEXT,
    issues_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_calls_user ON calls(user_id);
  CREATE INDEX IF NOT EXISTS idx_calls_created ON calls(created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);
`);

// ---------- Standart sozlamalar ----------
const DEFAULT_PRODUCT = {
  name: "Abihayat",
  price: "285 000 so'm / quti (30 kunlik)",
  category: "Tabiiy o'simlik asosidagi quvvat va salomatlik mahsuloti",
  benefits: "Energiya oshiradi\nImmunitetni mustahkamlaydi",
  ingredients: "100% tabiiy o'simlik ekstraktlari",
  notes: "Dori vositasi emas, biologik faol qo'shimcha sifatida tavsiya etiladi",
};

const DEFAULT_SCRIPT_STEPS = [
  "Salomlashish va o'zini tanishtirish",
  "Mijoz ehtiyojini aniqlash",
  "Mahsulotni to'g'ri va halol taqdim etish",
  "Narx va shartlarni aniq aytish",
  "Mijoz e'tirozlariga javob berish",
  "Keyingi qadamni kelishish (buyurtma yoki qo'ng'iroq)",
];

function seedIfEmpty() {
  const userCount = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "admin123";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'admin')"
    ).run(username, hash, "Administrator");
    console.log(`[SotuvAI] Standart admin yaratildi -> login: ${username} / parol: ${password}`);
    console.log("[SotuvAI] MUHIM: tizimga kirib, parolni darhol almashtiring!");
  }
  if (!getSetting("product")) setSetting("product", JSON.stringify(DEFAULT_PRODUCT));
  if (!getSetting("script_steps")) setSetting("script_steps", JSON.stringify(DEFAULT_SCRIPT_STEPS));
}

// ---------- Settings helperlari ----------
function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
function getProduct() {
  return JSON.parse(getSetting("product") || JSON.stringify(DEFAULT_PRODUCT));
}
function setProduct(product) {
  setSetting("product", JSON.stringify(product));
}
function getScriptSteps() {
  return JSON.parse(getSetting("script_steps") || JSON.stringify(DEFAULT_SCRIPT_STEPS));
}
function setScriptSteps(steps) {
  setSetting("script_steps", JSON.stringify(steps));
}

// ---------- Users ----------
function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}
function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}
function listUsers() {
  return db
    .prepare("SELECT id, username, full_name, role, active, created_at FROM users ORDER BY id")
    .all();
}
function createUser({ username, password, full_name, role }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)")
    .run(username, hash, full_name || username, role === "admin" ? "admin" : "operator");
  return info.lastInsertRowid;
}
function setUserActive(id, active) {
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}
function deleteUser(id) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}
function updateUserPassword(id, password) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
}

// ---------- Chat tarixi ----------
function saveChatMessage(userId, role, content) {
  db.prepare("INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)").run(
    userId,
    role,
    content
  );
}
function getChatHistory(userId, limit = 50) {
  return db
    .prepare(
      "SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?"
    )
    .all(userId, limit)
    .reverse();
}

// ---------- Qo'ng'iroq tahlillari ----------
function saveCallAnalysis(userId, { source, title, transcript, analysis }) {
  const info = db
    .prepare(
      `INSERT INTO calls
        (user_id, source, title, transcript, honesty_score, script_completion, confidence_score,
         politeness_score, product_knowledge_score, closing_skill_score, summary, steps_json, issues_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      source,
      title || null,
      transcript || null,
      analysis.honesty_score ?? null,
      analysis.script_completion ?? null,
      analysis.confidence_score ?? null,
      analysis.politeness_score ?? null,
      analysis.product_knowledge_score ?? null,
      analysis.closing_skill_score ?? null,
      analysis.summary || "",
      JSON.stringify(analysis.steps || []),
      JSON.stringify(analysis.issues || [])
    );
  return info.lastInsertRowid;
}

function getCallById(id) {
  const row = db.prepare("SELECT * FROM calls WHERE id = ?").get(id);
  return row ? hydrateCall(row) : null;
}
function getUserHistory(userId, limit = 50) {
  return db
    .prepare("SELECT * FROM calls WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit)
    .map(hydrateCall);
}
function getAllHistory(limit = 200) {
  return db
    .prepare(
      `SELECT calls.*, users.full_name, users.username
       FROM calls JOIN users ON users.id = calls.user_id
       ORDER BY calls.id DESC LIMIT ?`
    )
    .all(limit)
    .map(hydrateCall);
}
function hydrateCall(row) {
  return {
    ...row,
    steps: row.steps_json ? JSON.parse(row.steps_json) : [],
    issues: row.issues_json ? JSON.parse(row.issues_json) : [],
  };
}

// ---------- Dashboard statistikasi ----------
function getStats(userId /* null = hammasi (admin) */) {
  const where = userId ? "WHERE user_id = ?" : "";
  const args = userId ? [userId] : [];

  const totals = db
    .prepare(
      `SELECT
        COUNT(*) count,
        AVG(honesty_score) avg_honesty,
        AVG(script_completion) avg_script,
        AVG(confidence_score) avg_confidence,
        AVG(politeness_score) avg_politeness,
        AVG(product_knowledge_score) avg_knowledge,
        AVG(closing_skill_score) avg_closing
       FROM calls ${where}`
    )
    .get(...args);

  const byDay = db
    .prepare(
      `SELECT date(created_at) day, COUNT(*) count, AVG(honesty_score) avg_honesty, AVG(script_completion) avg_script
       FROM calls ${where}
       GROUP BY date(created_at)
       ORDER BY day DESC LIMIT 14`
    )
    .all(...args)
    .reverse();

  return { totals, byDay };
}

seedIfEmpty();

module.exports = {
  db,
  getSetting,
  setSetting,
  getProduct,
  setProduct,
  getScriptSteps,
  setScriptSteps,
  findUserByUsername,
  findUserById,
  listUsers,
  createUser,
  setUserActive,
  deleteUser,
  updateUserPassword,
  saveChatMessage,
  getChatHistory,
  saveCallAnalysis,
  getCallById,
  getUserHistory,
  getAllHistory,
  getStats,
};
