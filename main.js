console.log("🔥 MAIN IS RUNNING 🔥");


const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

app.disableHardwareAcceleration();

// ===== Database Setup =====
const dbPath = path.join(app.getPath('userData'), 'roofing_crm_2026.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fName TEXT,
    lName TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    pricing TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Lead'
);
`);

function getAdminPasswordHash() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?')
        .get('admin_password');
    return row ? row.value : null;
}

let win;

// ===== IPC Setup (REGISTERED EARLY) =====
function setupIPC() {

    ipcMain.handle('check-first-run', () => {
        return !getAdminPasswordHash();
    });

    ipcMain.handle('set-initial-password', (e, password) => {
        const hash = bcrypt.hashSync(password, 10);
        db.prepare(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
        ).run('admin_password', hash);
        return true;
    });

    ipcMain.handle('verify-password', (e, password) => {
        const hash = getAdminPasswordHash();
        if (!hash) return false;
        return bcrypt.compareSync(password, hash);
    });

    ipcMain.handle('update-password', (e, current, newPassword) => {
        const hash = getAdminPasswordHash();

        if (!hash || !bcrypt.compareSync(current, hash)) {
            return { success: false, message: 'Current password incorrect' };
        }

        const newHash = bcrypt.hashSync(newPassword, 10);

        db.prepare(
            'UPDATE settings SET value = ? WHERE key = ?'
        ).run(newHash, 'admin_password');

        return { success: true };
    });

    ipcMain.on('login-success', () => {
        if (win) {
            win.loadFile(path.join(__dirname, 'main.html'));
        }
    });

    // ===== Client CRUD =====

    ipcMain.handle('save-client', (e, c) => {
        const result = db.prepare(`
            INSERT INTO clients (fName, lName, email, phone)
            VALUES (?, ?, ?, ?)
        `).run(c.fName, c.lName, c.email, c.phone);

        return { ...c, id: result.lastInsertRowid };
    });

    ipcMain.handle('search-clients', (e, term) => {
        const q = `%${term}%`;
        return db.prepare(`
            SELECT * FROM clients
            WHERE fName LIKE ? OR lName LIKE ? OR email LIKE ? OR phone LIKE ?
        `).all(q, q, q, q);
    });

    ipcMain.handle('update-project', (e, d) => {
        db.prepare(`
            UPDATE clients
            SET address = ?, pricing = ?, notes = ?, status = ?, email = ?, phone = ?
            WHERE id = ?
        `).run(d.address, d.pricing, d.notes, d.status, d.email, d.phone, d.id);

        return { success: true };
    });

    ipcMain.handle('delete-client', (e, id) => {
        db.prepare('DELETE FROM clients WHERE id = ?').run(id);
        return { success: true };
    });

    // ===== PDF Upload =====

    ipcMain.handle('upload-pdf', async (e, { filePath, clientId }) => {
        try {
            if (!filePath) throw new Error("Invalid file path");

            const pdfDir = path.join(
                app.getPath('userData'),
                'client_documents',
                clientId.toString()
            );

            if (!fs.existsSync(pdfDir)) {
                fs.mkdirSync(pdfDir, { recursive: true });
            }

            const fileName = path.basename(filePath);
            const destination = path.join(pdfDir, fileName);

            fs.copyFileSync(filePath, destination);

            return { success: true, fileName };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.on('open-client-folder', (e, clientId) => {
        const folderPath = path.join(
            app.getPath('userData'),
            'client_documents',
            clientId.toString()
        );

        if (fs.existsSync(folderPath)) {
            shell.openPath(folderPath);
        } else {
            shell.openPath(path.join(app.getPath('userData'), 'client_documents'));
        }
    });
}

// Register IPC BEFORE creating window
setupIPC();

// ===== Create Window =====
function createWindow() {
    win = new BrowserWindow({
        width: 1300,
        height: 900,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // IMPORTANT
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile(path.join(__dirname, 'login.html'));
    win.webContents.openDevTools();
}

// ===== App Lifecycle =====
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    db.close();
    app.quit();
});
