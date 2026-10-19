const express = require('express');
const db = require('./database');
const path = require('node:path');
const { installSecurity } = require('./security');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ dest: 'uploads/' });
const app = express();

// Browser and API share an origin; cross-origin access is disabled.
app.use(express.json({ limit: '256kb' }));
app.use('/rep', express.static(path.join(__dirname, '..', 'frontend', 'rep')));
app.get('/', (_req, res) => res.redirect('/rep/login.html'));
installSecurity(app, db);
const PORT = Number(process.env.PORT) || 3000;
app.get('/api/reps/:repId/doctors', (req, res) => {
  try {
    const repId = Number(req.params.repId);

    if (!Number.isInteger(repId)) {
      return res.status(400).json({
        success: false,
        message: 'رقم المندوب غير صالح'
      });
    }

    const rep = db.prepare(`
      SELECT
        id,
        team_id,
        COALESCE(specialty_mode, 'TEAM') AS specialty_mode
      FROM users
      WHERE id = ?
        AND role = 'REP'
    `).get(repId);

    if (!rep) {
      return res.status(404).json({
        success: false,
        message: 'المندوب غير موجود'
      });
    }

    // مناطق المندوب
    const repAreas = db.prepare(`
      SELECT a.name
      FROM rep_areas ra
      JOIN areas a
        ON a.id = ra.area_id
      WHERE ra.rep_id = ?
    `).all(repId).map(row => row.name);

    // الاختصاصات الفعلية للمندوب
    let specialties = [];

    if (rep.specialty_mode === 'CUSTOM') {

      specialties = db.prepare(`
        SELECT specialty
        FROM rep_specialties
        WHERE rep_id = ?
        ORDER BY specialty
      `).all(repId).map(row => row.specialty);

    } else if (rep.team_id) {

      specialties = db.prepare(`
        SELECT specialty
        FROM team_specialties
        WHERE team_id = ?
        ORDER BY specialty
      `).all(rep.team_id).map(row => row.specialty);

    }

    // إذا لا توجد مناطق أو اختصاصات فلا يوجد أطباء مستهدفون
    if (!repAreas.length || !specialties.length) {
      return res.json([]);
    }

    const areaPlaceholders =
      repAreas.map(() => '?').join(',');

    const specialtyPlaceholders =
      specialties.map(() => '?').join(',');

    const doctors = db.prepare(`
      SELECT *
      FROM doctors
      WHERE area IN (${areaPlaceholders})
        AND TRIM(spec) IN (${specialtyPlaceholders})
      ORDER BY name
    `).all(
      ...repAreas,
      ...specialties
    );

    res.json(doctors);

  } catch (error) {
    console.error(
      'Error loading rep doctors:',
      error
    );

    res.status(500).json({
      success: false,
      message: 'تعذر تحميل أطباء المندوب'
    });
  }
});

app.get('/api/doctors', (req, res) => {
  try {
    const cycleStart = db.prepare(`
  SELECT value FROM settings
  WHERE key = 'cycle_start_date'
`).get()?.value;

const cycleEnd = db.prepare(`
  SELECT value FROM settings
  WHERE key = 'cycle_end_date'
`).get()?.value;

const frequencyA = Number(
  db.prepare(`
    SELECT value FROM settings
    WHERE key = 'frequency_A'
  `).get()?.value || 4
);

const frequencyB = Number(
  db.prepare(`
    SELECT value FROM settings
    WHERE key = 'frequency_B'
  `).get()?.value || 2
);

const frequencyC = Number(
  db.prepare(`
    SELECT value FROM settings
    WHERE key = 'frequency_C'
  `).get()?.value || 1
);

    const doctors = db.prepare(`
      SELECT * FROM doctors
    `).all();

    const visits = db.prepare(`
  SELECT targets, visit_date
  FROM visits
  WHERE type = 'أطباء'
    AND date(visit_date) >= date(?)
    AND date(visit_date) <= date(?)
  ORDER BY date(visit_date) DESC, id DESC
`).all(cycleStart, cycleEnd);

    const doctorsWithVisits = doctors.map(doctor => {

      const doctorVisits = visits.filter(visit => {
        if (!visit.targets) return false;

        const targets = String(visit.targets)
  .split(/[,،]/)
  .map(name => name.trim())
  .filter(Boolean);

        return targets.includes(doctor.name);
      });

      const lastVisit =
        doctorVisits.length > 0
          ? doctorVisits[0].visit_date
          : null;

      return {
  ...doctor,

  last: lastVisit || 'لم تتم زيارته بعد',

  status: lastVisit
    ? 'مزار'
    : 'غير مزار',

  done: doctorVisits.length,

target: doctor.grade === 'A'
  ? frequencyA
  : doctor.grade === 'B'
    ? frequencyB
    : frequencyC,
    coverage: Math.min(
  100,
  Math.round(
    (
      doctorVisits.length /
      (
        doctor.grade === 'A'
          ? frequencyA
          : doctor.grade === 'B'
          ? frequencyB
          : frequencyC
      )
    ) * 100
  )
)
};
    });

    res.json(doctorsWithVisits);

  } catch (error) {
    console.error('Error loading doctors:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل الأطباء'
    });
  }
});

app.post('/api/doctors', (req, res) => {
  const { name, spec, area, grade } = req.body;

  const result = db.prepare(`
    INSERT INTO doctors (name, spec, area, grade)
    VALUES (?, ?, ?, ?)
  `).run(name, spec, area, grade);

  res.json({
    message: 'Doctor added successfully',
    id: result.lastInsertRowid
  });
});
app.delete('/api/doctors/bulk', (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم تحديد أطباء للحذف'
      });
    }

    const placeholders = ids.map(() => '?').join(',');

    const result = db.prepare(`
      DELETE FROM doctors
      WHERE id IN (${placeholders})
    `).run(...ids);

    res.json({
      success: true,
      deleted: result.changes
    });

  } catch (error) {
    console.error('Error deleting doctors:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حذف الأطباء'
    });
  }
});
app.post('/api/doctors/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'لم يتم اختيار ملف Excel'
      });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: ''
    });

    let imported = 0;
    let skipped = 0;
    let invalid = 0;

    const insertArea = db.prepare(`
  INSERT OR IGNORE INTO areas (name, city)
  VALUES (?, ?)
`);

    const insertDoctor = db.prepare(`
      INSERT INTO doctors (name, spec, area, grade, city)
      VALUES (?, ?, ?, ?, ?)
    `);

    const findDoctor = db.prepare(`
      SELECT id
      FROM doctors
      WHERE name = ? AND area = ?
    `);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const name = String(row.Name || '').trim();
        const city = String(row.City || '').trim();
        const spec = String(row.Specailist || '').trim();
        const grade = String(
  row.classification ||
  row.Classification ||
  row.CLASSIFICATION ||
  row['classification '] ||
  ''
).trim().toUpperCase();
        const area = String(row['Doctor geo name'] || '').trim();
if (area) {
  insertArea.run(area, city);
}
        if (!name) {
          invalid++;
          continue;
        }

        const exists = findDoctor.get(name, area);

        if (exists) {
  db.prepare(`
    UPDATE doctors
    SET spec = ?, area = ?, grade = ?, city = ?
    WHERE id = ?
  `).run(
    spec,
    area,
    grade,
    city,
    exists.id
  );

  skipped++;
  continue;
}

        insertDoctor.run(
          name,
          spec,
          area,
          grade,
          city
        );

        imported++;
      }
    });

    insertMany(rows);

    res.json({
      success: true,
      total: rows.length,
      imported,
      skipped,
      invalid
    });

  } catch (error) {
    console.error('Error importing doctors:', error);

    res.status(500).json({
      success: false,
      error: 'فشل استيراد ملف الأطباء'
    });
  }
});

