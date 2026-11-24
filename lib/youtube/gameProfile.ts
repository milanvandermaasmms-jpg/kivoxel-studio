// Channel profiles for the gaming channels (Milan, 18-11-2026): KIVOXEL plays Minecraft, SpawnNado plays a mix of
// Fortnite, Roblox, GTA, Call of Duty and Minecraft. Everything else (presets, montage, Shorts plus at most 2 long
// videos, upload and review) is the same; only the name and the games differ. The game of a recording comes from its
// label (Milan picks it at upload, or the inbox file name says it), else from the analysis, else the channel's default.
// KIVOXEL must behave exactly as before: its texts below are the old fixed Minecraft texts, word for word.
// Video content is always English (decision 16-11-2026).

export const GAME_IDS = ["minecraft", "fortnite", "roblox", "gta", "cod"] as const;
export type GameId = (typeof GAME_IDS)[number];

export type Game = {
  id: GameId;
  /** "Minecraft": the search keyword at the front of a title. */
  name: string;
  /** "Minecraft (PS5 Bedrock and PC Java)": how the prompts name the game. */
  subject: string;
  /** What the analysis gets: "raw Minecraft survival gameplay (PS5 Bedrock or PC Java Edition)". */
  gameplay: string;
  /** What the analysis should look out for. */
  focus: string;
  /** Extra narration rule (kid-friendly words for shooters), or null. */
  toneNote: string | null;
  /** Recognises the game in a recording label or file name. */
  match: RegExp;
  tags: string[];
  shortTags: string[];
  longTags: string[];
  hashtag: string;
  longHashtag: string;
  /** Words in a title that are worth a tag of their own, with the tag they become. */
  topics: [RegExp, string[]][];
  /** Reference searches for the weekly viral reference (YouTube Data API). */
  queries: string[];
};

const KID_SAFE_SHOOTER =
  "Keep it kid-friendly: say \"eliminated\", \"knocked\" or \"took out\", never kill, blood, injuries or weapons details; cheer the skill and the clutch, not the violence.";

const tagged = (prefix: string, list: [RegExp, string[]][]) => list.map(([re, t]) => [re, t.map((x) => `${prefix} ${x}`)] as [RegExp, string[]]);

