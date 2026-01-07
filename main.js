const { app, BrowserWindow, ipcMain } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

// Initialize database in the user's data folder for safety
const dbPath = path.join(app.getPath('userData'), 'roofing_pro.db');
const db = new Database(dbPath);

// Create tables for clients and app settings
db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fName TEXT, lName TEXT, email TEXT, phone TEXT,
        address TEXT, pricing TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('login.html');

    // -- Authentication Logic --

    // Returns true if NO password exists yet (First Run)
    ipcMain.handle('check-first-run', () => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
        return !row; 
    });

    // Save the very first password
    ipcMain.handle('set-initial-password', (e, password) => {
        const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        return stmt.run('admin_password', password);
    });

    // Verify password during normal login
    ipcMain.handle('verify-password', (e, password) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
        return row && row.value === password;
    });

    // Switch to Dashboard on success
    ipcMain.on('login-success', () => {
        win.loadFile('index.html');
    });

    // -- Database Logic --
    ipcMain.handle('save-client', (e, c) => {
        const stmt = db.prepare('INSERT INTO clients (fName, lName, email, phone) VALUES (?, ?, ?, ?)');
        return stmt.run(c.fName, c.lName, c.email, c.phone);
    });

    ipcMain.handle('search-clients', (e, term) => {
        const query = `%${term}%`;
        return db.prepare('SELECT * FROM clients WHERE fName LIKE ? OR phone LIKE ? OR email LIKE ?').all(query, query, query);
    });

    ipcMain.handle('update-project', (e, d) => {
        return db.prepare('UPDATE clients SET address = ?, pricing = ?, notes = ? WHERE id = ?')
                 .run(d.address, d.pricing, d.notes, d.id);
    });
}

app.whenReady().then(createWindow);

// Close DB cleanly when app exits to prevent data loss
app.on('window-all-closed', () => {
    db.close();
    if (process.platform !== 'darwin') app.quit();
});
