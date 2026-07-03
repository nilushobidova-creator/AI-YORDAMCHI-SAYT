require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const db = require('./database/db');

const app = express();
const port = process.env.PORT || 3000;

// AI Model sozlamasi
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Middlewares
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

const upload = multer({ dest: 'uploads/' });

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

// Login API
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

// Chat API
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { message, history } = req.body;
    db.get("SELECT * FROM Products WHERE status = 'active' LIMIT 1", async (err, product) => {
        try {
            const prompt = `Product Info: ${JSON.stringify(product)}. User message: ${message}`;
            const result = await model.generateContent(prompt);
            res.json({ reply: result.response.text() });
        } catch (error) {
            res.status(500).json({ error: 'AI Error' });
        }
    });
});

// Analysis API
app.post('/api/analyze', authenticateToken, upload.single('callFile'), async (req, res) => {
    try {
        const transcript = req.body.transcript || "Simulated call data";
        const prompt = `Analyze this: ${transcript}. Return JSON with scores, issues, and coaching.`;
        const result = await model.generateContent(prompt);
        // JSON formatida qaytarish
        res.json(JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '')));
    } catch (error) {
        res.status(500).json({ error: 'Analysis failed' });
    }
});

app.get('/api/dashboard', authenticateToken, (req, res) => {
    res.json({ totalCalls: 0, avgOverall: 0 }); // Kengaytirilishi mumkin
});

app.listen(port, () => console.log(`Server running on port ${port}`));

