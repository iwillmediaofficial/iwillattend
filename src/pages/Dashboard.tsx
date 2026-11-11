import { useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AttendanceWithEmployee, Branch, EmployeeLite, VisitWithEmployee } from "../lib/types";
import { Badge, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { MapView, type MapPoint } from "../components/MapView";
import { SelfieThumb } from "../components/SelfieThumb";
import { fmtDistance, fmtHours, fmtTime, hoursBetween, mapsLink, todayIn } from "../lib/utils";

interface Data {
  employees: EmployeeLite[];
  attendance: AttendanceWithEmployee[];
  visits: VisitWithEmployee[];
  branches: Branch[];
}

const EMP = "employee:employees(id, full_name, emp_code, staff_type)";

export function Dashboard() {
  const { org } = useAuth();
  const tz = org!.timezone;
  const [date, setDate] = useState(todayIn(tz));
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    Promise.all([
      supabase.from("employees").select("id, full_name, emp_code, staff_type").eq("is_active", true).order("full_name"),
      supabase.from("attendance").select(`*, ${EMP}`).eq("work_date", date).order("check_in_at"),
      supabase.from("visits").select(`*, ${EMP}`).eq("work_date", date).order("visited_at"),
      supabase.from("branches").select("*").eq("is_active", true),
    ]).then(([e, a, v, b]) => {
      if (!alive) return;
      setData({
        employees: (e.data as EmployeeLite[]) ?? [],
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
      ...data.branches.map((b) => ({ lat: b.latitude, lng: b.longitude, label: `Branch: ${b.name}`, color: "#64748b", radius: b.radius_m })),
      ...data.attendance.map((a) => ({
        lat: a.check_in_lat,
        lng: a.check_in_lng,
        label: `${a.employee?.full_name ?? "Employee"} · in ${fmtTime(a.check_in_at, tz)}`,
        color: "#059669",
      })),
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
  const stats = [
    { label: "Active staff", value: data.employees.length, cls: "text-slate-900" },
    { label: "Checked in", value: data.attendance.length, cls: "text-emerald-600" },
    { label: "Not checked in", value: absent.length, cls: "text-rose-600" },
    { label: "Checked out", value: data.attendance.filter((a) => a.check_out_at).length, cls: "text-indigo-600" },
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

      <div className="mb-5">
        <MapView points={points} className="h-80" />
        <p className="mt-1 text-xs text-slate-500">Green: check-ins · Orange: field visits · Grey circle: branch geofence</p>
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
                    <td className="px-4 py-2">{fmtTime(a.check_in_at, tz)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {a.check_out_selfie_path && <SelfieThumb path={a.check_out_selfie_path} size={28} />}
                        {fmtTime(a.check_out_at, tz)}
                      </div>
                    </td>
                    <td className="px-4 py-2">{fmtHours(hoursBetween(a.check_in_at, a.check_out_at))}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {a.check_in_in_geofence == null ? (
                          <Badge>Field</Badge>
                        ) : a.check_in_in_geofence ? (
                          <Badge tone="green">In zone · {fmtDistance(a.check_in_distance_m)}</Badge>
                        ) : (
                          <Badge tone="amber">Outside · {fmtDistance(a.check_in_distance_m)}</Badge>
                        )}
                        <a href={mapsLink(a.check_in_lat, a.check_in_lng)} target="_blank" rel="noreferrer" className="text-indigo-600" aria-label="Open in maps">
                          <MapPin className="h-4 w-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Not checked in ({absent.length})</h2>
          {absent.length === 0 ? (
            <Empty>Everyone has checked in.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {absent.map((e) => (
                <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{e.full_name}</span>
                  <Badge>{e.staff_type}</Badge>
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
                      {v.employee?.full_name} · {fmtTime(v.visited_at, tz)}
                      {v.notes ? ` · ${v.notes}` : ""}
                    </p>
                  </div>
                  <a href={mapsLink(v.latitude, v.longitude)} target="_blank" rel="noreferrer" className="text-indigo-600" aria-label="Open in maps">
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
