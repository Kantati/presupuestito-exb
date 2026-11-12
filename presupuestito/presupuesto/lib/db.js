import Database from "better-sqlite3";

const db = new Database("data.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestion INTEGER,
    fecha TEXT,
    rubro TEXT,
    cuenta TEXT,
    financiador TEXT,
    area TEXT,
    region TEXT,
    monto REAL,
    glosa TEXT
  )
`);

export default db;