const n0 = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const fmtInt = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : n0.format(v);
export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${n1.format(v * 100)}%`;
export const fmtPos = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : n1.format(v);
export const fmtDuration = (s: number | null | undefined) => {
  if (s === null || s === undefined) return "—";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};
