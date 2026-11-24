import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { weekRuleOf, weekStart } from "../lib/muster";
import { addDays, errMsg, fmtDate, todayIn } from "../lib/utils";
import { Card, ErrorText } from "./ui";

const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * "My weekly off": staff on flexible weekly offs pick their day off for this week and the next.
 * The planned day counts as their paid weekly off; otherwise the first day they miss does.
 */
export function WeeklyOffPlanner({ onChange }: { onChange?: (todayPlanned: boolean) => void }) {
  const { employee, org } = useAuth();
  const today = todayIn(org!.timezone);
  const rule = weekRuleOf(employee!, org!);
  const weeks = [weekStart(today), addDays(weekStart(today), 7)];
  const last = addDays(weeks[1], 6);
  const [planned, setPlanned] = useState<Set<string> | null>(null);
  const [worked, setWorked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from("planned_offs").select("off_date").eq("employee_id", employee!.id).gte("off_date", weeks[0]).lte("off_date", last),
      supabase.from("attendance").select("work_date").eq("employee_id", employee!.id).gte("work_date", weeks[0]).lte("work_date", last),
    ]);
    const set = new Set(((p.data as { off_date: string }[]) ?? []).map((x) => x.off_date));
    setPlanned(set);
    setWorked(new Set(((a.data as { work_date: string }[]) ?? []).map((x) => x.work_date)));
    onChange?.(set.has(today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, weeks[0], last, today]);

  useEffect(() => {
    void load();
  }, [load]);

  if (rule.mode !== "flexible") return null;

  const toggle = async (day: string) => {
    if (!planned) return;
    setBusy(day);
    setError("");
    try {
      const on = planned.has(day);
      if (!on && rule.perWeek === 1) {
        // One day a week: choosing another day moves the plan.
        const w = weekStart(day);
        const other = [...planned].find((d) => weekStart(d) === w && d >= today);
        if (other) {
          const { error } = await supabase.rpc("set_planned_off", { p_date: other, p_on: false });
          if (error) throw error;
        }
      }
      const { error } = await supabase.rpc("set_planned_off", { p_date: day, p_on: !on });
      if (error) throw error;
      await load();
    } catch (e) {
      setError(errMsg(e));
      await load();
    }
    setBusy("");
  };

  return (
    <Card className="mx-auto mt-4 max-w-md p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarDays className="h-4 w-4 text-brand-600" /> My weekly off
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        You get {rule.perWeek} day{rule.perWeek === 1 ? "" : "s"} off each week (Monday to Sunday), on any day. Tap a day to plan it so your manager knows. If you don't plan, the first day you don't come counts as your weekly off.
      </p>
      {weeks.map((w, wi) => (
        <div key={w} className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-slate-600">{wi === 0 ? "This week" : "Next week"} · {fmtDate(w)} to {fmtDate(addDays(w, 6))}</p>
          <div className="grid grid-cols-7 gap-1">
            {LABELS.map((label, i) => {
              const day = addDays(w, i);
              const on = planned?.has(day) ?? false;
              const past = day < today;
              const cameIn = worked.has(day);
              const disabled = !planned || !!busy || past || cameIn;
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${label} ${fmtDate(day)}${on ? ", planned weekly off" : ""}`}
                  disabled={disabled}
                  onClick={() => void toggle(day)}
                  className={`flex flex-col items-center rounded-lg border py-1.5 text-xs font-medium disabled:cursor-not-allowed ${
                    on ? "border-brand-600 bg-brand-600 text-white" : past || cameIn ? "border-slate-100 bg-slate-50 text-slate-300" : "border-slate-300 bg-white text-slate-700 hover:border-brand-500"
                  } ${day === today ? "ring-2 ring-brand-200" : ""}`}
                >
                  <span>{label}</span>
                  <span className="text-[11px] opacity-80">{Number(day.slice(8))}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <ErrorText>{error}</ErrorText>
      {planned && planned.size > 0 && (
        <p className="mt-2 text-xs text-brand-800">
          Planned: {[...planned].sort().map((d) => fmtDate(d)).join(", ")}
        </p>
      )}
    </Card>
  );
}
