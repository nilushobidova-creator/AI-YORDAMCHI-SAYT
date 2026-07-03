require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const db = require('./database/db');

const app = express();
const port = process.env.PORT || 3000;
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Middlewares
app.use(helmet({ contentSecurityPolicy: false })); // Disabled CSP for simplified CDN usage
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Multer for Audio Uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/') || file.mimetype === 'text/plain') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only audio and text are allowed.'));
        }
    }
});

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- ROUTES ---

// Auth
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM Users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid credentials' });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, role: user.role });
    });
});

// Products
app.get('/api/products', authenticateToken, (req, res) => {
    db.all("SELECT * FROM Products", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// AI Chat
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { message, history } = req.body;
    
    try {
        db.get("SELECT * FROM Products WHERE status = 'active' LIMIT 1", async (err, product) => {
            const systemPrompt = `You are a professional sales assistant for SotuvAI. Use the following product info to answer. Never hallucinate. 
            Product: ${product.name}
            Ingredients: ${product.ingredients}
            Benefits: ${product.benefits}
            Warnings: ${product.warnings}
            Important: Never guarantee a money-back policy. If price is not listed, ask the user to contact a manager.`;

            let formattedHistory = history.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [...formattedHistory, { role: 'user', parts: [{ text: message }] }],
                config: { systemInstruction: systemPrompt }
            });

            res.json({ reply: response.text });
        });
    } catch (error) {
        res.status(500).json({ error: 'AI Service Error', details: error.message });
    }
});

// Call Analysis
app.post('/api/analyze', authenticateToken, upload.single('callFile'), async (req, res) => {
    try {
        const transcript = req.body.transcript || "Simulated audio transcript for processing...";
        
        const prompt = `Analyze this call transcript. Return ONLY a valid JSON object.
        Transcript: "${transcript}"
        JSON format:
        {
          "scores": { "honesty": 0-100, "script": 0-100, "confidence": 0-100, "politeness": 0-100, "productKnowledge": 0-100, "objectionHandling": 0-100, "closing": 0-100, "overall": 0-100 },
          "issues": [ { "quote": "...", "why": "...", "risk": "Low/Medium/High", "correction": "...", "recommendation": "..." } ],
          "timestamps": [ { "time": "00:00", "event": "Greeting" } ],
          "coaching": { "strengths": [], "weaknesses": [], "exercises": [], "tips": [] }
        }`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        let result = JSON.parse(response.text);

        db.run(`INSERT INTO AnalysisHistory (call_title, scores, issues, coaching, timestamps) VALUES (?, ?, ?, ?, ?)`,
            [req.file ? req.file.originalname : 'Text Input', JSON.stringify(result.scores), JSON.stringify(result.issues), JSON.stringify(result.coaching), JSON.stringify(result.timestamps)],
            function(err) {
                if (err) console.error(err);
                res.json({ id: this.lastID, ...result });
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Analysis failed. Ensure valid transcript provided.' });
    }
});

// Dashboard Analytics
app.get('/api/dashboard', authenticateToken, (req, res) => {
    db.all("SELECT scores FROM AnalysisHistory", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let totalCalls = rows.length;
        let avgHonesty = 0, avgScript = 0, avgOverall = 0;
        
        rows.forEach(row => {
            let scores = JSON.parse(row.scores);
            avgHonesty += scores.honesty;
            avgScript += scores.script;
            avgOverall += scores.overall;
        });

        if (totalCalls > 0) {
            avgHonesty = Math.round(avgHonesty / totalCalls);
            avgScript = Math.round(avgScript / totalCalls);
            avgOverall = Math.round(avgOverall / totalCalls);
        }

        res.json({ totalCalls, avgHonesty, avgScript, avgOverall });
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
    console.log(`SotuvAI listening on port ${port}`);
});
