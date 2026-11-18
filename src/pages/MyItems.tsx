import { useEffect, useState } from "react";
import { FileText, Package } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { CONDITION_LABEL, type AssetFile, type AssetItem } from "../lib/assets";
import { Badge, Card, Empty, PageHeader, Spinner } from "../components/ui";
import { ExpiryBadge, FileList } from "../components/assets";
import { fmtDate, todayIn } from "../lib/utils";

interface Mine extends AssetItem {
  files: AssetFile[];
  since?: string;
}

/** Documents shared with me and company assets I currently hold. Read only. */
export function MyItems() {
  const { employee, org } = useAuth();
  const today = todayIn(org!.timezone);
  const [items, setItems] = useState<Mine[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, h] = await Promise.all([
        supabase.from("asset_assignments").select("item_id").eq("employee_id", employee!.id),
        supabase.from("asset_handovers").select("item_id, issued_on").eq("employee_id", employee!.id).is("returned_on", null),
      ]);
      const held = new Map(((h.data as { item_id: string; issued_on: string }[]) ?? []).map((x) => [x.item_id, x.issued_on]));
      const ids = [...new Set([...((a.data as { item_id: string }[]) ?? []).map((x) => x.item_id), ...held.keys()])];
      if (ids.length === 0) {
        if (alive) setItems([]);
        return;
      }
      const { data } = await supabase.from("asset_items").select("*, files:asset_files(*)").in("id", ids).is("files.replaced_at", null).order("name");
      if (alive) setItems(((data as Mine[]) ?? []).map((i) => ({ ...i, since: held.get(i.id) })));
    })();
    return () => {
      alive = false;
    };
  }, [employee]);

  const docs = (items ?? []).filter((i) => i.kind === "document");
  const assets = (items ?? []).filter((i) => i.kind === "asset");

  const section = (title: string, list: Mine[]) =>
    list.length > 0 && (
      <>
        <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-700">{title}</h2>
        <div className="space-y-3">
          {list.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="mb-3 flex items-start gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${i.kind === "document" ? "bg-brand-50 text-brand-700" : "bg-navy-50 text-navy-900"}`}>
                  {i.kind === "document" ? <FileText className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-slate-500">
                    {i.category}{i.ref_no ? ` · ${i.ref_no}` : ""}{i.brand_model ? ` · ${i.brand_model}` : ""}
                    {i.expiry_date ? ` · ${i.kind === "document" ? "valid until" : "warranty until"} ${fmtDate(i.expiry_date)}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <ExpiryBadge item={i} today={today} />
                    {i.since && <Badge tone="indigo">With you since {fmtDate(i.since)}</Badge>}
                    {i.kind === "asset" && i.condition && i.condition !== "good" && <Badge tone="amber">{CONDITION_LABEL[i.condition]}</Badge>}
                  </div>
                </div>
              </div>
              <FileList files={i.files} />
            </Card>
          ))}
        </div>
      </>
    );

  return (
    <>
      <PageHeader title="My items" subtitle="Documents shared with you and company property you hold" />
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card><Empty>Nothing is shared with you yet. Your manager can share documents such as your vehicle's RC book here.</Empty></Card>
      ) : (
        <div className="mx-auto max-w-2xl">
          {section("Documents", docs)}
          {section("Company property with you", assets)}
        </div>
      )}
    </>
  );
}