app.get('/api/team/reps', (req, res) => {
  try {
    const reps = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.username,
        u.daily_target,
        u.annual_leave_balance,
        u.team_id,
        t.name AS team_name,
        u.specialty_mode,

COALESCE((
  SELECT group_concat(specialty, '، ')
  FROM (
    SELECT rs.specialty
    FROM rep_specialties rs
    WHERE rs.rep_id = u.id
    ORDER BY rs.specialty
  )
), '') AS custom_specialties,

        COALESCE((
          SELECT group_concat(area_name, '، ')
          FROM (
            SELECT a.name AS area_name
            FROM rep_areas ra
            JOIN areas a
              ON a.id = ra.area_id
            WHERE ra.rep_id = u.id
            ORDER BY a.name
          )
                ), '') AS areas,

        COALESCE((
          SELECT group_concat(product_name, '، ')
          FROM (
            SELECT p.name AS product_name
            FROM rep_products rp
            JOIN products p
              ON p.id = rp.product_id
            WHERE rp.rep_id = u.id
            ORDER BY p.name
          )
        ), '') AS custom_products

      FROM users u

      LEFT JOIN teams t
        ON u.team_id = t.id

      WHERE u.role = 'REP'

      ORDER BY u.id
    `).all();

    const result = reps.map(rep => ({
      id: rep.id,
      name: rep.name,
      username: rep.username || '',
      areas: rep.areas || '',
      team_id: rep.team_id,
      team_name: rep.team_name || null,
      specialty_mode: rep.specialty_mode || 'TEAM',
custom_specialties: rep.custom_specialties || '',
      custom_products: rep.custom_products || '',
      visits: 0,
      target: rep.daily_target || 8,
      annual_leave_balance: rep.annual_leave_balance ?? 12,
      performance: 0
    }));

    res.json(result);

  } catch (error) {
    console.error('Error loading reps:', error);

    res.status(500).json({
      success: false,
      error: 'تعذر تحميل المندوبين'
    });
  }
});

app.get('/api/specialties', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT TRIM(spec) AS specialty
      FROM doctors
      WHERE spec IS NOT NULL
        AND TRIM(spec) <> ''
      ORDER BY TRIM(spec)
    `).all();

    res.json(rows.map(row => row.specialty));

  } catch (error) {
    console.error('Error loading specialties:', error);

    res.status(500).json({
      success: false,
      message: 'تعذر تحميل الاختصاصات'
    });
  }
});

app.get('/api/teams', (req, res) => {
  try {
    const teams = db.prepare(`
      SELECT
        t.id,
        t.name,

        COALESCE((
          SELECT group_concat(specialty, '، ')
          FROM (
            SELECT ts.specialty
            FROM team_specialties ts
            WHERE ts.team_id = t.id
            ORDER BY ts.specialty
          )
        ), t.specialties, '') AS specialties,

        COALESCE((
          SELECT group_concat(product_name, '، ')
          FROM (
            SELECT p.name AS product_name
            FROM team_products tp
            JOIN products p
              ON p.id = tp.product_id
            WHERE tp.team_id = t.id
            ORDER BY p.name
          )
        ), '') AS products

      FROM teams t
      ORDER BY t.name
    `).all();

    res.json(teams);

  } catch (error) {
    console.error('Error loading teams:', error);

    res.status(500).json({
      success: false,
      message: 'تعذر تحميل الفرق'
    });
  }
});

app.post('/api/teams', (req, res) => {
  try {
    const { name, specialties, products } = req.body;
    const cleanedSpecialties = [
  ...new Set(
    (Array.isArray(specialties)
      ? specialties
      : String(specialties || '')
          .replace(/،/g, ',')
          .split(',')
    )
      .map(specialty => String(specialty).trim())
      .filter(Boolean)
  )
];

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'اسم الفريق مطلوب'
      });
    }

    const cleanedProducts = [
      ...new Set(
        (Array.isArray(products)
          ? products
          : String(products || '').replace(/،/g, ',').split(',')
        )
          .map(product => String(product).trim())
          .filter(Boolean)
      )
    ];

    const productRows = cleanedProducts.length
      ? db.prepare(`
          SELECT id, name
          FROM products
          WHERE name IN (${cleanedProducts.map(() => '?').join(',')})
        `).all(...cleanedProducts)
      : [];

    if (productRows.length !== cleanedProducts.length) {
      const foundProducts = new Set(productRows.map(product => product.name));
      const missingProducts = cleanedProducts.filter(
        productName => !foundProducts.has(productName)
      );

      return res.status(400).json({
        success: false,
        message: `منتجات غير موجودة: ${missingProducts.join('، ')}`
      });
    }

    const createTeam = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO teams (
          name,
          specialties,
          products
        )
        VALUES (?, ?, ?)
      `).run(
        name.trim(),
        cleanedSpecialties.join('، '),
        cleanedProducts.join('، ')
      );

      const teamId = Number(result.lastInsertRowid);

      const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO team_products (
          team_id,
          product_id
        )
        VALUES (?, ?)
      `);

      for (const product of productRows) {
        insertProduct.run(teamId, product.id);
      }
const insertSpecialty = db.prepare(`
  INSERT OR IGNORE INTO team_specialties (
    team_id,
    specialty
  )
  VALUES (?, ?)
`);

for (const specialty of cleanedSpecialties) {
  insertSpecialty.run(teamId, specialty);
}

      return teamId;
    });

    const teamId = createTeam();

    res.json({
      success: true,
      id: teamId,
      message: 'تم إنشاء الفريق بنجاح'
    });

  } catch (error) {
    console.error('Error creating team:', error);

    const isDuplicateName =
      String(error.message || '').includes('UNIQUE constraint failed: teams.name');

    res.status(isDuplicateName ? 409 : 500).json({
      success: false,
      message: isDuplicateName
        ? 'اسم الفريق مستخدم مسبقاً'
        : 'تعذر إنشاء الفريق'
    });
  }
});

app.put('/api/teams/:id', (req, res) => {
  try {
    const teamId = Number(req.params.id);
    const { name, specialties, products } = req.body;
    const cleanedSpecialties = [
  ...new Set(
    (Array.isArray(specialties)
      ? specialties
      : String(specialties || '')
          .replace(/،/g, ',')
          .split(',')
    )
      .map(specialty => String(specialty).trim())
      .filter(Boolean)
  )
];

    if (!Number.isInteger(teamId) || teamId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'معرّف الفريق غير صحيح'
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'اسم الفريق مطلوب'
      });
    }

    const team = db.prepare(`
      SELECT id
      FROM teams
      WHERE id = ?
    `).get(teamId);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'الفريق غير موجود'
      });
    }

    const cleanedProducts = [
      ...new Set(
        (Array.isArray(products)
          ? products
          : String(products || '').replace(/،/g, ',').split(',')
        )
          .map(product => String(product).trim())
          .filter(Boolean)
      )
    ];

    const productRows = cleanedProducts.length
      ? db.prepare(`
          SELECT id, name
          FROM products
          WHERE name IN (${cleanedProducts.map(() => '?').join(',')})
        `).all(...cleanedProducts)
      : [];

    if (productRows.length !== cleanedProducts.length) {
      const foundProducts = new Set(productRows.map(product => product.name));
      const missingProducts = cleanedProducts.filter(
        productName => !foundProducts.has(productName)
      );

      return res.status(400).json({
        success: false,
        message: `منتجات غير موجودة: ${missingProducts.join('، ')}`
      });
    }

    const updateTeam = db.transaction(() => {
      db.prepare(`
        UPDATE teams
        SET
          name = ?,
          specialties = ?,
          products = ?
        WHERE id = ?
      `).run(
        name.trim(),
        cleanedSpecialties.join('، '),
        cleanedProducts.join('، '),
        teamId
      );

      db.prepare(`
        DELETE FROM team_products
        WHERE team_id = ?
      `).run(teamId);

      const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO team_products (
          team_id,
          product_id
        )
        VALUES (?, ?)
      `);

      for (const product of productRows) {
        insertProduct.run(teamId, product.id);
      }
      db.prepare(`
  DELETE FROM team_specialties
  WHERE team_id = ?
`).run(teamId);

const insertSpecialty = db.prepare(`
  INSERT OR IGNORE INTO team_specialties (
    team_id,
    specialty
  )
  VALUES (?, ?)
`);

for (const specialty of cleanedSpecialties) {
  insertSpecialty.run(teamId, specialty);
}
    });

    updateTeam();

    res.json({
      success: true,
      message: 'تم تعديل الفريق بنجاح'
    });

  } catch (error) {
    console.error('Error updating team:', error);

    const isDuplicateName =
      String(error.message || '').includes('UNIQUE constraint failed: teams.name');

    res.status(isDuplicateName ? 409 : 500).json({
      success: false,
      message: isDuplicateName
        ? 'اسم الفريق مستخدم مسبقاً'
        : 'تعذر تعديل الفريق'
    });
  }
});

app.post('/api/team/reps', (req, res) => {
  try {
   const {
  name,
  username,
  password,
  areas,
  target,
  team_id,
  custom_products,
  specialty_mode,
  custom_specialties
} = req.body;

const normalizedSpecialtyMode =
  specialty_mode === 'CUSTOM' ? 'CUSTOM' : 'TEAM';

const cleanedSpecialties = [
  ...new Set(
    (Array.isArray(custom_specialties)
      ? custom_specialties
      : String(custom_specialties || '')
          .replace(/،/g, ',')
          .split(',')
    )
      .map(specialty => String(specialty).trim())
      .filter(Boolean)
  )
];

    if (!name || !username || !password || !areas) {
      return res.status(400).json({
        success: false,
        message: 'الاسم واسم المستخدم وكلمة المرور والمناطق مطلوبة'
      });
    }

    const cleanedAreas = [
      ...new Set(
        (Array.isArray(areas)
          ? areas
          : String(areas).replace(/،/g, ',').split(',')
        )
          .map(area => String(area).trim())
          .filter(Boolean)
      )
    ];

    if (cleanedAreas.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب اختيار منطقة واحدة على الأقل'
      });
    }

    const areaRows = db.prepare(`
      SELECT id, name
      FROM areas
      WHERE name IN (${cleanedAreas.map(() => '?').join(',')})
    `).all(...cleanedAreas);

    if (areaRows.length !== cleanedAreas.length) {
      const foundNames = new Set(areaRows.map(area => area.name));

      const missingAreas = cleanedAreas.filter(
        areaName => !foundNames.has(areaName)
      );

      return res.status(400).json({
        success: false,
        message: `مناطق غير موجودة: ${missingAreas.join('، ')}`
      });
    }

    const normalizedTeamId =
      team_id === null || team_id === '' ? null : Number(team_id);

    if (
      normalizedTeamId !== null &&
      (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'معرّف الفريق غير صحيح'
      });
    }

    if (normalizedTeamId !== null) {
      const team = db.prepare(`
        SELECT id
        FROM teams
        WHERE id = ?
      `).get(normalizedTeamId);

      if (!team) {
        return res.status(400).json({
          success: false,
          message: 'الفريق غير موجود'
        });
      }
    }

    const cleanedProducts =
      normalizedTeamId === null
        ? [
            ...new Set(
              (Array.isArray(custom_products)
                ? custom_products
                : String(custom_products || '')
                    .replace(/،/g, ',')
                    .split(',')
              )
                .map(product => String(product).trim())
                .filter(Boolean)
            )
          ]
        : [];

    const productRows = cleanedProducts.length
      ? db.prepare(`
          SELECT id, name
          FROM products
          WHERE name IN (${cleanedProducts.map(() => '?').join(',')})
        `).all(...cleanedProducts)
      : [];

    if (productRows.length !== cleanedProducts.length) {
      const foundProducts = new Set(
        productRows.map(product => product.name)
      );

      const missingProducts = cleanedProducts.filter(
        productName => !foundProducts.has(productName)
      );

      return res.status(400).json({
        success: false,
        message: `منتجات غير موجودة: ${missingProducts.join('، ')}`
      });
    }

    const createRep = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (
          name,
          username,
          password,
          role,
          areas,
          daily_target,
          team_id,
          custom_products,
specialty_mode
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name.trim(),
        username.trim(),
        password,
        'REP',
        cleanedAreas.join('، '),
        Number(target) || 8,
        normalizedTeamId,
        cleanedProducts.join('، '),
normalizedSpecialtyMode
      );

      const repId = Number(result.lastInsertRowid);

      const insertArea = db.prepare(`
        INSERT OR IGNORE INTO rep_areas (
          rep_id,
          area_id
        )
        VALUES (?, ?)
      `);

      for (const area of areaRows) {
        insertArea.run(repId, area.id);
      }

      const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO rep_products (
          rep_id,
          product_id
        )
        VALUES (?, ?)
      `);

      for (const product of productRows) {
        insertProduct.run(repId, product.id);
      }

      const insertSpecialty = db.prepare(`
  INSERT OR IGNORE INTO rep_specialties (
    rep_id,
    specialty
  )
  VALUES (?, ?)
`);

if (normalizedSpecialtyMode === 'CUSTOM') {
  for (const specialty of cleanedSpecialties) {
    insertSpecialty.run(repId, specialty);
  }
}

      return repId;
    });

    const repId = createRep();

    res.json({
      success: true,
      message: 'تمت إضافة المندوب بنجاح',
      id: repId,
      name: name.trim(),
      areas: cleanedAreas,
      custom_products: cleanedProducts,
      target: Number(target) || 8
    });

  } catch (error) {
    console.error('Error creating rep:', error);

    res.status(500).json({
      success: false,
      message: 'تعذر إضافة المندوب'
    });
  }
});


