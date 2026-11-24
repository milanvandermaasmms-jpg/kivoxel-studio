// 24-11-2026 (superprompt V5, uploadcontrole): everything that is already on YouTube, checked against the studio's own
// rules: English texts, the right channel and game, the AI label with a cloned voice, the audience choices. Only a
// report: changing a video that is on YouTube is always Milan's choice (and his click in YouTube Studio). Pure, tested.

import { looksDutch } from "../kivoxel/config";
import { GAMES, GAME_IDS, recordingGame, wrongChannelProblem, type ChannelProfile } from "./gameProfile";

export type AuditInput = {
  id: string;
  youtubeVideoId: string;
  title: string;
  description: string;
  tags: string[] | null;
  madeForKids: boolean | null;
  syntheticMedia: boolean | null;
  status: string;
  visibility: string | null;
  profile: ChannelProfile;
  /** The label of the recording the video was made from (it names the game on SpawnNado). */
  recordingLabel: string | null;
  /** The voice engine of the uploaded version ("chatterbox" = the cloned voice). */
  voiceEngine: string | null;
};

export type AuditFinding = { key: string; severity: "probleem" | "let op"; text: string };
export type AuditRow = { id: string; youtubeVideoId: string; title: string; channel: string; status: string; findings: AuditFinding[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (name: string) => new RegExp(`(^|[^a-z])${escape(name.toLowerCase())}([^a-z]|$)`);

export function auditUpload(p: AuditInput): AuditFinding[] {
  const out: AuditFinding[] = [];
  const title = p.title.trim();
  if (looksDutch(title)) out.push({ key: "title-nl", severity: "probleem", text: `De titel lijkt Nederlands; video's zijn altijd Engels.` });
  if (p.description.trim() && looksDutch(p.description)) out.push({ key: "desc-nl", severity: "probleem", text: "De beschrijving lijkt Nederlands." });
  const dutchTag = (p.tags ?? []).find(looksDutch);
  if (dutchTag) out.push({ key: "tag-nl", severity: "probleem", text: `De tag "${dutchTag}" lijkt Nederlands.` });

  const wrong = wrongChannelProblem(p.profile, p.recordingLabel);
  if (wrong) out.push({ key: "channel", severity: "probleem", text: `Staat op ${p.profile.name}, maar de opname "${p.recordingLabel}" hoort bij een ander kanaal.` });

  const game = GAMES[recordingGame(p.recordingLabel, p.profile)];
  const lower = title.toLowerCase();
  const other = GAME_IDS.filter((g) => g !== game.id).map((g) => GAMES[g].name).find((n) => word(n).test(lower));
  if (other) out.push({ key: "game", severity: "probleem", text: `De titel noemt ${other}, maar de video is ${game.name}.` });
  else if (title && !word(game.name).test(lower)) out.push({ key: "game-name", severity: "let op", text: `"${game.name}" staat niet in de titel; met de gamenaam vinden kijkers hem beter.` });

  if (/chatterbox|stemkloon/i.test(p.voiceEngine ?? "") && !p.syntheticMedia) out.push({ key: "ai-label", severity: "let op", text: "Gekloonde stem, AI-melding staat uit (jouw keuze)." });
  if (p.madeForKids === null) out.push({ key: "kids", severity: "let op", text: "Niet vastgelegd of de video voor kinderen gemaakt is." });
  if (!p.description.trim()) out.push({ key: "desc-empty", severity: "let op", text: "Geen beschrijving." });
  if (!(p.tags ?? []).length) out.push({ key: "tags-empty", severity: "let op", text: "Geen tags." });
  return out;
}

export function auditSummary(rows: AuditRow[]) {
  const problems = rows.filter((r) => r.findings.some((f) => f.severity === "probleem")).length;
  const notes = rows.filter((r) => r.findings.length && !r.findings.some((f) => f.severity === "probleem")).length;
  return { total: rows.length, problems, notes, clean: rows.length - problems - notes };
}
