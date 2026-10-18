// Einfache JSON-Datenbank (eine Datei). Reicht für ein kleines Team; bei Bedarf
// später gegen SQLite/Postgres tauschen – die Funktionen hier sind die einzige Schnittstelle.
const fs = require('fs');
const crypto = require('crypto');
const { DB_FILE } = require('./config');

let db = { items: [], accounts: {} };
if (fs.existsSync(DB_FILE)) {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 50);
}
function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
process.on('exit', () => { clearTimeout(saveTimer); flush(); });

const newId = () => crypto.randomBytes(6).toString('hex');

module.exports = {
  newId,
  flush,

  listItems() {
    return [...db.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getItem(id) {
    return db.items.find((i) => i.id === id) || null;
  },
  addItem(item) {
    db.items.push(item);
    save();
    return item;
  },
  updateItem(id, patch) {
    const item = this.getItem(id);
    if (!item) return null;
    Object.assign(item, typeof patch === 'function' ? patch(item) || {} : patch, {
      updatedAt: new Date().toISOString(),
    });
    save();
    return item;
  },
  deleteItem(id) {
    db.items = db.items.filter((i) => i.id !== id);
    save();
  },

  getAccount(platform) {
    return db.accounts[platform] || null;
  },
  setAccount(platform, data) {
    db.accounts[platform] = data ? { ...data, updatedAt: new Date().toISOString() } : undefined;
    if (!data) delete db.accounts[platform];
    save();
  },
  allAccounts() {
    return db.accounts;
  },
};
