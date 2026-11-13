// Checks the migrations on a throwaway in-memory Postgres; it never touches Supabase.
// Runs as part of npm test (see rls.test.ts).

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const migrationFiles = process.argv.slice(2);
const migrations = migrationFiles.map((file) => readFileSync(file, "utf8"));
// A block runs when its own migration is in the list (by number), not by counting, so migrations from other branches do not shift it.
const hasMigration = (number) => migrationFiles.some((file) => basename(file).startsWith(`${number}_`));
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const [MILAN, NATASJA, STRANGER, MEMBER, CHILD, UNCONFIRMED] = [1, 2, 3, 4, 5, 6].map(id);

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create publication supabase_realtime;
  create schema realtime;
  create table realtime.messages (id serial primary key, topic text, extension text);
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('test.topic', true) $$;
  grant usage on schema realtime to anon, authenticated;
  grant select, insert on realtime.messages to anon, authenticated;
  grant usage on sequence realtime.messages_id_seq to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid, owner_id text, metadata jsonb, unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values
    ('${MILAN}','milan@test.invalid',now()),('${NATASJA}','natasja@test.invalid',now()),('${STRANGER}','vreemd@test.invalid',now()),
    ('${MEMBER}','lid@test.invalid',now()),('${CHILD}','kind@test.invalid',now()),('${UNCONFIRMED}','onbevestigd@test.invalid',null);
