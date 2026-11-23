import type { ManagerWorkspace } from "./ManagerDashboardV2Types";
import { ThemeIcon } from "./ManagerDashboardThemeIcon";
import { RepTable } from "./ManagerDashboardRepTable";
import { Empty } from "./ManagerDashboardTablePrimitives";
type Page = string;
const kinds: Record<string,string> = {DOCTOR:"أطباء",PHARMACY:"صيدليات",HOSPITAL:"مشافي"};
import s from "./ManagerDashboardV2.module.css";

type Props = { data: ManagerWorkspace; name: string; navigate: (page: Page) => void; openRep: (id: string) => void };
export function ManagerDashboardV2({ data, name, navigate, openRep }: Props) {
  return (
<div className={s.dashboardScope}>
  <section className={s.hero}>
    <div>
      <h2>صباح الخير، {name} 👋</h2>
      <p>
        متابعة أداء فرقك وجولات المندوبين. لديك{" "}
        {data.summary.pendingLeaves} طلبات إجازة بانتظار القرار.
      </p>
    </div>
    <div className={s.heroStatus}>
      <div className={s.row}>
        <span>المحافظة</span>
        <b>
          {[
            ...new Set(
              data.teams
                .map((t) => t.province?.name)
                .filter(Boolean),
            ),
          ].join("، ") || "—"}
        </b>
      </div>
      <div className={s.row}>
        <span>الفريق</span>
        <b>{data.teams.map((t) => t.name).join("، ") || "—"}</b>
      </div>
      <div className={s.row}>
        <span>عدد المندوبين</span>
        <b>{data.summary.reps}</b>
      </div>
      <div className={s.row}>
        <span>تاريخ المتابعة</span>
        <bdi>{data.today}</bdi>
      </div>
    </div>
  </section>
  <div className={s.kpis}>
    {[
      [data.summary.reps, "أعضاء الفريق", "👥", "الفريق"],
      [
        `${data.summary.coverage}%`,
        "تحقيق الخطة",
        "🎯",
        "السايكل",
      ],
      [
        `${data.summary.areaCoverage}%`,
        "تغطية المناطق",
        "📍",
        "المناطق",
      ],
      [
        data.summary.visitsToday,
        "الزيارات المنجزة",
        "🚗",
        "اليوم",
      ],
      [
        data.summary.pendingReports ?? "—",
        "تقارير معلقة",
        "📄",
        "مراجعة",
      ],
      [
        data.summary.overdueVisits ?? "—",
        "زيارات متأخرة",
        "⚠️",
        "تنبيه",
      ],
    ].map(([value, label, icon, tag]) => (
      <div
        className={`${s.card} ${s.kpi}`}
        key={label}
        title={
          value === "—"
            ? "هذا المؤشر غير متاح في البيانات الحالية."
            : undefined
        }
      >
        <div className={s.kpiTop}>
          <span className={s.kpiIcon}><ThemeIcon name={String(icon)}/></span>
          <span className={s.delta}>{tag}</span>
        </div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    ))}
  </div>
  <div className={s.grid}>
    <section className={s.card}>
      <div className={s.sectionHead}>
        <h3>أداء الفريق خلال الأسبوع</h3>
        <button onClick={() => navigate("analytics")}>
          عرض التحليل الكامل
        </button>
      </div>
      <div className={s.chart}>
        {data.week.map((d) => (
          <div className={s.barWrap} key={d.date}>
            <b>{d.count}</b>
            <div
              className={s.bar}
              style={{
                height: `${(d.count / Math.max(1, ...data.week.map((x) => x.count))) * 190}px`,
              }}
            />
            <span>
              {new Intl.DateTimeFormat("ar", {
                weekday: "short",
                timeZone: "UTC",
              }).format(new Date(`${d.date}T12:00:00Z`))}
            </span>
          </div>
        ))}
      </div>
    </section>
    <section className={s.card}>
      <div className={s.sectionHead}>
        <h3>النشاط المباشر</h3>
        <button onClick={() => navigate("tours")}>
          مشاهدة الكل
        </button>
      </div>
      <div className={s.list}>
        {data.rounds.slice(0, 5).map((r) => (
          <div className={s.item} key={r.id}>
            <b>
              {r.repName} — جولة {kinds[r.type]}
            </b>
            <p>
              {r.visits.length} زيارات • {r.date}
            </p>
          </div>
        ))}
        {!data.rounds.length && (
          <Empty>لا يوجد نشاط مسجل ضمن الفرق.</Empty>
        )}
      </div>
    </section>
  </div>
  <section className={`${s.card} ${s.performance}`}>
    <div className={s.sectionHead}>
      <h3>أداء أعضاء الفريق</h3>
      <button onClick={() => navigate("team")}>
        إدارة الفريق
      </button>
    </div>
    <RepTable items={data.reps} onOpen={openRep} />
  </section>
  <div className={s.miniGrid}>
    <section className={s.card}>
      <div className={s.sectionHead}>
        <h3>تغطية المناطق</h3>
        <button onClick={() => navigate("areas")}>
          عرض المناطق
        </button>
      </div>
      {data.areas.map((a) => (
        <div className={s.item} key={a.id}>
          <div className={s.row}>
            <b>{a.name}</b>
            <span>{a.coverage}%</span>
          </div>
          <progress value={a.coverage} max={100} />
        </div>
      ))}
    </section>
    <section className={s.card}>
      <div className={s.sectionHead}>
        <h3>طلبات تحتاج قرارك</h3>
        <button onClick={() => navigate("leaves")}>
          عرض الكل
        </button>
      </div>
      <p>
        {data.summary.pendingLeaves} طلبات إجازة بانتظار
        المراجعة.
      </p>
    </section>
  </div>
</div>
  );
}
