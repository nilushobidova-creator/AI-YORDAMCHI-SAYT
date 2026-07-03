const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'sotuvai.db');
const db = new sqlite3.Database(dbPath);

const initDb = () => {
    db.serialize(async () => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'Operator'
        )`);

        // Products Table
        db.run(`CREATE TABLE IF NOT EXISTS Products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            price TEXT,
            ingredients TEXT,
            benefits TEXT,
            faq TEXT,
            warnings TEXT,
            status TEXT DEFAULT 'active'
        )`);

        // Chat History Table
        db.run(`CREATE TABLE IF NOT EXISTS ChatHistory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            messages TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Analysis History Table
        db.run(`CREATE TABLE IF NOT EXISTS AnalysisHistory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            call_title TEXT,
            scores TEXT,
            issues TEXT,
            coaching TEXT,
            timestamps TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Seed Admin User
        db.get("SELECT * FROM Users WHERE username = 'admin'", async (err, row) => {
            if (!row) {
                const hash = await bcrypt.hash('admin123', 10);
                db.run("INSERT INTO Users (username, password, role) VALUES (?, ?, ?)", ['admin', hash, 'Admin']);
            }
        });

        // Seed Default Product
        db.get("SELECT * FROM Products WHERE name = 'Abihayat'", (err, row) => {
            if (!row) {
                db.run(`INSERT INTO Products (name, price, ingredients, benefits, status) 
                        VALUES (?, ?, ?, ?, ?)`, 
                [
                    'Abihayat', 
                    null, // Pricing information excluded 
                    'Clean honey, red ginseng, ashwagandha, baxmal', 
                    'Natural energy, vitality, cognitive support', 
                    'active'
                ]);
            }
        });
    });
};

initDb();

module.exports = db;
