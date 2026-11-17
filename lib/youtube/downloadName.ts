/** A file name Windows accepts, from the title of a video (Zelf uploaden, 17-11-2026). */
export function downloadName(title: string, ext: "mp4" | "jpg", fallback = "kivoxel-video"): string {
  const clean = title.replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90).replace(/[ .]+$/, "");
  return `${clean || fallback}.${ext}`;
}
