import type { ManagerRep } from "./ManagerDashboardV2Types";
import { Empty, Table } from "./ManagerDashboardTablePrimitives";
import s from "./ManagerDashboardV2.module.css";

export function RepTable({
  items,
  onOpen,
  onEdit,
}: {
  items: ManagerRep[];
  onOpen: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  return items.length ? (
    <Table
      headers={[
        "المندوب",
        "المناطق",
        "الزيارات",
        "تحقيق الخطة",
        "آخر نشاط",
        "الحالة",
        "التفاصيل",
      ]}
    >
      {items.map((r) => (
        <tr key={r.id}>
          <td>
            <div className={s.repName}>
              <span className={s.avatar}>
                {r.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join(" ")}
              </span>
              <strong>{r.name}</strong>
            </div>
          </td>
          <td>{r.areas.map((a) => a.name).join("، ") || "—"}</td>
          <td>{r.completedVisits}</td>
          <td>
            {r.scopeConfigured ? `${r.coverage}%` : "غير محدد"}
            <progress value={r.coverage} max={100} />
          </td>
          <td>
            <bdi>{r.lastVisit ?? "—"}</bdi>
          </td>
          <td className={s.statusCell}>
            <span
              className={`${s.badge} ${s.repStatus} ${r.status === "ACTIVE" ? s.repStatusActive : s.repStatusInactive}`}
              aria-label={`حالة المندوب: ${r.status === "ACTIVE" ? "نشط" : "غير نشط"}`}
            >
              {r.status === "ACTIVE" ? "نشط" : "غير نشط"}
            </span>
          </td>
          <td className={s.detailActionCell}>
            <button className={s.btn} type="button" onClick={() => onOpen(r.id)}>
              عرض التفاصيل
            </button>
            {onEdit && (
              <button
                className={`${s.btn} ${s.secondary}`}
                onClick={() => onEdit(r.id)}
              >
                تعديل
              </button>
            )}
          </td>
        </tr>
      ))}
    </Table>
  ) : (
    <Empty />
  );
}
