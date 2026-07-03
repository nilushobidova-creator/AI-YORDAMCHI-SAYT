const express = require("express");
const path = require("path");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const app = express();
app.use(express.json({ limit: "20mb" })); // Limit PC dagi yirik trankskriptlar uchun oshirildi
app.use(express.static(__dirname));

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

async function callGemini(systemText, userText) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini xatosi");
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
  return text;
}

// Product Q&A
app.post("/api/chat", async (req, res) => {
  try {
    const { productInfo, message } = req.body;
    const system = `Sen sotuv menejeri uchun mahsulot bo'yicha ichki maslahatchisan. Faqat quyidagi mahsulot ma'lumotlariga tayan, aniq va qisqa javob ber (o'zbek tilida). Agar javob ma'lumotda yo'q bo'lsa, shuni ayt, hech narsa o'ylab topma.\n\nMAHSULOT MA'LUMOTI:\n${productInfo}`;
    const reply = await callGemini(system, message);
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Call transcript analysis
app.post("/api/analyze", async (req, res) => {
  try {
    const { scriptSteps, transcript } = req.body;
    const system = `Sen sotuv qo'ng'iroqlarini nazorat qiluvchi tahlilchisan. Sotuv menejeri quyidagi SKRIPT bosqichlariga amal qilishi kerak edi. Berilgan qo'ng'iroq transkriptini shu skript bilan solishtir va menejer qayerda yolg'on yoki noaniq/xato ma'lumot bergani, qayerda skriptdan chetga chiqqanini top.

SKRIPT BOSQICHLARI:
${scriptSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Javobni FAQAT quyidagi JSON formatda ber, boshqa hech narsa yozma, kod bloklarisiz:
{"honesty_score": 0-100, "script_completion": 0-100, "steps": [{"step": "...", "completed": true, "note": "..."}], "issues": [{"quote": "...", "issue": "...", "severity": "past/o'rta/yuqori"}], "summary": "..."}`;
    const raw = await callGemini(system, `TRANSKRIPT:\n${transcript}`);
    const clean = raw.replace(/```json|```/g, "").trim();
    const jsonStart = clean.indexOf("{");
    const jsonEnd = clean.lastIndexOf("}");
    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Call analysis directly from an audio recording (Gemini listens to the audio itself)
app.post("/api/analyze-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Audio fayl topilmadi" });
    const scriptSteps = JSON.parse(req.body.scriptSteps || "[]");
    const base64Audio = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "audio/mpeg";

    const system = `Sen sotuv qo'ng'iroqlarini nazorat qiluvchi tahlilchisan. Senga mijoz bilan sotuv menejeri o'rtasidagi qo'ng'iroqning AUDIO YOZUVI beriladi. Avval uni diqqat bilan tingla (ichingda), so'ng menejer quyidagi SKRIPT bosqichlariga qanchalik amal qilganini va qayerda yolg'on yoki noaniq/xato ma'lumot berganini aniqla.

SKRIPT BOSQICHLARI:
${scriptSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Javobni FAQAT quyidagi JSON formatda ber, boshqa hech narsa yozma, kod bloklarisiz:
{"transcript": "audio matnining qisqartirilgan yozuvi (asosiy qismlari)", "honesty_score": 0-100, "script_completion": 0-100, "steps": [{"step": "...", "completed": true, "note": "..."}], "issues": [{"quote": "audio dagi aniq jumla", "issue": "...", "severity": "past/o'rta/yuqori"}], "summary": "..."}`;

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Audio } },
              { text: "Yuqoridagi audio - sotuv qo'ng'iroqi yozuvi. Uni tahlil qil." },
            ],
          },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini xatosi");
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const jsonStart = clean.indexOf("{");
    const jsonEnd = clean.lastIndexOf("}");
    const parsed = JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SotuvAI ${PORT}-portda ishlamoqda`));