export const GAMES: Record<GameId, Game> = {
  minecraft: {
    id: "minecraft",
    name: "Minecraft",
    subject: "Minecraft (PS5 Bedrock and PC Java)",
    gameplay: "raw Minecraft survival gameplay (PS5 Bedrock or PC Java Edition)",
    focus: "Look especially for low health, mobs, falls or lava, rare blocks or items, and finished builds.",
    toneNote: null,
    match: /minecraft/i,
    tags: ["minecraft", "minecraft survival", "minecraft java", "minecraft bedrock", "minecraft ps5"],
    shortTags: ["minecraft shorts", "shorts"],
    longTags: ["minecraft lets play", "minecraft survival series"],
    hashtag: "#minecraft",
    longHashtag: "#minecraftsurvival",
    topics: [
      [/\btnt\b|explo/i, ["minecraft tnt", "tnt explosion"]],
      [/creeper/i, ["minecraft creeper"]],
      [/zombie|husk/i, ["minecraft zombie"]],
      [/skeleton/i, ["minecraft skeleton"]],
      [/spider/i, ["minecraft spider"]],
      [/enderman|ender pearl|\bend\b/i, ["minecraft enderman"]],
      [/iron golem|golem/i, ["minecraft iron golem"]],
      [/diamond/i, ["minecraft diamonds"]],
      [/\bcave|mine ?shaft|underground/i, ["minecraft cave", "minecraft caves"]],
      [/lava|nether/i, ["minecraft lava"]],
      [/elytra/i, ["minecraft elytra"]],
      [/\bmace\b|wind (burst|charge)/i, ["minecraft mace"]],
      [/\bpvp\b|duel|fight/i, ["minecraft pvp"]],
      [/snow|ice|frozen/i, ["minecraft snow"]],
      [/hardcore/i, ["minecraft hardcore"]],
      [/\bbuild|base|house|tower/i, ["minecraft build"]],
      [/trap/i, ["minecraft trap"]],
      [/fail|death|dies|died|dead/i, ["minecraft fails"]],
      [/funny|lol/i, ["minecraft funny moments"]],
      [/\bpart \d|series/i, ["minecraft series"]],
    ],
    queries: ["minecraft survival", "minecraft shorts"],
  },
  fortnite: {
    id: "fortnite",
    name: "Fortnite",
    subject: "Fortnite",
    gameplay: "raw Fortnite gameplay (Battle Royale, Zero Build or Creative)",
    focus: "Look especially for eliminations, close fights, low health or shield, the storm circle closing, rare loot, wins (Victory Royale) and big fails.",
    toneNote: KID_SAFE_SHOOTER,
    match: /fortnite/i,
    tags: ["fortnite", "fortnite battle royale", "fortnite zero build", "fortnite gameplay"],
    shortTags: ["fortnite shorts", "shorts"],
    longTags: ["fortnite lets play", "fortnite full match"],
    hashtag: "#fortnite",
    longHashtag: "#fortnitebattleroyale",
    topics: tagged("fortnite", [
      [/victory|win|crown/i, ["victory royale"]],
      [/clutch|1v|last/i, ["clutch"]],
      [/storm|zone|circle/i, ["endgame"]],
      [/build|box|edit/i, ["building"]],
      [/mythic|legendary|loot|chest/i, ["loot"]],
      [/fail|death|dies|died/i, ["fails"]],
      [/funny|lol/i, ["funny moments"]],
      [/\bpart \d|series/i, ["series"]],
    ]),
    queries: ["fortnite shorts", "fortnite victory royale"],
  },
  roblox: {
    id: "roblox",
    name: "Roblox",
    subject: "Roblox",
    gameplay: "raw Roblox gameplay (obbies, tycoons, horror, simulator and other Roblox games)",
    focus: "Look especially for falls and fails, close calls, jumpscares, finished stages or levels, wins, rare items and funny moments.",
    toneNote: null,
    match: /roblox/i,
    tags: ["roblox", "roblox gameplay", "roblox games"],
    shortTags: ["roblox shorts", "shorts"],
    longTags: ["roblox lets play", "roblox full game"],
    hashtag: "#roblox",
    longHashtag: "#robloxgameplay",
    topics: tagged("roblox", [
      [/obby|parkour|jump/i, ["obby"]],
      [/horror|scary|jumpscare/i, ["horror"]],
      [/tycoon/i, ["tycoon"]],
      [/brookhaven/i, ["brookhaven"]],
      [/doors/i, ["doors"]],
      [/win|first place/i, ["win"]],
      [/fail|death|dies|died|fell/i, ["fails"]],
      [/funny|lol/i, ["funny moments"]],
      [/\bpart \d|series/i, ["series"]],
    ]),
    queries: ["roblox shorts", "roblox funny moments"],
  },
  gta: {
    id: "gta",
    name: "GTA",
    subject: "GTA V (Grand Theft Auto)",
    gameplay: "raw GTA V (Grand Theft Auto) gameplay",
    focus: "Look especially for car chases, big jumps and stunts, crashes, escapes from the police, finished missions and funny fails.",
    toneNote: KID_SAFE_SHOOTER,
    match: /\bgta\b|grand theft/i,
    tags: ["gta", "gta 5", "gta v", "gta gameplay"],
    shortTags: ["gta shorts", "shorts"],
    longTags: ["gta lets play", "gta 5 gameplay"],
    hashtag: "#gta",
    longHashtag: "#gta5",
    topics: tagged("gta", [
      [/stunt|jump|ramp|flip/i, ["stunts"]],
      [/chase|police|cops|wanted/i, ["police chase"]],
      [/crash/i, ["crash"]],
      [/car|race|drive/i, ["cars"]],
      [/mission|heist/i, ["mission"]],
      [/fail|wasted/i, ["fails"]],
      [/funny|lol/i, ["funny moments"]],
      [/\bpart \d|series/i, ["series"]],
    ]),
    queries: ["gta 5 shorts", "gta funny moments"],
  },
  cod: {
    id: "cod",
    name: "Call of Duty",
    subject: "Call of Duty",
    gameplay: "raw Call of Duty gameplay (multiplayer or Warzone)",
    focus: "Look especially for multi-eliminations, clutches, close fights, low health, round or match wins, killstreak rewards and funny fails.",
    toneNote: KID_SAFE_SHOOTER,
    match: /call of duty|\bcod\b|warzone|black ops|modern warfare/i,
    tags: ["call of duty", "cod", "warzone", "call of duty gameplay"],
    shortTags: ["cod shorts", "shorts"],
    longTags: ["call of duty lets play", "warzone full match"],
    hashtag: "#callofduty",
    longHashtag: "#warzone",
    topics: tagged("cod", [
      [/clutch|1v|last/i, ["clutch"]],
      [/win|victory/i, ["win"]],
      [/streak|nuke|multi/i, ["streak"]],
      [/sniper|snipe|quickscope/i, ["sniper"]],
      [/fail|death|dies|died/i, ["fails"]],
      [/funny|lol/i, ["funny moments"]],
      [/\bpart \d|series/i, ["series"]],
    ]),
    queries: ["call of duty shorts", "warzone shorts"],
  },
};

