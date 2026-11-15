# Video-inventaris (gemeten 15-11-2026)

Bron: de studio-database zelf (ingelogd als Milan, via de app; geen service-sleutel), tabellen `yt_videos`, `yt_recordings`, `yt_scripts`, `yt_renders`, `yt_viral_checks`, `yt_publications`, `yt_video_snapshots`. Gearchiveerde video's en testdata niet meegeteld.

## Samenvatting
- **70 KIVOXEL-video's**: 18 lang, 52 Shorts. **21 live** op YouTube, **49 niet live** (de 49 uit de opdracht). Dreamnest: 1 aflevering (60 min), apart, zie `docs/incident-dreamnest-93.md`.
- Stem: Google TTS Chirp3-HD, eerst **Charon**, later **Fenrir** (gratis deel).
- **Spreektijd** (geschat: woorden ÷ 2,6 woord/s ÷ lengte):
  - Lange video's: gemiddeld **20%** van de tijd wordt er gesproken (14-44%); langste stilte tot **144 s**.
  - Shorts: gemiddeld **40%** (11-70%); stiltes tot 12 s.
  - → Bevestigt "scripts te kort, te veel stilte" (bevestigd, gemeten).
- **Feitelijke fouten** (bevestigd door Milans notities bij 13 video's): verkeerde gezondheid/harten, "het is niet donker en hij valt niet", en vier keer "rewrite as a real story". De verteltekst wordt niet gecontroleerd tegen het beeld.
- **Viral-score (AI) zegt weinig**: alle 49 niet-live video's scoren 7,0-9,1; van de live Shorts met score 8-8,5 haalden er twee 8 en 371 weergaven. Ongevalideerde voorspelling (hypothese: de score meet het script, niet het beeld).
- **YouTube-cijfers**: weergaven komen binnen; **kijkpercentage/kijkduur zijn bij alle video's leeg** (Analytics-gegevens ontbreken; moet worden nagekeken: koppeling of vertraging).
- **Wat het beste liep (live, alleen weergaven, n=21, correlatie geen oorzaak)**: vijf Shorts rond 900-1200 weergaven, allemaal grot/donker/gevaar, stem Charon, opnames 11-11 en 12-11. De Short met de meeste weergaven per woord ("Spider Drops on You") had maar 10 woorden. Lange video's: 0-26 weergaven.

## Per video
Spreektijd = geschat aandeel van de video met voice-over. "Viral (AI)" = interne voorspelling, geen YouTube-cijfer.

| # | ID | Titel | Soort | Status | Opname | Lengte | Stem | Woorden | Spreektijd % | Langste stilte | Viral (AI) | Weergaven | Notitie van Milan |
|---:|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 7ee46d12 | Minecraft PS5 Survival Part 1 (Part 1) | Lang deel 1/2 | niet live | 14-11 1gb | 9:30 | Fenrir | 238 | 16 | 57 s | 7 | - |  |
| 2 | 2437b6d3 | Minecraft Strip Mining Gone Wrong in Lava | Short | niet live | 14-11 1.8gb | 0:35 | Fenrir | 45 | 50 | 8 s | 8.4 | - |  |
| 3 | b35ce465 | Minecraft Cave Ledge Death in Lava on Bedrock | Short | niet live | 14-11 1.8gb | 0:35 | Fenrir | 39 | 43 | 9 s | 8.1 | - |  |
| 4 | 22d585b1 | Minecraft Creeper Explosion in a Dark Cave Survival | Short | niet live | 14-11 1.8gb | 0:35 | Fenrir | 36 | 40 | 10 s | 8.5 | - |  |
| 5 | 0df2d5b2 | Minecraft Rare Diamond Ore Found in Dark Cave | Short | niet live | 14-11 3gb | 0:37 | Fenrir | 38 | 40 | 6 s | 8 | - |  |
| 6 | 99152d14 | Minecraft Zombie Ambush Left Me With Half a Heart | Short | niet live | 14-11 3gb | 0:35 | Fenrir | 35 | 39 | 9 s | 8.8 | - |  |
| 7 | 22247671 | Minecraft PS5 Bedrock Survival Finale - Iron Golem Defeat (Part 2) | Lang deel 2/2 | niet live | 14-11 1gb | 8:25 | Fenrir | 220 | 17 | 67 s | 7.4 | - |  |
| 8 | 73226e56 | Minecraft Underground Survival: Escaping The Creeper Blast (Part 2) | Lang deel 2/4 | niet live | 14-11 3gb | 6:46 | Fenrir | 201 | 19 | 125 s | 7.6 | - |  |
| 9 | 0a7a9a9b | Minecraft PS5 Bedrock Survival Finale: Defeating Pillagers (Part 4) | Lang deel 4/4 | niet live | 14-11 3gb | 8:50 | Fenrir | 194 | 14 | 144 s | 7.4 | - |  |
| 10 | f4a94059 | Minecraft Iron Golem Attack Goes Horribly Wrong | Short | niet live | 14-11 1gb | 0:35 | Fenrir | 36 | 40 | 9 s | 8.5 | - |  |
| 11 | 695b001d | Minecraft Iron Golem and Piglin Cliff Trap Escape | Short | niet live | 14-11 1gb | 0:35 | Fenrir | 41 | 46 | 7 s | 8.6 | - |  |
| 12 | 990e78c9 | Minecraft Bedrock Near Death Escape From Mob Trap | Short | niet live | 14-11 1gb | 0:35 | Fenrir | 27 | 30 | 10 s | 8.4 | - |  |
| 13 | 3d965f2b | How Did We Survive This Sudden Zombie Ambush? | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 54 | 60 | 3 s | - | 6 | Health is about half the bar, not half a heart and not critical. |
| 14 | 671f61f9 | How Did We Survive This Brutal Guardian Attack Underwater? | Short | live | 11-11 minecraft | 0:35 | Charon | 32 | 36 | 11 s | - | 9 | Never mention hearts, health levels |
| 15 | de35e8dc | Minecraft Cave Survival Against a Sudden Zombie Swarm | Short | live | 11-11 minecraft | 0:35 | Charon | 50 | 56 | 8 s | 8 | 371 | Health stays full in this clip. |
| 16 | c1fb40f7 | Minecraft Cave Survival: Surviving the Creeper and Zombie Swarms | Lang | live | 11-11 minecraft | 10:49 | Charon | 236 | 14 | 87 s | - | 9 | Vervangen door een zelf samengestelde lange video zonder zwakke hoofdstukken. |
| 17 | 13f0b03d | How Did We Survive This Sudden Dark Drop? | Short | live | Minecraft 20261112195128 | 0:25 | Charon | 30 | 47 | 6 s | - | 6 |  |
| 18 | 01820ce5 | Minecraft PS5 Survival Story Part 1 Snow Village Attack | Lang deel 1/5 | live | the one who watches | 5:38 | Charon | 200 | 23 | 55 s | 6.9 | 0 |  |
| 19 | 4a2b4ae9 | Minecraft Cave Creeper Blast Survival in Bedrock Edition | Short | live | 11-11 minecraft | 0:35 | Charon | 38 | 42 | 8 s | - | 1163 |  |
| 20 | e2d65aaa | Minecraft Survival Part 3: Finding Diamonds and Crafting Full Armor | Lang deel 3/4 | niet live | 14-11 3gb | 7:41 | Fenrir | 529 | 44 | 87 s | 7.2 | - |  |
| 21 | e0acfcc3 | How Did We Survive This Pitch Black Monster Attack? | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 27 | 30 | 9 s | - | 908 | Never mention hearts, health levels |
| 22 | e37eee14 | Minecraft Cave Survival: Surviving Creepers and Deadly Lava | Lang | niet live | 14-11 1.8gb | 5:36 | Fenrir | 146 | 17 | 35 s | 7.3 | - |  |
| 23 | ba6f3087 | Minecraft: A creeper explodes right in the middle of a tight cave | Lang | live | 11-11 minecraft | 8:51 | Charon | 195 | 14 | 58 s | - | 26 | Rewrite the narration as a real story |
| 24 | adee8ce5 | Minecraft Cave Survival: Defending Against the Sudden Spider Attack | Short | live | 11-11 minecraft | 0:35 | Charon | 27 | 30 | 9 s | - | 18 |  |
| 25 | 437329e5 | How This Underground Base Survived a Direct Creeper Blast | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 29 | 32 | 10 s | - | 12 | Never mention hearts, health levels |
| 26 | d7835944 | Minecraft Cave Survival: Destroying the Spider Spawner | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 30 | 33 | 9 s | - | 30 | Never mention hearts, health levels |
| 27 | 425c621e | Minecraft Mineshaft Zombie Ambush Survival | Short | niet live | 14-11 3gb | 0:35 | Fenrir | 36 | 40 | 5 s | 8.7 | - |  |
| 28 | 9c5f4480 | How to Survive Lava and a Husk Underground | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 22 | 24 | 10 s | - | 1047 | Never mention hearts, health levels |
| 29 | b87c6840 | Minecraft Cave Survival: Fighting Spiders in the Dark | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 42 | 47 | 4 s | - | 23 |  |
| 30 | 44ff1474 | Minecraft PS5 Survival Part 1: Finding Diamonds and Surviving Caves | Lang deel 1/4 | niet live | 14-11 3gb | 9:33 | Fenrir | 301 | 20 | 44 s | 7.4 | - |  |
| 31 | 94e6e303 | Minecraft Cave Survival: Escaping the Mineshaft and Lava | Lang | live | Minecraft 20261112195128 | 9:29 | Charon | 260 | 18 | 42 s | - | 4 | Rewrite the narration as a real story |
| 32 | 6d89d005 | Can We Survive This Massive Zombie Raid Underground? | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 32 | 36 | 9 s | - | 10 |  |
| 33 | 3f199f8c | What Happens When a Spider Drops on You Underground? | Short | live | Minecraft 20261112195128 | 0:35 | Charon | 10 | 11 | 12 s | - | 1124 |  |
| 34 | 9cfba032 | Minecraft Bedrock Survival Snowy Ambush Near Death | Short | niet live | 14-11 1gb | 0:35 | Fenrir | 53 | 59 | 4 s | 8.5 | - |  |
| 35 | 158c61a0 | Minecraft: Escaping the dark cave just in time | Short | live | 11-11 minecraft | 0:35 | Charon | 50 | 56 | 8 s | - | 1178 | Health is about half the whole time; never one heart. |
| 36 | dc34f63d | Defending Our Underground Base From Zombies and Creepers | Lang | live | Minecraft 20261112195128 | 7:30 | Charon | 172 | 15 | 54 s | - | 19 | Rewrite the narration as a real story |
| 37 | 3f3a150f | Minecraft Glowing Ice Creeper Cave Ambush Survival | Short | niet live | the one who watches | 0:35 | Charon | 42 | 47 | 5 s | 8.9 | - |  |
| 38 | 86374981 | Minecraft Base Invaded by Mysterious Shadow Figures | Short | niet live | the one who watches | 0:27 | Charon | 17 | 24 | 10 s | 8.5 | - |  |
| 39 | 2aeabcaa | Minecraft Charged Creeper Explosion Survival in Snow | Short | niet live | the one who watches | 0:35 | Charon | 26 | 29 | 8 s | 8.4 | - |  |
| 40 | b712a29c | Minecraft Hardcore Survival: Deadly Falls and Shadowy Figures | Lang | niet live | the one who watches | 8:28 | Charon | 223 | 17 | 36 s | 7.1 | - |  |
| 41 | f43a5a33 | Minecraft Creeper Explosion Survival with Half a Heart | Short | niet live | the one who watches | 0:35 | Charon | 42 | 47 | 5 s | 8.8 | - |  |
| 42 | 144be595 | Minecraft Night Ambush: Escaping the Skeleton Horsemen Swarm | Short | niet live | the one who watches | 0:35 | Charon | 30 | 33 | 5 s | 8.8 | - |  |
| 43 | 63fa40e4 | Minecraft PS5 Bedrock Survival Platform Ambush (Part 3) | Lang deel 3/5 | niet live | the one who watches | 7:18 | Charon | 296 | 26 | 36 s | 7.6 | - |  |
| 44 | 28154e39 | Minecraft PS5 Survival Part 4: Ice-Creeper Cave Ambush | Lang deel 4/5 | niet live | the one who watches | 8:16 | Charon | 347 | 27 | 55 s | 7.9 | - |  |
| 45 | e961ad32 | Minecraft PS5 Survival Ending: Shadowy Figures in Base (Part 5) | Lang deel 5/5 | niet live | the one who watches | 7:32 | Charon | 220 | 19 | 64 s | 7.1 | - |  |
| 46 | c8486cc3 | Minecraft Fatal Cave Drop Ends in Instant Death | Short | live | the one who watches | 0:35 | Charon | 39 | 43 | 10 s | 8.5 | 8 |  |
| 47 | 07bdae4f | Minecraft PS5 Survival Part 2 - Charged Creeper Explosion | Lang deel 2/5 | niet live | the one who watches | 9:56 | Charon | 288 | 19 | 115 s | 7 | - |  |
| 48 | 93546d0e | Minecraft Ruined Treehouse Secret Book Discovery | Short | niet live | 14-11 800 | 0:37 | Fenrir | 37 | 39 | 11 s | 7.3 | - |  |
| 49 | 4c0fff62 | Minecraft Black Entity Appears Behind Me in Village | Short | niet live | 14-11 800 | 0:33 | Fenrir | 30 | 35 | 9 s | 8.5 | - |  |
| 50 | 83949218 | Minecraft Ender Pearl Fail on Hardcore Cliff | Short | niet live | 14-11 klein | 0:35 | Fenrir | 46 | 51 | 6 s | 8.3 | - |  |
| 51 | cd76752a | Minecraft Deepslate Diamond Vein Discovery in Survival | Short | niet live | 14-11 3gb | 0:37 | Fenrir | 48 | 51 | 5 s | 8.5 | - |  |
| 52 | 9ff1fa34 | Minecraft Bedrock Outpost Ambush Survived With Shield | Short | niet live | 14-11 3gb | 0:35 | Fenrir | 51 | 57 | 8 s | 8.4 | - |  |
| 53 | 3e06eccc | Minecraft Black Entity Appears in Village During Pause | Short | niet live | 14-11 800 | 0:29 | Fenrir | 29 | 38 | 9 s | 7.5 | - |  |
| 54 | 7f7b8849 | Minecraft Mysterious Black Figure With Glowing Eyes Spotted | Short | niet live | 14-11 800 | 0:27 | Fenrir | 21 | 30 | 9 s | 8.3 | - |  |
| 55 | e57fdd71 | Minecraft Iron Golem Attack Survival in Village | Short | niet live | 14-11 800 | 0:35 | Fenrir | 34 | 38 | 9 s | 8.5 | - |  |
| 56 | 534aba02 | Minecraft Bedrock player survives massive fall with half a heart | Short | niet live | 14-11 klein | 0:21 | Fenrir | 30 | 56 | 6 s | 8.4 | - |  |
| 57 | 56e3c604 | Minecraft Bedrock PS5: Overleven met een halve hart | Short | niet live | 14-11 klein | 0:35 | Fenrir | 18 | 20 | 10 s | 8.5 | - |  |
| 58 | 5e6f4717 | Minecraft PS5 Ender Pearl Fail and Death Screen | Short | niet live | 14-11 klein | 0:35 | Fenrir | 31 | 35 | 10 s | 8.5 | - |  |
| 59 | 6caf377c | Minecraft Iron Pickaxe Crafting Speedrun in Bedrock Edition | Short | niet live | 14-11 23 | 0:35 | Fenrir | 64 | 70 | 4 s | 8.9 | - |  |
| 60 | b0e67a1c | Minecraft Rare Village Loot Discovery | Short | niet live | 14-11 23 | 0:37 | Fenrir | 30 | 32 | 11 s | 8.4 | - |  |
| 61 | f37f5b10 | Minecraft Surviving Underwater With Zero Air and Half a Heart | Short | niet live | Hardcore Dane!! | 0:35 | Fenrir | 23 | 26 | 5 s | 8.8 | - |  |
| 62 | 6d768457 | Minecraft PS5 Survival: Finding Rare Diamonds and Epic Loot! | Lang | niet live | Hardcore Dane!! | 5:01 | Fenrir | 226 | 29 | 27 s | 7.6 | - |  |
| 63 | f3719796 | Minecraft Hardcore Cow Attack Surviving On One Heart | Short | niet live | Hardcore Dane!! | 0:35 | Fenrir | 29 | 32 | 10 s | 8.5 | - |  |
| 64 | b41ff026 | Minecraft Creeper Jump Scare in the Dark Night | Short | niet live | Hardcore Dane!! | 0:35 | Fenrir | 37 | 41 | 9 s | 8.1 | - |  |
| 65 | 8a5e3562 | Minecraft PS5 Bedrock Finding Secret Diamond Chests | Short | niet live | Hardcore Dane!! | 0:36 | Fenrir | 32 | 34 | 4 s | 8.3 | - |  |
| 66 | 6a6318ba | Minecraft Cave Mob Ambush Survival | Short | niet live | 14-11 3gb | 0:35 | Fenrir | 33 | 37 | 4 s | 9.1 | - |  |
| 67 | 5f00829a | Minecraft Digging Straight Down on Half a Heart Challenge | Short | niet live | Hardcore Dane!! | 0:35 | Fenrir | 45 | 50 | 4 s | 8.7 | - | klopt niet! het is niet donker en hij valt niet |
| 68 | 51b07b98 | Worst Cave Death Ever in Minecraft PS5 | Short | live | Hardcore Dane v2 | 0:31 | Fenrir | 29 | 36 | 9 s | 8.3 | 6 |  |
| 69 | a307b239 | Minecraft Creeper Jump Scare in the Dark Night | Short | niet live | Hardcore Dane!! | 0:35 | Fenrir | 22 | 24 | 5 s | 8.7 | - |  |
| 70 | 413ae9a9 | Minecraft Village Secret Mobs Hiding Inside Daylight | Short | niet live | Hardcore Dane!! | 0:37 | Fenrir | 43 | 45 | 4 s | 8.8 | - |  |

Opmerkingen: nr. 64 en 69 hebben dezelfde titel (dubbel moment); nr. 57 heeft een Nederlandse titel op een Engels kanaal; nr. 1 heeft "(Part 1)" dubbel in de titel.
