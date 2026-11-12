import type { Metadata } from "next";
import Link from "next/link";

// Public pages of Kivoxel Studio (no login): the homepage and the privacy statement that Google asks for
// on the OAuth consent screen. Nothing of the family app or its data is shown here.
export const metadata: Metadata = {
  title: { default: "Kivoxel Studio", template: "%s · Kivoxel Studio" },
  description: "Private production tool for the YouTube channel Kivoxel.",
};

export default function KivoxelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="studio min-h-screen bg-slate-50">
      <header className="studio-header border-b border-slate-200">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          <Link href="/kivoxel" className="text-lg font-semibold tracking-tight">
            Kivoxel Studio
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/kivoxel" className="text-slate-600 hover:text-slate-900">
              Home
            </Link>
            <Link href="/kivoxel/privacy" className="text-slate-600 hover:text-slate-900">
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
