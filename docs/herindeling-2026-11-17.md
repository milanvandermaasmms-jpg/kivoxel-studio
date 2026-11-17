# Herindeling 17-11-2026: "opname 17-11 Dane en Maes"

Op verzoek van Milan opnieuw ingedeeld met de nieuwe verdeling (hoogstens 2 lange video's, Shorts zonder maximum).
De 7 oude delen (7 lange video's, goedgekeurd, niet op YouTube) zijn gearchiveerd. Daarna is een gratis herindeling
(`analyse` met `replan: true`) in de wachtrij gezet, op basis van de 25 momenten die al gevonden waren. De 6 Shorts zijn blijven staan.

Terugzetten (in de Studio of met de SQL Editor):

```sql
update public.yt_videos set status = 'approved' where status = 'archived' and id in (
  '86b63d83-42ab-4b02-81e5-2712717af30c', '43971cc4-a59b-4912-9bbc-62b465004018', '3b3ae039-fd8d-4f7b-9094-b19debafcf13',
  'ad3be71b-0b77-455b-bf6d-397566c95a56', '926297e2-125b-428d-a6fc-a1e79576b161', '748005d4-b481-416f-aa50-2f91e488d2df',
  '2580d96c-550d-422d-9f31-2f257940d57b');
```
