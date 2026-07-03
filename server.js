import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Multer sozlamalari
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'audio-' + uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
      'audio/webm', 'audio/m4a', 'audio/mp4', 'audio/x-m4a',
      'audio/aac', 'audio/flac'
    ];
    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Faqat audio fayllar qabul qilinadi!'), false);
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.post('/api/analyze', upload.single('audio'), async (req, res) => {
  let uploadedFilePath = null;

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable topilmadi.');
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Audio fayl yuklanmadi.' });
    }

    uploadedFilePath = req.file.path;
    const checklistItems = req.body.checklist ? JSON.parse(req.body.checklist) : [];

    console.log('📁 Fayl qabul qilindi:', req.file.originalname);

    // ✅ DINAMIK IMPORT: Eski versiyalarda server crash bo'lmasligi uchun
    let GoogleAIFileManager;
    try {
      const module = await import('@google/generative-ai');
      GoogleAIFileManager = module.GoogleAIFileManager;
      if (!GoogleAIFileManager) {
        throw new Error('GoogleAIFileManager klassi mavjud emas. @google/generative-ai paketini yangilang.');
      }
    } catch (importErr) {
      throw new Error(`Import xatosi: ${importErr.message}`);
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    console.log('⬆️ Gemini serveriga audio yuklanyapti...');
    const uploadResult = await fileManager.uploadFile(uploadedFilePath, {
      mimeType: req.file.mimetype,
      displayName: req.file.originalname,
    });

    let file = await fileManager.getFile(uploadResult.file.name);
    console.log('⏳ Fayl holati:', file.state);

    while (file.state === 'PROCESSING') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      file = await fileManager.getFile(uploadResult.file.name);
      console.log('⏳ Hali ishlov berilmoqda... Holat:', file.state);
    }

    if (file.state === 'FAILED') {
      throw new Error('Gemini serveri faylni qayta ishlay olmadi.');
    }

    console.log('🎯 Fayl tayyor. AI tahlil boshlanmoqda...');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const checklistString = checklistItems.length > 0
      ? checklistItems.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
      : 'Standart sifat ko\'rsatkichlari';

    const systemPrompt = `
Siz professional sifat nazorati bo'yicha mutaxassiz. Qo'ng'iroq audio yozuvini chuqur tahlil qiling.

MAHSULOT MA'LUMOTLARI:
Nomi: Abihayat
Tarkibi: zaytun, kekkik, dolchin
Narxi: 600,000 so'm (bitta quti uchun)
AKSIYA: 2+2 bonus taklif — 2 ta sotib oling, 2 ta bepul oling (jami 4 ta quti). Maxsulot soni 1 taga kamaysa narx ham 200,000 soʻmga tushadi.

TEKSHIRISH MEZONLARI:
${checklistString}

VAZIFA:
Audio yozuvni eshitib, menejer qanchalik professional ishladi va mezonlarga javob berdimi baholang.

MAJBURIY JAVOB FORMATI - FAQAT TO'G'RI JSON:
{
 "score": 85,
 "summary": "Qisqa umumiy xulosa",
 "checkpoints": [
   { "name": "Mezon nomi", "status": "passed/failed", "time": "MM:SS", "comment": "Izoh" }
 ],
 "critical_errors": [
   { "time": "MM:SS", "description": "Jiddiy xato tavsifi" }
 ]
}

MUHIM:
- "score" 0-100 oralig'ida
- "status" faqat "passed" yoki "failed"
- Vaqt formati: "MM:SS"
- Faqat valid JSON qaytaring, boshqa matn yo'q
`;

    const result = await model.generateContent([
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      { text: systemPrompt }
    ]);

    let analysisText = result.response.text();
    console.log('🤖 AI javob olindi:', analysisText.substring(0, 150) + '...');

    // Markdown kod bloklarini tozalash
    analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let analysisJson;
    try {
      analysisJson = JSON.parse(analysisText);
    } catch (parseError) {
      console.error('❌ JSON parse xatosi:', parseError.message);
      analysisJson = {
        score: 50,
        summary: 'AI javobini qayta ishlashda xatolik. Iltimos qaytadan urinib ko\'ring.',
        checkpoints: checklistItems.map(item => ({
          name: item, status: 'failed', time: '00:00', comment: 'Tahlil noto\'liq'
        })),
        critical_errors: [{ time: '00:00', description: 'Texnik xatolik: AI javobi noto\'g\'ri formatda' }]
      };
    }

    console.log('✅ Tahlil yakunlandi. Ball:', analysisJson.score);
    res.json(analysisJson);

  } catch (error) {
    console.error('❌ Xatolik:', error.message);
    res.status(500).json({
      error: 'Tahlil paytida xatolik yuz berdi',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    // ✅ Har doim vaqtinchalik faylni o'chirish
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
        console.log('🗑️ Vaqtinchalik fayl o\'chirildi');
      } catch (cleanupError) {
        console.error('Faylni o\'chirishda xatolik:', cleanupError.message);
      }
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY
  });
});

app.listen(PORT, () => {
  console.log('🚀 Server ishga tushdi');
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`🔑 Gemini API: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ MISSING'}`);
  console.log('⏰ Vaqt:', new Date().toLocaleString('uz-UZ'));
});
