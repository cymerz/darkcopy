import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t-2 border-surface-variant bg-terminal-bg mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Left: Branding & Disclaimer */}
          <div className="flex flex-col items-center md:items-start text-center md:text-left gap-2 max-w-md">
            <p className="text-xs text-outline font-mono uppercase tracking-wider leading-relaxed">
              &copy; 2026 DARKCOPY TERMINAL SYSTEMS. UNKNOWN ORIGIN.
            </p>
            <p className="text-[10px] text-outline font-mono">
              DARKCOPY IS AN ANONYMOUS CONTENT SHARING SERVICE. WE ARE NOT RESPONSIBLE FOR ANY CONTENT UPLOADED BY USERS. ILLEGAL CONTENT MAY BE REPORTED FOR REMOVAL.
            </p>
          </div>

          {/* Right: Navigation Links */}
          <nav className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-xs font-mono text-on-surface-variant uppercase tracking-wider">
            <Link
              href="https://github.com/cymerz/darkcopy_pub"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-hot-pink focus:outline-none"
            >
              GitHub
            </Link>
            {' / '}
            <Link
              href="/new"
              className="transition-colors hover:text-hot-pink focus:outline-none"
            >
              Create Paste
            </Link>
            {' / '}
            <Link
              href="/upload"
              className="transition-colors hover:text-hot-pink focus:outline-none"
            >
              Upload File
            </Link>
            {' / '}
            <Link
              href="/admin"
              className="transition-colors hover:text-hot-pink focus:outline-none"
            >
              Admin Panel
            </Link>
            {' / '}
            <Link
              href="/tos"
              className="transition-colors hover:text-hot-pink focus:outline-none"
            >
              Terms of Service
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
