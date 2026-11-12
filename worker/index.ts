// YouTube Studio worker on Milan's pc. Start with: npm run worker (or double-click worker\start-werker.cmd).
// Settings go in worker/.env.local (see worker/.env.example); without Supabase settings it runs locally only.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { WORKER_PORT, type WorkerHealth } from "../lib/youtube/protocol.ts";
import { boostLoudness, extractFrame, ffmpegVersion, findTool, makeProxy, measureLoudness, measureRender, probe, runFfmpeg } from "./ffmpeg.ts";
import { createGemini } from "./gemini.ts";
import { createTts, createUsageCounter } from "./tts.ts";
import { createQueue, type Ai, type Montage, type Publisher } from "./queue.ts";
import { createWorkerServer } from "./server.ts";
import { createYouTubeLink } from "./youtubeLink.ts";
import { createYouTube } from "./youtube.ts";
import { createUploader } from "./youtubeUpload.ts";
import { createStats } from "./youtubeStats.ts";
import { createStatsSync } from "./statsSync.ts";
import { createClient } from "@supabase/supabase-js";
import { createStore } from "./store.ts";
import { createInbox } from "./inbox.ts";
import { createRegistrar } from "./register.ts";

const VERSION = "60.0";

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
const envFile = join(import.meta.dirname, ".env.local");
loadEnv(envFile);

const env = process.env;
const dataDir = env.WORKER_DATA_DIR || join(homedir(), "FamilieMK-YouTube");
const port = Number(env.WORKER_PORT || WORKER_PORT);
const allowedOrigins = (env.WORKER_ALLOWED_ORIGINS || "http://localhost:3200,http://127.0.0.1:3200,https://kivoxel-studio.vercel.app")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const ffmpeg = findTool("ffmpeg", env.FFMPEG_PATH);
const ffprobe = findTool("ffprobe", env.FFPROBE_PATH);
const workerName = env.WORKER_NAME || `pc-${hostname()}`;

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam" })}] ${msg}`);

const store = createStore(dataDir, (file) => probe(ffprobe, file));
await store.init();
const version = await ffmpegVersion(ffmpeg);

const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
// Paid analysis (Gemini, paid tier). Proxies are temporary and deleted right after the analysis.
const proxyDir = join(dataDir, "proxies");
const ai: Ai | null = env.GEMINI_API_KEY
  ? {
      gemini: createGemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || undefined),
      makeProxy: async (file, fingerprint, durationMs, options) => {
        await mkdir(proxyDir, { recursive: true });
        // The store keeps file names relative to its recordings folder.
        return makeProxy(ffmpeg, join(dataDir, "recordings", file), join(proxyDir, `${fingerprint}.mp4`), durationMs, options);
      },
      removeProxy: (file) => rm(file, { force: true }),
    }
  : null;
// Montage: previews stay on this pc in <data>/renders; work files in <data>/tmp are removed after each montage.
const montage: Montage | null = version
  ? {
      rendersDir: join(dataDir, "renders"),
      tmpDir: join(dataDir, "tmp"),
      run: (args, cwd, timeoutMs, options) => runFfmpeg(ffmpeg, args, cwd, timeoutMs, options),
      measure: (file, cwd, options) => measureRender(ffmpeg, ffprobe, file, cwd, options),
      boost: (input, output, cwd, options) => boostLoudness(ffmpeg, input, output, cwd, options),
      loudness: (file, cwd) => measureLoudness(ffmpeg, file, cwd),
      // Narrator: Google TTS, free tier only; the character counter lives next to the recordings.
      voice: env.GOOGLE_TTS_API_KEY ? { tts: createTts(env.GOOGLE_TTS_API_KEY), usage: createUsageCounter(join(dataDir, "tts-usage.json")) } : null,
    }
  : null;
if (montage) await mkdir(montage.tmpDir, { recursive: true });

