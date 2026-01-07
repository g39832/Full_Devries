const { app, BrowserWindow, ipcMain } = require('electron');
const Database = require('better-sqlite3');
const path = require('node:path');

// FIX: Disable Hardware Acceleration to stop "Ghost Lag" on text boxes
app.disableHardwareAcceleration();

const dbPath = path.join(app.getPath('userData'), 'roofing_pro_2026.db');
const db = new Database(dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fName TEXT, lName TEXT, email TEXT, phone TEXT,
        address TEXT, pricing TEXT, notes TEXT,
        status TEXT DEFAULT 'Lead'
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

function createWindow() {
    const win = new BrowserWindow({
        width: 1300, height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        }
    });

    win.loadFile(path.join(__dirname, 'login.html'));

    ipcMain.handle('check-first-run', () => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
        return !row; 
    });

    ipcMain.handle('set-initial-password', (e, password) => {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin_password', password);
    });

    ipcMain.handle('verify-password', (e, password) => {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password');
        return row && row.value === password;
    });

    ipcMain.on('login-success', () => { win.loadFile(path.join(__dirname, 'main.html')); });

    ipcMain.handle('save-client', (e, c) => {
        return db.prepare('INSERT INTO clients (fName, lName, email, phone) VALUES (?, ?, ?, ?)').run(c.fName, c.lName, c.email, c.phone);
    });

    ipcMain.handle('search-clients', (e, term) => {
        const q = `%${term}%`;
        return db.prepare('SELECT * FROM clients WHERE fName LIKE ? OR phone LIKE ? OR email LIKE ?').all(q, q, q);
    });

    ipcMain.handle('update-project', (e, d) => {
        return db.prepare('UPDATE clients SET address = ?, pricing = ?, notes = ?, status = ? WHERE id = ?')
                 .run(d.address, d.pricing, d.notes, d.status, d.id);
    });

    ipcMain.handle('delete-client', (e, id) => {
        return db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { db.close(); if (process.platform !== 'darwin') app.quit(); });
