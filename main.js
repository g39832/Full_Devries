const { app, BrowserWindow, ipcMain, shell } = require('electron');
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

// 2026 Performance Fix: Stops input lag in text boxes
app.disableHardwareAcceleration();

const dbPath = path.join(app.getPath('userData'), 'roofing_pro_2026.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // High-speed database mode

// 1. INITIAL SCHEMA
db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fName TEXT, lName TEXT, email TEXT, phone TEXT,
        address TEXT, pricing TEXT, notes TEXT,
        status TEXT DEFAULT 'Lead'
    );
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT
    );
`);

// 2. DATABASE MIGRATION
try {
    db.prepare("SELECT status FROM clients LIMIT 1").get();
} catch (e) {
    db.exec("ALTER TABLE clients ADD COLUMN status TEXT DEFAULT 'Lead'");
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1300, height: 900,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // FIX for 2026: This allows the renderer to access file.path during drag-and-drop
            sandbox: false 
        }
    });

    win.loadFile(path.join(__dirname, 'login.html'));

    // SECURITY & LOGIN
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

    // CLIENT DATA HANDLERS
    ipcMain.handle('save-client', (e, c) => {
        return db.prepare('INSERT INTO clients (fName, lName, email, phone) VALUES (?, ?, ?, ?)').run(c.fName, c.lName, c.email, c.phone);
    });
    ipcMain.handle('search-clients', (e, term) => {
        const q = `%${term}%`;
        return db.prepare('SELECT * FROM clients WHERE fName LIKE ? OR phone LIKE ? OR email LIKE ?').all(q, q, q);
    });
    ipcMain.handle('update-project', (e, d) => {
        return db.prepare('UPDATE clients SET address=?, pricing=?, notes=?, status=?, email=?, phone=? WHERE id=?')
                 .run(d.address, d.pricing, d.notes, d.status, d.email, d.phone, d.id);
    });
    ipcMain.handle('delete-client', (e, id) => {
        return db.prepare('DELETE FROM clients WHERE id = ?').run(id);
    });

    // 3. FILE MANAGEMENT
    ipcMain.handle('upload-pdf', async (event, { filePath, clientId }) => {
        try {
            // Verify path is actually a string before proceeding
            if (typeof filePath !== 'string') {
                throw new Error("Invalid file path received");
            }

            const pdfDir = path.join(app.getPath('userData'), 'client_documents', clientId.toString());
            if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
            
            const fileName = path.basename(filePath);
            const destination = path.join(pdfDir, fileName);
            
            fs.copyFileSync(filePath, destination);
            return { success: true, fileName };
        } catch (err) {
            console.error("Upload handler error:", err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.on('open-client-folder', (event, clientId) => {
        const folderPath = path.join(app.getPath('userData'), 'client_documents', clientId.toString());
        if (fs.existsSync(folderPath)) shell.openPath(folderPath);
        else shell.openPath(path.join(app.getPath('userData'), 'client_documents'));
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { db.close(); app.quit(); });
