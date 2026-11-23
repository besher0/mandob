import type { ReactNode } from "react";
import s from "./ManagerDashboardV2.module.css";

export function Empty({
  children = "لا توجد بيانات ضمن نطاق فرقك.",
}: {
  children?: ReactNode;
}) {
  return <p className={s.empty}>{children}</p>;
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className={`${s.card} ${s.tableCard}`}>
      <table className={s.table}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
