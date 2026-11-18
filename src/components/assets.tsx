import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, Eye, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Branch, EmployeeLite } from "../lib/types";
import {
  ASSET_CATEGORIES, CONDITION_LABEL, DOC_CATEGORIES, deleteItem, deleteStoredFile, expiryState, expiryText, fileProblem, fmtBytes,
  openStoredFile, uploadItemFile,
  type AssetAssignment, type AssetFile, type AssetHandover, type AssetItem, type Condition, type ItemKind,
} from "../lib/assets";
import { Link } from "react-router-dom";
import { Badge, Button, Card, ErrorText, Field, Input, Modal, Select, Spinner } from "./ui";
import { addDays, errMsg, fmtDate, todayIn } from "../lib/utils";

const textareaCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function ExpiryBadge({ item, today }: { item: Pick<AssetItem, "expiry_date" | "remind_days">; today: string }) {
  const s = expiryState(item, today);
  if (s === "none") return null;
  const tone = s === "expired" ? "red" : s === "soon" ? "amber" : "green";
  return <Badge tone={tone}>{expiryText(item, today)}</Badge>;
}

export function ConditionBadge({ condition }: { condition: Condition | null }) {
  if (!condition) return null;
  const tone = condition === "good" ? "green" : condition === "needs_repair" ? "amber" : condition === "retired" ? "slate" : "red";
  return <Badge tone={tone}>{CONDITION_LABEL[condition]}</Badge>;
}

