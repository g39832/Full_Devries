// api/auth.js
const express = require('express');
const router = express.Router();

// Example route to test authentication
router.get('/test', (req, res) => {
  res.json({ message: 'Auth route is working!' });
});

// Example login route
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  // Replace with real auth logic
  if (username === 'admin' && password === 'password') {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

module.exports = router;
