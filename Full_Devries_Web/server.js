const express = require('express');
const path = require('path');

const app = express();

// ===== BODY PARSING =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== STATIC FILES =====

// Serve root files (login.html, css, js)
app.use(express.static(path.join(__dirname)));

// Serve assets folder explicitly
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ===== API ROUTES =====
const authRoutes = require('./api/auth');
app.use('/api', authRoutes);

// ===== PAGE ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/main', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