/** List of an item's files with view and download buttons (and remove, for managers). */
export function FileList({ files, onRemove }: { files: AssetFile[]; onRemove?: (f: AssetFile) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const act = async (f: AssetFile, download: boolean) => {
    setBusy(f.id);
    setError("");
    try {
      await openStoredFile(f, download);
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy("");
  };
  if (files.length === 0) return <p className="text-sm text-slate-500">No files attached.</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            {f.mime === "application/pdf" ? <FileText className="h-4 w-4 shrink-0 text-rose-600" /> : <ImageIcon className="h-4 w-4 shrink-0 text-brand-600" />}
            <span className="min-w-0 flex-1 truncate" title={f.file_name}>{f.file_name}</span>
            <span className="shrink-0 text-xs text-slate-500">{fmtBytes(f.size_bytes)}</span>
            <button type="button" onClick={() => act(f, false)} disabled={!!busy} aria-label={`View ${f.file_name}`} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Eye className="h-4 w-4" /></button>
            <button type="button" onClick={() => act(f, true)} disabled={!!busy} aria-label={`Download ${f.file_name}`} className="rounded p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Download className="h-4 w-4" /></button>
            {onRemove && (
              <button type="button" onClick={() => onRemove(f)} disabled={!!busy} aria-label={`Remove ${f.file_name}`} className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** File chooser that checks type and the 10 MB limit before anything is uploaded. */
function FilePicker({ files, setFiles, max }: { files: File[]; setFiles: (f: File[]) => void; max: number }) {
  const [problem, setProblem] = useState("");
  const add = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list];
    const bad = picked.map(fileProblem).find(Boolean);
    const ok = picked.filter((f) => !fileProblem(f));
    const next = [...files, ...ok].slice(0, max);
    setProblem(bad ?? (files.length + ok.length > max ? `You can add at most ${max} file${max === 1 ? "" : "s"} here.` : ""));
    setFiles(next);
  };
  return (
    <div>
      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:bg-slate-50 ${files.length >= max ? "pointer-events-none opacity-50" : ""}`}>
        <Upload className="h-4 w-4" /> Choose files (PDF, JPG or PNG, up to 10 MB each)
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-slate-500">{fmtBytes(f.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:underline">Remove</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="mt-1 text-xs text-rose-600">{problem}</p>}
      <p className="mt-1 text-xs text-slate-500">Large photos are made smaller before upload, so they go faster on mobile data.</p>
    </div>
  );
}

async function uploadAll(orgId: string, itemId: string, files: File[], onProgress: (text: string) => void) {
  for (let i = 0; i < files.length; i++) {
    onProgress(`Uploading file ${i + 1} of ${files.length}…`);
    await uploadItemFile(orgId, itemId, files[i]);
  }
}

// ---------------- Add / edit ----------------

const NEW_CATEGORY = "__new__";

export function ItemForm({ kind, item, branches, usedCategories = [], onClose, onSaved }: {
  kind: ItemKind;
  item?: AssetItem;
  branches: Branch[];
  /** Categories this company already uses, so ones it added itself stay in the list. */
  usedCategories?: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { org } = useAuth();
  const isDoc = kind === "document";
  const base = isDoc ? DOC_CATEGORIES : ASSET_CATEGORIES;
  const cats = [...base, ...[...new Set([...usedCategories, ...(item ? [item.category] : [])])].filter((c) => !base.includes(c)).sort()];
  const [newCategory, setNewCategory] = useState("");
  const [f, setF] = useState({
    category: item?.category ?? cats[0],
    name: item?.name ?? "",
    ref_no: item?.ref_no ?? "",
    issued_by: item?.issued_by ?? "",
    brand_model: item?.brand_model ?? "",
    issue_date: item?.issue_date ?? "",
    expiry_date: item?.expiry_date ?? "",
    remind_days: String(item?.remind_days ?? 30),
    purchase_cost: item?.purchase_cost != null ? String(item.purchase_cost) : "",
    condition: (item?.condition ?? "good") as Condition,
    branch_id: item?.branch_id ?? "",
    notes: item?.notes ?? "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.issue_date && f.expiry_date && f.expiry_date < f.issue_date) return setError("The expiry date cannot be before the issue date.");
    const typed = newCategory.trim().replace(/s+/g, " ");
    if (f.category === NEW_CATEGORY && (typed.length < 2 || typed.length > 60)) return setError("Type a category name of 2 to 60 characters.");
    // Reuse an existing category when the typed name only differs in capitals.
    const category = f.category === NEW_CATEGORY ? cats.find((c) => c.toLowerCase() === typed.toLowerCase()) ?? typed : f.category;
    setBusy("Saving…");
    setError("");
    const row = {
      org_id: org!.id,
      kind,
      category,
      name: f.name.trim(),
      ref_no: f.ref_no.trim() || null,
      issued_by: isDoc ? f.issued_by.trim() || null : null,
      brand_model: isDoc ? null : f.brand_model.trim() || null,
      issue_date: f.issue_date || null,
      expiry_date: f.expiry_date || null,
      remind_days: Number(f.remind_days) || 30,
      purchase_cost: isDoc || f.purchase_cost === "" ? null : Number(f.purchase_cost),
      condition: isDoc ? null : f.condition,
      branch_id: f.branch_id || null,
      notes: f.notes.trim() || null,
    };
    try {
      let id = item?.id;
      if (id) {
        const { error } = await supabase.from("asset_items").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("asset_items").insert(row).select("id").single();
        if (error) throw error;
        id = data.id as string;
      }
      try {
        await uploadAll(org!.id, id, files, setBusy);
      } catch (e) {
        // The item is saved; say which file failed and open it so the rest can be retried.
        window.alert(`${isDoc ? "The document" : "The asset"} was saved, but ${errMsg(e)}`);
      }
      onSaved(id);
    } catch (e) {
      setError(errMsg(e));
      setBusy("");
    }
  };

  return (
    <Modal title={`${item ? "Edit" : "Add"} ${isDoc ? "document" : "asset"}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={f.category} onChange={set("category")}>
            {cats.map((c) => <option key={c}>{c}</option>)}
            <option value={NEW_CATEGORY}>+ Add new category…</option>
          </Select>
          <Select label="Branch (optional)" value={f.branch_id} onChange={set("branch_id")}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        {f.category === NEW_CATEGORY && (
          <Input label="New category name" required minLength={2} maxLength={60} autoFocus placeholder={isDoc ? "e.g. Fire safety" : "e.g. Air conditioners"} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} hint="It is added to this list for your company." />
        )}
        <Input label={isDoc ? "Document name" : "Asset name"} required minLength={2} maxLength={120} placeholder={isDoc ? "e.g. RC book – KL 07 AB 1234" : "e.g. Dell laptop – Accounts"} value={f.name} onChange={set("name")} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={isDoc ? "Document number" : "Serial / registration no."} maxLength={80} value={f.ref_no} onChange={set("ref_no")} />
          {isDoc
            ? <Input label="Issued by" maxLength={120} placeholder="e.g. RTO Ernakulam" value={f.issued_by} onChange={set("issued_by")} />
            : <Input label="Brand and model" maxLength={120} value={f.brand_model} onChange={set("brand_model")} />}
          <Input label={isDoc ? "Issue date" : "Purchase date"} type="date" value={f.issue_date} onChange={set("issue_date")} />
          <Input label={isDoc ? "Expiry date" : "Warranty / insurance expiry"} type="date" min={f.issue_date || undefined} value={f.expiry_date} onChange={set("expiry_date")} hint="Leave blank if it never expires." />
          {!isDoc && <Input label="Purchase cost (₹)" type="number" min={0} step="0.01" value={f.purchase_cost} onChange={set("purchase_cost")} />}
          {!isDoc && (
            <Select label="Condition" value={f.condition} onChange={set("condition")}>
              {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </Select>
          )}
          {f.expiry_date && (
            <Select label="Warn me before expiry" value={f.remind_days} onChange={set("remind_days")}>
              {[7, 15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days before</option>)}
            </Select>
          )}
        </div>
        <Field label="Notes (optional)">
          <textarea rows={2} maxLength={1000} value={f.notes} onChange={set("notes")} className={textareaCls} />
        </Field>
        {!item && (
          <Field label="Files (optional, up to 5)">
            <FilePicker files={files} setFiles={setFiles} max={5} />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={!!busy}>{busy || (item ? "Save changes" : `Add ${isDoc ? "document" : "asset"}`)}</Button>
      </form>
    </Modal>
  );
}

// ---------------- Detail ----------------

interface Detail {
  files: AssetFile[];
  assignments: AssetAssignment[];
  handovers: AssetHandover[];
}

const EMP = "employee:employees!employee_id(id, full_name, emp_code, staff_type)";

export function ItemDetail({ item, staff, branches, onClose, onChanged, onEdit }: {
  item: AssetItem;
  staff: EmployeeLite[];
  branches: Branch[];
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { org } = useAuth();
  const today = todayIn(org!.timezone);
  const isDoc = item.kind === "document";
  const [d, setD] = useState<Detail | null>(null);
  const [mode, setMode] = useState<"" | "renew" | "files" | "handover" | "return">("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [renewExpiry, setRenewExpiry] = useState("");
  const [renewIssue, setRenewIssue] = useState(today);
  const [replaceOld, setReplaceOld] = useState(true);
  const [pick, setPick] = useState("");
  const [ho, setHo] = useState({ employee_id: "", issued_on: today, condition: "good", notes: "" });
  const [ret, setRet] = useState({ returned_on: today, condition: "good", notes: "" });

  const load = useCallback(async () => {
    const [f, a, h] = await Promise.all([
      supabase.from("asset_files").select("*").eq("item_id", item.id).order("created_at"),
      supabase.from("asset_assignments").select(`item_id, employee_id, ${EMP}`).eq("item_id", item.id),
      supabase.from("asset_handovers").select(`*, ${EMP}`).eq("item_id", item.id).order("issued_on", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    setD({
      files: (f.data as AssetFile[]) ?? [],
      assignments: (a.data as unknown as AssetAssignment[]) ?? [],
      handovers: (h.data as unknown as AssetHandover[]) ?? [],
    });
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
      setMode("");
      setFiles([]);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
    setBusy("");
  };

  if (!d) return <Modal title={item.name} onClose={onClose} wide><Spinner /></Modal>;

  const current = d.files.filter((f) => !f.replaced_at);
  const old = d.files.filter((f) => f.replaced_at);
  const open = d.handovers.find((h) => !h.returned_on) ?? null;
  const assignedIds = new Set(d.assignments.map((a) => a.employee_id));
  const unavailable = item.condition === "lost" || item.condition === "retired";
  const branch = branches.find((b) => b.id === item.branch_id)?.name;

  const removeFile = (f: AssetFile) => {
    if (!window.confirm(`Remove "${f.file_name}"? It is deleted permanently.`)) return;
    void run("Removing…", () => deleteStoredFile(f.path));
  };

  const renew = () => run("Saving renewal…", async () => {
    if (!renewExpiry) throw new Error("Enter the new expiry date.");
    if (renewIssue && renewExpiry < renewIssue) throw new Error("The new expiry date cannot be before the issue date.");
    if (replaceOld && current.length > 0) {
      const { error } = await supabase.from("asset_files").update({ replaced_at: new Date().toISOString() }).eq("item_id", item.id).is("replaced_at", null);
      if (error) throw error;
    }
    const { error } = await supabase.from("asset_items").update({ expiry_date: renewExpiry, issue_date: renewIssue || item.issue_date }).eq("id", item.id);
    if (error) throw error;
    await uploadAll(org!.id, item.id, files, setBusy);
  });

  const remove = () => {
    if (!window.confirm(`Delete "${item.name}" and all ${d.files.length} file${d.files.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBusy("Deleting…");
    setError("");
    deleteItem(item.id).then(() => { onChanged(); onClose(); }, (e) => { setError(errMsg(e)); setBusy(""); });
  };

  const facts: [string, string | null][] = isDoc
    ? [["Category", item.category], ["Document number", item.ref_no], ["Issued by", item.issued_by], ["Issue date", item.issue_date && fmtDate(item.issue_date)], ["Expiry date", item.expiry_date && fmtDate(item.expiry_date)], ["Branch", branch ?? "All branches"]]
    : [["Category", item.category], ["Serial / registration no.", item.ref_no], ["Brand and model", item.brand_model], ["Purchase date", item.issue_date && fmtDate(item.issue_date)], ["Purchase cost", item.purchase_cost != null ? `₹${Number(item.purchase_cost).toLocaleString("en-IN")}` : null], ["Warranty / insurance expiry", item.expiry_date && fmtDate(item.expiry_date)], ["Branch", branch ?? "All branches"]];

  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="indigo">{isDoc ? "Document" : "Asset"}</Badge>
          <ExpiryBadge item={item} today={today} />
          {!isDoc && <ConditionBadge condition={item.condition} />}
          {!isDoc && (open ? <Badge tone="amber">With {open.employee?.full_name ?? "staff"}</Badge> : !unavailable && <Badge>In stock</Badge>)}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
        {item.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{item.notes}</p>}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onEdit} disabled={!!busy}>Edit details</Button>
          {item.expiry_date && <Button variant="outline" onClick={() => { setMode("renew"); setRenewExpiry(""); setRenewIssue(today); setFiles([]); }} disabled={!!busy}>Renew</Button>}
          <Button variant="outline" onClick={() => { setMode("files"); setFiles([]); }} disabled={!!busy || current.length >= 5}>Add files</Button>
          <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={remove} disabled={!!busy}>Delete</Button>
        </div>

        {mode === "renew" && (
          <section className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
            <h3 className="text-sm font-semibold">Renew</h3>
            <div className="grid grid-cols-2 gap-3">
              <Input label="New issue date" type="date" value={renewIssue} onChange={(e) => setRenewIssue(e.target.value)} />
              <Input label="New expiry date" type="date" required min={renewIssue || undefined} value={renewExpiry} onChange={(e) => setRenewExpiry(e.target.value)} />
            </div>
            <FilePicker files={files} setFiles={setFiles} max={5} />
            {current.length > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={replaceOld} onChange={(e) => setReplaceOld(e.target.checked)} />
                <span>Move the current {current.length} file{current.length === 1 ? "" : "s"} to history (kept, but no longer shown to staff)</span>
              </label>
            )}
            <div className="flex gap-2">
              <Button onClick={renew} loading={!!busy}>{busy || "Save renewal"}</Button>
              <Button variant="ghost" onClick={() => setMode("")} disabled={!!busy}>Cancel</Button>
            </div>
          </section>
        )}

        {mode === "files" && (
          <section className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
            <h3 className="text-sm font-semibold">Add files</h3>
            <FilePicker files={files} setFiles={setFiles} max={5 - current.length} />
            <div className="flex gap-2">
              <Button onClick={() => run("Uploading…", () => uploadAll(org!.id, item.id, files, setBusy))} disabled={files.length === 0} loading={!!busy}>{busy || "Upload"}</Button>
              <Button variant="ghost" onClick={() => setMode("")} disabled={!!busy}>Cancel</Button>
            </div>
          </section>
        )}

        <ErrorText>{error}</ErrorText>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Files ({current.length} of 5)</h3>
          <FileList files={current} onRemove={removeFile} />
          {old.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Earlier versions ({old.length})</summary>
              <div className="mt-2"><FileList files={old} onRemove={removeFile} /></div>
            </details>
          )}
        </section>

        {isDoc ? (
          <section>
            <h3 className="text-sm font-semibold">Staff who can see this document</h3>
            <p className="mb-2 text-xs text-slate-500">They find it under "My items" on their phone. Owners, admins, HR and managers always see every item.</p>
            {d.assignments.length === 0 ? (
              <p className="text-sm text-slate-500">Not shared with any staff yet.</p>
            ) : (
              <ul className="mb-2 flex flex-wrap gap-2">
                {d.assignments.map((a) => (
                  <li key={a.employee_id} className="flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-sm">
                    {a.employee?.full_name ?? "Employee"}
                    <button type="button" aria-label={`Stop sharing with ${a.employee?.full_name ?? "employee"}`} disabled={!!busy}
                      onClick={() => run("Saving…", async () => { const { error } = await supabase.from("asset_assignments").delete().eq("item_id", item.id).eq("employee_id", a.employee_id); if (error) throw error; })}
                      className="rounded-full p-1 text-slate-500 hover:bg-slate-200"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <select aria-label="Employee to share with" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">Choose an employee…</option>
                {staff.filter((s) => !assignedIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <Button variant="outline" disabled={!pick || !!busy}
                onClick={() => run("Saving…", async () => { const { error } = await supabase.from("asset_assignments").insert({ item_id: item.id, employee_id: pick, org_id: org!.id }); if (error) throw error; setPick(""); })}>Share</Button>
            </div>
          </section>
        ) : (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Handover</h3>
            {open ? (
              <div className="rounded-lg border border-slate-200 p-3 text-sm">
                <p><b>{open.employee?.full_name}</b> has had it since {fmtDate(open.issued_on)} ({CONDITION_LABEL[open.issued_condition].toLowerCase()} condition).</p>
                {open.issue_notes && <p className="mt-1 text-slate-600">{open.issue_notes}</p>}
                {mode === "return" ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Returned on" type="date" min={open.issued_on} max={today} value={ret.returned_on} onChange={(e) => setRet({ ...ret, returned_on: e.target.value })} />
                      <Select label="Condition on return" value={ret.condition} onChange={(e) => setRet({ ...ret, condition: e.target.value })}>
                        {(["good", "needs_repair", "damaged", "lost"] as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                      </Select>
                    </div>
                    <Input label="Notes (optional)" maxLength={500} value={ret.notes} onChange={(e) => setRet({ ...ret, notes: e.target.value })} />
                    <div className="flex gap-2">
                      <Button loading={!!busy} onClick={() => run("Saving…", async () => {
                        const { error } = await supabase.from("asset_handovers").update({ returned_on: ret.returned_on, returned_condition: ret.condition, return_notes: ret.notes.trim() || null }).eq("id", open.id);
                        if (error) throw error;
                      })}>Record return</Button>
                      <Button variant="ghost" onClick={() => setMode("")} disabled={!!busy}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" className="mt-3" onClick={() => { setMode("return"); setRet({ returned_on: today, condition: "good", notes: "" }); }}>Record return</Button>
                )}
              </div>
            ) : unavailable ? (
              <p className="text-sm text-slate-500">This asset is {CONDITION_LABEL[item.condition!].toLowerCase()}, so it cannot be handed over.</p>
            ) : mode === "handover" ? (
              <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Give to" value={ho.employee_id} onChange={(e) => setHo({ ...ho, employee_id: e.target.value })}>
                    <option value="">Choose an employee…</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </Select>
                  <Input label="Handed over on" type="date" max={today} value={ho.issued_on} onChange={(e) => setHo({ ...ho, issued_on: e.target.value })} />
                  <Select label="Condition" value={ho.condition} onChange={(e) => setHo({ ...ho, condition: e.target.value })}>
                    {(["good", "needs_repair", "damaged"] as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                  </Select>
                  <Input label="Notes (optional)" maxLength={500} value={ho.notes} onChange={(e) => setHo({ ...ho, notes: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <Button disabled={!ho.employee_id} loading={!!busy} onClick={() => run("Saving…", async () => {
                    const { error } = await supabase.from("asset_handovers").insert({ org_id: org!.id, item_id: item.id, employee_id: ho.employee_id, issued_on: ho.issued_on, issued_condition: ho.condition, issue_notes: ho.notes.trim() || null });
                    if (error) throw error;
                  })}>Hand over</Button>
                  <Button variant="ghost" onClick={() => setMode("")} disabled={!!busy}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <span>In stock. Not with anyone.</span>
                <Button variant="outline" onClick={() => { setMode("handover"); setHo({ employee_id: "", issued_on: today, condition: item.condition === "needs_repair" || item.condition === "damaged" ? item.condition : "good", notes: "" }); }}>Hand over</Button>
              </div>
            )}
            {d.handovers.filter((h) => h.returned_on).length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">Handover history</summary>
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                  {d.handovers.filter((h) => h.returned_on).map((h) => (
                    <li key={h.id} className="px-3 py-2">
                      <b>{h.employee?.full_name ?? "Employee"}</b>: {fmtDate(h.issued_on)} to {fmtDate(h.returned_on!)}
                      <span className="text-slate-500"> · returned {CONDITION_LABEL[h.returned_condition!].toLowerCase()}</span>
                      {h.return_notes && <span className="block text-xs text-slate-500">{h.return_notes}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

/** Dashboard card: items that expired or expire within their warning period. */
export function ExpiringCard() {
  const { org } = useAuth();
  const today = todayIn(org!.timezone);
  const [items, setItems] = useState<AssetItem[] | null>(null);
  useEffect(() => {
    supabase.from("asset_items").select("*").not("expiry_date", "is", null).lte("expiry_date", addDays(today, 365)).order("expiry_date")
      .then(({ data }) => setItems(((data as AssetItem[]) ?? []).filter((i) => expiryState(i, today) === "expired" || expiryState(i, today) === "soon")));
  }, [today]);
  if (!items || items.length === 0) return null;
  return (
    <Card className="mb-5">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold">Documents and assets needing renewal ({items.length})</h2>
        <Link to="/assets" className="text-sm font-medium text-brand-600 hover:underline">Open Assets</Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.slice(0, 6).map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{i.name}<span className="text-slate-500"> · {i.category}</span></span>
            <span className="shrink-0 text-xs text-slate-500">{fmtDate(i.expiry_date!)}</span>
            <ExpiryBadge item={i} today={today} />
          </li>
        ))}
      </ul>
      {items.length > 6 && <p className="px-4 py-2 text-xs text-slate-500">and {items.length - 6} more</p>}
    </Card>
  );
}