app.put('/api/team/reps/:id', (req, res) => {
  try {
    const repId = Number(req.params.id);

    const {
  name,
  areas,
  target,
  team_id,
  custom_products,
  specialty_mode,
  custom_specialties
} = req.body;

const normalizedSpecialtyMode =
  specialty_mode === 'CUSTOM' ? 'CUSTOM' : 'TEAM';

const cleanedSpecialties = [
  ...new Set(
    (Array.isArray(custom_specialties)
      ? custom_specialties
      : String(custom_specialties || '')
          .replace(/،/g, ',')
          .split(',')
    )
      .map(specialty => String(specialty).trim())
      .filter(Boolean)
  )
];

    if (!Number.isInteger(repId) || repId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المندوب غير صحيح'
      });
    }

    if (!name || !String(name).trim() || !areas) {
      return res.status(400).json({
        success: false,
        error: 'الاسم والمناطق مطلوبة'
      });
    }

    const rep = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ? AND role = 'REP'
    `).get(repId);

    if (!rep) {
      return res.status(404).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    const cleanedAreas = [
      ...new Set(
        (Array.isArray(areas)
          ? areas
          : String(areas).replace(/،/g, ',').split(',')
        )
          .map(area => String(area).trim())
          .filter(Boolean)
      )
    ];

    if (cleanedAreas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'يجب اختيار منطقة واحدة على الأقل'
      });
    }

    const areaRows = db.prepare(`
      SELECT id, name
      FROM areas
      WHERE name IN (${cleanedAreas.map(() => '?').join(',')})
    `).all(...cleanedAreas);

    if (areaRows.length !== cleanedAreas.length) {
      const foundNames = new Set(areaRows.map(area => area.name));
      const missingAreas = cleanedAreas.filter(
        areaName => !foundNames.has(areaName)
      );

      return res.status(400).json({
        success: false,
        error: `مناطق غير موجودة: ${missingAreas.join('، ')}`
      });
    }

    const normalizedTeamId =
      team_id === null || team_id === '' ? null : Number(team_id);

    if (
      normalizedTeamId !== null &&
      (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: 'معرّف الفريق غير صحيح'
      });
    }

    if (normalizedTeamId !== null) {
      const team = db.prepare(`
        SELECT id
        FROM teams
        WHERE id = ?
      `).get(normalizedTeamId);

      if (!team) {
        return res.status(400).json({
          success: false,
          error: 'الفريق غير موجود'
        });
      }
    }

    const cleanedProducts =
      normalizedTeamId === null
        ? [
            ...new Set(
              (Array.isArray(custom_products)
                ? custom_products
                : String(custom_products || '')
                    .replace(/،/g, ',')
                    .split(',')
              )
                .map(product => String(product).trim())
                .filter(Boolean)
            )
          ]
        : [];

    const productRows = cleanedProducts.length
      ? db.prepare(`
          SELECT id, name
          FROM products
          WHERE name IN (${cleanedProducts.map(() => '?').join(',')})
        `).all(...cleanedProducts)
      : [];

    if (productRows.length !== cleanedProducts.length) {
      const foundProducts = new Set(productRows.map(product => product.name));
      const missingProducts = cleanedProducts.filter(
        productName => !foundProducts.has(productName)
      );

      return res.status(400).json({
        success: false,
        error: `منتجات غير موجودة: ${missingProducts.join('، ')}`
      });
    }

    const updateRep = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET
          name = ?,
          areas = ?,
          daily_target = ?,
          team_id = ?,
          custom_products = ?,
specialty_mode = ?
WHERE id = ? AND role = 'REP'
      `).run(
        String(name).trim(),
        cleanedAreas.join('، '),
        Number(target) || 8,
        normalizedTeamId,
        cleanedProducts.join('، '),
normalizedSpecialtyMode,
repId
      );

      db.prepare(`
        DELETE FROM rep_areas
        WHERE rep_id = ?
      `).run(repId);

      const insertArea = db.prepare(`
        INSERT OR IGNORE INTO rep_areas (
          rep_id,
          area_id
        )
        VALUES (?, ?)
      `);

      for (const area of areaRows) {
        insertArea.run(repId, area.id);
      }

      db.prepare(`
        DELETE FROM rep_products
        WHERE rep_id = ?
      `).run(repId);

      const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO rep_products (
          rep_id,
          product_id
        )
        VALUES (?, ?)
      `);

      for (const product of productRows) {
        insertProduct.run(repId, product.id);
      }
      db.prepare(`
  DELETE FROM rep_specialties
  WHERE rep_id = ?
