import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, LogIn, LogOut, MapPin, ScanFace } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Attendance } from "../lib/types";
import { Badge, Button, Card, PageHeader, Spinner } from "../components/ui";
import { CaptureFlow, type Capture } from "../components/CaptureFlow";
import { SelfieThumb } from "../components/SelfieThumb";
import { AttendanceStatus, FaceBadge } from "../components/badges";
import { FaceEnroll } from "../components/FaceEnroll";
import { fmtDate, fmtDistance, fmtHours, fmtTime, hoursBetween, todayIn, uploadSelfie } from "../lib/utils";

export function Punch() {
  const { employee, org, branch, refresh } = useAuth();
  const faceOn = org!.face_check_enabled;
  const enrolled = !!employee!.face_enrolled_at;
  const [enrolling, setEnrolling] = useState(false);
  const tz = org!.timezone;
  const today = todayIn(tz);
  const [row, setRow] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"in" | "out" | null>(null);
  const [missed, setMissed] = useState<string | null>(null);
  const [wfhToday, setWfhToday] = useState(false);
  // Shown after a punch: what was recorded and whether the face matched.
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

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
    // A check-in can be closed for 18 hours. After that it is a missed check-out,
    // fixed by a correction request, and must not block today's check-in.
    const stillOpen = !!r && !r.check_out_at && !r.missing_checkout && Date.now() - Date.parse(r.check_in_at) < 18 * 3_600_000;
    setRow(r && (r.work_date === today || stillOpen) ? r : null);
    setMissed(r && r.work_date !== today && !r.check_out_at && !stillOpen ? r.work_date : null);
    const { data: w } = await supabase.from("wfh_requests").select("id").eq("employee_id", employee!.id).eq("status", "approved").lte("from_date", today).gte("to_date", today).limit(1);
    setWfhToday(!!w?.length);
    setLoading(false);
  }, [employee, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (c: Capture) => {
    const kind = mode!;
    const path = await uploadSelfie(employee!.org_id, employee!.id, kind, c.blob);
    const { data, error } = await supabase.rpc(kind === "in" ? "check_in" : "check_out", {
      p_lat: c.lat,
      p_lng: c.lng,
      p_accuracy: c.accuracy,
      p_selfie_path: path,
    });
    if (error) throw error;
    const saved = data as Attendance;
    let face = "";
    let ok = true;
    if (c.descriptor) {
      // The punch is already saved; a failed comparison only leaves it marked "not checked".
      const { data: matched, error: faceError } = await supabase.rpc("record_face", { p_kind: kind, p_id: saved.id, p_descriptor: c.descriptor });
      face = faceError ? " · Face not checked" : matched ? " · Face matched" : " · Face did not match (flagged to your manager)";
      ok = !faceError && matched === true;
    }
    setResult({ text: `${kind === "in" ? "Checked in" : "Checked out"} at ${fmtTime(kind === "in" ? saved.check_in_at : saved.check_out_at, tz)}${face}`, ok });
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

      {result && (
        <p role="status" className={`mx-auto mb-4 max-w-md rounded-lg px-4 py-3 text-sm font-medium ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{result.text}</p>
      )}

      <Card className="mx-auto max-w-md p-6 text-center">
        <div className="mb-4 flex justify-center gap-2">
          <Badge tone="indigo">{isOffice ? "Office staff" : "Field staff"}</Badge>
          {branch && <Badge>{branch.name}</Badge>}
        </div>

        {!row && (
          <>
            {missed && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
                You did not check out on {fmtDate(missed)}. Open History and request a correction so that day is counted properly.
              </p>
            )}
            <Clock className="mx-auto mb-2 h-10 w-10 text-slate-300" />
            <p className="mb-1 text-lg font-semibold">Not checked in yet</p>
            <p className="mb-5 text-sm text-slate-500">
              {isOffice && wfhToday
                ? "Work from home is approved for today, so you can check in from anywhere."
                : isOffice
                ? branch
                  ? `You must be within ${branch.radius_m} m of ${branch.name}.`
                  : "No branch is assigned to you yet. Ask your admin."
                : "Your current location is captured with your selfie."}
            </p>
            {faceOn && !enrolled ? (
              <>
                <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">Register your face once before your first check-in.</p>
                <Button className="w-full py-3 text-base" onClick={() => setEnrolling(true)}>
                  <ScanFace className="h-5 w-5" /> Register my face
                </Button>
              </>
            ) : (
              <Button variant="success" className="w-full py-3 text-base" onClick={() => setMode("in")}>
                <LogIn className="h-5 w-5" /> Check in
              </Button>
            )}
          </>
        )}

        {row && (
          <>
            <div className="mb-4 flex items-center justify-center gap-3">
              <SelfieThumb path={row.check_in_selfie_path} size={56} />
              {row.check_out_selfie_path && <SelfieThumb path={row.check_out_selfie_path} size={56} />}
            </div>
            <div className="mb-4 flex flex-wrap justify-center gap-1">
              <AttendanceStatus row={row} />
              {faceOn && <FaceBadge match={row.check_in_face_match} required={row.face_required} />}
              {faceOn && row.check_out_at && row.check_out_face_match === false && <FaceBadge match={false} />}
            </div>
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

      {enrolling && <FaceEnroll onClose={() => setEnrolling(false)} onDone={async () => { await refresh(); setEnrolling(false); }} />}

      {mode && (
        <CaptureFlow
          title={mode === "in" ? "Check in" : "Check out"}
          confirmLabel={mode === "in" ? "Confirm check-in" : "Confirm check-out"}
          onClose={() => setMode(null)}
          onConfirm={submit}
          face={faceOn && enrolled}
        />
      )}
    </>
  );
}
