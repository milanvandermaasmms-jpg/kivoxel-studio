import Link from "next/link";

export const metadata = { title: "Kivoxel Studio" };

export default function KivoxelHome() {
  return (
    <article className="space-y-6 text-sm leading-6 text-slate-700">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Kivoxel Studio</h1>
        <p>
          Kivoxel Studio is a private production tool for the YouTube channel{" "}
          <a href="https://www.youtube.com/@Kivoxel" className="text-cyan-700 underline underline-offset-2">
            Kivoxel
          </a>
          , a faceless Minecraft gameplay channel. It is used only by the owner of that channel. It is not offered to other users.
        </p>
        <p>The tool helps the owner turn their own gameplay recordings into videos and publish them on their own channel:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>edit montages from the owner&apos;s own recordings, on the owner&apos;s own computer;</li>
          <li>upload a finished video to the owner&apos;s own YouTube channel, private by default;</li>
          <li>schedule or publish a video, add captions and a thumbnail, but only after an explicit click by the owner;</li>
          <li>show the channel&apos;s own statistics (views, watch time, retention) to the owner.</li>
        </ul>
        <p>Nothing is ever published automatically.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Nederlands</h2>
        <p>
          Kivoxel Studio is een besloten productietool voor het YouTube-kanaal Kivoxel. Alleen de eigenaar van het kanaal gebruikt hem. De tool helpt eigen gameplay-opnames te monteren, ze op het eigen kanaal te zetten (standaard privé) en de eigen cijfers te bekijken. Publiceren gebeurt nooit vanzelf, maar alleen na een bewuste klik van de eigenaar.
        </p>
      </section>

      <p>
        Read how data from Google is handled in the{" "}
        <Link href="/kivoxel/privacy" className="text-cyan-700 underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
    </article>
  );
}
