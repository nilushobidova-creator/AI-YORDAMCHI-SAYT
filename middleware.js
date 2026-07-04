// middleware.js — autentifikatsiya tekshiruvlari va xatoliklarni yagona joydan boshqarish

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Tizimga kiring" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Bu amal faqat administrator uchun" });
  }
  next();
}

// Har bir async route handlerni shu bilan o'rab qo'ysak, try/catch yozish shart bo'lmaydi
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Barcha xatoliklar oxir-oqibat shu yerga tushadi va bir xil formatda qaytariladi
function errorHandler(err, req, res, next) {
  console.error("[SotuvAI xatosi]", err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Server xatosi yuz berdi" });
}

module.exports = { requireAuth, requireAdmin, asyncHandler, errorHandler };