`).run(repId);

if (normalizedSpecialtyMode === 'CUSTOM') {
  const insertSpecialty = db.prepare(`
    INSERT OR IGNORE INTO rep_specialties (
      rep_id,
      specialty
    )
    VALUES (?, ?)
  `);

  for (const specialty of cleanedSpecialties) {
    insertSpecialty.run(repId, specialty);
  }
}
    });

    updateRep();

    res.json({
      success: true,
      message: 'تم تعديل المندوب بنجاح',
      areas: cleanedAreas,
      custom_products: cleanedProducts
    });

  } catch (error) {
    console.error('Error updating rep:', error);

    res.status(500).json({
      success: false,
      error: 'تعذر تعديل المندوب'
    });
  }
});

app.put('/api/team/reps/:id/annual-leave-balance', (req, res) => {
  try {
    const repId = Number(req.params.id);
    const balance = Number(req.body.balance);

    if (!Number.isInteger(balance) || balance < 0) {
      return res.status(400).json({
        success: false,
        error: 'رصيد الإجازة غير صحيح'
      });
    }

    const result = db.prepare(`
      UPDATE users
      SET annual_leave_balance = ?
      WHERE id = ? AND role = 'REP'
    `).run(balance, repId);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    res.json({
      success: true,
      balance
    });

  } catch (error) {
    console.error('Error updating rep annual leave balance:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حفظ رصيد الإجازة'
    });
  }
});

app.get('/api/pharmacies', (req, res) => {
  try {
    const cycleStart = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = 'cycle_start_date'
    `).get()?.value;

    const cycleEnd = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = 'cycle_end_date'
    `).get()?.value;

    const repOnlyId = req.authUser.role === 'REP' ? req.authUser.id : null;
    const repAreaNames = repOnlyId === null ? null : new Set(db.prepare(
      'SELECT a.name FROM rep_areas ra JOIN areas a ON a.id = ra.area_id WHERE ra.rep_id = ?'
    ).all(repOnlyId).map(a => a.name));
    const pharmacies = db.prepare(`
      SELECT *
      FROM pharmacies
      ORDER BY id DESC
    `).all();

    // كل الزيارات - لاستخراج آخر زيارة تاريخية
    const allVisits = db.prepare(`
      SELECT targets, visit_date
      FROM visits
      WHERE type = 'صيدليات'
      ${repOnlyId === null ? '' : 'AND rep_id = ?'}
      ORDER BY date(visit_date) DESC, id DESC
    `).all(...(repOnlyId === null ? [] : [repOnlyId]));

    // زيارات السايكل الحالي فقط
    const cycleVisits = db.prepare(`
      SELECT targets, visit_date
      FROM visits
      WHERE type = 'صيدليات'
      ${repOnlyId === null ? '' : 'AND rep_id = ?'}
        AND date(visit_date) >= date(?)
        AND date(visit_date) <= date(?)
      ORDER BY date(visit_date) DESC, id DESC
    `).all(...(repOnlyId === null ? [] : [repOnlyId]), cycleStart, cycleEnd);

    const pharmacyInVisit = (visit, pharmacyName) => {
      if (!visit.targets) return false;

      const targets = String(visit.targets)
        .split(/[,،]/)
        .map(name => name.trim())
        .filter(Boolean);

      return targets.includes(pharmacyName);
    };

    const pharmaciesWithVisits = pharmacies.filter(p => repAreaNames === null || repAreaNames.has(p.area)).map(pharmacy => {

      const historicalVisits = allVisits.filter(visit =>
        pharmacyInVisit(visit, pharmacy.name)
      );

      const currentCycleVisits = cycleVisits.filter(visit =>
        pharmacyInVisit(visit, pharmacy.name)
      );

      const lastVisit =
        historicalVisits.length > 0
          ? historicalVisits[0].visit_date
          : null;

      return {
        ...pharmacy,

        last: lastVisit || 'لم تتم زيارتها بعد',

        status: currentCycleVisits.length > 0
          ? 'مزارة'
          : 'غير مزارة',

        done: currentCycleVisits.length,

        target: Number(pharmacy.target || 0)
      };
    });

    res.json(pharmaciesWithVisits);

  } catch (error) {
    console.error('Error loading pharmacies:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل الصيدليات'
    });
  }
});

app.post('/api/pharmacies', (req, res) => {
  try {
    const {
      name,
      area,
      target,
      category = 'A',
      type = 'مستقلة'
    } = req.body;

    if (!name || !area) {
      return res.status(400).json({
        message: 'Name and area are required'
      });
    }

    const result = db.prepare(`
      INSERT INTO pharmacies (
        name,
        area,
        target,
        category,
        type
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name,
      area,
      Number(target) || 4,
      category,
      type
    );

    res.json({
      id: result.lastInsertRowid,
      name,
      area,
      target: Number(target) || 4,
      category,
      type
    });

  } catch (error) {
    console.error('Error adding pharmacy:', error);

    res.status(500).json({
      message: 'Failed to add pharmacy'
    });
  }
});

// حفظ جولة جديدة

app.post('/api/visits', (req, res) => {
  try {
    const {
      rep_id,
      type,
      areas,
      targets,
      target_ids = [],
      visit_date
    } = req.body;

    if (req.authUser.role === 'REP' && Number(rep_id) !== req.authUser.id) {
      return res.status(403).json({ success: false, error: 'Cannot act for another representative' });
    }
    if (!['أطباء', 'صيدليات', 'مشافي'].includes(type) ||
        typeof visit_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(visit_date) ||
        !Number.isFinite(Date.parse(visit_date)) || visit_date > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ success: false, error: 'Invalid visit type or date' });
    }
    if (!rep_id) {
      return res.status(400).json({ success: false, error: 'معرّف المندوب مطلوب' });
    }

    const rep = db.prepare(`
      SELECT id, name
      FROM users
      WHERE id = ? AND role = 'REP'
    `).get(Number(rep_id));

    if (!rep) {
      return res.status(400).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    const targetConfig = {
      'أطباء': {
        table: 'doctors',
        targetType: 'doctor'
      },
      'صيدليات': {
        table: 'pharmacies',
        targetType: 'pharmacy'
      },
      'مشافي': {
        table: 'hospitals',
        targetType: 'hospital'
      }
    };

    const saveVisit = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO visits (
          rep_id,
          rep_name,
          type,
          areas,
          targets,
          visit_date
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        rep.id,
        rep.name,
        type,
        areas,
        targets,
        visit_date
      );

      const visitId = Number(result.lastInsertRowid);
      const config = targetConfig[type];

      if (config) {
        const insertRelation = db.prepare(`
          INSERT OR IGNORE INTO visit_targets (
            visit_id,
            target_type,
            target_id
          )
          VALUES (?, ?, ?)
        `);

        let ids = Array.isArray(target_ids)
          ? target_ids.map(Number).filter(Number.isInteger)
          : [];

        // للأطباء الجدد: نستعمل IDs القادمة من الواجهة.
        // ولأي عميل قديم/صيدليات/مشافي: نحاول المطابقة بالاسم بشكل آمن.
        if (!ids.length && targets) {
          const names = String(targets)
            .split(/[,،]/)
            .map(name => name.trim())
            .filter(Boolean);

          const findByName = db.prepare(`
            SELECT id
            FROM ${config.table}
            WHERE name = ?
            ORDER BY id ASC
          `);

          for (const name of names) {
            const matches = findByName.all(name);

            if (matches.length === 1) {
              ids.push(Number(matches[0].id));
            }
          }
        }

        ids = [...new Set(ids)];

        const targetExists = db.prepare(`
          SELECT id
          FROM ${config.table}
          WHERE id = ?
        `);

        for (const targetId of ids) {
          const exists = targetExists.get(targetId);

          if (exists) {
            insertRelation.run(
              visitId,
              config.targetType,
              targetId
            );
          }
        }
      }

      return visitId;
    });

    const visitId = saveVisit();

    res.json({
      success: true,
      id: visitId
    });

  } catch (error) {
    console.error('Error saving visit:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حفظ الجولة'
    });
  }
});

