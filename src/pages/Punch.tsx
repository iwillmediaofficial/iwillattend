import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, LogIn, LogOut, MapPin } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Attendance } from "../lib/types";
import { Badge, Button, Card, PageHeader, Spinner } from "../components/ui";
import { CaptureFlow, type Capture } from "../components/CaptureFlow";
import { SelfieThumb } from "../components/SelfieThumb";
import { AttendanceStatus } from "../components/badges";
import { fmtDate, fmtDistance, fmtHours, fmtTime, hoursBetween, todayIn, uploadSelfie } from "../lib/utils";

export function Punch() {
  const { employee, org, branch } = useAuth();
  const tz = org!.timezone;
  const today = todayIn(tz);
  const [row, setRow] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"in" | "out" | null>(null);

  const load = useCallback(async () => {
    // Latest record: today's, or an earlier one that was never checked out.
    const { data } = await supabase
      .from("attendance")
      .select("*")
      .eq("employee_id", employee!.id)
      .order("check_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = data as Attendance | null;
    setRow(r && (r.work_date === today || !r.check_out_at) ? r : null);
    setLoading(false);
  }, [employee, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (c: Capture) => {
    const kind = mode!;
    const path = await uploadSelfie(employee!.org_id, employee!.id, kind, c.blob);
    const { error } = await supabase.rpc(kind === "in" ? "check_in" : "check_out", {
      p_lat: c.lat,
      p_lng: c.lng,
      p_accuracy: c.accuracy,
      p_selfie_path: path,
    });
    if (error) throw error;
    await load();
    setMode(null);
  };

  if (loading) return <Spinner />;

  const isOffice = employee!.staff_type === "office";
  const done = !!row?.check_out_at;
  const openFromEarlier = row && !row.check_out_at && row.work_date !== today;

  return (
    <>
      <PageHeader title={`Hello, ${employee!.full_name.split(" ")[0]}`} subtitle={fmtDate(today)} />

      <Card className="mx-auto max-w-md p-6 text-center">
        <div className="mb-4 flex justify-center gap-2">
          <Badge tone="indigo">{isOffice ? "Office staff" : "Field staff"}</Badge>
          {branch && <Badge>{branch.name}</Badge>}
        </div>

        {!row && (
          <>
            <Clock className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="mb-1 text-lg font-semibold">Not checked in yet</p>
            <p className="mb-5 text-sm text-slate-500">
              {isOffice
                ? branch
                  ? `You must be within ${branch.radius_m} m of ${branch.name}.`
                  : "No branch is assigned to you yet. Ask your admin."
                : "Your current location is captured with your selfie."}
            </p>
            <Button variant="success" className="w-full py-3 text-base" onClick={() => setMode("in")}>
              <LogIn className="h-5 w-5" /> Check in
            </Button>
          </>
        )}

        {row && (
          <>
            <div className="mb-4 flex items-center justify-center gap-3">
              <SelfieThumb path={row.check_in_selfie_path} size={56} />
              {row.check_out_selfie_path && <SelfieThumb path={row.check_out_selfie_path} size={56} />}
            </div>
            <div className="mb-4 flex justify-center"><AttendanceStatus row={row} /></div>
            {openFromEarlier && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">You did not check out on {fmtDate(row.work_date)}. Check out to close it.</p>}
            <dl className="mb-5 grid grid-cols-2 gap-3 text-left text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Check in</dt>
                <dd className="font-semibold">{fmtTime(row.check_in_at, tz)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Check out</dt>
                <dd className="font-semibold">{fmtTime(row.check_out_at, tz)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Worked</dt>
                <dd className="font-semibold">{fmtHours(hoursBetween(row.check_in_at, row.check_out_at ?? new Date().toISOString()))}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <dt className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3" /> From branch
                </dt>
                <dd className="font-semibold">{fmtDistance(row.check_in_distance_m)}</dd>
              </div>
            </dl>
            {done ? (
              <p className="flex items-center justify-center gap-2 font-medium text-emerald-600">
                <CheckCircle2 className="h-5 w-5" /> Day complete
              </p>
            ) : (
              <Button variant="danger" className="w-full py-3 text-base" onClick={() => setMode("out")}>
                <LogOut className="h-5 w-5" /> Check out
              </Button>
            )}
          </>
        )}
      </Card>

      {mode && (
        <CaptureFlow
          title={mode === "in" ? "Check in" : "Check out"}
          confirmLabel={mode === "in" ? "Confirm check-in" : "Confirm check-out"}
          onClose={() => setMode(null)}
          onConfirm={submit}
        />
      )}
    </>
  );
}
