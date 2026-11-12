import { supabase } from "./supabase";

/** Today's date (YYYY-MM-DD) in the organisation's timezone. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export function fmtDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", weekday: "short" })
    .format(new Date(date + "T00:00:00Z"));
}

export function hoursBetween(a: string, b: string | null): number | null {
  if (!b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

export function fmtHours(h: number | null): string {
  if (h == null) return "—";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtDistance(m: number | null | undefined): string {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device does not support location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Allow location for this site and try again."
              : err.code === err.TIMEOUT
                ? "Could not get your location in time. Move to an open area and try again."
                : "Your location is unavailable right now.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Upload a selfie into the caller's own folder and return its storage path. */
export async function uploadSelfie(orgId: string, employeeId: string, kind: "in" | "out" | "visit", blob: Blob): Promise<string> {
  const path = `${orgId}/${employeeId}/${new Date().toISOString().slice(0, 10)}-${kind}-${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("selfies").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("Selfie upload failed: " + error.message);
  return path;
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Quote always; prefix formula-like cells so spreadsheets treat them as text.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Something went wrong";
}

interface Page<T> { data: T[] | null; error: { message: string } | null }

/**
 * Reads every row of a query. Supabase returns at most 1,000 rows per request,
 * so this keeps asking for the next page. The query must have a stable order.
 */
export async function fetchAll<T>(make: () => { range: (from: number, to: number) => PromiseLike<Page<T>> }): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await make().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}
