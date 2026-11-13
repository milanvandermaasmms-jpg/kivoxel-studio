// Fase C: what changed between two script versions, so Milan sees at a glance what his comment did.
export type DiffScript = { top_line: string | null; hook: string; lines: { at_ms: number; text: string }[] };
export type DiffRow = { kind: "same" | "new" | "removed"; label: string; text: string };

const norm = (t: string | null | undefined) => (t ?? "").trim().replace(/\s+/g, " ");

/** Top line and hook as "changed" pairs, then every line: same, new (only in next) or removed (only in previous). */
export function scriptDiff(previous: DiffScript, next: DiffScript): DiffRow[] {
  const rows: DiffRow[] = [];
  const field = (label: string, a: string | null, b: string | null) => {
    if (norm(a) === norm(b)) rows.push({ kind: "same", label, text: norm(b) });
    else {
      if (norm(a)) rows.push({ kind: "removed", label, text: norm(a) });
      if (norm(b)) rows.push({ kind: "new", label, text: norm(b) });
    }
  };
  field("Tekst bovenin", previous.top_line, next.top_line);
  field("Hook", previous.hook, next.hook);
  const before = new Set(previous.lines.map((l) => norm(l.text)));
  const after = new Set(next.lines.map((l) => norm(l.text)));
  for (const l of previous.lines) if (!after.has(norm(l.text))) rows.push({ kind: "removed", label: "Regel", text: norm(l.text) });
  for (const l of next.lines) rows.push({ kind: before.has(norm(l.text)) ? "same" : "new", label: "Regel", text: norm(l.text) });
  return rows;
}

export const changedCount = (rows: DiffRow[]) => rows.filter((r) => r.kind === "new").length;
