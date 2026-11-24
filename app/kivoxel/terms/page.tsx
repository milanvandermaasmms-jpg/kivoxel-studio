export const metadata = { title: "Terms of service" };

const UPDATED = "24 November 2026";

/** Terms of service, asked for by TikTok for Developers (and fitting for Google too). They describe what the tool is. */
export default function KivoxelTerms() {
  return (
    <article className="space-y-6 text-sm leading-6 text-slate-700">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Terms of service</h1>
        <p className="text-slate-500">Kivoxel Studio · last updated {UPDATED}</p>
      </header>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">What Kivoxel Studio is</h2>
        <p>Kivoxel Studio is a private production tool of the gaming channels Kivoxel and SpawnNado. It edits the owner&apos;s own gameplay recordings into videos and Shorts. It is not offered to the public; only the owner signs in.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">YouTube and TikTok</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Kivoxel Studio uploads only the owner&apos;s own videos to the owner&apos;s own YouTube channel and TikTok account, and only after the owner chose to.</li>
          <li>On TikTok, a video is placed in the owner&apos;s TikTok inbox as a draft. The owner publishes it himself in the TikTok app.</li>
          <li>Use of YouTube and TikTok through this tool is also subject to their own terms: the YouTube Terms of Service and the TikTok Terms of Service.</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Content</h2>
        <p>All gameplay, voices and music in the videos belong to the owner or are used under licence (for example Uppbeat). The tool does not use anyone else&apos;s content.</p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Privacy</h2>
        <p>How data is handled is described in the <a href="/kivoxel/privacy" className="underline underline-offset-2">privacy policy</a>.</p>
      </section>
    </article>
  );
}
