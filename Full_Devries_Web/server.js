const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// ===== BODY PARSING =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== API ROUTES =====
const authRoutes = require('./api/auth');
const clientsRoutes = require('./api/clients');
const pdfRoutes = require('./api/pdf');

// Mount routers under correct prefixes
app.use('/api', authRoutes);       // /api/login, /api/change-password
app.use('/api', clientsRoutes);    // /api/search, /api/save-client, etc.
app.use('/api/pdf', pdfRoutes);    // /api/pdf/*

// ===== PAGE ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/main', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/finance', (req, res) => {
  res.sendFile(path.join(__dirname, 'finance.html'));
});

// ===== ENSURE UPLOADS FOLDER EXISTS =====
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
console.log("✅ Uploads folder is ready");

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
