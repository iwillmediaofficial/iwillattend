import type { Attendance, RequestStatus } from "../lib/types";
import { Badge } from "./ui";

export function AttendanceStatus({ row }: { row: Pick<Attendance, "status" | "late_minutes" | "is_corrected"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {row.status === "late" ? (
        <Badge tone="amber">Late {row.late_minutes} min</Badge>
      ) : row.status === "half_day" ? (
        <Badge tone="amber">Half day</Badge>
      ) : (
        <Badge tone="green">On time</Badge>
      )}
      {row.is_corrected && <Badge tone="indigo">Corrected</Badge>}
    </span>
  );
}

const tone = { pending: "amber", approved: "green", rejected: "red", cancelled: "slate" } as const;

export function RequestBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge tone={tone[status]}>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}
