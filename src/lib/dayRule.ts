import type { Organization } from "./types";

/** The company's rules for what a day's worked hours are worth. Mirrors the database trigger. */
export type DayRules = Pick<Organization, "full_day_hours" | "half_day_hours" | "below_half_rule" | "between_rule" | "full_day_tolerance_min">;

type Knobs = Pick<DayRules, "below_half_rule" | "between_rule" | "full_day_tolerance_min">;
export type PresetId = "strict" | "hourly" | "lenient";

export const PRESETS: Record<PresetId, { name: string; summary: string; knobs: Knobs }> = {
  strict: {
    name: "Strict (day-wise)",
    summary: "Full day only when the full hours are done. Half day from the half-day mark. Anything less is not paid.",
    knobs: { below_half_rule: "absent", between_rule: "half", full_day_tolerance_min: 0 },
  },
  hourly: {
    name: "Pay by hours",
    summary: "Short days are paid for the hours actually worked, in proportion to a full day.",
    knobs: { below_half_rule: "hours", between_rule: "hours", full_day_tolerance_min: 0 },
  },
  lenient: {
    name: "Lenient",
    summary: "Any attendance counts as at least a half day, and up to 30 minutes short still counts as a full day.",
    knobs: { below_half_rule: "half", between_rule: "half", full_day_tolerance_min: 30 },
  },
};

export function presetOf(r: Knobs): PresetId | "custom" {
  const hit = (Object.keys(PRESETS) as PresetId[]).find((id) => {
    const k = PRESETS[id].knobs;
    return k.below_half_rule === r.below_half_rule && k.between_rule === r.between_rule && k.full_day_tolerance_min === Number(r.full_day_tolerance_min);
  });
  return hit ?? "custom";
}

/** Value of a day (0 to 1) for the minutes worked, and how to describe it. */
export function evaluateDay(minutes: number, r: DayRules): { value: number; label: string } {
  const full = Number(r.full_day_hours) * 60;
  const half = Number(r.half_day_hours) * 60;
  const byHours = () => Math.round((minutes / full) * 1000) / 1000;
  if (minutes >= full - Number(r.full_day_tolerance_min)) return { value: 1, label: "Full day" };
  const rule = minutes >= half ? r.between_rule : r.below_half_rule;
  if (rule === "half") return { value: 0.5, label: "Half day" };
  if (rule === "hours") return { value: byHours(), label: "Paid for hours worked" };
  return { value: 0, label: "Not paid (counts as absent)" };
}

export function describeDayValue(value: number | null | undefined): string {
  if (value == null) return "";
  const v = Number(value);
  if (v >= 1) return "full day";
  if (v === 0.5) return "half day";
  if (v === 0) return "not paid";
  return `${Math.round(v * 100)}% of a day`;
}
