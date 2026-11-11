import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { LocateFixed, Pencil, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Branch } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorText, Input, Modal, PageHeader, Spinner } from "../components/ui";
import { MapView } from "../components/MapView";
import { errMsg, getPosition } from "../lib/utils";

interface Form {
  id?: string;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  is_active: boolean;
}

const blank: Form = { name: "", address: "", latitude: "", longitude: "", radius_m: "150", is_active: true };

export function Branches() {
  const { org } = useAuth();
  const [rows, setRows] = useState<Branch[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("branches").select("*").order("name");
    setRows((data as Branch[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lat = Number(form?.latitude);
  const lng = Number(form?.longitude);
  const hasPoint = !!form && form.latitude !== "" && form.longitude !== "" && Number.isFinite(lat) && Number.isFinite(lng);
  const radius = Number(form?.radius_m) || 150;
  const points = useMemo(
    () => (hasPoint ? [{ lat, lng, label: "Branch location", radius }] : []),
    [hasPoint, lat, lng, radius],
  );

  const useMyLocation = async () => {
    setLocating(true);
    setError("");
    try {
      const p = await getPosition();
      setForm((f) => f && { ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) });
    } catch (e) {
      setError(errMsg(e));
    }
    setLocating(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!hasPoint) {
      setError("Set the branch location: use your current location, click the map, or type the coordinates.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      latitude: lat,
      longitude: lng,
      radius_m: Math.round(radius),
      is_active: form.is_active,
    };
    const res = form.id
      ? await supabase.from("branches").update(payload).eq("id", form.id)
      : await supabase.from("branches").insert({ ...payload, org_id: org!.id });
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setForm(null);
    await load();
  };

  const edit = (b: Branch) => {
    setError("");
    setForm({ id: b.id, name: b.name, address: b.address ?? "", latitude: String(b.latitude), longitude: String(b.longitude), radius_m: String(b.radius_m), is_active: b.is_active });
  };

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle="Office locations and their check-in geofence"
        action={
          <Button onClick={() => { setError(""); setForm(blank); }}>
            <Plus className="h-4 w-4" /> Add branch
          </Button>
        }
      />
      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No branches yet. Add one so office staff can check in.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {b.name} {!b.is_active && <Badge tone="red">Inactive</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {b.address ? `${b.address} · ` : ""}
                    {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)} · {b.radius_m} m radius
                  </p>
                </div>
                <Button variant="ghost" onClick={() => edit(b)} aria-label={`Edit ${b.name}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {form && (
        <Modal title={form.id ? "Edit branch" : "Add branch"} onClose={() => setForm(null)}>
          <form onSubmit={save} className="space-y-4">
            <Input label="Branch name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Address (optional)" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Button type="button" variant="outline" className="w-full" onClick={useMyLocation} loading={locating}>
              <LocateFixed className="h-4 w-4" /> Use my current location
            </Button>
            <MapView points={points} onPick={(la, lo) => setForm((f) => f && { ...f, latitude: la.toFixed(6), longitude: lo.toFixed(6) })} className="h-56" />
            <p className="-mt-2 text-xs text-slate-500">Click the map to place the branch.</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Latitude" inputMode="decimal" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
              <Input label="Longitude" inputMode="decimal" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
            </div>
            <Input label="Geofence radius (metres)" type="number" min={20} max={5000} required hint="Office staff must be inside this distance to check in." value={form.radius_m} onChange={(e) => setForm({ ...form, radius_m: e.target.value })} />
            {form.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active
              </label>
            )}
            <ErrorText>{error}</ErrorText>
            <Button type="submit" className="w-full" loading={busy}>
              Save branch
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
