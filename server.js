import express from 'express';
import multer from 'multer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'audio-' + uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac'];
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
  let geminiFileUri = null;

  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable topilmadi. Railway sozlamalarida API kalitni tekshiring.');
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Audio fayl yuklanmadi.' });
    }

    uploadedFilePath = req.file.path;
    const checklistItems = req.body.checklist ? JSON.parse(req.body.checklist) : [];

    console.log('📁 Fayl qabul qilindi:', req.file.originalname);
    console.log('📋 Tekshirish ro\'yxati:', checklistItems);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

    console.log('⬆️  Gemini serveriga audio yuklanyapti...');
    const uploadResult = await fileManager.uploadFile(uploadedFilePath, {
      mimeType: req.file.mimetype,
      displayName: req.file.originalname,
    });

    geminiFileUri = uploadResult.file.uri;
    console.log('✅ Fayl yuklandi:', uploadResult.file.name);

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

**MAHSULOT MA'LUMOTLARI:**
- Nomi: Abihayat
- Tarkibi: Toza asal, qizil ginseng, ashwagandha, baxmal
- Narxi: 600,000 so'm (bitta shisha uchun)
- AKSIYA: 2+2 bonus taklif — 2 ta sotib oling, 2 ta bepul oling (jami 4 ta shisha)

**TEKSHIRISH MEZONLARI:**
${checklistString}

**VAZIFA:**
Audio yozuvni eshitib, menejer qanchalik professional ishladi va quyidagi mezonlarga javob berdi yoki yo'qligini baholang.

**MAJBURIY JAVOB FORMATI - FAQAT TO'G'RI JSON:**

{
  "score": 85,
  "summary": "Menejer umumiy yaxshi ishladi, lekin aksiyani tushuntirishda zaiflik ko'rsatdi.",
  "checkpoints": [
    {
      "name": "Salomlashish",
      "status": "passed",
      "time": "00:05",
      "comment": "Issiq va professional salomlashish amalga oshirildi."
    },
    {
      "name": "Mahsulot tarkibini tushuntirish",
      "status": "passed",
      "time": "00:45",
      "comment": "Tarkibni batafsil va tushunarli bayon qildi."
    },
    {
      "name": "Narxni aytish",
      "status": "failed",
      "time": "01:30",
      "comment": "Narxni aytdi, lekin aksiya haqida gapirmadi."
    }
  ],
  "critical_errors": [
    {
      "time": "02:15",
      "description": "Mijoz qimmat deyilganda hech qanday javob bermay jim qoldi."
    },
    {
      "time": "03:40",
      "description": "Aksiya shartlarini noto'g'ri tushuntirdi (2+1 deb aytdi, 2+2 o'rniga)."
    }
  ]
}

**MUHIM:**
- "score" 0 dan 100 gacha bo'lishi kerak
- Har bir checkpoint uchun "status" faqat "passed" yoki "failed" bo'lishi kerak
- "time" formatida daqiqa:soniya (masalan: "01:23")
- Agar jiddiy xatolar bo'lmasa, "critical_errors" bo'sh array [] bo'lishi mumkin
- Faqat JSON qaytaring, boshqa hech narsa yo'q
- Javobingiz valid JSON formatida bo'lishi shart
`;

    const result = await model.generateContent([
      {
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri
        }
      },
      { text: systemPrompt }
    ]);

    const response = await result.response;
    let analysisText = response.text();
    
    console.log('🤖 AI javob olindi:', analysisText.substring(0, 200) + '...');

    analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let analysisJson;
    try {
      analysisJson = JSON.parse(analysisText);
    } catch (parseError) {
      console.error('❌ JSON parse xatosi:', parseError);
      console.error('📄 To\'liq javob:', analysisText);
      
      analysisJson = {
        score: 50,
        summary: 'AI javobini qayta ishlashda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.',
        checkpoints: checklistItems.map(item => ({
          name: item,
          status: 'failed',
          time: '00:00',
          comment: 'Tahlil noto\'liq bajarildi'
        })),
        critical_errors: [
          {
            time: '00:00',
            description: 'Texnik xatolik: AI javobi noto\'g\'ri formatda qaytdi'
          }
        ]
      };
    }

    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
      console.log('🗑️  Vaqtinchalik fayl o\'chirildi');
    }

    console.log('✅ Tahlil muvaffaqiyatli yakunlandi. Ball:', analysisJson.score);

    res.json(analysisJson);

  } catch (error) {
    console.error('❌ Xatolik yuz berdi:', error);

    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupError) {
        console.error('Faylni o\'chirishda xatolik:', cleanupError);
      }
    }

    res.status(500).json({
      error: 'Tahlil paytida xatolik yuz berdi',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