// جلب جميع الجولات
app.get('/api/visits', (req, res) => {
  try {
    const visits = db.prepare(`
      SELECT * FROM visits
      WHERE (? = 0 OR rep_id = ?)
      ORDER BY id DESC
    `).all(req.authUser.role === 'REP' ? 1 : 0, req.authUser.id);

    res.json(visits);

  } catch (error) {
    console.error('Error loading visits:', error);

    res.status(500).json({
      error: 'فشل تحميل الجولات'
    });
  }
});
// إرسال طلب إجازة
app.post('/api/leaves', (req, res) => {
  try {
    const {
  rep_id,
  leave_type,
  from_date,
  to_date,
  reason
} = req.body;

if (req.authUser.role === 'REP' && Number(rep_id) !== req.authUser.id) {
  return res.status(403).json({ success: false, error: 'Cannot submit leave for another representative' });
}
if (!rep_id) {
  return res.status(400).json({
    success: false,
    error: 'معرّف المندوب مطلوب'
  });
}

const rep = db.prepare(`
  SELECT id, name
  FROM users
  WHERE id = ? AND role = 'REP'
`).get(Number(rep_id));

if (!rep) {
  return res.status(400).json({
    success: false,
    error: 'المندوب غير موجود'
  });
}

    if (typeof from_date !== 'string' || typeof to_date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(from_date) || !/^\d{4}-\d{2}-\d{2}$/.test(to_date) ||
        !Number.isFinite(Date.parse(from_date)) || !Number.isFinite(Date.parse(to_date)) ||
        to_date < from_date) {
      return res.status(400).json({ success: false, error: 'Invalid leave dates' });
    }
    if (!leave_type || !from_date || !to_date) {
  return res.status(400).json({
    success: false,
    error: 'بيانات طلب الإجازة غير مكتملة'
  });
}

    const result = db.prepare(`
  INSERT INTO leave_requests
  (
    rep_id,
    rep_name,
    leave_type,
    from_date,
    to_date,
    reason,
    status
  )
  VALUES (?, ?, ?, ?, ?, ?, 'pending')
`).run(
  rep.id,
  rep.name,
  leave_type,
  from_date,
  to_date,
  reason || ''
);

    res.json({
      success: true,
      id: result.lastInsertRowid
    });

  } catch (error) {
    console.error('Error saving leave request:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حفظ طلب الإجازة'
    });
  }
});
app.get('/api/settings/annual-leave-balance', (req, res) => {
  try {
    const setting = db.prepare(`
      SELECT value FROM settings
      WHERE key = ?
    `).get('annual_leave_balance');

    res.json({
      success: true,
      balance: setting ? Number(setting.value) : 12
    });

  } catch (error) {
    console.error('Error loading annual leave balance:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل رصيد الإجازة'
    });
  }
});
app.put('/api/settings/annual-leave-balance', (req, res) => {
  try {
    const balance = Number(req.body.balance);

    if (!Number.isInteger(balance) || balance < 0) {
      return res.status(400).json({
        success: false,
        error: 'رصيد الإجازة غير صحيح'
      });
    }

    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value
    `).run('annual_leave_balance', String(balance));

    res.json({
      success: true,
      balance
    });

  } catch (error) {
    console.error('Error updating annual leave balance:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تعديل رصيد الإجازة'
    });
  }
});
app.get('/api/leaves', (req, res) => {
  try {
    const leaves = db.prepare(`
      SELECT *
      FROM leave_requests
      WHERE (? = 0 OR rep_id = ?)
      ORDER BY id DESC
    `).all(req.authUser.role === 'REP' ? 1 : 0, req.authUser.id);

    res.json(leaves);

  } catch (error) {
    console.error('Error loading leave requests:', error);

    res.status(500).json({
      error: 'فشل تحميل طلبات الإجازة'
    });
  }
});
app.patch('/api/leaves/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'حالة الطلب غير صحيحة'
      });
    }

    const result = db.prepare(`
      UPDATE leave_requests
      SET status = ?
      WHERE id = ?
    `).run(status, id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'طلب الإجازة غير موجود'
      });
    }

    res.json({
      success: true,
      id,
      status
    });

  } catch (error) {
    console.error('Error updating leave status:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحديث حالة الطلب'
    });
  }
});
app.get('/api/settings/working-days', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = ?
    `).get('working_days');

    const days = row
      ? JSON.parse(row.value)
      : [0, 1, 2, 3, 4, 6];

    res.json({ days });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'فشل تحميل أيام العمل'
    });
  }
});

app.post('/api/settings/working-days', (req, res) => {
  try {
    const { days } = req.body;

    if (!Array.isArray(days)) {
      return res.status(400).json({
        message: 'أيام العمل غير صحيحة'
      });
    }

    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value
    `).run(
      'working_days',
      JSON.stringify(days)
    );

    res.json({
      success: true,
      days
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'فشل حفظ أيام العمل'
    });
  }
});


app.post('/api/areas/sync-from-doctors', (req, res) => {
  try {
    const doctors = db.prepare(`
      SELECT DISTINCT area
      FROM doctors
      WHERE area IS NOT NULL
        AND TRIM(area) != ''
    `).all();

    const insertArea = db.prepare(`
      INSERT OR IGNORE INTO areas (name, city)
      VALUES (?, ?)
    `);

    const syncAreas = db.transaction((rows) => {
      for (const row of rows) {
        insertArea.run(
          String(row.area || '').trim(),
          'حلب'
        );
      }
    });

    syncAreas(doctors);

    res.json({
      success: true,
      synced: doctors.length
    });

  } catch (error) {
    console.error('Error syncing areas:', error);

    res.status(500).json({
      success: false,
      error: 'فشل مزامنة المناطق'
    });
  }
});
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT
        id,
        name,
        active_ingredient
      FROM products
      WHERE is_active = 1
      ORDER BY name ASC
    `).all();

    res.json(products);

  } catch (error) {
    console.error('Error loading products:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل المنتجات'
    });
  }
});

