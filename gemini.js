// gemini.js — Gemini API bilan bog'liq barcha mantiq shu yerda.
// server.js bu funksiyalarni chaqiradi, prompt matnlari haqida bosh og'rig'i bo'lmaydi.

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

if (!GEMINI_KEY) {
  console.warn("[SotuvAI] OGOHLANTIRISH: GEMINI_API_KEY o'rnatilmagan. AI so'rovlari ishlamaydi.");
}

async function callGeminiRaw(systemText, parts) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || `Gemini xatosi (${res.status})`;
    throw new Error(msg);
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
  if (!text) throw new Error("Gemini bo'sh javob qaytardi");
  return text;
}

function parseJsonLoose(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("AI javobida JSON topilmadi");
  return JSON.parse(clean.slice(s, e + 1));
}

function formatProduct(product) {
  return `Nomi: ${product.name || "-"}
Narxi: ${product.price || "-"}
Turi/Kategoriyasi: ${product.category || "-"}
Foydalari:\n${product.benefits || "-"}
Tarkibi: ${product.ingredients || "-"}
Eslatmalar: ${product.notes || "-"}`;
}

// ---------- Mahsulot bo'yicha chat ----------
async function chatReply(product, history, message) {
  const system = `Sen sotuv menejeri (operator) uchun mahsulot bo'yicha ichki maslahatchisan. Faqat quyidagi mahsulot ma'lumotiga tayan, aniq va qisqa javob ber (o'zbek tilida). Agar javob ma'lumotda yo'q bo'lsa, shuni ochiq ayt, hech narsa o'ylab topma.

MAHSULOT MA'LUMOTI:
${formatProduct(product)}`;

  // Oxirgi bir necha xabarni kontekst sifatida qo'shamiz
  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Operator" : "AI"}: ${m.content}`)
    .join("\n");
  const userText = historyText ? `${historyText}\nOperator: ${message}` : message;

  const raw = await callGeminiRaw(system, [{ text: userText }]);
  return raw.trim();
}

// ---------- Tahlil uchun umumiy JSON sxema ----------
const ANALYSIS_SCHEMA_HINT = `Javobni FAQAT quyidagi JSON formatda ber, boshqa hech narsa yozma, kod bloklarisiz, izohlarsiz:
{
  "honesty_score": 0-100 (menejer qanchalik rost va aniq gapirgani),
  "script_completion": 0-100 (skript necha foiz bajarilgani),
  "confidence_score": 0-100 (menejer qanchalik ishonchli va tinch gapirgani),
  "politeness_score": 0-100 (menejerning muloyimligi, hurmati),
  "product_knowledge_score": 0-100 (mahsulotni qanchalik yaxshi bilgani),
  "closing_skill_score": 0-100 (suhbatni qanchalik yaxshi yakunlagani / keyingi qadamga olib borgani),
  "steps": [{"step": "bosqich nomi", "completed": true/false, "note": "qisqa izoh"}],
  "issues": [
    {
      "quote": "transkript/audiodan qisqa parcha",
      "what_was_wrong": "nima xato yoki yolg'on ekani",
      "why_wrong": "bu nega xato yoki muammoli ekanining sababi",
      "correct_version": "shu joyda qanday aytish to'g'ri bo'lardi",
      "severity": "past/o'rta/yuqori"
    }
  ],
  "summary": "2-3 gapli umumiy xulosa"
}`;

function buildAnalysisSystem(scriptSteps, product) {
  return `Sen sotuv qo'ng'iroqlarini nazorat qiluvchi tahlilchisan. Operator (sotuv menejeri) quyidagi SKRIPT bosqichlariga amal qilishi va mahsulot haqida to'g'ri ma'lumot berishi kerak edi.

SKRIPT BOSQICHLARI:
${scriptSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

MAHSULOT HAQIDA TO'G'RI MA'LUMOT (operatorning aytganlarini shu bilan solishtir):
${formatProduct(product)}

Har bir aniqlangan xato yoki yolg'on uchun albatta uchta narsani alohida ko'rsat: nima xato edi, nega bu xato/muammoli, va to'g'ri versiyasi qanday bo'lishi kerak edi.

${ANALYSIS_SCHEMA_HINT}`;
}

// ---------- Matn transkript tahlili ----------
async function analyzeTranscript(scriptSteps, product, transcript) {
  const system = buildAnalysisSystem(scriptSteps, product);
  const raw = await callGeminiRaw(system, [{ text: `TRANSKRIPT:\n${transcript}` }]);
  return normalizeAnalysis(parseJsonLoose(raw));
}

// ---------- Audio tahlili ----------
async function analyzeAudio(scriptSteps, product, audioBuffer, mimeType) {
  const system = buildAnalysisSystem(scriptSteps, product) + `

Senga qo'shimcha ravishda audio yozuvning o'zi beriladi. Avval uni diqqat bilan tingla, so'ng yuqoridagi JSON formatda tahlil qil. JSON ichiga yana "transcript" maydonini ham qo'sh (audio matnining qisqartirilgan yozuvi).`;
  const base64Audio = audioBuffer.toString("base64");
  const raw = await callGeminiRaw(system, [
    { inline_data: { mime_type: mimeType, data: base64Audio } },
    { text: "Yuqoridagi audio - sotuv qo'ng'iroqi yozuvi. Uni tahlil qil." },
  ]);
  return normalizeAnalysis(parseJsonLoose(raw));
}

// Gemini har doim hamma maydonni to'liq qaytarmasligi mumkin — xavfsiz standartlar bilan to'ldiramiz
function normalizeAnalysis(a) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return {
    transcript: a.transcript || null,
    honesty_score: clamp(a.honesty_score),
    script_completion: clamp(a.script_completion),
    confidence_score: clamp(a.confidence_score),
    politeness_score: clamp(a.politeness_score),
    product_knowledge_score: clamp(a.product_knowledge_score),
    closing_skill_score: clamp(a.closing_skill_score),
    steps: Array.isArray(a.steps) ? a.steps : [],
    issues: Array.isArray(a.issues) ? a.issues : [],
    summary: a.summary || "",
  };
}

module.exports = { chatReply, analyzeTranscript, analyzeAudio };