export type ChannelProfileKey = "kivoxel" | "spawnnado";
export type ChannelProfile = {
  key: ChannelProfileKey;
  name: string;
  /** The channel's own tag (always on). */
  tag: string;
  games: GameId[];
  defaultGame: GameId;
  /** The fixed block in every description. */
  block: (game: Game, kind: "short" | "long") => string;
  /** The audio modes (config/kivoxel/presets.json) this channel may use; the first is its default. Undefined = all. */
  audioModes?: string[];
  /** Blur the fixed corners (chat, notifications) from the settings; false = never. */
  blur: boolean;
};

export const PROFILES: Record<ChannelProfileKey, ChannelProfile> = {
  kivoxel: {
    key: "kivoxel",
    name: "KIVOXEL",
    tag: "kivoxel",
    games: ["minecraft"],
    defaultGame: "minecraft",
    blur: true,
    block: (_g, kind) =>
      kind === "short"
        ? "KIVOXEL plays Minecraft survival on PS5 and PC (Java) – new Shorts every day: close calls, fails, finds and big moments.\n🔔 Subscribe so you never miss the next one!"
        : "KIVOXEL plays Minecraft survival on PS5 and PC (Java), told as a story: every close call, fail and find from the whole session.\n🔔 Subscribe for the next part!",
  },
  spawnnado: {
    key: "spawnnado",
    name: "SpawnNado",
    tag: "spawnnado",
    games: ["fortnite", "roblox", "gta", "cod", "minecraft"],
    defaultGame: "fortnite",
    // Milan, 18-11-2026: no voice, no captions and no blurred corners on SpawnNado; only music (own tune) or only game sound.
    // Milan, 23-11-2026: the voice-over split applies per channel, SpawnNado too: 1 of every 3 Shorts and 1 of every 5 long
    // videos with an English voice-over (lib/youtube/voicePlan.ts). Music without voice stays the default.
    audioModes: ["muziek_geen_vo", "alleen_game", "vo_muziek", "vo_met_muziek"],
    blur: false,
    block: (g, kind) =>
      kind === "short"
        ? `SpawnNado plays ${g.name} – new Shorts every day: clutches, fails, wins and big moments from Fortnite, Roblox, GTA, Call of Duty and Minecraft.\n🔔 Subscribe so you never miss the next one!`
        : `SpawnNado plays ${g.name}, told as a story: every clutch, fail and win from the whole session.\n🔔 Subscribe for the next part!`,
  },
};

/** The profile of a channel: SpawnNado by slug or name, every other gaming channel behaves like KIVOXEL. */
export function profileFor(channel: { slug?: string | null; name?: string | null } | null | undefined): ChannelProfile {
  return /spawn-?nado/i.test(`${channel?.slug ?? ""} ${channel?.name ?? ""}`) ? PROFILES.spawnnado : PROFILES.kivoxel;
}