app.get('/api/areas', (req, res) => {
  try {
    // =========================
    // إعدادات السايكل
    // =========================

    const settingsRows = db.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN (
        'cycle_start_date',
        'cycle_end_date',
        'frequency_A',
        'frequency_B',
        'frequency_C'
      )
    `).all();

    const settings = Object.fromEntries(
      settingsRows.map(row => [row.key, row.value])
    );

    const startDate = settings.cycle_start_date;
    const endDate = settings.cycle_end_date;

    const frequencyA =
      Number(settings.frequency_A) || 1;

    const frequencyB =
      Number(settings.frequency_B) || 1;

    const frequencyC =
      Number(settings.frequency_C) || 1;

    function targetByGrade(grade) {
      if (grade === 'A') return frequencyA;
      if (grade === 'B') return frequencyB;
      if (grade === 'C') return frequencyC;

      return 1;
    }

    // =========================
    // المناطق
    // =========================

    const areaRows = db.prepare(`
      SELECT
        a.id,
        a.name,
        a.city,
        a.group_id,
        ag.name AS group_name,
        COUNT(DISTINCT ra.rep_id) AS reps

      FROM areas a

      LEFT JOIN area_groups ag
        ON ag.id = a.group_id

      LEFT JOIN rep_areas ra
        ON ra.area_id = a.id

      GROUP BY
        a.id,
        a.name,
        a.city,
        a.group_id,
        ag.name,
        ag.sort_order

      ORDER BY
        CASE
          WHEN a.group_id IS NULL THEN 1
          ELSE 0
        END,
        ag.sort_order ASC,
        a.name ASC
    `).all();

    // =========================
    // Statements
    // =========================

    const repsForAreaStmt = db.prepare(`
      SELECT
        u.id,
        u.team_id,
        COALESCE(
          u.specialty_mode,
          'TEAM'
        ) AS specialty_mode

      FROM rep_areas ra

      JOIN users u
        ON u.id = ra.rep_id

      WHERE ra.area_id = ?
        AND u.role = 'REP'
    `);

    const teamSpecialtiesStmt = db.prepare(`
      SELECT specialty
      FROM team_specialties
      WHERE team_id = ?
    `);

    const repSpecialtiesStmt = db.prepare(`
      SELECT specialty
      FROM rep_specialties
      WHERE rep_id = ?
    `);

    // =========================
    // حساب كل منطقة
    // =========================

    const result = areaRows.map(area => {

      const reps =
        repsForAreaStmt.all(area.id);

      let totalRequired = 0;
      let totalCompleted = 0;

      for (const rep of reps) {

        // -------------------------
        // اختصاصات المندوب الفعلية
        // -------------------------

        let specialties = [];

        if (rep.specialty_mode === 'CUSTOM') {

          specialties =
            repSpecialtiesStmt
              .all(rep.id)
              .map(row => row.specialty);

        } else if (rep.team_id) {

          specialties =
            teamSpecialtiesStmt
              .all(rep.team_id)
              .map(row => row.specialty);
        }

        if (!specialties.length) {
          continue;
        }

        // -------------------------
        // أطباء هذا المندوب
        // ضمن هذه المنطقة فقط
        // -------------------------

        const specialtyPlaceholders =
          specialties.map(() => '?').join(',');

        const doctors = db.prepare(`
          SELECT
            id,
            grade
          FROM doctors
          WHERE area = ?
            AND TRIM(spec) IN (
              ${specialtyPlaceholders}
            )
        `).all(
          area.name,
          ...specialties
        );

        if (!doctors.length) {
          continue;
        }

        const doctorIds =
          doctors.map(doctor => doctor.id);

        const doctorPlaceholders =
          doctorIds.map(() => '?').join(',');

        // -------------------------
        // زيارات هذا المندوب
        // لهؤلاء الأطباء فقط
        // -------------------------

        let visitRows = [];

        if (startDate && endDate) {
          visitRows = db.prepare(`
            SELECT
              vt.target_id AS doctor_id,
              COUNT(*) AS visits_count

            FROM visits v

            JOIN visit_targets vt
              ON vt.visit_id = v.id

            WHERE v.rep_id = ?
              AND v.type = 'أطباء'
              AND vt.target_type = 'doctor'

              AND vt.target_id IN (
                ${doctorPlaceholders}
              )

              AND date(v.visit_date)
                BETWEEN date(?) AND date(?)

            GROUP BY vt.target_id
          `).all(
            rep.id,
            ...doctorIds,
            startDate,
            endDate
          );
        }

        const visitMap = new Map(
          visitRows.map(row => [
            Number(row.doctor_id),
            Number(row.visits_count)
          ])
        );

        // -------------------------
        // Required + Completed
        // -------------------------

        for (const doctor of doctors) {

          const target =
            targetByGrade(doctor.grade);

          const done =
            visitMap.get(Number(doctor.id)) || 0;

          totalRequired += target;

          totalCompleted += Math.min(
            done,
            target
          );
        }
      }

      // =========================
      // Coverage المنطقة
      // =========================

      const coverage =
        totalRequired > 0
          ? Math.round(
              (
                totalCompleted /
                totalRequired
              ) * 100
            )
          : 0;

      return {
        ...area,
        coverage,
        completed_visits: totalCompleted,
        required_visits: totalRequired
      };
    });

    res.json(result);

  } catch (error) {
    console.error(
      'Error loading areas:',
      error
    );

    res.status(500).json({
      success: false,
      error: 'فشل تحميل المناطق'
    });
  }
});

app.get('/api/areas/:id/details', (req, res) => {
  try {
    const areaId = Number(req.params.id);

    if (!Number.isInteger(areaId) || areaId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المنطقة غير صالح'
      });
    }

    // المنطقة + المجموعة
    const area = db.prepare(`
      SELECT
        a.id,
        a.name,
        a.city,
        a.group_id,
        ag.name AS group_name
      FROM areas a
      LEFT JOIN area_groups ag
        ON ag.id = a.group_id
      WHERE a.id = ?
    `).get(areaId);

    if (!area) {
      return res.status(404).json({
        success: false,
        error: 'المنطقة غير موجودة'
      });
    }

    // إعدادات السايكل والـ Frequency
    const settingsRows = db.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN (
        'cycle_start_date',
        'cycle_end_date',
        'frequency_A',
        'frequency_B',
        'frequency_C'
      )
    `).all();

    const settings = Object.fromEntries(
      settingsRows.map(row => [row.key, row.value])
    );

    const cycleStart = settings.cycle_start_date;
    const cycleEnd = settings.cycle_end_date;

    const frequencies = {
      A: Number(settings.frequency_A) || 1,
      B: Number(settings.frequency_B) || 1,
      C: Number(settings.frequency_C) || 1
    };

    // أطباء المنطقة
    const doctors = db.prepare(`
      SELECT
        id,
        name,
        spec,
        grade
      FROM doctors
      WHERE area = ?
      ORDER BY name
    `).all(area.name);

    // صيدليات المنطقة
    const pharmacies = db.prepare(`
      SELECT
        id,
        name,
        category,
        target,
        type
      FROM pharmacies
      WHERE area = ?
      ORDER BY name
    `).all(area.name);

    // مشافي المنطقة
    const hospitals = db.prepare(`
      SELECT
        id,
        name,
        category,
        specialty,
        target
      FROM hospitals
      WHERE area = ?
      ORDER BY name
    `).all(area.name);

    // المندوبون المستلمون للمنطقة
    const reps = db.prepare(`
      SELECT
        u.id,
        u.name,
        u.username,
        u.daily_target,
        u.team_id,
        t.name AS team_name
      FROM rep_areas ra
      JOIN users u
        ON u.id = ra.rep_id
      LEFT JOIN teams t
        ON t.id = u.team_id
      WHERE ra.area_id = ?
        AND u.role = 'REP'
      ORDER BY u.name
    `).all(areaId);

    // إجمالي الزيارات المطلوبة لأطباء المنطقة
    const totalRequiredVisits = doctors.reduce(
      (sum, doctor) => {
        const grade = String(
          doctor.grade || 'C'
        ).toUpperCase();

        return sum + (frequencies[grade] || 1);
      },
      0
    );

    // IDs أطباء المنطقة
    const doctorIds = new Set(
      doctors.map(doctor => Number(doctor.id))
    );

    const repsWithCoverage = reps.map(rep => {

      let completedVisits = 0;
      let visitedDoctors = 0;

      const doctorVisitCounts = new Map();

      if (cycleStart && cycleEnd) {
        const visits = db.prepare(`
          SELECT
            vt.target_id AS doctor_id,
            COUNT(*) AS visits_count
          FROM visits v
          JOIN visit_targets vt
            ON vt.visit_id = v.id
           AND vt.target_type = 'doctor'
          WHERE v.rep_id = ?
            AND date(v.visit_date)
                BETWEEN date(?) AND date(?)
          GROUP BY vt.target_id
        `).all(
          rep.id,
          cycleStart,
          cycleEnd
        );

        visits.forEach(row => {
          const doctorId = Number(row.doctor_id);

          if (!doctorIds.has(doctorId)) {
            return;
          }

          doctorVisitCounts.set(
            doctorId,
            Number(row.visits_count) || 0
          );
        });
      }

      doctors.forEach(doctor => {
        const grade = String(
          doctor.grade || 'C'
        ).toUpperCase();

        const required =
          frequencies[grade] || 1;

        const actual =
          doctorVisitCounts.get(
            Number(doctor.id)
          ) || 0;

        if (actual > 0) {
          visitedDoctors += 1;
        }

        // لا نسمح بالزيارات الزائدة أن ترفع التغطية فوق المطلوب
        completedVisits += Math.min(
          actual,
          required
        );
      });

      const coverage = totalRequiredVisits > 0
        ? Math.round(
            (completedVisits / totalRequiredVisits) * 100
          )
        : 0;

      return {
        id: rep.id,
        name: rep.name,
        username: rep.username || '',
        team_id: rep.team_id,
        team_name: rep.team_name || null,

        doctors_count: doctors.length,
        visited_doctors: visitedDoctors,

        completed_visits: completedVisits,
        required_visits: totalRequiredVisits,

        coverage
      };
    });

    const areaCoverage = repsWithCoverage.length
      ? Math.round(
          repsWithCoverage.reduce(
            (sum, rep) => sum + rep.coverage,
            0
          ) / repsWithCoverage.length
        )
      : 0;

    res.json({
      success: true,

      area: {
        id: area.id,
        name: area.name,
        city: area.city || '',
        group_id: area.group_id,
        group_name: area.group_name || null
      },

      cycle: {
        start_date: cycleStart,
        end_date: cycleEnd,
        frequency: frequencies
      },

      totals: {
        reps: repsWithCoverage.length,
        doctors: doctors.length,
        pharmacies: pharmacies.length,
        hospitals: hospitals.length
      },

      coverage: areaCoverage,

      reps: repsWithCoverage,

      doctors,
      pharmacies,
      hospitals
    });

  } catch (error) {
    console.error(
      'Error loading area details:',
      error
    );

    res.status(500).json({
      success: false,
      error: 'فشل تحميل تفاصيل المنطقة'
    });
  }
});

app.get('/api/area-groups', (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT
        ag.id,
        ag.name,
        ag.sort_order,
        COUNT(a.id) AS areas_count
      FROM area_groups ag
      LEFT JOIN areas a
        ON a.group_id = ag.id
      GROUP BY ag.id, ag.name, ag.sort_order
      ORDER BY ag.sort_order ASC, ag.name ASC
    `).all();

    res.json(groups);

  } catch (error) {
    console.error('Error loading area groups:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل مجموعات المناطق'
    });
  }
});

app.post('/api/area-groups', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'اسم المجموعة مطلوب'
      });
    }

    const maxOrder = db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS max_order
      FROM area_groups
    `).get();

    const result = db.prepare(`
      INSERT INTO area_groups (name, sort_order)
      VALUES (?, ?)
    `).run(name, Number(maxOrder.max_order) + 1);

    res.json({
      success: true,
      id: Number(result.lastInsertRowid)
    });

  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: 'اسم المجموعة موجود مسبقاً'
      });
    }

    console.error('Error creating area group:', error);

    res.status(500).json({
      success: false,
      error: 'فشل إنشاء مجموعة المناطق'
    });
  }
});

app.put('/api/areas/:id', (req, res) => {
  try {
    const areaId = Number(req.params.id);
    const name = String(req.body.name || '').trim();

    const groupId =
      req.body.group_id === null ||
      req.body.group_id === '' ||
      req.body.group_id === undefined
        ? null
        : Number(req.body.group_id);

    if (!Number.isInteger(areaId) || areaId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المنطقة غير صالح'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'اسم المنطقة مطلوب'
      });
    }

    const area = db.prepare(`
      SELECT id
      FROM areas
      WHERE id = ?
    `).get(areaId);

    if (!area) {
      return res.status(404).json({
        success: false,
        error: 'المنطقة غير موجودة'
      });
    }

    if (groupId !== null) {
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'مجموعة المنطقة غير صالحة'
        });
      }

      const group = db.prepare(`
        SELECT id
        FROM area_groups
        WHERE id = ?
      `).get(groupId);

      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'مجموعة المناطق غير موجودة'
        });
      }
    }

    db.prepare(`
      UPDATE areas
      SET name = ?, group_id = ?
      WHERE id = ?
    `).run(name, groupId, areaId);

    res.json({ success: true });

  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: 'اسم المنطقة موجود مسبقاً'
      });
    }

    console.error('Error updating area:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تعديل المنطقة'
    });
  }
});

