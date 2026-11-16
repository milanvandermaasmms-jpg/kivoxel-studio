// The yellow thumbnail header is sacred (KIVOXEL fase 1, section 4). Its style lives in exactly one place:
// brand/thumbnail_header.json. Every thumbnail is drawn from that file, and after drawing, a pixel check proves
// the header really came out in that yellow, at that place, in that font.
import headerJson from "../../brand/thumbnail_header.json" with { type: "json" };

export type HeaderLayout = { width: number; height: number; size_px: number; outline_px: number; shadow_px: number; margin_top_px: number };
export type HeaderSpec = {
  version: number;
  font: { family: string; windows_file: string; bold: boolean };
  color_hex: string;
  outline_hex: string;
  shadow_hex: string;
  shadow_alpha: number;
  uppercase: boolean;
  max_words: number;
  position: "top_center";
  margin_side_px: number;
  short: HeaderLayout;
  long: HeaderLayout;
  check: { max_channel_diff: number; min_match_share: number; min_text_pixels: number };
};

export const HEADER: HeaderSpec = headerJson as unknown as HeaderSpec;

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`Ongeldige kleur "${hex}" in brand/thumbnail_header.json`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** "#FFE500" with alpha 0 -> "&H0000E5FF" (ASS writes alpha, blue, green, red; alpha 0 = opaque). */
export function assColour(hex: string, alpha = 0): string {
  const [r, g, b] = hexToRgb(hex);
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${h(alpha)}${h(b)}${h(g)}${h(r)}`;
}

/** A colour change inside a line ("\c" tag) in ASS's own form: "#FFE500" -> "&H00E5FF&" (blue, green, red). */
export function assColourTag(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const h = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${h(b)}${h(g)}${h(r)}&`;
}

export const headerLayout =(size: { width: number; height: number }, spec: HeaderSpec = HEADER): HeaderLayout => (size.height > size.width ? spec.short : spec.long);

/** The one ASS style line of the header, made only from the brand file. */
export function headerStyle(size: { width: number; height: number }, spec: HeaderSpec = HEADER): string {
  const l = headerLayout(size, spec);
  const c = assColour(spec.color_hex);
  // Alignment 8 = top centre.
  return `Style: Thumb,${spec.font.family},${l.size_px},${c},${c},${assColour(spec.outline_hex)},${assColour(spec.shadow_hex, spec.shadow_alpha)},${spec.font.bold ? -1 : 0},0,0,0,100,100,0,0,1,${l.outline_px},${l.shadow_px},8,${spec.margin_side_px},${spec.margin_side_px},${l.margin_top_px},1`;
}

/** The header text as the brand wants it: capitals, at most `max_words` words, no punctuation. */
export function headerText(text: string | null | undefined, spec: HeaderSpec = HEADER): string {
  const t = (text ?? "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, spec.max_words)
    .join(" ");
  return spec.uppercase ? t.toUpperCase() : t;
}

export type HeaderCheck = { ok: boolean; textPixels: number; matchShare: number; reason: string | null };

const near = (px: Uint8Array, i: number, c: Rgb, tol: number) => Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol;

/**
 * Compares a finished thumbnail with a reference: the same header drawn alone on black (raw RGB24, same size).
 * Only the inside of the letters counts (pixels whose neighbours 2 px away are also yellow), because JPEG
 * smears colour at the edges. At least `min_match_share` of those pixels must be the brand yellow.
 */
export function checkHeaderPixels(reference: Uint8Array, thumb: Uint8Array, width: number, height: number, spec: HeaderSpec = HEADER): HeaderCheck {
  if (reference.length !== width * height * 3 || thumb.length !== reference.length) {
    return { ok: false, textPixels: 0, matchShare: 0, reason: `Beeldgrootte klopt niet (${thumb.length} / ${reference.length} bytes voor ${width}×${height}).` };
  }
  const yellow = hexToRgb(spec.color_hex);
  const tol = spec.check.max_channel_diff;
  const inRef = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && near(reference, (y * width + x) * 3, yellow, 8);
  let text = 0;
  let match = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (!inRef(x, y) || !inRef(x - 2, y) || !inRef(x + 2, y) || !inRef(x, y - 2) || !inRef(x, y + 2)) continue;
      text++;
      if (near(thumb, (y * width + x) * 3, yellow, tol)) match++;
    }
  }
  const share = text ? match / text : 0;
  if (text < spec.check.min_text_pixels) return { ok: false, textPixels: text, matchShare: share, reason: `De header is te klein of ontbreekt (${text} letterpixels, minstens ${spec.check.min_text_pixels}). Is het lettertype ${spec.font.family} geïnstalleerd?` };
  if (share < spec.check.min_match_share) return { ok: false, textPixels: text, matchShare: share, reason: `Header wijkt af van ${spec.color_hex}: maar ${Math.round(share * 100)}% van de letters heeft de juiste kleur en plek (minstens ${Math.round(spec.check.min_match_share * 100)}%).` };
  return { ok: true, textPixels: text, matchShare: share, reason: null };
}

/** Problems in the brand file itself (runs in the tests and when the worker starts). */
export function brandProblems(spec: HeaderSpec = HEADER): string[] {
  const out: string[] = [];
  try {
    hexToRgb(spec.color_hex);
    hexToRgb(spec.outline_hex);
    hexToRgb(spec.shadow_hex);
  } catch (e) {
    out.push(e instanceof Error ? e.message : String(e));
  }
  if (spec.max_words < 1 || spec.max_words > 4) out.push("max_words moet 1-4 zijn.");
  for (const k of ["short", "long"] as const) if (spec[k].size_px < 40) out.push(`Header ${k}: lettergrootte te klein.`);
  if (spec.check.min_match_share < 0.5 || spec.check.min_match_share > 1) out.push("check.min_match_share moet tussen 0,5 en 1 liggen.");
  return out;
}
