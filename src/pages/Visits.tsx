import { useCallback, useEffect, useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Visit } from "../lib/types";
import { Button, Card, Empty, Field, Input, PageHeader, Spinner } from "../components/ui";
import { CaptureFlow, type Capture } from "../components/CaptureFlow";
import { SelfieThumb } from "../components/SelfieThumb";
import { addDays, fmtDate, fmtTime, mapsLink, todayIn, uploadSelfie } from "../lib/utils";

export function Visits() {
  const { employee, org } = useAuth();
  const faceOn = org!.face_check_enabled && !!employee!.face_enrolled_at;
  const tz = org!.timezone;
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("visits")
      .select("*")
      .eq("employee_id", employee!.id)
      .gte("work_date", addDays(todayIn(tz), -30))
      .order("visited_at", { ascending: false });
    setRows((data as Visit[]) ?? []);
  }, [employee, tz]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (c: Capture) => {
    if (!client.trim()) throw new Error("Enter the client or place name.");
    const path = await uploadSelfie(employee!.org_id, employee!.id, "visit", c.blob);
    const { data, error } = await supabase.rpc("log_visit", {
      p_lat: c.lat,
      p_lng: c.lng,
      p_accuracy: c.accuracy,
      p_selfie_path: path,
      p_client_name: client,
      p_notes: notes,
    });
    if (error) throw error;
    if (c.descriptor) {
      const { data: matched, error: faceError } = await supabase.rpc("record_face", { p_kind: "visit", p_id: (data as Visit).id, p_descriptor: c.descriptor });
      setResult(faceError ? "Visit saved · Face not checked" : matched ? "Visit saved · Face matched" : "Visit saved · Face did not match (flagged to your manager)");
    } else setResult("Visit saved");
    setOpen(false);
    setClient("");
    setNotes("");
    await load();
  };

  return (
    <>
      <PageHeader
        title="Field visits"
        subtitle="Log each client visit with a selfie and your location"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Log visit
          </Button>
        }
      />
      {result && <p role="status" className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${result.endsWith("Face matched") || result === "Visit saved" ? "bg-success-50 text-success-700" : "bg-amber-50 text-amber-800"}`}>{result}</p>}
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No visits logged in the last 30 days.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                <SelfieThumb path={v.selfie_path} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.client_name}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(v.work_date)} · {fmtTime(v.visited_at, tz)}
                  </p>
                  {v.notes && <p className="mt-0.5 text-xs text-slate-600">{v.notes}</p>}
                </div>
                <a href={mapsLink(v.latitude, v.longitude)} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-brand-600 hover:bg-brand-50" aria-label="Open in maps">
                  <MapPin className="h-4 w-4" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {open && (
        <CaptureFlow title="Log a visit" confirmLabel="Save visit" onClose={() => setOpen(false)} onConfirm={submit} face={faceOn}>
          <Input label="Client / place name" required maxLength={160} value={client} onChange={(e) => setClient(e.target.value)} />
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              maxLength={1000}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </Field>
        </CaptureFlow>
      )}
    </>
  );
}