app.post('/api/areas', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();

    const groupId =
      req.body.group_id === null ||
      req.body.group_id === '' ||
      req.body.group_id === undefined
        ? null
        : Number(req.body.group_id);

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'اسم المنطقة مطلوب'
      });
    }

    if (groupId !== null) {
      if (!Number.isInteger(groupId) || groupId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'مجموعة المنطقة غير صالحة'
        });
      }

      const group = db.prepare(`
        SELECT id
        FROM area_groups
        WHERE id = ?
      `).get(groupId);

      if (!group) {
        return res.status(404).json({
          success: false,
          error: 'مجموعة المناطق غير موجودة'
        });
      }
    }

    const result = db.prepare(`
      INSERT INTO areas (
        name,
        group_id
      )
      VALUES (?, ?)
    `).run(name, groupId);

    res.json({
      success: true,
      id: Number(result.lastInsertRowid)
    });

  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        success: false,
        error: 'اسم المنطقة موجود مسبقاً'
      });
    }

    console.error('Error creating area:', error);

    res.status(500).json({
      success: false,
      error: 'فشل إنشاء المنطقة'
    });
  }
});


app.put('/api/team/reps/:id/areas', (req, res) => {
  try {
    const repId = Number(req.params.id);
    const { areas } = req.body;

    if (!Number.isInteger(repId) || repId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المندوب غير صحيح'
      });
    }

    if (!Array.isArray(areas)) {
      return res.status(400).json({
        success: false,
        error: 'صيغة المناطق غير صحيحة'
      });
    }

    const cleanedAreas = [
      ...new Set(
        areas
          .map(area => String(area).trim())
          .filter(Boolean)
      )
    ];

    const rep = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ? AND role = 'REP'
    `).get(repId);

    if (!rep) {
      return res.status(404).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    const areaRows = cleanedAreas.length
      ? db.prepare(`
          SELECT id, name
          FROM areas
          WHERE name IN (${cleanedAreas.map(() => '?').join(',')})
        `).all(...cleanedAreas)
      : [];

    if (areaRows.length !== cleanedAreas.length) {
      const foundNames = new Set(areaRows.map(area => area.name));

      const missingAreas = cleanedAreas.filter(
        areaName => !foundNames.has(areaName)
      );

      return res.status(400).json({
        success: false,
        error: `مناطق غير موجودة: ${missingAreas.join('، ')}`
      });
    }

    const updateRepAreas = db.transaction(() => {
      db.prepare(`
        DELETE FROM rep_areas
        WHERE rep_id = ?
      `).run(repId);

      const insertRelation = db.prepare(`
        INSERT OR IGNORE INTO rep_areas (
          rep_id,
          area_id
        )
        VALUES (?, ?)
      `);

      for (const area of areaRows) {
        insertRelation.run(repId, area.id);
      }

      // توافق مؤقت مع الكود القديم
      db.prepare(`
        UPDATE users
        SET areas = ?
        WHERE id = ?
      `).run(
        cleanedAreas.join('، '),
        repId
      );
    });

    updateRepAreas();

    res.json({
      success: true,
      areas: cleanedAreas
    });

  } catch (error) {
    console.error('Error updating rep areas:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تعديل مناطق المندوب'
    });
  }
});

app.put('/api/team/reps/:id/team', (req, res) => {
  try {
    const repId = Number(req.params.id);
    const { team_id } = req.body;

    if (!Number.isInteger(repId) || repId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المندوب غير صحيح'
      });
    }

    const normalizedTeamId =
      team_id === null || team_id === '' ? null : Number(team_id);

    if (
      normalizedTeamId !== null &&
      (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        error: 'رقم الفريق غير صحيح'
      });
    }

    const rep = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ? AND role = 'REP'
    `).get(repId);

    if (!rep) {
      return res.status(404).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    if (normalizedTeamId !== null) {
      const team = db.prepare(`
        SELECT id
        FROM teams
        WHERE id = ?
      `).get(normalizedTeamId);

      if (!team) {
        return res.status(404).json({
          success: false,
          error: 'الفريق غير موجود'
        });
      }
    }

    const updateTeam = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET
          team_id = ?,
          custom_products = CASE WHEN ? IS NULL THEN custom_products ELSE '' END
        WHERE id = ? AND role = 'REP'
      `).run(normalizedTeamId, normalizedTeamId, repId);

      if (normalizedTeamId !== null) {
        db.prepare(`
          DELETE FROM rep_products
          WHERE rep_id = ?
        `).run(repId);
      }
    });

    updateTeam();

    res.json({
      success: true,
      team_id: normalizedTeamId
    });

  } catch (error) {
    console.error('Error updating rep team:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تعديل فريق المندوب'
    });
  }
});

app.get('/api/cycle-settings', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN (
        'cycle_start_date',
        'cycle_end_date',
        'frequency_A',
        'frequency_B',
        'frequency_C'
      )
    `).all();

    const settings = {};

    rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({
      cycle_start_date: settings.cycle_start_date || '',
      cycle_end_date: settings.cycle_end_date || '',
      frequency_A: Number(settings.frequency_A || 4),
      frequency_B: Number(settings.frequency_B || 2),
      frequency_C: Number(settings.frequency_C || 1)
    });

  } catch (error) {
    console.error('Error loading cycle settings:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل إعدادات السايكل'
    });
  }
});
app.post('/api/cycle-settings', (req, res) => {
  try {
    const {
      cycle_start_date,
      cycle_end_date,
      frequency_A,
      frequency_B,
      frequency_C
    } = req.body;

    const updateSetting = db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    updateSetting.run('cycle_start_date', cycle_start_date);
    updateSetting.run('cycle_end_date', cycle_end_date);
    updateSetting.run('frequency_A', String(frequency_A));
    updateSetting.run('frequency_B', String(frequency_B));
    updateSetting.run('frequency_C', String(frequency_C));

    res.json({
      success: true
    });

  } catch (error) {
    console.error('Error saving cycle settings:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حفظ إعدادات السايكل'
    });
  }
});
app.get('/api/weekly-visits-count', (req, res) => {
  try {
    const today = new Date();

    const day = today.getDay();
    const diffToSaturday = (day + 1) % 7;

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - diffToSaturday);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const toDateString = (date) =>
      date.toISOString().split('T')[0];

    const start = toDateString(weekStart);
    const end = toDateString(weekEnd);


const repId = Number(req.query.rep_id);

if (!Number.isInteger(repId) || repId <= 0) {
  return res.status(400).json({
    success: false,
    error: 'معرّف المندوب غير صحيح'
  });
}

const visits = db.prepare(`
  SELECT targets
  FROM visits
  WHERE rep_id = ?
    AND date(visit_date) >= date(?)
    AND date(visit_date) <= date(?)
`).all(repId, start, end);

    let count = 0;

    visits.forEach(visit => {
      if (!visit.targets) return;

      count += String(visit.targets)
        .split(/[,،]/)
        .map(x => x.trim())
        .filter(Boolean)
        .length;
    });

    res.json({
      success: true,
      count,
      start,
      end
    });

  } catch (error) {
    console.error('Error counting weekly visits:', error);

    res.status(500).json({
      success: false,
      error: 'فشل حساب زيارات الأسبوع'
    });
  }
});
app.get('/api/hospitals', (req, res) => {
  try {
    const cycleStart = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = 'cycle_start_date'
    `).get()?.value;

    const cycleEnd = db.prepare(`
      SELECT value
      FROM settings
      WHERE key = 'cycle_end_date'
    `).get()?.value;

    const repOnlyId = req.authUser.role === 'REP' ? req.authUser.id : null;
    const repAreaNames = repOnlyId === null ? null : new Set(db.prepare(
      'SELECT a.name FROM rep_areas ra JOIN areas a ON a.id = ra.area_id WHERE ra.rep_id = ?'
    ).all(repOnlyId).map(a => a.name));
    const hospitals = db.prepare(`
      SELECT *
      FROM hospitals
      ORDER BY id DESC
    `).all();

    const allVisits = db.prepare(`
      SELECT targets, visit_date
      FROM visits
      WHERE type = 'مشافي'
      ${repOnlyId === null ? '' : 'AND rep_id = ?'}
      ORDER BY date(visit_date) DESC, id DESC
    `).all(...(repOnlyId === null ? [] : [repOnlyId]));

    const cycleVisits = db.prepare(`
      SELECT targets, visit_date
      FROM visits
      WHERE type = 'مشافي'
      ${repOnlyId === null ? '' : 'AND rep_id = ?'}
        AND date(visit_date) >= date(?)
        AND date(visit_date) <= date(?)
      ORDER BY date(visit_date) DESC, id DESC
    `).all(...(repOnlyId === null ? [] : [repOnlyId]), cycleStart, cycleEnd);

    const hospitalInVisit = (visit, hospitalName) => {
      if (!visit.targets) return false;

      const targets = String(visit.targets)
        .split(/[,،]/)
        .map(name => name.trim())
        .filter(Boolean);

      return targets.includes(hospitalName);
    };

    const result = hospitals.filter(h => repAreaNames === null || repAreaNames.has(h.area)).map(hospital => {
      const historicalVisits = allVisits.filter(visit =>
        hospitalInVisit(visit, hospital.name)
      );

      const currentCycleVisits = cycleVisits.filter(visit =>
        hospitalInVisit(visit, hospital.name)
      );

      const lastVisit =
        historicalVisits.length > 0
          ? historicalVisits[0].visit_date
          : null;

      return {
        ...hospital,

        last: lastVisit || 'لم تتم زيارته بعد',

        status: currentCycleVisits.length > 0
          ? 'مزار'
          : 'بحاجة زيارة',

        done: currentCycleVisits.length,

        target: Number(hospital.target || 0)
      };
    });

    res.json(result);

  } catch (error) {
    console.error('Error loading hospitals:', error);

    res.status(500).json({
      success: false,
      error: 'فشل تحميل المشافي'
    });
  }
});

app.post('/api/hospitals', (req, res) => {
  try {
    const {
      name,
      category = 'خاص',
      area,
      specialty = 'عام',
      target = 4
    } = req.body;

    if (!name || !area) {
      return res.status(400).json({
        success: false,
        error: 'اسم المشفى والمنطقة مطلوبان'
      });
    }

    const result = db.prepare(`
      INSERT INTO hospitals (
        name,
        category,
        area,
        specialty,
        target
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name,
      category,
      area,
      specialty,
      Number(target) || 4
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      name,
      category,
      area,
      specialty,
      target: Number(target) || 4
    });

  } catch (error) {
    console.error('Error adding hospital:', error);

    res.status(500).json({
      success: false,
      error: 'فشل إضافة المشفى'
    });
  }
});

