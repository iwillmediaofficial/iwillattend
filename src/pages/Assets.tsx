import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Package, Plus, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Branch, EmployeeLite } from "../lib/types";
import { cleanUpOrphanFiles, expiryState, fmtBytes, type AssetItem, type ExpiryState, type ItemKind } from "../lib/assets";
import { Badge, Button, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { ConditionBadge, ExpiryBadge, ItemDetail, ItemForm } from "../components/assets";
import { fetchAll, fmtDate, todayIn } from "../lib/utils";

interface Row extends AssetItem {
  files: { count: number }[];
  holder: { employee_id: string; returned_on: string | null; employee: { full_name: string } | null }[];
}

const TABS: { id: "" | ItemKind; label: string }[] = [
  { id: "", label: "All" },
  { id: "document", label: "Documents" },
  { id: "asset", label: "Physical assets" },
];

const STATES: { id: "" | ExpiryState; label: string }[] = [
  { id: "", label: "Any status" },
  { id: "expired", label: "Expired" },
  { id: "soon", label: "Expiring soon" },
  { id: "valid", label: "Valid" },
  { id: "none", label: "No expiry" },
];

/** Company documents and physical assets, for Owner, Admin, HR and Manager. */
export function Assets() {
  const { org } = useAuth();
  const today = todayIn(org!.timezone);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [staff, setStaff] = useState<EmployeeLite[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [storage, setStorage] = useState<{ used_bytes: number; quota_mb: number } | null>(null);
  const [tab, setTab] = useState<"" | ItemKind>("");
  const [state, setState] = useState<"" | ExpiryState>("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ kind: ItemKind; item?: AssetItem } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [items, s] = await Promise.all([
      fetchAll<Row>(() =>
        supabase
          .from("asset_items")
          .select("*, files:asset_files(count), holder:asset_handovers(employee_id, returned_on, employee:employees!employee_id(full_name))")
          .is("files.replaced_at", null)
          .is("holder.returned_on", null)
          .order("name")
          .order("id"),
      ),
      supabase.rpc("doc_storage"),
    ]);
    setRows(items);
    setStorage((s.data as { used_bytes: number; quota_mb: number } | null) ?? null);
  }, []);

  useEffect(() => {
    void load();
    supabase.from("employees").select("id, full_name, emp_code, staff_type").eq("is_active", true).order("full_name")
      .then(({ data }) => setStaff((data as EmployeeLite[]) ?? []));
    supabase.from("branches").select("*").eq("is_active", true).order("name").then(({ data }) => setBranches((data as Branch[]) ?? []));
    void cleanUpOrphanFiles();
  }, [load]);

  const categories = useMemo(() => [...new Set((rows ?? []).filter((r) => !tab || r.kind === tab).map((r) => r.category))].sort(), [rows, tab]);

  const shown = (rows ?? []).filter((r) => {
    if (tab && r.kind !== tab) return false;
    if (state && expiryState(r, today) !== state) return false;
    if (category && r.category !== category) return false;
    const needle = q.trim().toLowerCase();
    if (needle && ![r.name, r.ref_no, r.brand_model, r.holder[0]?.employee?.full_name].some((v) => v?.toLowerCase().includes(needle))) return false;
    return true;
  });

  const counts = {
    expired: (rows ?? []).filter((r) => expiryState(r, today) === "expired").length,
    soon: (rows ?? []).filter((r) => expiryState(r, today) === "soon").length,
  };
  const open = rows?.find((r) => r.id === openId) ?? null;
  const usedPct = storage && storage.quota_mb > 0 ? Math.min(100, (storage.used_bytes / (storage.quota_mb * 1048576)) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Assets & documents"
        subtitle="Certificates, licences, vehicle papers and company property, with expiry reminders"
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setForm({ kind: "asset" })}><Package className="h-4 w-4" /> Add asset</Button>
            <Button onClick={() => setForm({ kind: "document" })}><Plus className="h-4 w-4" /> Add document</Button>
          </div>
        }
      />

      {(counts.expired > 0 || counts.soon > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {counts.expired > 0 && (
            <button onClick={() => setState("expired")} className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100">
              {counts.expired} expired
            </button>
          )}
          {counts.soon > 0 && (
            <button onClick={() => setState("soon")} className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">
              {counts.soon} expiring soon
            </button>
          )}
        </div>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-1" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setCategory(""); }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-white text-brand-700 shadow-sm" : "text-slate-600"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <select aria-label="Status" value={state} onChange={(e) => setState(e.target.value as ExpiryState | "")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="search" aria-label="Search" placeholder="Search name, number or person" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
          </label>
        </div>
      </Card>

      <Card>
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>Nothing added yet. Add your first document, such as the company registration certificate or a vehicle RC book.</Empty>
        ) : shown.length === 0 ? (
          <Empty>No items match these filters.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => {
              const holder = r.holder[0]?.employee?.full_name;
              return (
                <li key={r.id}>
                  <button onClick={() => setOpenId(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${r.kind === "document" ? "bg-brand-50 text-brand-700" : "bg-navy-50 text-navy-900"}`}>
                      {r.kind === "document" ? <FileText className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {r.category}{r.ref_no ? ` · ${r.ref_no}` : ""}{r.expiry_date ? ` · expires ${fmtDate(r.expiry_date)}` : ""} · {r.files[0]?.count ?? 0} file{r.files[0]?.count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      <ExpiryBadge item={r} today={today} />
                      {r.kind === "asset" && r.condition !== "good" && <ConditionBadge condition={r.condition} />}
                      {r.kind === "asset" && (holder ? <Badge tone="indigo">With {holder}</Badge> : r.condition !== "lost" && r.condition !== "retired" && <Badge>In stock</Badge>)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {storage && (
        <div className="mt-4 max-w-sm text-xs text-slate-500">
          <div className="mb-1 flex justify-between"><span>File storage</span><span>{fmtBytes(storage.used_bytes)} of {storage.quota_mb >= 1024 ? `${storage.quota_mb / 1024} GB` : `${storage.quota_mb} MB`}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100} aria-label="File storage used">
            <div className={`h-full ${usedPct > 90 ? "bg-rose-500" : "bg-brand-500"}`} style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      )}

      {form && (
        <ItemForm
          kind={form.kind}
          item={form.item}
          branches={branches}
          usedCategories={(rows ?? []).filter((r) => r.kind === form.kind).map((r) => r.category)}
          onClose={() => setForm(null)}
          onSaved={async (id) => { setForm(null); await load(); setOpenId(id); }}
        />
      )}
      {open && !form && (
        <ItemDetail
          key={open.id + open.updated_at}
          item={open}
          staff={staff}
          branches={branches}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onEdit={() => setForm({ kind: open.kind, item: open })}
        />
      )}
    </>
  );
}
