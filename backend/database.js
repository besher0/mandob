const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'medrep.db');
const db = new Database(dbPath);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function splitNames(value) {
  return [...new Set(
    String(value || '')
      .replace(/،/g, ',')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )];
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    areas TEXT,
    username TEXT,
    password TEXT,
    daily_target INTEGER DEFAULT 8,
    annual_leave_balance INTEGER DEFAULT 12,
    team_id INTEGER,
    custom_products TEXT
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    specialties TEXT,
    products TEXT
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    spec TEXT,
    area TEXT,
    grade TEXT,
    city TEXT
  );

  CREATE TABLE IF NOT EXISTS pharmacies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    target INTEGER DEFAULT 4,
    category TEXT DEFAULT 'A',
    type TEXT DEFAULT 'مستقلة'
  );

  CREATE TABLE IF NOT EXISTS hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'خاص',
    area TEXT NOT NULL,
    specialty TEXT DEFAULT 'عام',
    target INTEGER DEFAULT 4
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rep_name TEXT NOT NULL,
    type TEXT NOT NULL,
    areas TEXT,
    targets TEXT,
    visit_date TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    rep_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS visit_targets (
  visit_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  PRIMARY KEY (visit_id, target_type, target_id)
);

  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rep_name TEXT NOT NULL,
    leave_type TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    rep_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    city TEXT
  );

  CREATE TABLE IF NOT EXISTS area_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0
);

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    active_ingredient TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rep_areas (
    rep_id INTEGER NOT NULL,
    area_id INTEGER NOT NULL,
    PRIMARY KEY (rep_id, area_id)
  );

  CREATE TABLE IF NOT EXISTS rep_products (
    rep_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    PRIMARY KEY (rep_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS team_products (
    team_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    PRIMARY KEY (team_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS team_specialties (
  team_id INTEGER NOT NULL,
  specialty TEXT NOT NULL,
  PRIMARY KEY (team_id, specialty)
);

CREATE TABLE IF NOT EXISTS rep_specialties (
  rep_id INTEGER NOT NULL,
  specialty TEXT NOT NULL,
  PRIMARY KEY (rep_id, specialty)
);

  CREATE INDEX IF NOT EXISTS idx_rep_areas_rep_id
    ON rep_areas(rep_id);

  CREATE INDEX IF NOT EXISTS idx_rep_areas_area_id
    ON rep_areas(area_id);

  CREATE INDEX IF NOT EXISTS idx_rep_products_rep_id
    ON rep_products(rep_id);

  CREATE INDEX IF NOT EXISTS idx_rep_products_product_id
    ON rep_products(product_id);

  CREATE INDEX IF NOT EXISTS idx_team_products_team_id
    ON team_products(team_id);

  CREATE INDEX IF NOT EXISTS idx_team_products_product_id
    ON team_products(product_id);

  CREATE INDEX IF NOT EXISTS idx_visits_rep_id
    ON visits(rep_id);

  CREATE INDEX IF NOT EXISTS idx_leave_requests_rep_id
    ON leave_requests(rep_id);
`);

ensureColumn('users', 'username', 'TEXT');
ensureColumn('users', 'password', 'TEXT');
ensureColumn('users', 'daily_target', 'INTEGER DEFAULT 8');
ensureColumn('users', 'annual_leave_balance', 'INTEGER DEFAULT 12');
ensureColumn('users', 'team_id', 'INTEGER');
ensureColumn('users', 'custom_products', 'TEXT');
ensureColumn('users', 'specialty_mode', "TEXT DEFAULT 'TEAM'");

ensureColumn('doctors', 'city', 'TEXT');
ensureColumn('areas', 'group_id', 'INTEGER');
ensureColumn('pharmacies', 'category', "TEXT DEFAULT 'A'");
ensureColumn('pharmacies', 'type', "TEXT DEFAULT 'مستقلة'");
ensureColumn('visits', 'created_at', 'TEXT');
ensureColumn('visits', 'rep_id', 'INTEGER');
ensureColumn('leave_requests', 'rep_id', 'INTEGER');

const defaultSettings = [
  ['annual_leave_balance', '12'],
  ['cycle_start_date', '2026-08-01'],
  ['cycle_end_date', '2026-08-31'],
  ['frequency_A', '4'],
  ['frequency_B', '2'],
  ['frequency_C', '1']
];

const upsertSetting = db.prepare(`
  INSERT OR IGNORE INTO settings (key, value)
  VALUES (?, ?)
`);

for (const [key, value] of defaultSettings) {
  upsertSetting.run(key, value);
}

const initialProducts = [
  ['Unixaban', 'Apixaban'],
  ['Rosuva', 'Rosuvastatin'],
  ['Tensocard', 'Perindopril'],
  ['Lodyptan Plus', 'Triple Combination'],
  ['Korga', 'Nadolol'],
  ['Ralvic Chrono', 'Valproate']
];

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (name, active_ingredient)
  VALUES (?, ?)
`);

const seedProducts = db.transaction((products) => {
  for (const [name, activeIngredient] of products) {
    insertProduct.run(name, activeIngredient);
  }
});

seedProducts(initialProducts);

/*
  Compatibility migrations:
  - Keep legacy text columns for the current frontend/API shape.
  - Normalized tables are the source of truth for relations.
  - Inserts are idempotent, so restarting the server is safe.
*/
const migrateLegacyRelations = db.transaction(() => {
  const areaByName = new Map(
    db.prepare(`SELECT id, name FROM areas`).all()
      .map(row => [row.name, row.id])
  );

  const productByName = new Map(
    db.prepare(`SELECT id, name FROM products`).all()
      .map(row => [row.name, row.id])
  );

  const insertRepArea = db.prepare(`
    INSERT OR IGNORE INTO rep_areas (rep_id, area_id)
    VALUES (?, ?)
  `);

  const insertRepProduct = db.prepare(`
    INSERT OR IGNORE INTO rep_products (rep_id, product_id)
    VALUES (?, ?)
  `);

  const insertTeamProduct = db.prepare(`
    INSERT OR IGNORE INTO team_products (team_id, product_id)
    VALUES (?, ?)
  `);

  const reps = db.prepare(`
    SELECT id, areas, custom_products
    FROM users
    WHERE role = 'REP'
  `).all();

  for (const rep of reps) {
    for (const areaName of splitNames(rep.areas)) {
      const areaId = areaByName.get(areaName);
      if (areaId) insertRepArea.run(rep.id, areaId);
    }

    for (const productName of splitNames(rep.custom_products)) {
      const productId = productByName.get(productName);
      if (productId) insertRepProduct.run(rep.id, productId);
    }
  }

  const teams = db.prepare(`
    SELECT id, products
    FROM teams
  `).all();

  for (const team of teams) {
    for (const productName of splitNames(team.products)) {
      const productId = productByName.get(productName);
      if (productId) insertTeamProduct.run(team.id, productId);
    }
  }
});

migrateLegacyRelations();

const visitTargetTypeMap = {
  'أطباء': {
    table: 'doctors',
    type: 'doctor'
  },
  'صيدليات': {
    table: 'pharmacies',
    type: 'pharmacy'
  },
  'مشافي': {
    table: 'hospitals',
    type: 'hospital'
  }
};

const legacyVisits = db.prepare(`
  SELECT id, type, targets
  FROM visits
  WHERE targets IS NOT NULL
    AND TRIM(targets) <> ''
`).all();

const findTargetStatements = {
  doctors: db.prepare(`
    SELECT id
    FROM doctors
    WHERE name = ?
    ORDER BY id ASC
  `),

  pharmacies: db.prepare(`
    SELECT id
    FROM pharmacies
    WHERE name = ?
    ORDER BY id ASC
  `),

  hospitals: db.prepare(`
    SELECT id
    FROM hospitals
    WHERE name = ?
    ORDER BY id ASC
  `)
};

const insertVisitTarget = db.prepare(`
  INSERT OR IGNORE INTO visit_targets (
    visit_id,
    target_type,
    target_id
  )
  VALUES (?, ?, ?)
`);

const migrateLegacyVisitTargets = db.transaction(() => {
  for (const visit of legacyVisits) {
    const config = visitTargetTypeMap[visit.type];

    if (!config) continue;

    const names = String(visit.targets)
      .split(/[,،]/)
      .map(name => name.trim())
      .filter(Boolean);

    const findTarget = findTargetStatements[config.table];

    for (const name of names) {
      const matches = findTarget.all(name);

      // إذا الاسم له سجل واحد فقط، نربطه.
      // إذا الاسم مكرر، نتركه بدون تخمين.
      if (matches.length === 1) {
        insertVisitTarget.run(
          visit.id,
          config.type,
          matches[0].id
        );
      }
    }
  }
});

migrateLegacyVisitTargets();

console.log(`Database connected: ${dbPath}`);

module.exports = db;