/** The game a label or file name names, when it is one of the channel's games. */
export function gameInText(text: string | null | undefined, profile: ChannelProfile): GameId | null {
  if (!text) return null;
  return profile.games.find((g) => GAMES[g].match.test(text)) ?? null;
}

/** The game of a recording: from its label, else what the analysis saw, else the channel's default. */
export function recordingGame(label: string | null | undefined, profile: ChannelProfile, detected?: unknown): GameId {
  if (profile.games.length === 1) return profile.games[0];
  const fromLabel = gameInText(label, profile);
  if (fromLabel) return fromLabel;
  const seen = typeof detected === "string" ? (GAME_IDS as readonly string[]).find((g) => g === detected.toLowerCase().trim()) : undefined;
  return seen && profile.games.includes(seen as GameId) ? (seen as GameId) : profile.defaultGame;
}

/** "Fortnite · 13-11 storm" — how the upload puts the chosen game in front of the label. */
export function labelWithGame(label: string, game: GameId | null, profile: ChannelProfile): string {
  if (!game || profile.games.length === 1 || gameInText(label, profile) === game) return label;
  return `${GAMES[game].name} · ${label}`.slice(0, 200);
}

export const gameOf = (id: GameId | null | undefined): Game => GAMES[id ?? "minecraft"];

/** The audio mode a montage gets: the asked one when the channel allows it, else the channel's first mode. */
export function channelAudioMode<M extends string>(asked: M, profile: ChannelProfile): M {
  return !profile.audioModes || profile.audioModes.includes(asked) ? asked : (profile.audioModes[0] as M);
}

/**
 * 20-11-2026 (Milan: "Roblox en Fortnite staan in KIVOXEL, dit is niet oké"): KIVOXEL is only Minecraft. A recording whose
 * label or file name says SpawnNado or names another game (Fortnite, Roblox, GTA, Call of Duty) always belongs to SpawnNado,
 * whatever channel was open when it came in. Null = the text says nothing, keep the chosen channel.
 */
export function channelKeyForText(text: string | null | undefined): ChannelProfileKey | null {
  if (!text) return null;
  if (/spawn-?nado/i.test(text)) return "spawnnado";
  return GAME_IDS.some((g) => g !== "minecraft" && GAMES[g].match.test(text)) ? "spawnnado" : null;
}

/** The channel a new recording goes to: the chosen one, unless its name says it is SpawnNado's (see channelKeyForText). */
export function routeRecording<C extends { id: string; slug?: string | null; name?: string | null }>(
  channels: C[],
  chosenId: string | null | undefined,
  ...texts: (string | null | undefined)[]
): { channelId: string | null; moved: C | null } {
  const key = channelKeyForText(texts.filter(Boolean).join(" "));
  const chosen = channels.find((c) => c.id === chosenId) ?? null;
  if (!key || (chosen && profileFor(chosen).key === key)) return { channelId: chosenId ?? null, moved: null };
  const target = channels.find((c) => profileFor(c).key === key) ?? null;
  return target ? { channelId: target.id, moved: target } : { channelId: chosenId ?? null, moved: null };
}

/** Last check before anything goes to YouTube: a Fortnite/Roblox/GTA/CoD recording never goes out on KIVOXEL. */
export function wrongChannelProblem(profile: ChannelProfile, label: string | null | undefined): string | null {
  const key = channelKeyForText(label);
  if (!key || key === profile.key) return null;
  return `Niets geüpload: "${label}" is geen Minecraft en hoort bij ${PROFILES[key].name}, niet bij ${profile.name}. Zet de opname eerst bij het juiste kanaal.`;
}

/**
 * 20-11-2026 (Milan: Fortnite videos on SpawnNado were called "Minecraft ..."): in a video of another game the word
 * Minecraft never appears in titles, hooks, descriptions or tags; it becomes that game's name. Minecraft stays as it is.
 */
export function fixGameName<T extends string | null | undefined>(text: T, game: GameId): T {
  if (!text || game === "minecraft") return text;
  const name = GAMES[game].name;
  return text
    .replace(/\bminecraft\b/g, name.toLowerCase())
    .replace(/\bMINECRAFT\b/g, name.toUpperCase())
    .replace(/\bminecraft\b/gi, name) as T;
}
