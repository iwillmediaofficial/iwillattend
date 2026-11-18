// Assets & documents: shared types, expiry status and file handling.
import { supabase } from "./supabase";
import { MEDIA_URL, accessToken, addDays, mediaError } from "./utils";
import type { EmployeeLite } from "./types";

export type ItemKind = "document" | "asset";
export type Condition = "good" | "needs_repair" | "damaged" | "lost" | "retired";

export interface AssetItem {
  id: string;
  org_id: string;
  kind: ItemKind;
  category: string;
  name: string;
  ref_no: string | null;
  issued_by: string | null;
  brand_model: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  remind_days: number;
  purchase_cost: number | null;
  condition: Condition | null;
  branch_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetFile {
  id: string;
  item_id: string;
  path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  replaced_at: string | null;
  created_at: string;
}

export interface AssetAssignment {
  item_id: string;
  employee_id: string;
  employee?: EmployeeLite | null;
}

export interface AssetHandover {
  id: string;
  item_id: string;
  employee_id: string;
  issued_on: string;
  issued_condition: Exclude<Condition, "lost" | "retired">;
  issue_notes: string | null;
  returned_on: string | null;
  returned_condition: Exclude<Condition, "retired"> | null;
  return_notes: string | null;
  employee?: EmployeeLite | null;
}

export const DOC_CATEGORIES = [
  "Company registration",
  "Tax and GST",
  "Licence and permit",
  "Vehicle document",
  "Insurance",
  "Contract and agreement",
  "Other document",
];

export const ASSET_CATEGORIES = [
  "Vehicle",
  "Laptop and computer",
  "Mobile phone",
  "Tools and equipment",
  "Furniture",
  "Other asset",
];

export const CONDITION_LABEL: Record<Condition, string> = {
  good: "Good",
  needs_repair: "Needs repair",
  damaged: "Damaged",
  lost: "Lost",
  retired: "Retired",
};

export type ExpiryState = "valid" | "soon" | "expired" | "none";

/** Expiry status of an item on a given day. */
export function expiryState(item: Pick<AssetItem, "expiry_date" | "remind_days">, today: string): ExpiryState {
  if (!item.expiry_date) return "none";
  if (item.expiry_date < today) return "expired";
  if (item.expiry_date <= addDays(today, item.remind_days)) return "soon";
  return "valid";
}

export function daysLeft(expiry: string, today: string): number {
  return Math.round((Date.parse(expiry) - Date.parse(today)) / 86_400_000);
}

export function expiryText(item: Pick<AssetItem, "expiry_date" | "remind_days">, today: string): string {
  const s = expiryState(item, today);
  if (s === "none") return "No expiry";
  const d = daysLeft(item.expiry_date!, today);
  if (s === "expired") return d === -1 ? "Expired yesterday" : `Expired ${-d} days ago`;
  if (d === 0) return "Expires today";
  return s === "soon" ? `Expires in ${d} day${d === 1 ? "" : "s"}` : "Valid";
}

export const fmtBytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

// ---------------- Files ----------------

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, { ext: "pdf" | "jpg" | "png"; mime: string }> = {
  "application/pdf": { ext: "pdf", mime: "application/pdf" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/png": { ext: "png", mime: "image/png" },
};

/** Why a chosen file cannot be uploaded, or null when it can. */
export function fileProblem(f: File): string | null {
  if (!TYPES[f.type]) return `"${f.name}" is not a PDF, JPG or PNG file.`;
  if (f.size > MAX_FILE_BYTES) return `"${f.name}" is ${fmtBytes(f.size)}. The limit is 10 MB per file.`;
  if (f.size === 0) return `"${f.name}" is empty.`;
  return null;
}

/** Large phone photos are shrunk to at most 2000 px and saved as JPEG, usually under 1 MB. */
async function shrinkPhoto(f: File): Promise<{ blob: Blob; mime: string }> {
  if (f.type === "application/pdf" || f.size < 1024 * 1024) return { blob: f, mime: f.type };
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // PNG transparency becomes white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    return blob && blob.size < f.size ? { blob, mime: "image/jpeg" } : { blob: f, mime: f.type };
  } catch {
    return { blob: f, mime: f.type };
  }
}

/** Uploads one file for an item and records it. */
export async function uploadItemFile(orgId: string, itemId: string, f: File): Promise<void> {
  if (!MEDIA_URL) throw new Error("File storage is not set up for this site.");
  const problem = fileProblem(f);
  if (problem) throw new Error(problem);
  const { blob, mime } = await shrinkPhoto(f);
  const path = `docs/${orgId}/${itemId}/${crypto.randomUUID()}.${TYPES[mime].ext}`;
  const res = await fetch(`${MEDIA_URL}/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": mime },
    body: blob,
  }).catch(() => null);
  if (!res) throw new Error(`"${f.name}" could not be uploaded: no connection. Check your internet and try again.`);
  if (!res.ok) throw new Error(`"${f.name}" could not be uploaded: ${await mediaError(res)}`);
  const name = mime === f.type ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg";
  const { error } = await supabase.from("asset_files").insert({ org_id: orgId, item_id: itemId, path, file_name: name.slice(0, 160), mime, size_bytes: blob.size });
  if (error) {
    await deleteStoredFile(path).catch(() => undefined);
    throw new Error(`"${f.name}" could not be saved: ${error.message}`);
  }
}

/** Removes a file from storage; its record goes with it. */
export async function deleteStoredFile(path: string): Promise<void> {
  const res = await fetch(`${MEDIA_URL}/${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${await accessToken()}` } }).catch(() => null);
  if (!res) throw new Error("No connection to the file service. Try again.");
  if (!res.ok && res.status !== 404) throw new Error(await mediaError(res));
}

/** Opens a stored file in a new tab (or downloads it). */
export async function openStoredFile(file: Pick<AssetFile, "path" | "file_name" | "mime">, download = false): Promise<void> {
  // Open the tab first, while the click still counts, so phones do not block it as a pop-up.
  const tab = download ? null : window.open("", "_blank");
  try {
    const res = await fetch(`${MEDIA_URL}/${file.path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!res.ok) throw new Error(await mediaError(res));
    const url = URL.createObjectURL(new Blob([await res.blob()], { type: file.mime }));
    if (tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name;
      a.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Deletes an item and every file it ever had. */
export async function deleteItem(itemId: string): Promise<void> {
  const { data, error } = await supabase.from("asset_files").select("path").eq("item_id", itemId);
  if (error) throw error;
  for (const f of (data as { path: string }[]) ?? []) await deleteStoredFile(f.path);
  const del = await supabase.from("asset_items").delete().eq("id", itemId);
  if (del.error) throw del.error;
}

/** Removes stored files whose item was deleted but whose file removal did not finish. */
export async function cleanUpOrphanFiles(): Promise<void> {
  const { data } = await supabase.rpc("orphan_doc_uploads");
  for (const path of (data as string[] | null) ?? []) await deleteStoredFile(path).catch(() => undefined);
}
