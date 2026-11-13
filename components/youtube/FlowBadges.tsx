import { FLOW_OF, PRIVACY, privacyOf, type Flow, type FlowPublication, type Privacy } from "@/lib/youtube/flow";

/** Status of a video with color and icon (fase 1.2): In productie, Review nodig, Klaar voor YouTube, Bezig met uploaden, Live. */
export function FlowBadge({ flow, className = "" }: { flow: Flow; className?: string }) {
  const f = FLOW_OF[flow];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${f.tone} ${className}`}>
      <span aria-hidden>{f.icon}</span> {f.label}
    </span>
  );
}

/** 🔒 Privé, 🔗 Niet vermeld, 🌍 Openbaar or 🗓️ Ingepland, as a badge on every video card (fase 1.5). */
export function PrivacyBadge({ publication, privacy }: { publication?: Pick<FlowPublication, "status" | "visibility" | "publish_at"> | null; privacy?: Privacy }) {
  const p = PRIVACY[privacy ?? privacyOf(publication ?? null)];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.tone}`}>
      <span aria-hidden>{p.icon}</span> {p.label}
    </span>
  );
}
