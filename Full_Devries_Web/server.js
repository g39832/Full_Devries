const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// ===== Middleware =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (CSS, JS, images) from root and assets folder
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ===== Import API routes =====
const clientsRoutes = require('./api/clients.js');

// Use API routes
app.use('/api', clientsRoutes);

// ===== Routes =====
// Serve login page
app.get('/', (req, res) => {
  const loginPath = path.join(__dirname, 'login.html');
  if (fs.existsSync(loginPath)) res.sendFile(loginPath);
  else res.status(404).send('login.html not found');
});

// Serve main/dashboard page
app.get('/main', (req, res) => {
  const mainPath = path.join(__dirname, 'main.html');
  if (fs.existsSync(mainPath)) res.sendFile(mainPath);
  else res.status(404).send('main.html not found');
});

// ===== Fallback route =====
app.get('*', (req, res) => res.status(404).send('Page not found'));

// ===== Start server =====
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

// Handle EADDRINUSE
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} in use. Close other processes or change port.`);
  else console.error(err);
});