// ==========================================
// Frequency Analytics - Real DB Data
// ==========================================
app.get('/api/analytics/frequency', (req, res) => {
  try {
    const repId = Number(req.query.rep_id);

    if (!Number.isInteger(repId)) {
      return res.status(400).json({
        success: false,
        error: 'rep_id مطلوب'
      });
    }

    const areaFilter =
      String(req.query.area || 'all').trim();

    const gradeFilter =
      String(req.query.grade || 'all').trim();

    // =========================
    // إعدادات السايكل
    // =========================

    const settingsRows = db.prepare(`
      SELECT key, value
      FROM settings
      WHERE key IN (
        'cycle_start_date',
        'cycle_end_date',
        'frequency_A',
        'frequency_B',
        'frequency_C'
      )
    `).all();

    const settings = Object.fromEntries(
      settingsRows.map(row => [row.key, row.value])
    );

    const startDate = settings.cycle_start_date;
    const endDate = settings.cycle_end_date;

    if (!startDate || !endDate) {
      return res.status(500).json({
        success: false,
        error: 'إعدادات السايكل غير مكتملة'
      });
    }

    const frequencyA =
      Number(settings.frequency_A) || 1;

    const frequencyB =
      Number(settings.frequency_B) || 1;

    const frequencyC =
      Number(settings.frequency_C) || 1;

    // =========================
    // بيانات المندوب
    // =========================

    const rep = db.prepare(`
      SELECT
        id,
        team_id,
        COALESCE(specialty_mode, 'TEAM') AS specialty_mode
      FROM users
      WHERE id = ?
        AND role = 'REP'
    `).get(repId);

    if (!rep) {
      return res.status(404).json({
        success: false,
        error: 'المندوب غير موجود'
      });
    }

    // =========================
    // مناطق المندوب
    // =========================

    const repAreas = db.prepare(`
      SELECT a.name
      FROM rep_areas ra
      JOIN areas a
        ON a.id = ra.area_id
      WHERE ra.rep_id = ?
    `).all(repId).map(row => row.name);

    // =========================
    // اختصاصات المندوب الفعلية
    // =========================

    let specialties = [];

    if (rep.specialty_mode === 'CUSTOM') {

      specialties = db.prepare(`
        SELECT specialty
        FROM rep_specialties
        WHERE rep_id = ?
        ORDER BY specialty
      `).all(repId).map(row => row.specialty);

    } else if (rep.team_id) {

      specialties = db.prepare(`
        SELECT specialty
        FROM team_specialties
        WHERE team_id = ?
        ORDER BY specialty
      `).all(rep.team_id).map(row => row.specialty);

    }

    // إذا لا مناطق أو لا اختصاصات
    if (!repAreas.length || !specialties.length) {
      return res.json({
        success: true,

        cycle: {
          start_date: startDate,
          end_date: endDate
        },

        frequencies: {
          A: frequencyA,
          B: frequencyB,
          C: frequencyC
        },

        summary: {
          total: 0,
          complete: 0,
          behind: 0,
          unvisited: 0,
          compliance: 0
        },

        doctors: []
      });
    }

    // =========================
    // أطباء المندوب المستهدفون
    // =========================

    const areaPlaceholders =
      repAreas.map(() => '?').join(',');

    const specialtyPlaceholders =
      specialties.map(() => '?').join(',');

    let doctorsQuery = `
      SELECT
        id,
        name,
        spec,
        area,
        grade
      FROM doctors
      WHERE area IN (${areaPlaceholders})
        AND TRIM(spec) IN (${specialtyPlaceholders})
    `;

    const doctorParams = [
      ...repAreas,
      ...specialties
    ];

    if (areaFilter !== 'all') {
      doctorsQuery += `
        AND area = ?
      `;

      doctorParams.push(areaFilter);
    }

    if (gradeFilter !== 'all') {
      doctorsQuery += `
        AND grade = ?
      `;

      doctorParams.push(gradeFilter);
    }

    doctorsQuery += `
      ORDER BY area, grade, name
    `;

    const doctors =
      db.prepare(doctorsQuery).all(...doctorParams);

    // =========================
    // زيارات الأطباء بالـ ID
    // =========================

    const visitRows = db.prepare(`
      SELECT
        vt.target_id AS doctor_id,
        v.visit_date
      FROM visits v
      JOIN visit_targets vt
        ON vt.visit_id = v.id
      WHERE v.rep_id = ?
        AND v.type = 'أطباء'
        AND vt.target_type = 'doctor'
        AND date(v.visit_date)
          BETWEEN date(?) AND date(?)
      ORDER BY v.visit_date ASC
    `).all(
      repId,
      startDate,
      endDate
    );

    const visitMap = new Map();

    for (const visit of visitRows) {
      const doctorId = Number(visit.doctor_id);

      if (!visitMap.has(doctorId)) {
        visitMap.set(doctorId, {
          count: 0,
          last: null
        });
      }

      const item = visitMap.get(doctorId);

      item.count += 1;

      if (
        !item.last ||
        visit.visit_date > item.last
      ) {
        item.last = visit.visit_date;
      }
    }

    // =========================
    // Frequency حسب Settings
    // =========================

    function targetByGrade(grade) {
      if (grade === 'A') return frequencyA;
      if (grade === 'B') return frequencyB;
      if (grade === 'C') return frequencyC;

      return 1;
    }

    // =========================
    // النتيجة
    // =========================

    const result = doctors.map(doctor => {

      const stats =
        visitMap.get(Number(doctor.id)) || {
          count: 0,
          last: null
        };

      const target =
        targetByGrade(doctor.grade);

      const done = stats.count;

      let status = 'ناقص';

      if (done === 0) {
        status = 'غير مزار';
      } else if (done >= target) {
        status = 'مكتمل';
      }

      const progress = target
        ? Math.min(
            100,
            Math.round((done / target) * 100)
          )
        : 0;

      return {
        id: doctor.id,
        name: doctor.name,
        spec: doctor.spec || '',
        area: doctor.area || '',
        grade: doctor.grade || '',
        done,
        target,
        status,
        progress,
        last: stats.last || '—'
      };
    });

    const complete =
      result.filter(
        doctor => doctor.status === 'مكتمل'
      ).length;

    const behind =
      result.filter(
        doctor => doctor.status === 'ناقص'
      ).length;

    const unvisited =
      result.filter(
        doctor => doctor.status === 'غير مزار'
      ).length;

    const compliance = result.length
      ? Math.round(
          (
            result.reduce((sum, doctor) => {
              return sum + Math.min(
                1,
                doctor.done / doctor.target
              );
            }, 0) / result.length
          ) * 100
        )
      : 0;

    res.json({
      success: true,

      cycle: {
        start_date: startDate,
        end_date: endDate
      },

      frequencies: {
        A: frequencyA,
        B: frequencyB,
        C: frequencyC
      },

      summary: {
        total: result.length,
        complete,
        behind,
        unvisited,
        compliance
      },

      doctors: result
    });

  } catch (error) {
    console.error(
      'Frequency analytics error:',
      error
    );

    res.status(500).json({
      success: false,
      error: 'فشل تحميل تحليل Frequency'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend is running on port ${PORT}`);
});