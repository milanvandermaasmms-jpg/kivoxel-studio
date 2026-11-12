export type NavStatus = "live" | "later" | "connect";

const STATUS_LABEL: Record<Exclude<NavStatus, "live">, string> = {
  later: "later",
  connect: "nog te verbinden",
};

export function StatusBadge({ status }: { status: Exclude<NavStatus, "live"> }) {
  const tone = status === "connect" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-500";
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{STATUS_LABEL[status]}</span>;
}
