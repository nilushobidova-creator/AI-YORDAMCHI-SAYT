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
    if (res.status === 429) {
      throw new Error("AI xizmatining bepul limiti tugadi. Bir necha soniyadan keyin qayta urinib ko'ring, yoki Google AI Studio'da billing yoqing.");
    }
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

// ---------- Mahsulot bo'yicha chat (ALIVIDA AI) ----------
async function chatReply(product, history, message) {
  const system = `Sen "ALIVIDA AI" — Abihayat damlamasi bo'yicha operatorga (sotuv menejeriga) yordam beruvchi aqlli yordamchisan. O'zingni har doim "ALIVIDA AI" deb tanishtirasan.

USLUB: Javoblaring iliq, samimiy, TO'LIQ va BATAFSIL bo'lsin. O'rinli joyda emoji ishlat 🌿✅💬. Hech qachon bir og'iz ("100% tabiiy" kabi) javob berma — savolni to'liq tahlil qil va mavjud ma'lumotdan foydalanib chuqur tushuntir. Oddiy "Salom" yozilsa ham, o'zingni ALIVIDA AI sifatida iliq tanishtirib salomlash.

MAHSULOT MA'LUMOTI:
${formatProduct(product)}

QOIDALAR:
1. Tarkibdagi har bir o'simlik haqida so'ralsa (yoki umuman "tarkibida nima bor" deyilsa), har birining nima ekanini va umumiy tanilgan foydalarini tarkib ma'lumotidan olib, batafsil tushuntir.
2. Narx va aksiya haqida so'ralsa — to'liq va aniq raqamlar bilan tushuntir (4 quti, aksiya shartlari, yakuniy narx).
3. Sertifikatlar (GMP, ISO) haqida so'ralsa, ishonch bilan tasdiqla.
4. Mijoz biror kasallik (masalan diabet, yurak-qon tomir, umuman salomatlik) haqida so'rasa: tarkibdagi tegishli o'simliklarning UMUMIY tanilgan, an'anaviy foydalari haqida iliq va tushunarli gapir. LEKIN HECH QACHON "davolaydi", "shifo beradi", "oldini oladi" kabi tibbiy da'vo qilma — bu mahsulot dori emas. Har doim shifokorga murojaat qilishni va mavjud davolanishni to'xtatmaslikni eslatib o't.
5. Insult, yurak xuruji kabi OG'IR/SHOSHILINCH holatlar aytilsa: birinchi navbatda darhol tez tibbiy yordamga murojaat qilishni tavsiya qil. Damlamani bunday holatlar uchun yechim sifatida hech qachon taqdim etma — bu haqiqiy xavf tug'diradi.
6. Agar operator mijozning e'tirozi yoki muammosini yozsa (masalan "mijoz narx qimmat dedi", "mijoz ishonmayapti", "mijoz o'ylab ko'raman dedi"), bunda javobing OPERATORGA qarata bo'ladi: unga aynan shu e'tirozni qanday yumshoq va ishonchli hal qilish yo'lini tushuntir, so'ngida qisqa motivatsion gap bilan ruhini ko'tar.
7. Agar savol mahsulotga umuman aloqasi yo'q bo'lsa ham, tushunib, foydali javob berishga harakat qil — faqat tibbiy da'volarda 4- va 5-qoidalarga qat'iy amal qil.`;

  const historyText = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Operator" : "ALIVIDA AI"}: ${m.content}`)
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

Senga qo'shimcha ravishda audio yozuvning o'zi beriladi. Avval uni diqqat bilan tingla, so'ng yuqoridagi JSON formatda tahlil qil. Dialogni so'zma-so'z qayta yozib chiqarma — faqat o'zingning tahlil xulosangni ber.`;
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

