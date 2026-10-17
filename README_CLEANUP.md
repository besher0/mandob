# Med Rep cleanup – 2026-09-11

تم تنظيف النسخة الحالية مع الحفاظ على شكل الواجهة والـ API قدر الإمكان.

## أهم التعديلات
- تثبيت مسار قاعدة البيانات ليستخدم دائماً `backend/medrep.db` عبر `__dirname`.
- تنظيف `database.js` من migrations مكررة/قديمة غير مستخدمة مثل إضافة email وإضافة password مرتين.
- إضافة وتفعيل `team_products` وربط منتجات الفرق بعلاقة normalized.
- إبقاء `teams.products` مؤقتاً كطبقة توافق فقط حتى لا تنكسر الواجهة القديمة.
- `GET /api/teams` يقرأ المنتجات من `team_products`.
- `POST /api/teams` و `PUT /api/teams/:id` يكتبان إلى `team_products` ويزامنان النص القديم مؤقتاً.
- استعادة `PUT /api/team/reps/:id` كاملاً وربط تعديل المناطق والمنتجات في transaction واحدة.
- `rep_products` و `rep_areas` هما مصدر العلاقات، مع إبقاء الأعمدة النصية القديمة للتوافق المؤقت.
- `GET /api/areas` يحسب عدد المندوبين من `rep_areas` بدل تحليل النص القديم.
- تسجيل الدخول يرجع مناطق المندوب من `rep_areas`.
- تطبيق المندوب يبحث عن المندوب بواسطة `currentUser.id` بدل الاسم.
- عند إسناد مندوب إلى فريق يتم تنظيف المنتجات المخصصة للمندوب لأن منتجاته تأتي من الفريق.
- إزالة المندوبين التجريبيين ID 22 و 23 من النسخة المنظفة.
- حذف ملف `backend/database.db` الفارغ وغير المستخدم.
- إضافة `npm start` و `npm run check`.
- الإبقاء على `rep_name` في الزيارات والإجازات كـ snapshot للعرض، بينما الربط الفعلي يعتمد `rep_id`.

## نسخة احتياطية
`backend/medrep.backup-before-cleanup.db` هي نسخة قاعدة البيانات قبل عمليات التنظيف على هذه النسخة.

## فحوص تمت
- `node --check backend/database.js`
- `node --check backend/server.js`
- `node --check frontend/rep/app.js`
- اختبار GET للفرق والمندوبين والمناطق والمنتجات.
- اختبار إنشاء/تعديل فريق مع `team_products` ثم حذف بيانات الاختبار.
- اختبار إنشاء/تعديل مندوب مع `rep_areas` و `rep_products` ثم حذف بيانات الاختبار.
- اختبار login وإرجاع `id` والمناطق normalized.
- فحص عدم وجود orphan rows في `rep_areas`, `rep_products`, `team_products`.
- فحص أن كل الزيارات والإجازات الحالية تحتوي `rep_id`.
