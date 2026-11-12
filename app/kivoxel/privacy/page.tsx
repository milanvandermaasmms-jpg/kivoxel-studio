export const metadata = { title: "Privacy policy" };

const UPDATED = "12 November 2026";

/**
 * Privacy policy for the Google OAuth consent screen. Every statement here describes what the code really does
 * (worker/youtube.ts, worker/youtubeStats.ts, migrations 036-043). Change this page when that changes.
 */
export default function KivoxelPrivacy() {
  return (
    <article className="space-y-6 text-sm leading-6 text-slate-700">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Privacy policy</h1>
        <p className="text-slate-500">Kivoxel Studio · last updated {UPDATED}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Who uses Kivoxel Studio</h2>
        <p>
          Kivoxel Studio is a private tool used only by the owner of the YouTube channel Kivoxel. It is not offered to the public. Only that owner signs in with Google.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">What we access through Google</h2>
        <p>With the owner&apos;s consent, Kivoxel Studio asks Google for these permissions:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>youtube.upload</strong>: to upload videos to the owner&apos;s own channel.
          </li>
          <li>
            <strong>youtube.force-ssl</strong>: to manage the owner&apos;s own videos: visibility, scheduled time, captions and thumbnail.
          </li>
          <li>
            <strong>yt-analytics.readonly</strong>: to read the statistics of the owner&apos;s own channel (read only).
          </li>
        </ul>
        <p>
          We do not request revenue data. We do not read any data about individual viewers: YouTube only provides totals, such as numbers of views, likes and comments, watch time and audience retention.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Where it is stored</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The sign-in tokens from Google are stored only on the owner&apos;s own computer, encrypted with AES-256-GCM. They are never stored in the browser or in a database, and never sent anywhere except to Google.
          </li>
          <li>
            The connection status and the channel statistics are stored in a private database. Only the channel owner can read it, behind a login. The connection status is the channel ID, name and picture, and the time of the last sync. The statistics are stored as hourly snapshots of totals.
          </li>
          <li>Old hourly snapshots are reduced to one per day after 8 days.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">What we never do</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>We do not sell, rent or share data from Google with anyone.</li>
          <li>We do not use it for advertising.</li>
          <li>We do not use it to train AI models.</li>
          <li>We do not publish anything without an explicit click by the owner.</li>
        </ul>
        <p>
          Kivoxel Studio&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-cyan-700 underline underline-offset-2">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Revoking access and deleting data</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The owner can disconnect at any time in Kivoxel Studio (Settings, &quot;Ontkoppelen&quot;). This revokes the access at Google and deletes the tokens on the computer.
          </li>
          <li>
            Access can also be revoked at{" "}
            <a href="https://myaccount.google.com/permissions" className="text-cyan-700 underline underline-offset-2">
              myaccount.google.com/permissions
            </a>
            .
          </li>
          <li>The stored statistics can be deleted on request of the owner.</li>
        </ul>
        <p>
          YouTube&apos;s own handling of data is described in the{" "}
          <a href="https://www.youtube.com/t/terms" className="text-cyan-700 underline underline-offset-2">
            YouTube Terms of Service
          </a>{" "}
          and the{" "}
          <a href="https://policies.google.com/privacy" className="text-cyan-700 underline underline-offset-2">
            Google Privacy Policy
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Nederlands (samenvatting)</h2>
        <p>
          Kivoxel Studio gebruikt de toegang tot YouTube alleen om video&apos;s op het eigen kanaal te zetten en te beheren, en om de eigen cijfers te lezen. De sleutels van Google staan versleuteld op de eigen pc. Cijfers zijn totalen, zonder gegevens over individuele kijkers. Er wordt niets verkocht of gedeeld, en niets gepubliceerd zonder een bewuste klik van de eigenaar. Intrekken kan in de app (Ontkoppelen) of via myaccount.google.com/permissions.
        </p>
      </section>
    </article>
  );
}
