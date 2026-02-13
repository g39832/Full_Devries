const express = require("express");
const bcrypt = require("bcryptjs");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve all files in current folder

// Simulated in-memory database
let users = [];
let firstRun = true;
let clients = [];

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// First-run check
app.get("/first-run", (req, res) => {
  res.json({ firstRun });
});

// Set initial password
app.post("/set-password", (req, res) => {
  const { password } = req.body;
  users = [{ username: "admin", passwordHash: bcrypt.hashSync(password, 10) }];
  firstRun = false;
  res.json({ success: true });
});

// Verify password (login)
app.post("/verify-password", (req, res) => {
  const { password } = req.body;
  const user = users[0];
  if (!user) return res.json({ valid: false });
  const valid = bcrypt.compareSync(password, user.passwordHash);
  res.json({ valid });
});

// Update password
app.post("/update-password", (req, res) => {
  const { current, newPassword } = req.body;
  const user = users[0];
  if (!user) return res.json({ success: false, message: "No user found" });
  const valid = bcrypt.compareSync(current, user.passwordHash);
  if (!valid) return res.json({ success: false, message: "Current password incorrect" });
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  res.json({ success: true });
});

// Save client
app.post("/save-client", (req, res) => {
  const client = { id: Date.now(), ...req.body };
  clients.push(client);
  res.json({ success: true, client });
});

// Search clients
app.get("/search-clients", (req, res) => {
  const term = req.query.term?.toLowerCase() || "";
  const results = clients.filter(c =>
    c.fName.toLowerCase().includes(term) ||
    c.lName.toLowerCase().includes(term) ||
    c.email.toLowerCase().includes(term) ||
    c.phone.includes(term)
  );
  res.json(results);
});

// Update client
app.post("/update-project", (req, res) => {
  const index = clients.findIndex(c => c.id === req.body.id);
  if (index !== -1) {
    clients[index] = { ...clients[index], ...req.body };
    res.json({ success: true });
  } else res.json({ success: false });
});

// Delete client
app.post("/delete-client", (req, res) => {
  clients = clients.filter(c => c.id !== req.body.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