`);
// Migration 032 moves existing YouTube data to a channel. Seed a separate family with data just before it runs,
// check the move afterwards and remove that family again, so the checks below start as before.
const OLD_HH = "aaaaaaaa-0000-0000-0000-000000000001";
let seededBeforeChannels = false;
for (const migration of migrations) {
  if (migration.includes("create table public.yt_channels")) {
    seededBeforeChannels = true;
    await db.exec(`
      insert into public.studios (id, name, created_by) values ('${OLD_HH}', 'Oud gezin', '${MILAN}');
      insert into public.yt_settings (studio_id) values ('${OLD_HH}');
      insert into public.yt_recordings (id, studio_id, label, original_name, size_bytes, fingerprint) values ('aaaaaaaa-0000-0000-0000-0000000000a1', '${OLD_HH}', 'Oud', 'o.mp4', 1, '${"f".repeat(64)}');
      insert into public.yt_moments (studio_id, recording_id, kind, start_ms, end_ms, reason, score, has_context, has_payoff, source) values ('${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'near_death', 0, 1000, 'r', 50, true, true, 'test');
      insert into public.yt_videos (id, studio_id, recording_id, format) values ('aaaaaaaa-0000-0000-0000-0000000000b1', '${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'A');
      insert into public.yt_videos (studio_id, format) values ('${OLD_HH}', 'C');
      insert into public.yt_scripts (id, studio_id, video_id, version, hook, target_ms, source) values ('aaaaaaaa-0000-0000-0000-0000000000c1', '${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000b1', 1, 'h', 18000, 'test');
      insert into public.yt_renders (studio_id, video_id, script_id, file_name, duration_ms, width, height) values ('${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'oud.mp4', 1000, 1080, 1920);
      insert into public.yt_jobs (id, studio_id, video_id, step, idempotency_key) values ('aaaaaaaa-0000-0000-0000-0000000000d1', '${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000b1', 'render', 'oud');
      insert into public.yt_costs (studio_id, job_id, category, service, amount_cents) values ('${OLD_HH}', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'rendering', 'x', 0);
    `);
  }
  await db.exec(migration);
}
// Read how 032 moved the seeded data, then remove that family before the other checks run.
let backfill = null;
if (seededBeforeChannels) {
  const tables = ["yt_recordings", "yt_moments", "yt_videos", "yt_scripts", "yt_renders", "yt_jobs", "yt_costs"];
  const channels = (await db.query("select id::text, name, is_default from public.yt_channels where studio_id=$1", [OLD_HH])).rows;
  const perTable = {};
  for (const t of tables) perTable[t] = (await db.query(`select array_agg(distinct channel_id::text) a, count(*) filter (where channel_id is null)::int n from public.${t} where studio_id=$1`, [OLD_HH])).rows[0];
  // Migration 045 marks the default channel as KIVOXEL and adds Dreamnest NL as a planned channel.
  const profiles = hasMigration("045") ? (await db.query("select name, slug, status, mode, safety_profile, made_for_kids, synthetic_media, banned_words, providers from public.yt_channels where studio_id=$1 order by is_default desc", [OLD_HH])).rows : [];
  backfill = { channels, perTable, profiles };
  await db.query("delete from public.studios where id=$1", [OLD_HH]);
}

let failed = 0;
const ok = (name, pass, extra = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name} ${pass ? "" : extra}`);
};
async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('test.uid','${uid ?? ""}',false); set role ${uid ? "authenticated" : "anon"};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function rejects(name, uid, sql, params) {
  try {
    const r = await as(uid, sql, params);
    ok(name, false, `no error, affected=${r.affectedRows} rows=${r.rows.length}`);
  } catch (e) {
    ok(name, true);
  }
}
const noneAffected = async (name, uid, sql) => {
  try {
    const r = await as(uid, sql);
    ok(name, (r.affectedRows ?? 0) === 0 && r.rows.length === 0, `affected=${r.affectedRows}`);
  } catch {
    ok(name, true);
  }
};
const one = async (uid, sql, params) => Object.values((await as(uid, sql, params)).rows[0])[0];

// ---------- Studio (migration 001) ----------
// Milan and Natasja are admins of the one studio; MEMBER, CHILD and STRANGER are not in it (they stand for anyone else).
const hh = await one(MILAN, "select public.create_studio('KIVOXEL Studio','Milan')");
ok("create_studio returns id", !!hh);
await rejects("a second studio is refused", STRANGER, "select public.create_studio('Twee','Vreemd')");
await rejects("the owner cannot make a second studio either", MILAN, "select public.create_studio('Twee','Milan')");
await rejects("anon cannot create a studio", null, "select public.create_studio('X','Y')");
await rejects("anon cannot read studios", null, "select * from public.studios");
await rejects("anon cannot read members", null, "select * from public.studio_members");
await rejects("direct insert into studios refused", STRANGER, `insert into public.studios(name,created_by) values('x','${STRANGER}')`);
await rejects("adding yourself to the studio refused", STRANGER, `insert into public.studio_members(studio_id,user_id,display_name,role) values('${hh}','${STRANGER}','x','beheerder')`);
ok("Milan is owner", (await one(MILAN, `select role from public.studio_members where user_id='${MILAN}'`)) === "eigenaar");
// A second admin is added by the owner in the SQL Editor (superuser), never from the app.
await db.query(`insert into public.studio_members(studio_id,user_id,display_name,role) values('${hh}','${NATASJA}','Natasja','beheerder')`);
let secondOwner = false;
try {
  await db.query(`insert into public.studio_members(studio_id,user_id,display_name,role) values('${hh}','${MEMBER}','Lid','eigenaar')`);
} catch {
  secondOwner = true;
}
ok("there is only one owner", secondOwner);
ok("admin sees the studio", (await as(NATASJA, "select * from public.studios")).rows.length === 1);
ok("admin sees the members", (await as(NATASJA, "select * from public.studio_members")).rows.length === 2);
ok("stranger sees no studio", (await as(STRANGER, "select * from public.studios")).rows.length === 0);
ok("stranger sees no members", (await as(STRANGER, "select * from public.studio_members")).rows.length === 0);
await rejects("admin cannot promote self to owner", NATASJA, `update public.studio_members set role='eigenaar' where user_id='${NATASJA}'`);
await as(NATASJA, `update public.studio_members set display_name='Tasja' where user_id='${NATASJA}'`);
ok("admin renames self", (await one(NATASJA, `select display_name from public.studio_members where user_id='${NATASJA}'`)) === "Tasja");
await noneAffected("admin cannot rename the owner", NATASJA, `update public.studio_members set display_name='Hack' where user_id='${MILAN}'`);
await rejects("user_id cannot be changed", NATASJA, `update public.studio_members set user_id='${STRANGER}' where user_id='${NATASJA}'`);
await rejects("a member cannot remove someone", NATASJA, `delete from public.studio_members where user_id='${MILAN}'`);
await noneAffected("admin cannot rename the studio", NATASJA, `update public.studios set name='Hack' where id='${hh}'`);
await noneAffected("stranger cannot rename the studio", STRANGER, `update public.studios set name='Hack' where id='${hh}'`);
await as(MILAN, `update public.studios set name='KIVOXEL' where id='${hh}'`);
ok("owner renames the studio", (await one(NATASJA, "select name from public.studios")) === "KIVOXEL");

// YouTube Studio (migration 007): admins only, no module right, the worker claims jobs with the service role.
const fp = (c) => c.repeat(64);
const addRecording = (uid, fingerprint, label = "TESTDATA opname") =>
  as(uid, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,$2,'test.mp4',1024,$3,true) returning id", [hh, label, fingerprint]);
const recording = (await addRecording(MILAN, fp("a"))).rows[0].id;
ok("admin adds a recording", !!recording);
await rejects("the same recording twice is refused", NATASJA, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint) values($1,'x','x.mp4',1,$2)", [hh, fp("a")]);
await rejects("a bad fingerprint is refused", MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint) values($1,'x','x.mp4',1,'abc')", [hh]);
ok("other admin sees the recording", (await as(NATASJA, "select id from public.yt_recordings")).rows.length === 1);
ok("child sees no recordings", (await as(CHILD, "select id from public.yt_recordings")).rows.length === 0);
ok("stranger sees no recordings", (await as(STRANGER, "select id from public.yt_recordings")).rows.length === 0);
await rejects("anon cannot read recordings", null, "select * from public.yt_recordings");
await rejects("child cannot add a recording", CHILD, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint) values($1,'x','x.mp4',1,$2)", [hh, fp("b")]);
await rejects("stranger cannot add a recording", STRANGER, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint) values($1,'x','x.mp4',1,$2)", [hh, fp("c")]);
await noneAffected("child cannot change a recording", CHILD, "update public.yt_recordings set label='Hack'");

const shortVideo = (await as(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning kind, privacy_status", [hh, recording])).rows[0];
ok("format A is a private Short", shortVideo.kind === "short" && shortVideo.privacy_status === "private");
ok("format C is a long video", (await one(MILAN, "insert into public.yt_videos(studio_id,format) values($1,'C') returning kind", [hh])) === "long");
await rejects("unknown format refused", MILAN, "insert into public.yt_videos(studio_id,format) values($1,'D')", [hh]);
ok("child sees no videos", (await as(CHILD, "select id from public.yt_videos")).rows.length === 0);

const queue = (uid, key, status = "queued") =>
  as(uid, "insert into public.yt_jobs(studio_id,recording_id,step,idempotency_key,status) values($1,$2,'intake',$3,$4) returning id", [hh, recording, key, status]);
const job = (await queue(MILAN, "intake:" + recording)).rows[0].id;
ok("admin queues a step", !!job);
await rejects("the same step twice is refused", MILAN, "insert into public.yt_jobs(studio_id,recording_id,step,idempotency_key) values($1,$2,'intake',$3)", [hh, recording, "intake:" + recording]);
await rejects("dashboard cannot queue a running step", MILAN, "insert into public.yt_jobs(studio_id,step,idempotency_key,status) values($1,'intake','x','running')", [hh]);
await rejects("child cannot queue a step", CHILD, "insert into public.yt_jobs(studio_id,step,idempotency_key) values($1,'intake','kind')", [hh]);
ok("child sees no queue", (await as(CHILD, "select id from public.yt_jobs")).rows.length === 0);
await rejects("dashboard cannot mark a step done", MILAN, "update public.yt_jobs set status='done' where id=$1", [job]);
await rejects("dashboard cannot claim steps", MILAN, "select * from public.claim_yt_job('pc')");

const asWorker = async (sql, params) => {
  await db.exec("set role service_role");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
};
const claimed = (await asWorker("select * from public.claim_yt_job('pc-milan')")).rows;
ok("worker claims the oldest step", claimed.length === 1 && claimed[0].id === job && claimed[0].status === "running" && claimed[0].attempts === 1);
ok("a running step is not claimed twice", (await asWorker("select * from public.claim_yt_job('pc-2')")).rows.length === 0);
await noneAffected("a running step cannot be cancelled from the dashboard", MILAN, `update public.yt_jobs set status='cancelled' where id='${job}'`);
await rejects("a running step cannot be retried", MILAN, "select public.retry_yt_job($1)", [job]);
await db.query("update public.yt_jobs set locked_at = now() - interval '2 hours' where id=$1", [job]);
ok("a stuck step is picked up again", (await asWorker("select attempts from public.claim_yt_job('pc-milan')")).rows[0]?.attempts === 2);
await db.query("update public.yt_jobs set status='failed', error='test', locked_by=null where id=$1", [job]);
await rejects("child cannot retry a step", CHILD, "select public.retry_yt_job($1)", [job]);
await as(MILAN, "select public.retry_yt_job($1)", [job]);
const retried = (await db.query("select status, attempts, error from public.yt_jobs where id=$1", [job])).rows[0];
ok("admin retries a failed step with a clean count", retried.status === "queued" && retried.attempts === 0 && retried.error === null);
await as(MILAN, `update public.yt_jobs set status='cancelled' where id='${job}'`);
ok("admin cancels a waiting step", (await one(MILAN, `select status from public.yt_jobs where id='${job}'`)) === "cancelled");
ok("a cancelled step is not claimed", (await asWorker("select * from public.claim_yt_job('pc-milan')")).rows.length === 0);

await as(MILAN, "insert into public.yt_costs(studio_id,job_id,category,service,amount_cents) values($1,$2,'processing','FFmpeg',0)", [hh, job]);
await rejects("a step costs only once", MILAN, "insert into public.yt_costs(studio_id,job_id,category,service,amount_cents) values($1,$2,'processing','FFmpeg',5)", [hh, job]);
await rejects("negative costs refused", MILAN, "insert into public.yt_costs(studio_id,category,service,amount_cents) values($1,'other','x',-1)", [hh]);
ok("child sees no costs", (await as(CHILD, "select id from public.yt_costs")).rows.length === 0);
ok("stranger sees no costs", (await as(STRANGER, "select id from public.yt_costs")).rows.length === 0);

// YouTube analysis and script (migration 009): approval and monthly cap, moments, scripts. Admins only.
if (hasMigration("009")) {
  await as(MILAN, "insert into public.yt_settings(studio_id) values($1)", [hh]);
  ok("paid processing starts switched off", (await one(MILAN, "select paid_processing_enabled from public.yt_settings")) === false);
  await rejects("switching on without a cap is refused", MILAN, "update public.yt_settings set paid_processing_enabled=true where studio_id=$1", [hh]);
  ok("child sees no settings", (await as(CHILD, "select * from public.yt_settings")).rows.length === 0);
  await noneAffected("member cannot change the cap", MEMBER, "update public.yt_settings set monthly_cap_cents=99999");
  await rejects("stranger cannot create settings for the family", STRANGER, "insert into public.yt_settings(studio_id) values($1)", [hh]);
  await rejects("a cap above the safety limit is refused", MILAN, "update public.yt_settings set monthly_cap_cents=100001 where studio_id=$1", [hh]);

  const analyseJob = (await as(MILAN, "insert into public.yt_jobs(studio_id,recording_id,step,idempotency_key) values($1,$2,'analyse','analyse:test') returning id", [hh, recording])).rows[0].id;
  const reserve = (jobId, cents) => asWorker("select public.reserve_yt_cost($1,$2,'analysis','Gemini Flash-Lite',$3) r", [hh, jobId, cents]);
  let refused = "";
  try {
    await reserve(analyseJob, 10);
  } catch (e) {
    refused = e.message;
  }
  ok("no paid step while paid processing is off", /staat uit/.test(refused), refused);
  await as(MILAN, "update public.yt_settings set paid_processing_enabled=true, monthly_cap_cents=100 where studio_id=$1", [hh]);
  const approval = (await as(NATASJA, "select approved_by, approved_at from public.yt_settings")).rows[0];
  ok("switching on records who approved", approval.approved_by === MILAN && !!approval.approved_at);
  ok("a paid step within the cap is reserved", (await reserve(analyseJob, 40)).rows[0].r === 40);
  ok("a restarted step does not reserve again", (await reserve(analyseJob, 40)).rows[0].r === 40 && (await db.query("select count(*)::int c from public.yt_costs where job_id=$1", [analyseJob])).rows[0].c === 1);
  const secondJob = (await as(MILAN, "insert into public.yt_jobs(studio_id,recording_id,step,idempotency_key) values($1,$2,'analyse','analyse:test2') returning id", [hh, recording])).rows[0].id;
  refused = "";
  try {
    await reserve(secondJob, 70);
  } catch (e) {
    refused = e.message;
  }
  ok("a step that would pass the monthly cap is refused", /Maandplafond/.test(refused), refused);
  await rejects("dashboard cannot reserve costs itself", MILAN, "select public.reserve_yt_cost($1,$2,'analysis','x',1)", [hh, secondJob]);

  const addMoment = (fields = {}) => {
    const m = { kind: "near_death", start_ms: 1000, end_ms: 9000, peak_ms: 6000, has_context: true, has_payoff: true, privacy_flags: "{}", source: "ai", ...fields };
    return db.query(
      "insert into public.yt_moments(studio_id,recording_id,kind,start_ms,end_ms,peak_ms,reason,score,has_context,has_payoff,privacy_flags,source,is_test) values($1,$2,$3,$4,$5,$6,'TESTDATA',70,$7,$8,$9,$10,true) returning id, usable",
      [hh, recording, m.kind, m.start_ms, m.end_ms, m.peak_ms, m.has_context, m.has_payoff, m.privacy_flags, m.source],
    );
  };
  const moment = (await addMoment()).rows[0];
  ok("a moment with context and payoff is usable", moment.usable === true);
  ok("a moment without payoff is not usable", (await addMoment({ kind: "mistake", has_payoff: false })).rows[0].usable === false);
  let bad = 0;
  for (const fields of [{ start_ms: 5000, end_ms: 4000, peak_ms: null }, { kind: "rescue", peak_ms: 20000 }, { kind: "escape", privacy_flags: "{ufo}" }, { kind: "dance" }, { start_ms: 1000 }]) {
    try {
      await addMoment(fields);
    } catch {
      bad++;
    }
  }
  ok("wrong timecodes, flags, kinds and the same moment twice are refused", bad === 5, `refused ${bad} of 5`);
  ok("other admin sees the moments", (await as(NATASJA, "select id from public.yt_moments")).rows.length === 2);
  ok("child sees no moments", (await as(CHILD, "select id from public.yt_moments")).rows.length === 0);
  ok("stranger sees no moments", (await as(STRANGER, "select id from public.yt_moments")).rows.length === 0);
  await rejects("dashboard cannot pose as the analysis service", MILAN, "insert into public.yt_moments(studio_id,recording_id,kind,start_ms,end_ms,reason,score,has_context,has_payoff,source) values($1,$2,'rescue',1,2,'x',1,true,true,'ai')", [hh, recording]);
  ok("admin adds a moment by hand", !!(await one(MILAN, "insert into public.yt_moments(studio_id,recording_id,kind,start_ms,end_ms,reason,score,has_context,has_payoff,source) values($1,$2,'rescue',1,2,'Handmatig',1,true,true,'manual') returning id", [hh, recording])));

  const video = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,plan_key,is_test) values($1,$2,'A','rec:A:1',true) returning id", [hh, recording]);
  await rejects("the same planned video twice is refused", MILAN, "insert into public.yt_videos(studio_id,recording_id,format,plan_key) values($1,$2,'A','rec:A:1')", [hh, recording]);
  await as(MILAN, "insert into public.yt_video_moments(studio_id,video_id,moment_id) values($1,$2,$3)", [hh, video, moment.id]);
  ok("child sees no video moments", (await as(CHILD, "select * from public.yt_video_moments")).rows.length === 0);

  const addScript = (version, lines = "[]") =>
    db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,lines,target_ms,source,is_test) values($1,$2,$3,'[TESTDATA] hook',$4::jsonb,18000,'test',true) returning id", [hh, video, version, lines]);
  const v1 = (await addScript(1)).rows[0].id;
  const v2 = (await addScript(2)).rows[0].id;
  let notArray = false;
  try {
    await addScript(3, "{}");
  } catch {
    notArray = true;
  }
  ok("script lines must be a list", notArray);
  let twice = false;
  try {
    await addScript(1);
  } catch {
    twice = true;
  }
  ok("the same script version twice is refused", twice);
  await rejects("dashboard cannot pose as the script writer", MILAN, "insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source) values($1,$2,9,'x',1,'ai')", [hh, video]);
  await as(MILAN, "update public.yt_scripts set status='approved' where id=$1", [v1]);
  ok("admin approves a script", (await one(NATASJA, "select status from public.yt_scripts where id=$1", [v1])) === "approved");
  await rejects("only one approved version per video", MILAN, "update public.yt_scripts set status='approved' where id=$1", [v2]);
  await rejects("dashboard cannot rewrite a generated script", MILAN, "update public.yt_scripts set hook='Anders' where id=$1", [v2]);
  ok("child sees no scripts", (await as(CHILD, "select id from public.yt_scripts")).rows.length === 0);
  await noneAffected("child cannot approve a script", CHILD, "update public.yt_scripts set status='approved'");
  await rejects("anon cannot read scripts", null, "select * from public.yt_scripts");

  // Voice-over and montage (migration 030): voice settings and renders. Only the worker creates renders.
  ok("the voice starts on the default narrator", (await one(MILAN, "select voice_name from public.yt_settings")) === "en-US-Chirp3-HD-Charon");
  await as(MILAN, "update public.yt_settings set speaking_rate=1.2, game_volume=0.3 where studio_id=$1", [hh]);
  await rejects("a speaking rate outside the range is refused", MILAN, "update public.yt_settings set speaking_rate=2 where studio_id=$1", [hh]);
  await rejects("a game volume above 1 is refused", MILAN, "update public.yt_settings set game_volume=1.5 where studio_id=$1", [hh]);
  await rejects("an odd voice name is refused", MILAN, "update public.yt_settings set voice_name='../hack' where studio_id=$1", [hh]);
  await noneAffected("child cannot change the voice", CHILD, "update public.yt_settings set voice_name='en-US-Chirp3-HD-Puck'");
  const addRender = (sql, params) => asWorker(sql, params);
  const renderSql = "insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test) values($1,$2,$3,$4,18000,1080,1920,true) returning id";
  const render = (await addRender(renderSql, [hh, video, v1, "short-v1-test.mp4"])).rows[0].id;
  ok("the worker adds a render", !!render);
  let badName = false;
  try {
    await addRender(renderSql, [hh, video, v1, "..\\..\\hack.mp4"]);
  } catch {
    badName = true;
  }
  ok("a render file name with a path is refused", badName);
  await rejects("dashboard cannot create a render", MILAN, renderSql, [hh, video, v1, "nep.mp4"]);
  await rejects("child cannot create a render", CHILD, renderSql, [hh, video, v1, "kind.mp4"]);
  await rejects("dashboard cannot change a render", MILAN, "update public.yt_renders set file_name='ander.mp4'");
  ok("other admin sees the render", (await as(NATASJA, "select id from public.yt_renders")).rows.length === 1);
  ok("child sees no renders", (await as(CHILD, "select id from public.yt_renders")).rows.length === 0);
  ok("stranger sees no renders", (await as(STRANGER, "select id from public.yt_renders")).rows.length === 0);
  await rejects("anon cannot read renders", null, "select * from public.yt_renders");
  await noneAffected("child cannot delete a render", CHILD, "delete from public.yt_renders");
  await noneAffected("stranger cannot delete a render", STRANGER, "delete from public.yt_renders");
  await as(MILAN, "delete from public.yt_renders where id=$1", [render]);
  ok("admin deletes a render", (await db.query("select count(*)::int c from public.yt_renders")).rows[0].c === 0);
  await addRender(renderSql, [hh, video, v1, "short-v1-again.mp4"]);

  await db.query("delete from public.yt_recordings where id=$1", [recording]);
  ok("deleting a recording removes its moments", (await db.query("select count(*)::int c from public.yt_moments")).rows[0].c === 0);
  await db.query("delete from public.yt_videos where id=$1", [video]);
  ok("deleting a video removes its renders", (await db.query("select count(*)::int c from public.yt_renders")).rows[0].c === 0);

  if (hasMigration("031")) {
    // Blurring and muting (migration 031): fixed PS5 corners, render flags, review note, recording to real in one step.
    ok("blurring is on by default with two corners", (await one(MILAN, "select jsonb_array_length(privacy_regions) from public.yt_settings")) === 2 && (await one(MILAN, "select privacy_blur and mute_flagged_voice from public.yt_settings")) === true);
    await as(MILAN, `update public.yt_settings set privacy_regions='[{"x":0,"y":0.8,"w":0.25,"h":0.2}]' where studio_id=$1`, [hh]);
    ok("admin changes the blurred corners", (await one(NATASJA, "select privacy_regions->0->>'y' from public.yt_settings")) === "0.8");
    await rejects("a region that is too small is refused", MILAN, `update public.yt_settings set privacy_regions='[{"x":0,"y":0,"w":0.01,"h":0.2}]' where studio_id=$1`, [hh]);
    await rejects("a region outside the picture is refused", MILAN, `update public.yt_settings set privacy_regions='[{"x":0.9,"y":0,"w":0.3,"h":0.2}]' where studio_id=$1`, [hh]);
    await rejects("more than six regions are refused", MILAN, `update public.yt_settings set privacy_regions=(select jsonb_agg('{"x":0,"y":0,"w":0.1,"h":0.1}'::jsonb) from generate_series(1,7)) where studio_id=$1`, [hh]);
    await rejects("regions must be a list", MILAN, `update public.yt_settings set privacy_regions='{"x":0}' where studio_id=$1`, [hh]);
    await noneAffected("child cannot switch blurring off", CHILD, "update public.yt_settings set privacy_blur=false");
    await noneAffected("member cannot switch muting off", MEMBER, "update public.yt_settings set mute_flagged_voice=false");

    const rec2 = (await as(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test,status) values($1,'Test 031','t.mp4',1,$2,true,'ready') returning id", [hh, fp("e")])).rows[0].id;
    const vid2 = (await as(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning id", [hh, rec2])).rows[0].id;
    const scr2 = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,1,'Hook',18000,'test',true) returning id", [hh, vid2])).rows[0].id;
    const r2 = (await asWorker("insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test,privacy_blur,game_muted) values($1,$2,$3,'blur-test.mp4',18000,1080,1920,true,true,true) returning privacy_blur, game_muted", [hh, vid2, scr2])).rows[0];
    ok("the worker records that a montage was blurred and muted", r2.privacy_blur === true && r2.game_muted === true);
    await rejects("dashboard cannot mark a render as blurred", MILAN, "update public.yt_renders set privacy_blur=true");

    await as(MILAN, "update public.yt_videos set status='scripted', review_note='Hook te traag' where id=$1", [vid2]);
    ok("admin stores why a video was rejected", (await one(NATASJA, "select review_note from public.yt_videos where id=$1", [vid2])) === "Hook te traag");
    await rejects("a very long review note is refused", MILAN, "update public.yt_videos set review_note=repeat('x',501) where id=$1", [vid2]);
    await noneAffected("child cannot write a review note", CHILD, "update public.yt_videos set review_note='kind'");

    await rejects("child cannot turn a recording into real gameplay", CHILD, "select public.mark_yt_recording_real($1,'Echt')", [rec2]);
    await rejects("stranger cannot turn a recording into real gameplay", STRANGER, "select public.mark_yt_recording_real($1,'Echt')", [rec2]);
    await rejects("anon cannot turn a recording into real gameplay", null, "select public.mark_yt_recording_real($1,'Echt')", [rec2]);
    await rejects("a label starting with testdata is refused", MILAN, "select public.mark_yt_recording_real($1,'TESTDATA nog steeds')", [rec2]);
    await as(MILAN, "select public.mark_yt_recording_real($1,'11-11 grot')", [rec2]);
    const real = (await as(NATASJA, "select label, is_test from public.yt_recordings where id=$1", [rec2])).rows[0];
    ok("admin turns a test recording into real gameplay", real.label === "11-11 grot" && real.is_test === false);
    ok("its test videos are removed in the same step", (await db.query("select count(*)::int c from public.yt_videos where recording_id=$1", [rec2])).rows[0].c === 0);
    ok("and the real analysis is queued once", (await db.query("select count(*)::int c from public.yt_jobs where recording_id=$1 and step='analyse'", [rec2])).rows[0].c === 1);
    await as(MILAN, "select public.mark_yt_recording_real($1,'11-11 grot')", [rec2]);
    ok("doing it twice queues nothing extra", (await db.query("select count(*)::int c from public.yt_jobs where recording_id=$1 and step='analyse'", [rec2])).rows[0].c === 1);
  }

  if (hasMigration("032")) {
    // Channels (migration 032): one channel per family today, ready for more later.
    const channelOf = async (table, where = "") => (await db.query(`select array_agg(distinct channel_id::text) a, count(*) filter (where channel_id is null)::int n from public.${table} ${where}`)).rows[0];
    const pixel = (backfill?.channels ?? []).filter((c) => c.name !== "Dreamnest NL");
    ok("existing data gets one default channel PixelRush", pixel.length === 1 && pixel[0].name === "PixelRush" && pixel[0].is_default);
    for (const [t, c] of Object.entries(backfill?.perTable ?? {})) ok(`existing ${t} moved to PixelRush`, c.n === 0 && c.a?.length === 1 && c.a[0] === pixel[0].id);

    const def = (await as(MILAN, "select id, name from public.yt_channels where studio_id=$1 and is_default", [hh])).rows[0];
    ok("a family without a channel gets a default channel on its first recording", !!def);
    ok("all recordings of the family are on that channel", (await channelOf("yt_recordings", `where studio_id='${hh}'`)).a?.every((c) => c === def.id));
    ok("other admin sees the channel", (await as(NATASJA, "select id from public.yt_channels")).rows.length === 1);
    ok("child sees no channels", (await as(CHILD, "select id from public.yt_channels")).rows.length === 0);
    ok("member sees no channels", (await as(MEMBER, "select id from public.yt_channels")).rows.length === 0);
    ok("stranger sees no channels", (await as(STRANGER, "select id from public.yt_channels")).rows.length === 0);
    await rejects("anon cannot read channels", null, "select * from public.yt_channels");
    await as(MILAN, "update public.yt_channels set name='PixelRush', audience='Minecraft-fans 8-14', brand_color='#22aa55' where id=$1", [def.id]);
    ok("admin names the channel", (await one(NATASJA, "select name from public.yt_channels where id=$1", [def.id])) === "PixelRush");
    await noneAffected("child cannot rename a channel", CHILD, "update public.yt_channels set name='Kind'");
    await rejects("a wrong brand colour is refused", MILAN, "update public.yt_channels set brand_color='groen' where id=$1", [def.id]);
    await rejects("a wrong blur region for a channel is refused", MILAN, `update public.yt_channels set privacy_regions='[{"x":0,"y":0,"w":0.01,"h":0.1}]' where id=$1`, [def.id]);
    await rejects("dashboard cannot link a YouTube channel itself", MILAN, "update public.yt_channels set youtube_channel_id='UCabcdefghijklmnopqrstuv' where id=$1", [def.id]);
    await rejects("dashboard cannot change the default channel", MILAN, "update public.yt_channels set is_default=false where id=$1", [def.id]);
    await rejects("dashboard cannot delete a channel", MILAN, "delete from public.yt_channels where id=$1", [def.id]);
    await rejects("stranger cannot add a channel to the family", STRANGER, "insert into public.yt_channels(studio_id,name) values($1,'Vreemd')", [hh]);
    await rejects("child cannot add a channel", CHILD, "insert into public.yt_channels(studio_id,name) values($1,'Kind')", [hh]);

    const second = await one(MILAN, "insert into public.yt_channels(studio_id,name,language) values($1,'Tweede kanaal','nl') returning id", [hh]);
    ok("admin adds a second channel (not default)", (await one(MILAN, "select is_default from public.yt_channels where id=$1", [second])) === false);
    const rec3 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,channel_id) values($1,'Kanaal 2','k.mp4',1,$2,$3) returning id", [hh, fp("9"), second]);
    const vid3 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format) values($1,$2,'A') returning id", [hh, rec3]);
    ok("a video follows the channel of its recording", (await one(MILAN, "select channel_id from public.yt_videos where id=$1", [vid3])) === second);
    await rejects("a video cannot go to another channel than its recording", MILAN, "insert into public.yt_videos(studio_id,recording_id,format,channel_id) values($1,$2,'A',$3)", [hh, rec3, def.id]);
    await rejects("a recording does not move to another channel", MILAN, "update public.yt_recordings set channel_id=$2 where id=$1", [rec3, def.id]);
    await rejects("a video does not move to another channel", MILAN, "update public.yt_videos set channel_id=$2 where id=$1", [vid3, def.id]);
    const job3 = await one(MILAN, "insert into public.yt_jobs(studio_id,video_id,step,idempotency_key) values($1,$2,'render','k2') returning id", [hh, vid3]);
    ok("a step follows the channel of its video", (await one(MILAN, "select channel_id from public.yt_jobs where id=$1", [job3])) === second);
    await db.query("insert into public.yt_costs(studio_id,job_id,category,service,amount_cents) values($1,$2,'rendering','FFmpeg',0)", [hh, job3]);
    ok("costs are counted per channel", (await one(MILAN, "select count(*)::int from public.yt_costs where channel_id=$1", [second])) === 1);
    await asWorker("update public.yt_channels set youtube_channel_id='UCabcdefghijklmnopqrstuv' where id=$1", [def.id]);
    let sameYouTube = false;
    try {
      await asWorker("update public.yt_channels set youtube_channel_id='UCabcdefghijklmnopqrstuv' where id=$1", [second]);
    } catch {
      sameYouTube = true;
    }
    ok("one YouTube channel cannot be linked twice", sameYouTube);
    await rejects("a recording on a channel of another family is refused", STRANGER, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,channel_id) values($1,'x','x.mp4',1,$2,$3)", [hh, fp("8"), second]);
  }

  if (hasMigration("033")) {
    // Live progress (migration 033): real progress from the worker, a log, and cancelling that really stops.
    const live = await one(MILAN, "insert into public.yt_jobs(studio_id,step,idempotency_key) values($1,'render','live-1') returning id", [hh]);
    const waiting = await one(MILAN, "insert into public.yt_jobs(studio_id,step,idempotency_key) values($1,'render','live-2') returning id", [hh]);
    await db.query("update public.yt_jobs set status='running', locked_by='pc-milan', locked_at=now(), attempts=1 where id=$1", [live]);
    await db.query(`update public.yt_jobs set progress=0.42, phase='Montage', metrics='{"frame":4200,"speed":2.1,"out_ms":42000,"total_ms":100000}', heartbeat_at=now() where id=$1`, [live]);
    ok("admin sees the real progress of a step", Number(await one(NATASJA, "select progress from public.yt_jobs where id=$1", [live])) === 0.42);
    ok("child sees no progress", (await as(CHILD, "select id from public.yt_jobs where id=$1", [live])).rows.length === 0);
    let badProgress = false;
    try {
      await db.query("update public.yt_jobs set progress=1.5 where id=$1", [live]);
    } catch {
      badProgress = true;
    }
    ok("progress above 100% is refused", badProgress);
    await noneAffected("dashboard cannot fake progress", MILAN, `update public.yt_jobs set progress=0.9 where id='${live}'`);

    await db.query("insert into public.yt_job_events(studio_id,job_id,kind,message) values($1,$2,'milestone','First preview available')", [hh, live]);
    ok("admin sees the log of a step", (await as(NATASJA, "select message from public.yt_job_events where job_id=$1", [live])).rows.length === 1);
    ok("child sees no log", (await as(CHILD, "select id from public.yt_job_events")).rows.length === 0);
    ok("stranger sees no log", (await as(STRANGER, "select id from public.yt_job_events")).rows.length === 0);
    await rejects("anon cannot read the log", null, "select * from public.yt_job_events");
    await rejects("dashboard cannot write the log", MILAN, "insert into public.yt_job_events(studio_id,job_id,message) values($1,$2,'nep')", [hh, live]);

    ok("cancelling a waiting step cancels it at once", (await one(MILAN, "select public.cancel_yt_job($1)", [waiting])) === "cancelled");
    ok("cancelling a running step asks the worker to stop", (await one(MILAN, "select public.cancel_yt_job($1)", [live])) === "requested" && (await one(NATASJA, "select status||':'||cancel_requested from public.yt_jobs where id=$1", [live])) === "running:true");
    await rejects("child cannot cancel a step", CHILD, "select public.cancel_yt_job($1)", [live]);
    await rejects("stranger cannot cancel a step", STRANGER, "select public.cancel_yt_job($1)", [live]);
    await rejects("anon cannot cancel a step", null, "select public.cancel_yt_job($1)", [live]);

    await db.query("update public.yt_jobs set status='failed', locked_by=null where id=$1", [live]);
    await as(MILAN, "select public.retry_yt_job($1)", [live]);
    const reset = (await db.query("select progress, phase, metrics, cancel_requested from public.yt_jobs where id=$1", [live])).rows[0];
    ok("trying again clears old progress and the cancel request", reset.progress === null && reset.phase === null && reset.metrics === null && reset.cancel_requested === false);
    ok("the log stays after trying again", (await db.query("select count(*)::int c from public.yt_job_events where job_id=$1", [live])).rows[0].c === 1);
    ok("progress and log are live (realtime)", (await db.query("select count(*)::int c from pg_publication_tables where pubname='supabase_realtime' and tablename in ('yt_jobs','yt_job_events')")).rows[0].c === 2);
  }

  if (hasMigration("034")) {
    // Quality check (migration 034): measurements and checklist on the render; only the worker writes them.
    const rec4 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,'QC','q.mp4',1,$2,true) returning id", [hh, fp("d")]);
    const vid4 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning id", [hh, rec4]);
    const scr4 = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,1,'Hook',18000,'test',true) returning id", [hh, vid4])).rows[0].id;
    const qc = JSON.stringify({ items: [{ key: "loudness", level: "red", value: "-37,3 LUFS" }] });
    await db.query("insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test,qc) values($1,$2,$3,'qc-test.mp4',18000,1080,1920,true,$4::jsonb)", [hh, vid4, scr4, qc]);
    ok("admin reads the quality checklist of a montage", (await one(NATASJA, "select qc->'items'->0->>'level' from public.yt_renders where video_id=$1", [vid4])) === "red");
    ok("child sees no quality checklist", (await as(CHILD, "select qc from public.yt_renders")).rows.length === 0);
    await rejects("dashboard cannot change the measurements", MILAN, `update public.yt_renders set qc='{"items":[]}' where video_id=$1`, [vid4]);
    let badQc = false;
    try {
      await db.query("update public.yt_renders set qc='[1,2]'::jsonb where video_id=$1", [vid4]);
    } catch {
      badQc = true;
    }
    ok("the checklist must be an object", badQc);
  }

  if (hasMigration("035")) {
    // Hook variants (migration 035): the AI writes them, the admin only chooses one.
    const rec5 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,'Hooks','h.mp4',1,$2,true) returning id", [hh, fp("7")]);
    const vid5 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning id", [hh, rec5]);
    const hooks = JSON.stringify([
      { type: "challenge", first_line: "One heart.", overlay: "1 HEART", cold_open: false },
      { type: "cold_open", first_line: "This close.", overlay: "TOO CLOSE", cold_open: true },
      { type: "curiosity_gap", first_line: "Watch left.", overlay: "WATCH LEFT", cold_open: false },
    ]);
    const scr5 = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test,hooks,loop_line,chosen_hook) values($1,$2,1,'Hook',18000,'test',true,$3::jsonb,'And again.',0) returning id", [hh, vid5, hooks])).rows[0].id;
    await as(MILAN, "update public.yt_scripts set chosen_hook=1 where id=$1", [scr5]);
    ok("admin chooses another hook", (await one(NATASJA, "select chosen_hook from public.yt_scripts where id=$1", [scr5])) === 1);
    await rejects("dashboard cannot rewrite the hooks of the AI", MILAN, `update public.yt_scripts set hooks='[]' where id=$1`, [scr5]);
    await rejects("dashboard cannot rewrite the loop line", MILAN, "update public.yt_scripts set loop_line='Mijn tekst' where id=$1", [scr5]);
    await noneAffected("child cannot choose a hook", CHILD, `update public.yt_scripts set chosen_hook=2 where id='${scr5}'`);
    let tooMany = false;
    try {
      await db.query("update public.yt_scripts set hooks=$2::jsonb where id=$1", [scr5, JSON.stringify([{}, {}, {}, {}])]);
    } catch {
      tooMany = true;
    }
    ok("at most three hook variants", tooMany);
    let missingHook = false;
    try {
      await db.query("update public.yt_scripts set hooks='[]'::jsonb, chosen_hook=0 where id=$1", [scr5]);
    } catch {
      missingHook = true;
    }
    ok("the chosen hook must exist", missingHook);
    // Editor (fase C3): an admin saves an edited version as a new script (source manual); a child cannot.
    await as(MILAN, "insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test,edit_plan) values($1,$2,2,$3,19500,$4,true,$5::jsonb)", [hh, vid5, "Bewerkt", "manual", JSON.stringify([{ part: "cold_open", src_start_ms: 0, src_end_ms: 1500, out_start_ms: 0, speed: 1, effects: ["zoom"], note: "", text: "4 ZOMBIES" }])]);
    ok("admin saves an edited version from the editor", (await one(NATASJA, "select edit_plan->0->>'text' from public.yt_scripts where video_id=$1 and version=2", [vid5])) === "4 ZOMBIES");
    await rejects("child cannot save an edited version", CHILD, "insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,3,'x',1000,'manual',true)", [hh, vid5]);
  }

  if (hasMigration("036")) {
    // YouTube connection (migration 036): only the worker writes the state; no tokens in the database.
    const ch = await one(MILAN, "select id from public.yt_channels where studio_id=$1 and is_default", [hh]);
    await db.query("update public.yt_channels set youtube_channel_id='UCabcdefghijklmnopqrstuv', youtube_title='Kivoxel', youtube_thumbnail_url='https://yt3.ggpht.com/abc', youtube_connected_at=now(), youtube_synced_at=now() where id=$1", [ch]);
    ok("admin sees the linked YouTube channel", (await one(NATASJA, "select youtube_title from public.yt_channels where id=$1", [ch])) === "Kivoxel");
    ok("child sees no YouTube connection", (await as(CHILD, "select youtube_title from public.yt_channels")).rows.length === 0);
    await rejects("dashboard cannot fake a connection", MILAN, "update public.yt_channels set youtube_connected_at=now() where id=$1", [ch]);
    await rejects("dashboard cannot change the YouTube name", MILAN, "update public.yt_channels set youtube_title='Nep' where id=$1", [ch]);
    await rejects("dashboard cannot clear a connection error", MILAN, "update public.yt_channels set youtube_error=null where id=$1", [ch]);
    let badThumb = false;
    try {
      await db.query("update public.yt_channels set youtube_thumbnail_url='http://evil.example/x.jpg' where id=$1", [ch]);
    } catch {
      badThumb = true;
    }
    ok("the channel picture must come from Google", badThumb);
    let noId = false;
    try {
      await db.query("update public.yt_channels set youtube_channel_id=null where id=$1", [ch]);
    } catch {
      noId = true;
    }
    ok("connected always has a YouTube channel ID", noId);
    const cols = (await db.query("select column_name from information_schema.columns where table_name='yt_channels'")).rows.map((r) => r.column_name);
    ok("no token columns in the database", !cols.some((c) => /token|secret/.test(c)));
    await db.query("update public.yt_channels set youtube_channel_id=null, youtube_title=null, youtube_thumbnail_url=null, youtube_connected_at=null, youtube_synced_at=null where id=$1", [ch]);
  }

  if (hasMigration("037")) {
    // Publications (migration 037): an admin keeps a draft for an approved video; only the worker sends it to YouTube.
    const rec7 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,'Publicatie','p.mp4',1,$2,true) returning id", [hh, fp("8")]);
    const vid7 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning id", [hh, rec7]);
    await rejects("no publication before the video is approved", MILAN, "insert into public.yt_publications(studio_id,video_id,title) values($1,$2,'Te vroeg')", [hh, vid7]);
    await db.query("update public.yt_videos set status='approved' where id=$1", [vid7]);
    const pub = await one(MILAN, "insert into public.yt_publications(studio_id,video_id,title,tags) values($1,$2,'Minecraft: creeper',array['minecraft','creeper']) returning id", [hh, vid7]);
    ok("a publication follows the channel and test flag of the video", (await one(NATASJA, "select (p.channel_id = v.channel_id and p.is_test) from public.yt_publications p join public.yt_videos v on v.id=p.video_id where p.id=$1", [pub])) === true);
    ok("audience and AI notice start empty (Milan chooses)", (await one(MILAN, "select made_for_kids is null and contains_synthetic_media is null from public.yt_publications where id=$1", [pub])) === true);
    await as(NATASJA, "update public.yt_publications set made_for_kids=false, contains_synthetic_media=false, description='Watch left. #minecraft' where id=$1", [pub]);
    ok("other admin edits the draft", (await one(MILAN, "select made_for_kids from public.yt_publications where id=$1", [pub])) === false);
    ok("child sees no publications", (await as(CHILD, "select id from public.yt_publications")).rows.length === 0);
    ok("member sees no publications", (await as(MEMBER, "select id from public.yt_publications")).rows.length === 0);
    await noneAffected("child cannot change a publication", CHILD, `update public.yt_publications set title='Kind' where id='${pub}'`);
    await rejects("stranger cannot add a publication", STRANGER, "insert into public.yt_publications(studio_id,video_id) values($1,$2)", [hh, vid7]);
    await rejects("dashboard cannot set the upload status", MILAN, "update public.yt_publications set status='published' where id=$1", [pub]);
    await rejects("dashboard cannot fill in a YouTube video ID", MILAN, "update public.yt_publications set youtube_video_id='abcdefghijk' where id=$1", [pub]);
    await rejects("dashboard cannot start as uploaded", MILAN, "insert into public.yt_publications(studio_id,video_id,status) values($1,$2,'published')", [hh, vid7]);
    await rejects("a title over 100 characters is refused", MILAN, "update public.yt_publications set title=repeat('x',101) where id=$1", [pub]);
    await rejects("angle brackets in the title are refused", MILAN, "update public.yt_publications set title='a <b>' where id=$1", [pub]);
    await rejects("a description over 5000 bytes is refused", MILAN, "update public.yt_publications set description=repeat('é',2501) where id=$1", [pub]);
    await rejects("tags over 500 characters are refused", MILAN, "update public.yt_publications set tags=array[repeat('x',300),repeat('y',300)] where id=$1", [pub]);
    await rejects("scheduling a public video is refused", MILAN, "update public.yt_publications set visibility='public', publish_at=now()+interval '1 day' where id=$1", [pub]);
    await rejects("one publication per video", MILAN, "insert into public.yt_publications(studio_id,video_id) values($1,$2)", [hh, vid7]);
    const otherVid = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'B',true) returning id", [hh, rec7]);
    const otherScr = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,1,'x',1000,'test',true) returning id", [hh, otherVid])).rows[0].id;
    const otherRender = (await db.query("insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test) values($1,$2,$3,'other.mp4',1000,1080,1920,true) returning id", [hh, otherVid, otherScr])).rows[0].id;
    await rejects("the montage must belong to the same video", MILAN, "update public.yt_publications set render_id=$2 where id=$1", [pub, otherRender]);
    await db.query("update public.yt_publications set status='uploading' where id=$1", [pub]);
    await noneAffected("no edits once the upload started", MILAN, `update public.yt_publications set title='Later' where id='${pub}'`);
    await noneAffected("no delete once the upload started", MILAN, `delete from public.yt_publications where id='${pub}'`);
    await db.query("update public.yt_publications set status='draft' where id=$1", [pub]);
    await as(MILAN, "delete from public.yt_publications where id=$1", [pub]);
    ok("admin deletes a draft", (await as(MILAN, "select id from public.yt_publications where id=$1", [pub])).rows.length === 0);
  }

  if (hasMigration("038")) {
    // Private upload (migration 038): only through the button, only a complete private draft.
    const rec8 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,'Upload','u.mp4',1,$2,true) returning id", [hh, "0f".repeat(32)]);
    const vid8 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',true) returning id", [hh, rec8]);
    const scr8 = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,1,'x',1000,'test',true) returning id", [hh, vid8])).rows[0].id;
    const ren8 = (await db.query("insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test) values($1,$2,$3,'upload.mp4',1000,1080,1920,true) returning id", [hh, vid8, scr8])).rows[0].id;
    await db.query("update public.yt_videos set status='approved' where id=$1", [vid8]);
    const pub8 = await one(MILAN, "insert into public.yt_publications(studio_id,video_id,render_id,title) values($1,$2,$3,'[TEST] Upload') returning id", [hh, vid8, ren8]);
    await rejects("no upload before audience and AI notice are chosen", MILAN, "select public.request_yt_upload($1)", [pub8]);
    await as(MILAN, "update public.yt_publications set made_for_kids=false, contains_synthetic_media=true, publish_at=now()+interval '2 days' where id=$1", [pub8]);
    // From 039 on the old button simply uploads private (and clears the time); before that it refused.
    if (!hasMigration("039")) await rejects("no scheduled upload yet (D4)", MILAN, "select public.request_yt_upload($1)", [pub8]);
    await as(MILAN, "update public.yt_publications set publish_at=null where id=$1", [pub8]);
    await rejects("child cannot request an upload", CHILD, "select public.request_yt_upload($1)", [pub8]);
    await rejects("stranger cannot request an upload", STRANGER, "select public.request_yt_upload($1)", [pub8]);
    await rejects("anon cannot request an upload", null, "select public.request_yt_upload($1)", [pub8]);
    const upJob = await one(MILAN, "select public.request_yt_upload($1)", [pub8]);
    ok("admin requests a private upload", (await one(NATASJA, "select status from public.yt_publications where id=$1", [pub8])) === "queued");
    ok("the upload step is queued for the worker", (await one(NATASJA, "select step || ':' || (payload->>'publication_id') from public.yt_jobs where id=$1", [upJob])) === "upload:" + pub8);
    await rejects("no second upload while one is on its way", MILAN, "select public.request_yt_upload($1)", [pub8]);
    await noneAffected("draft is locked while the upload waits", MILAN, `update public.yt_publications set title='Anders' where id='${pub8}'`);
    await as(MILAN, "select public.cancel_yt_job($1)", [upJob]);
    ok("cancelling the upload frees the draft", (await one(MILAN, "select status || ':' || error from public.yt_publications where id=$1", [pub8])) === "failed:Geannuleerd");
    await as(MILAN, "update public.yt_publications set title='[TEST] Upload 2' where id=$1", [pub8]);
    const upJob2 = await one(MILAN, "select public.request_yt_upload($1)", [pub8]);
    ok("a new request after cancelling gets its own step", upJob2 !== upJob);
    await db.query("update public.yt_publications set status='uploaded', youtube_video_id='abcdefghijk' where id=$1", [pub8]);
    await db.query("update public.yt_jobs set status='failed', error='x' where id=$1", [upJob2]);
    ok("a finished upload is not reset by an old step", (await one(MILAN, "select status from public.yt_publications where id=$1", [pub8])) === "uploaded");
    await db.query("update public.yt_publications set status='failed' where id=$1", [pub8]);
    if (!hasMigration("039")) await rejects("a video already on YouTube is not uploaded again", MILAN, "select public.request_yt_upload($1)", [pub8]);
    else {
      const jobId = await one(MILAN, "select public.request_yt_upload($1)", [pub8]);
      ok("a video already on YouTube is not uploaded again (only its visibility)", (await one(MILAN, "select step from public.yt_jobs where id=$1", [jobId])) === "publish");
    }
  }

  if (hasMigration("039")) {
    // Scheduling and publishing (migration 039): explicit actions; test videos never go public.
    const rec9 = await one(MILAN, "insert into public.yt_recordings(studio_id,label,original_name,size_bytes,fingerprint,is_test) values($1,'Echt','e.mp4',1,$2,false) returning id", [hh, "1e".repeat(32)]);
    const vid9 = await one(MILAN, "insert into public.yt_videos(studio_id,recording_id,format,is_test) values($1,$2,'A',false) returning id", [hh, rec9]);
    const scr9 = (await db.query("insert into public.yt_scripts(studio_id,video_id,version,hook,target_ms,source,is_test) values($1,$2,1,'x',1000,'ai',false) returning id", [hh, vid9])).rows[0].id;
    const ren9 = (await db.query("insert into public.yt_renders(studio_id,video_id,script_id,file_name,duration_ms,width,height,is_test) values($1,$2,$3,'real.mp4',1000,1080,1920,false) returning id", [hh, vid9, scr9])).rows[0].id;
    await db.query("update public.yt_videos set status='approved' where id=$1", [vid9]);
    const pub9 = await one(MILAN, "insert into public.yt_publications(studio_id,video_id,render_id,title,made_for_kids,contains_synthetic_media) values($1,$2,$3,'Minecraft: echt',false,false) returning id", [hh, vid9, ren9]);
    await rejects("scheduling too soon is refused", MILAN, "select public.request_yt_publish($1,'schedule',now()+interval '5 minutes')", [pub9]);
    await rejects("publishing needs public or unlisted", MILAN, "select public.request_yt_publish($1,'publish',null,'private')", [pub9]);
    await rejects("an unknown action is refused", MILAN, "select public.request_yt_publish($1,'delete')", [pub9]);
    await rejects("child cannot publish", CHILD, "select public.request_yt_publish($1,'publish',null,'public')", [pub9]);
    const j1 = await one(MILAN, "select public.request_yt_publish($1,'schedule',now()+interval '2 days')", [pub9]);
    ok("admin schedules: upload step, private with a time", (await one(NATASJA, "select p.status || ':' || p.visibility || ':' || (p.publish_at is not null) || ':' || j.step || ':' || (j.payload->>'action') from public.yt_publications p, public.yt_jobs j where p.id=$1 and j.id=$2", [pub9, j1])) === "queued:private:true:upload:schedule");
    await db.query("update public.yt_publications set status='scheduled', youtube_video_id='realvideo01' where id=$1", [pub9]);
    const j2 = await one(MILAN, "select public.request_yt_publish($1,'publish',null,'public')", [pub9]);
    ok("publishing a video that is already on YouTube only updates its visibility", (await one(MILAN, "select step from public.yt_jobs where id=$1", [j2])) === "publish");
    ok("the publication now asks for public without a time", (await one(MILAN, "select visibility || ':' || (publish_at is null) from public.yt_publications where id=$1", [pub9])) === "public:true");
    await rejects("no second request while one waits", MILAN, "select public.request_yt_publish($1,'private')", [pub9]);
    await db.query("update public.yt_jobs set status='failed', error='YouTube weigerde' where id=$1", [j2]);
    ok("a failed visibility step frees the publication with the reason", (await one(MILAN, "select status || ':' || error from public.yt_publications where id=$1", [pub9])) === "failed:YouTube weigerde");
    // The test video from 038 (already on YouTube) may only stay private.
    const testPub = (await db.query("select id from public.yt_publications where is_test and youtube_video_id is not null limit 1")).rows[0].id;
    await db.query("update public.yt_publications set status='uploaded' where id=$1", [testPub]);
    await rejects("a test video is never published", MILAN, "select public.request_yt_publish($1,'publish',null,'public')", [testPub]);
    await rejects("a test video is never scheduled", MILAN, "select public.request_yt_publish($1,'schedule',now()+interval '2 days')", [testPub]);
  }

  if (hasMigration("040")) {
    // Captions and thumbnail (migration 040): Milan chooses, the worker reports.
    const pubX = (await db.query("select id from public.yt_publications where is_test and youtube_video_id is not null limit 1")).rows[0].id;
    ok("captions are on by default", (await one(MILAN, "select captions_enabled from public.yt_publications where id=$1", [pubX])) === true);
    await rejects("dashboard cannot write the caption result", MILAN, "update public.yt_publications set captions_status='Klaar' where id=$1", [pubX]);
    await rejects("dashboard cannot write the thumbnail result", MILAN, "update public.yt_publications set thumbnail_status='Klaar' where id=$1", [pubX]);
    await db.query("update public.yt_publications set status='uploaded' where id=$1", [pubX]);
    await rejects("nothing chosen is refused", MILAN, "select public.request_yt_extras($1,false,null)", [pubX]);
    await rejects("a thumbnail moment must be valid", MILAN, "select public.request_yt_extras($1,true,-5)", [pubX]);
    await rejects("child cannot send captions", CHILD, "select public.request_yt_extras($1,true,5000)", [pubX]);
    const jx = await one(MILAN, "select public.request_yt_extras($1,true,5000)", [pubX]);
    ok("admin sends captions and thumbnail as a separate step", (await one(NATASJA, "select step || ':' || (payload->>'action') from public.yt_jobs where id=$1", [jx])) === "publish:extras");
    ok("the choice is stored and visibility stays private", (await one(MILAN, "select status || ':' || thumbnail_ms || ':' || visibility from public.yt_publications where id=$1", [pubX])) === "queued:5000:private");
    await rejects("no second request while one waits", MILAN, "select public.request_yt_extras($1,true,6000)", [pubX]);
    const draftVid = (await db.query("select id from public.yt_publications where youtube_video_id is null limit 1")).rows[0]?.id;
    if (draftVid) await rejects("not before the video is on YouTube", MILAN, "select public.request_yt_extras($1,true,1000)", [draftVid]);
  }

  if (hasMigration("041")) {
    // Statistics (migration 041): the worker writes snapshots, admins read them, nobody else sees them.
    const chS = await one(MILAN, "select id from public.yt_channels where studio_id=$1 and is_default", [hh]);
    await db.query("insert into public.yt_channel_snapshots(studio_id,channel_id,subscribers,views_total,videos_total,views_7d,analytics_until) values($1,$2,2,120,1,100,'2026-11-11')", [hh, chS]);
    await db.query("insert into public.yt_video_snapshots(studio_id,channel_id,youtube_video_id,views,likes,retention) values($1,$2,'VoNoNzixd00',120,5,'[{\"at\":0,\"ratio\":1}]'::jsonb)", [hh, chS]);
    ok("admin reads channel numbers", (await one(NATASJA, "select subscribers from public.yt_channel_snapshots where channel_id=$1", [chS])) === 2);
    ok("admin reads video numbers", Number(await one(MILAN, "select views from public.yt_video_snapshots where youtube_video_id='VoNoNzixd00'")) === 120);
    ok("child sees no statistics", (await as(CHILD, "select id from public.yt_channel_snapshots")).rows.length === 0 && (await as(CHILD, "select id from public.yt_video_snapshots")).rows.length === 0);
    ok("member sees no statistics", (await as(MEMBER, "select id from public.yt_video_snapshots")).rows.length === 0);
    await rejects("anon cannot read statistics", null, "select * from public.yt_video_snapshots");
    await rejects("dashboard cannot write statistics", MILAN, "insert into public.yt_channel_snapshots(studio_id,channel_id,views_total,videos_total) values($1,$2,999999,1)", [hh, chS]);
    await rejects("dashboard cannot change statistics", MILAN, "update public.yt_video_snapshots set views=999999");
    await rejects("dashboard cannot delete statistics", MILAN, "delete from public.yt_video_snapshots");
    let badId = false;
    try {
      await db.query("insert into public.yt_video_snapshots(studio_id,channel_id,youtube_video_id,views) values($1,$2,'x y',1)", [hh, chS]);
    } catch {
      badId = true;
    }
    ok("a YouTube video ID must look like one", badId);
  }

  if (hasMigration("042")) {
    // Manual numbers (migration 042): what the API does not give, an admin fills in; marked as manual.
    await as(MILAN, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value,entered_by) values($1,'VoNoNzixd00','viewed_pct',72.5,$2)", [hh, MILAN]);
    ok("other admin reads the manual number", Number(await one(NATASJA, "select value from public.yt_manual_metrics where youtube_video_id='VoNoNzixd00'")) === 72.5);
    await as(NATASJA, "update public.yt_manual_metrics set value=70, entered_by=$1 where youtube_video_id='VoNoNzixd00'", [NATASJA]);
    ok("other admin corrects it", Number(await one(MILAN, "select value from public.yt_manual_metrics where youtube_video_id='VoNoNzixd00'")) === 70);
    ok("child sees no manual numbers", (await as(CHILD, "select id from public.yt_manual_metrics")).rows.length === 0);
    await rejects("child cannot fill in numbers", CHILD, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value) values($1,'abcdefghijk','viewed_pct',50)", [hh]);
    await rejects("stranger cannot fill in numbers", STRANGER, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value) values($1,'abcdefghijk','viewed_pct',50)", [hh]);
    await rejects("a percentage above 100 is refused", MILAN, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value,entered_by) values($1,'abcdefghijk','viewed_pct',120,$2)", [hh, MILAN]);
    await rejects("an unknown metric is refused", MILAN, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value,entered_by) values($1,'abcdefghijk','revenue',5,$2)", [hh, MILAN]);
    await rejects("one value per video and metric", MILAN, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value,entered_by) values($1,'VoNoNzixd00','viewed_pct',50,$2)", [hh, MILAN]);
    await rejects("nobody enters a number in someone else's name", MILAN, "insert into public.yt_manual_metrics(studio_id,youtube_video_id,metric,value,entered_by) values($1,'abcdefghijk','viewed_pct',50,$2)", [hh, NATASJA]);
    await as(MILAN, "delete from public.yt_manual_metrics where youtube_video_id='VoNoNzixd00'");
    ok("admin removes a manual number", (await as(MILAN, "select id from public.yt_manual_metrics")).rows.length === 0);
  }

  if (hasMigration("043")) {
    // Pruning (migration 043): only the worker; keeps the last 8 days, one per day and the report milestones.
    const chP = await one(MILAN, "select id from public.yt_channels where studio_id=$1 and is_default", [hh]);
    await db.query("delete from public.yt_video_snapshots where youtube_video_id='prunetest01'");
    const pub = "2026-01-01 10:00:00+00";
    // 30 days of hourly snapshots, starting at publication.
    await db.query("insert into public.yt_video_snapshots(studio_id,channel_id,youtube_video_id,published_at,taken_at,views) select $1,$2,'prunetest01',$3::timestamptz, $3::timestamptz + make_interval(hours => h), h from generate_series(0, 30*24) h", [hh, chP, pub]);
    await rejects("dashboard cannot prune", MILAN, "select public.yt_prune_snapshots()");
    const removed = (await db.query("select public.yt_prune_snapshots() as n")).rows[0].n;
    const left = (await db.query("select taken_at from public.yt_video_snapshots where youtube_video_id='prunetest01' order by taken_at")).rows.map((r) => new Date(r.taken_at).getTime());
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    ok("pruning removes old hourly snapshots", removed > 0 && left.length < 30 * 24);
    ok("pruning keeps the 24-hour, 72-hour and 7-day points", [24, 72, 168].every((h) => left.includes(t0 + h * 3600000)));
    ok("pruning keeps one snapshot per day", new Set(left.map((t) => new Date(t + 3600000).toISOString().slice(0, 10))).size >= 30);
    await db.query("delete from public.yt_video_snapshots where youtube_video_id='prunetest01'");
  }
}



