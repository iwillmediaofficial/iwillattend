import type { Attendance, RequestStatus } from "../lib/types";
import { Badge } from "./ui";

export function AttendanceStatus({ row }: { row: Pick<Attendance, "status" | "late_minutes" | "is_corrected" | "missing_checkout"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {row.status === "late" ? (
        <Badge tone="amber">Late {row.late_minutes} min</Badge>
      ) : row.status === "half_day" ? (
        <Badge tone="amber">Half day</Badge>
      ) : (
        <Badge tone="green">On time</Badge>
      )}
      {row.missing_checkout && <Badge tone="red">Missing check-out</Badge>}
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

/** Result of comparing a punch selfie with the registered face. */
export function FaceBadge({ match, required }: { match: boolean | null | undefined; required?: boolean }) {
  if (match === true) return <Badge tone="green">Face matched</Badge>;
  if (match === false) return <Badge tone="red">Face mismatch</Badge>;
  // A registered employee whose selfie was never compared is suspicious, not neutral.
  return required ? <Badge tone="amber">Face not checked</Badge> : null;
}

/** True when a punch needs a manager's eye: the face did not match, or was never compared. */
export function faceFlagged(match: boolean | null | undefined, required: boolean): boolean {
  return match === false || (match == null && required);
}
