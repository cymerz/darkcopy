import { getRecentPastes } from '@/lib/api';
import { PasteList } from '@/components/PasteList';
import { FileList } from '@/components/FileList';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let pastes = [];
  let files = [];
  try {
    const result = await getRecentPastes();
    pastes = result.pastes ?? [];
    files = result.files ?? [];
  } catch (error) {
    console.error('Failed to load paste and file list:', error);
    throw error;
  }

  return (
    <div className="space-y-10 md:space-y-14">
      {/* Hero Section */}
      <div className="text-center space-y-5 max-w-3xl mx-auto py-8 md:py-12">
        <h1 className="font-display text-headline-xl text-secondary drop-shadow-[0_0_30px_rgba(76,215,246,0.5)]">
          DARKCOPY
        </h1>
        <p className="text-body-md text-on-surface-variant font-mono">
          [ SHARE TEXT & FILES ANONYMOUSLY, SECURELY, AND INSTANTLY ]
        </p>
        <p className="text-sm text-on-surface-variant font-mono max-w-xl mx-auto leading-relaxed">
          A no-registration platform for sharing encrypted pastes and temporary files with automatic expiry & password protection.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link
            href="/new"
            className="inline-flex min-h-[44px] items-center justify-center gap-2.5 border-2 border-secondary text-secondary px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)] active:translate-y-[2px]"
          >
            {'>'} CREATE PASTE
          </Link>
          <Link
            href="/upload"
            className="inline-flex min-h-[44px] items-center justify-center gap-2.5 border-2 border-hot-pink text-hot-pink px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-hot-pink hover:text-black hover:shadow-[0_0_20px_rgba(244,114,182,0.4)] active:translate-y-[2px]"
          >
            {'>'} UPLOAD FILE
          </Link>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
        <section className="space-y-4">
          <h2 className="text-label-caps text-secondary flex items-center gap-2">
            <span className="w-2 h-2 bg-secondary animate-terminal-blink" />
            LATEST PUBLIC PASTES
          </h2>
          <PasteList pastes={pastes} />
        </section>

        <section className="space-y-4">
          <h2 className="text-label-caps text-secondary flex items-center gap-2">
            <span className="w-2 h-2 bg-secondary animate-terminal-blink" />
            LATEST PUBLIC FILES
          </h2>
          <FileList files={files} />
        </section>
      </div>

      {/* Security Notice */}
      <div className="border-2 border-outline-variant bg-surface-container-lowest px-6 py-4 text-center max-w-2xl mx-auto">
        <p className="text-xs text-on-surface-variant font-mono uppercase tracking-wider">
          <span className="text-tertiary">⚠ WARNING:</span> DARKCOPY IS AN ANONYMOUS CONTENT SHARING SERVICE. WE ARE NOT RESPONSIBLE FOR ANY CONTENT UPLOADED BY USERS. ILLEGAL CONTENT MAY BE REPORTED FOR REMOVAL.
        </p>
      </div>
    </div>
  );
}
