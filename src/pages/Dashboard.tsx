import { useEffect, useMemo, useState } from "react";
import { LogIn, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AttendanceWithEmployee, Branch, Employee, EmployeeLite, VisitWithEmployee } from "../lib/types";
import { Badge, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { MapView, type MapPoint } from "../components/MapView";
import { SelfieThumb } from "../components/SelfieThumb";
import { AttendanceStatus, FaceBadge, faceFlagged } from "../components/badges";
import { ExpiringCard } from "../components/assets";
import { addDays, fmtDistance, fmtHours, fmtTime, hoursBetween, mapsLink, todayIn } from "../lib/utils";
import { weekRuleOf, weekStart } from "../lib/muster";

type Staff = EmployeeLite & Pick<Employee, "weekly_off_mode" | "weekly_offs" | "flex_offs_per_week">;

interface Data {
  planned: { employee_id: string; off_date: string }[];
  employees: Staff[];
  attendance: AttendanceWithEmployee[];
  visits: VisitWithEmployee[];
  branches: Branch[];
}

const EMP = "employee:employees!employee_id(id, full_name, emp_code, staff_type)";

export function Dashboard() {
  const { org, employee: me } = useAuth();
  const faceOn = org!.face_check_enabled;
  const tz = org!.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    Promise.all([
      supabase.from("employees").select("id, full_name, emp_code, staff_type, weekly_off_mode, weekly_offs, flex_offs_per_week").eq("is_active", true).not("role", "in", "(owner,admin)").order("full_name"),
      supabase.from("attendance").select(`*, ${EMP}, site:site_assignments!site_assignment_id(site_name)`).eq("work_date", date).order("check_in_at"),
      supabase.from("visits").select(`*, ${EMP}`).eq("work_date", date).order("visited_at"),
      supabase.from("branches").select("*").eq("is_active", true),
      supabase.from("planned_offs").select("employee_id, off_date").gte("off_date", weekStart(date)).lte("off_date", addDays(weekStart(date), 6)),
    ]).then(([e, a, v, b, p]) => {
      if (!alive) return;
      setData({
        planned: (p.data as Data["planned"]) ?? [],
        employees: (e.data as Staff[]) ?? [],
        attendance: (a.data as unknown as AttendanceWithEmployee[]) ?? [],
        visits: (v.data as unknown as VisitWithEmployee[]) ?? [],
        branches: (b.data as Branch[]) ?? [],
      });
    });
    return () => {
      alive = false;
    };
  }, [date]);

  const points = useMemo<MapPoint[]>(() => {
    if (!data) return [];
    return [
      ...data.branches.map((b) => ({ lat: b.latitude, lng: b.longitude, label: `Branch: ${b.name}`, color: "#0c2e52", radius: b.radius_m })),
      ...data.attendance.flatMap((a) =>
        a.check_in_lat == null || a.check_in_lng == null
          ? []
          : [{ lat: a.check_in_lat, lng: a.check_in_lng, label: `${a.employee?.full_name ?? "Employee"} · in ${fmtTime(a.check_in_at, tz)}`, color: "#33a101" }],
      ),
      ...data.visits.map((v) => ({
        lat: v.latitude,
        lng: v.longitude,
        label: `${v.employee?.full_name ?? "Employee"} · visit: ${v.client_name} (${fmtTime(v.visited_at, tz)})`,
        color: "#d97706",
      })),
    ];
  }, [data, tz]);

  const dateInput = (
    <input
      type="date"
      value={date}
      max={todayIn(tz)}
      onChange={(e) => e.target.value && setDate(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
    />
  );

  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" action={dateInput} />
        <Spinner />
      </>
    );
  }

  const presentIds = new Set(data.attendance.map((a) => a.employee_id));
  const absent = data.employees.filter((e) => !presentIds.has(e.id));
  const plannedToday = new Set(data.planned.filter((p) => p.off_date === date).map((p) => p.employee_id));
  const isFlexible = (e: Staff) => weekRuleOf(e, org!).mode === "flexible";
  const nameOf = new Map(data.employees.map((e) => [e.id, e.full_name]));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  const anyFlexible = data.employees.some(isFlexible);
  const mismatches =
    data.attendance.filter((a) => faceFlagged(a.check_in_face_match, a.face_required)).length +
    data.attendance.filter((a) => a.check_out_at && faceFlagged(a.check_out_face_match, a.face_required)).length +
    data.visits.filter((v) => faceFlagged(v.face_match, v.face_required)).length;
  const byManager = data.attendance.filter((a) => a.check_in_by || a.check_out_by).length;
  const canCheckInStaff = org!.staff_checkin_enabled && date === todayIn(tz);
  const stats = [
    { label: "Active staff", value: data.employees.length, cls: "text-navy-900" },
    { label: "Checked in", value: data.attendance.length, cls: "text-success-600" },
    { label: "Not checked in", value: absent.length, cls: "text-rose-600" },
    { label: "Late", value: data.attendance.filter((a) => a.late_minutes > 0).length, cls: "text-amber-600" },
    { label: "Field visits", value: data.visits.length, cls: "text-amber-600" },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Attendance for the selected day" action={dateInput} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-semibold ${s.cls}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      {faceOn && mismatches > 0 && (
        <p className="mb-5 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {mismatches} punch{mismatches === 1 ? "" : "es"} on this day did not match the registered face, or were not checked against it. Check the selfies below.
        </p>
      )}

      {byManager > 0 && (
        <p className="mb-5 rounded-lg bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {byManager} attendance record{byManager === 1 ? " was" : "s were"} checked in or out by a manager on this day. Look for the "by" badges below, or filter them in Reports.
        </p>
      )}

      <ExpiringCard />

      <div className="mb-5">
        <MapView points={points} className="h-80" />
        <p className="mt-1 text-xs text-slate-500">Green: check-ins · Orange: field visits · Navy circle: branch geofence</p>
      </div>

      <Card className="mb-5">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Checked in ({data.attendance.length})</h2>
        {data.attendance.length === 0 ? (
          <Empty>Nobody has checked in on this day.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">In</th>
                  <th className="px-4 py-2 font-medium">Out</th>
                  <th className="px-4 py-2 font-medium">Hours</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.attendance.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <SelfieThumb path={a.check_in_selfie_path} />
                        <div>
                          <p className="font-medium">{a.employee?.full_name}</p>
                          <p className="text-xs capitalize text-slate-500">{a.employee?.staff_type} staff</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <p>{fmtTime(a.check_in_at, tz)}</p>
                      <span className="inline-flex flex-wrap gap-1">
                        <AttendanceStatus row={a} />
                        {faceOn && <FaceBadge match={a.check_in_face_match} required={a.face_required} />}
                        {faceOn && a.check_in_face_fails + a.check_out_face_fails > 0 && <Badge tone="amber">{a.check_in_face_fails + a.check_out_face_fails} failed face attempt{a.check_in_face_fails + a.check_out_face_fails === 1 ? "" : "s"}</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {a.check_out_selfie_path && <SelfieThumb path={a.check_out_selfie_path} size={28} />}
                        {fmtTime(a.check_out_at, tz)}
                        {faceOn && a.check_out_at && a.check_out_face_match !== true && <FaceBadge match={a.check_out_face_match} required={a.face_required} />}
                      </div>
                    </td>
                    <td className="px-4 py-2">{fmtHours(hoursBetween(a.check_in_at, a.check_out_at))}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {a.check_in_lat == null || a.check_in_lng == null ? (
                          <Badge>No location</Badge>
                        ) : (
                          <>
                            {a.site_assignment_id ? (
                              <Badge tone="indigo">Site work{a.site?.site_name ? ` · ${a.site.site_name}` : ""}</Badge>
                            ) : a.is_wfh ? (
                              <Badge tone="indigo">Work from home</Badge>
                            ) : a.check_in_in_geofence == null ? (
                              <Badge>Field</Badge>
                            ) : a.check_in_in_geofence ? (
                              <Badge tone="green">In zone · {fmtDistance(a.check_in_distance_m)}</Badge>
                            ) : (
                              <Badge tone="amber">Outside · {fmtDistance(a.check_in_distance_m)}</Badge>
                            )}
                            {a.check_in_accuracy_m != null && a.check_in_accuracy_m > org!.max_accuracy_m && <Badge tone="amber">Low accuracy ±{Math.round(a.check_in_accuracy_m)} m</Badge>}
                            <a href={mapsLink(a.check_in_lat, a.check_in_lng)} target="_blank" rel="noreferrer" className="text-brand-600" aria-label="Open in maps">
                              <MapPin className="h-4 w-4" />
                            </a>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {anyFlexible && (
        <Card className="mb-5">
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Planned weekly offs this week</h2>
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-7">
            {week.map((d) => {
              const names = data.planned.filter((p) => p.off_date === d).map((p) => nameOf.get(p.employee_id)).filter(Boolean);
              return (
                <div key={d} className={`bg-white px-3 py-2 ${d === date ? "ring-2 ring-inset ring-brand-200" : ""}`}>
                  <p className="text-xs font-semibold text-slate-600">{new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" })}</p>
                  {names.length === 0 ? <p className="text-xs text-slate-400">—</p> : names.map((n) => <p key={n} className="truncate text-xs">{n}</p>)}
                </div>
              );
            })}
          </div>
          <p className="px-4 py-2 text-xs text-slate-500">Staff on flexible weekly offs plan their day in the app. Someone who did not plan gets the first day they miss that week.</p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Not checked in ({absent.length})</h2>
          {absent.length === 0 ? (
            <Empty>Everyone has checked in.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {absent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{e.full_name}</span>
                  {plannedToday.has(e.id) ? <Badge tone="indigo">Planned weekly off</Badge> : isFlexible(e) ? <Badge tone="slate">May be on weekly off</Badge> : null}
                  <Badge>{e.staff_type}</Badge>
                  {canCheckInStaff && e.id !== me!.id && (
                    <Link to={`/staff-checkin?emp=${e.id}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                      <LogIn className="h-3.5 w-3.5" /> Check in
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Field visits ({data.visits.length})</h2>
          {data.visits.length === 0 ? (
            <Empty>No visits logged on this day.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.visits.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <SelfieThumb path={v.selfie_path} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{v.client_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {v.employee?.full_name} · {fmtTime(v.visited_at, tz)}{faceOn && faceFlagged(v.face_match, v.face_required) ? (v.face_match === false ? " · FACE MISMATCH" : " · FACE NOT CHECKED") : ""}
                      {v.notes ? ` · ${v.notes}` : ""}
                    </p>
                  </div>
                  <a href={mapsLink(v.latitude, v.longitude)} target="_blank" rel="noreferrer" className="text-brand-600" aria-label="Open in maps">
                    <MapPin className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