// YouTube connection (fase D1): the key that encrypts the tokens on this pc. Missing? Make one and keep it in .env.local.
if (!/^[0-9a-f]{64}$/i.test(env.YT_TOKEN_KEY ?? "")) {
  env.YT_TOKEN_KEY = randomBytes(32).toString("hex");
  appendFileSync(envFile, `${existsSync(envFile) ? "\n" : ""}# Gemaakt door de werker: versleutelt de YouTube-tokens op deze pc. Niet delen, niet weggooien.\nYT_TOKEN_KEY=${env.YT_TOKEN_KEY}\n`);
  log("Nieuwe sleutel voor de YouTube-tokens gemaakt en bewaard in worker/.env.local");
}
const youtube = createYouTube({
  clientId: env.YOUTUBE_CLIENT_ID,
  clientSecret: env.YOUTUBE_CLIENT_SECRET,
  redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
  key: Buffer.from(env.YT_TOKEN_KEY!, "hex"),
  tokenFile: join(dataDir, "youtube-tokens.enc"),
  quotaFile: join(dataDir, "youtube-quota.json"),
});
const youtubeLink = createYouTubeLink(youtube, supabaseUrl && serviceKey ? { url: supabaseUrl, serviceKey } : null);
// Private upload (fase D3): needs the YouTube client and the montages on this pc.
const publisher: Publisher | null = youtube.configured && montage ? { uploader: createUploader({ yt: youtube, sessionDir: join(dataDir, "youtube-uploads") }), rendersDir: montage.rendersDir, tmpDir: montage.tmpDir, frame: (input, atMs, output) => extractFrame(ffmpeg, input, atMs, output) } : null;
// Statistics (fase E): hourly counts and every 6 hours the delayed analytics, only while YouTube is linked.
const statsSync = youtube.configured && supabaseUrl && serviceKey ? createStatsSync({ db: createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }), stats: createStats({ yt: youtube }), log }) : null;
const queue = supabaseUrl && serviceKey ? createQueue(supabaseUrl, serviceKey, workerName, store, log, ai, montage, undefined, publisher) : null;

// Inbox folder (fase 2): KIVOXEL/inbox in the user's home folder unless KIVOXEL_INBOX_DIR says otherwise. KIVOXEL_INBOX=0 switches it off.
const inboxDir = env.KIVOXEL_INBOX_DIR || join(homedir(), "KIVOXEL", "inbox");
const registrar = supabaseUrl && serviceKey ? createRegistrar(createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })) : null;
const inbox =
  env.KIVOXEL_INBOX === "0"
    ? null
    : createInbox({
        dir: inboxDir,
        importFile: (file, label) => store.importFile(file, label),
        register: async (recording) => {
          if (registrar) {
            await registrar(recording);
            queue?.poke();
          } else {
            const r = await store.intake(recording.fingerprint);
            log(r.intakeError ? `Intake mislukt: ${r.intakeError}` : `Intake klaar: ${r.label}`);
          }
        },
        log,
      });

const health = (): WorkerHealth => ({ ok: true, version: VERSION, ffmpeg: version, queue: queue ? "supabase" : "local", dataDir, analysis: ai?.gemini.model ?? null, voice: !!montage?.voice, youtube: youtube.configured, inbox: inbox?.status() ?? null });

const server = createWorkerServer({
  store,
  allowedOrigins,
  health,
  rendersDir: montage?.rendersDir,
  youtube: { ...youtubeLink, refresh: statsSync ? async () => ((await youtube.status()).connected ? statsSync.sync(true) : "YouTube is niet gekoppeld") : undefined },
  log,
  // Local mode: no queue, so run the intake straight away. Queue mode: the dashboard queues the step.
  onReceived: (fp) => {
    if (queue) queue.poke();
    else void store.intake(fp).then((r) => log(r.intakeError ? `Intake mislukt: ${r.intakeError}` : `Intake klaar: ${r.label}`));
  },
});

server.listen(port, "127.0.0.1", () => {
  log(`Werker ${VERSION} draait op http://127.0.0.1:${port}`);
  log(`Opnames staan in ${dataDir}`);
  log(version ? `FFmpeg ${version} gevonden` : "FFmpeg niet gevonden: installeer met  winget install Gyan.FFmpeg");
  log(queue ? `Wachtrij: Supabase (${workerName})` : "Wachtrij: alleen lokaal (geen Supabase-sleutel in worker/.env.local)");
  log(ai ? `Analysedienst: ${ai.gemini.model} (betaalde laag, binnen het maandplafond)` : "Analysedienst: niet verbonden (geen GEMINI_API_KEY); alleen testdata wordt geanalyseerd");
  log(montage?.voice ? "Stem: Google TTS (alleen het gratis deel, grens 900.000 tekens per maand)" : "Stem: nog te verbinden (geen GOOGLE_TTS_API_KEY); montages worden gemaakt zonder stem");
  log(youtube.configured ? "YouTube: client ingesteld; koppelen via YouTube Studio > Instellingen" : "YouTube: nog te verbinden (YOUTUBE_CLIENT_ID en YOUTUBE_CLIENT_SECRET ontbreken)");
  log("Laat dit venster open. Stoppen: Ctrl+C.");
  void youtubeLink.sync().then((m) => {
    if (m) log(`YouTube: ${m}`);
    // Statistics only once the link works; the schedule itself checks every 5 minutes what is due.
    void youtube.status().then((s) => s.connected && statsSync?.start());
  });
  queue?.start();
  if (inbox) {
    log(`Inbox-map: ${inboxDir} (zet hier een opname neer; de werker pakt hem op zodra het kopiëren klaar is)`);
    inbox.start();
  }
});
server.on("error", (e: NodeJS.ErrnoException) => {
  log(e.code === "EADDRINUSE" ? `Poort ${port} is al in gebruik: draait de werker al?` : `Fout: ${e.message}`);
  process.exit(1);
});
