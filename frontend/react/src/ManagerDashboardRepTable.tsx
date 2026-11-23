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
          <td>
            <span className={s.badge}>
              {r.status === "ACTIVE" ? "نشط" : "غير نشط"}
            </span>
          </td>
          <td>
            <button className={s.btn} onClick={() => onOpen(r.id)}>
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