// ---------- Review tile (migration 044) ----------
if (hasMigration("044")) {
  const token = "t".repeat(48);
  const count = (uid, t) => one(uid, "select public.kivoxel_review_count($1)", [t]);
  ok("without a registered token the tile gets nothing", (await count(null, token)) === null);
  await db.query("insert into public.studio_tile_tokens(token_sha256) values(encode(sha256(convert_to($1,'UTF8')),'hex'))", [token]);
  await rejects("anon cannot read the tokens", null, "select * from public.studio_tile_tokens");
  await rejects("admin cannot read the tokens from the app", MILAN, "select * from public.studio_tile_tokens");
  await rejects("admin cannot add a token from the app", MILAN, "insert into public.studio_tile_tokens(token_sha256) values(repeat('a',64))");
  ok("a wrong token gets nothing", (await count(null, "x".repeat(48))) === null);
  ok("a short token gets nothing", (await count(null, "t".repeat(10))) === null);
  const before = await count(null, token);
  ok("the right token gets a number", typeof before === "number");
  await db.query("insert into public.yt_videos(studio_id,format,status,is_test) values($1,'A','review',false),($1,'A','review',true)", [hh]);
  ok("only real videos in review are counted", (await count(null, token)) === before + 1);
}

// ---------- Channel profiles (migration 045) ----------
if (hasMigration("045")) {
  const [kivoxel, dreamnest] = backfill?.profiles ?? [];
  ok("the existing default channel becomes kivoxel with the free providers", kivoxel?.slug === "kivoxel" && kivoxel.mode === "upload" && kivoxel.safety_profile === "kids_gaming" && kivoxel.providers?.llm === "gemini" && kivoxel.providers?.video === "none");
  ok("Dreamnest NL is added as a planned generate channel", dreamnest?.slug === "dreamnest-nl" && dreamnest.status === "planned" && dreamnest.mode === "generate" && dreamnest.safety_profile === "infant_sleep" && dreamnest.made_for_kids === true && dreamnest.synthetic_media === true);
  ok("Dreamnest NL blocks medical promises", ["geneest", "IQ", "therapie"].every((w) => dreamnest?.banned_words?.includes(w)));

  const ch = await one(MILAN, "insert into public.yt_channels(studio_id,name,slug,mode,safety_profile,banned_words,publish_slots) values($1,'Profieltest','profiel-test','hybrid','general',array['x'],array['19:00']) returning id", [hh]);
  ok("admin adds a channel with a profile", (await one(MILAN, "select mode from public.yt_channels where id=$1", [ch])) === "hybrid");
  await as(MILAN, "update public.yt_channels set concept_auto_approve=true, publish_slots=array['08:30','20:00'], synthetic_media=true where id=$1", [ch]);
  ok("admin changes the profile", (await one(NATASJA, "select concept_auto_approve from public.yt_channels where id=$1", [ch])) === true);
  await rejects("a wrong publish time is refused", MILAN, "update public.yt_channels set publish_slots=array['25:00'] where id=$1", [ch]);
  await rejects("a wrong slug is refused", MILAN, "update public.yt_channels set slug='Met Spatie' where id=$1", [ch]);
  await rejects("a slug is unique within the studio", MILAN, "insert into public.yt_channels(studio_id,name,slug) values($1,'Dubbel','profiel-test')", [hh]);
  await rejects("an unknown safety profile is refused", MILAN, "update public.yt_channels set safety_profile='alles' where id=$1", [ch]);
  await rejects("the app cannot switch on a paid provider", MILAN, `update public.yt_channels set providers='{"llm":"claude"}' where id=$1`, [ch]);
  await rejects("the app cannot set providers on a new channel", MILAN, `insert into public.yt_channels(studio_id,name,providers) values($1,'Duur','{"video":"veo"}')`, [hh]);
  await noneAffected("child cannot change a profile", CHILD, "update public.yt_channels set concept_auto_approve=true");
  await noneAffected("stranger cannot change a profile", STRANGER, "update public.yt_channels set banned_words='{}'");
  await rejects("dashboard still cannot link a YouTube channel", MILAN, "update public.yt_channels set youtube_channel_id='UCzzzzzzzzzzzzzzzzzzzzzz' where id=$1", [ch]);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
