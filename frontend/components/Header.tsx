'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useRef } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/new', label: 'Create Paste' },
  { href: '/upload', label: 'Upload File' },
];

function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => setIsMenuOpen(false);
  const toggleMenu = () => setIsMenuOpen((open) => !open);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
    setSearchQuery('');
    closeMenu();
  };

  return (
    <header className="sticky top-0 z-50 bg-background/95 border-b-2 border-secondary shadow-[0_0_15px_rgba(76,215,246,0.3)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="relative flex items-center justify-between h-16">
          {/* Branding */}
          <Link
            href="/"
            onClick={closeMenu}
            className="flex min-h-[44px] items-center gap-2.5 group"
            aria-label="DarkCopy home"
          >
            <span
              className="flex items-center justify-center w-9 h-9 rounded-sm bg-secondary text-background font-mono font-bold text-sm shadow-[0_0_10px_rgba(76,215,246,0.5)]"
              aria-hidden="true"
            >
              DC
            </span>
            <span className="font-mono font-bold text-lg tracking-tight text-secondary group-hover:shadow-[0_0_15px_rgba(76,215,246,0.5)] transition-shadow">
              DARKCOPY
            </span>
          </Link>

          {/* Desktop Navigation — absolutely centered */}
          <nav
            className="hidden md:flex items-center gap-1 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            aria-label="Main navigation"
          >
            {NAV_LINKS.map((link) => {
              const active = isActivePath(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative inline-flex min-h-[44px] items-center px-4 py-2.5 text-sm font-mono font-bold uppercase tracking-wider transition-colors ${
                    active
                      ? 'text-secondary border-b-2 border-secondary'
                      : 'text-on-surface-variant hover:text-secondary'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right-side controls */}
          <div className="flex items-center gap-2">
            {/* Search bar - desktop */}
            <form onSubmit={handleSearch} className="hidden md:flex items-center">
              <input
                type="search"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search pastes and files"
                className="h-9 w-32 lg:w-48 border-2 border-surface-variant bg-surface-container-lowest px-2.5 py-1.5 text-xs font-mono text-on-surface placeholder-on-surface-variant focus:border-secondary focus:outline-none transition-colors"
              />
              <button type="submit" aria-label="Search"
                className="h-9 border-2 border-l-0 border-surface-variant bg-surface-container-low px-2.5 text-xs font-mono text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">
                &gt;
              </button>
            </form>
            <ThemeToggle />
            <button
              type="button"
              onClick={toggleMenu}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-menu"
              aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
              className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-sm text-on-surface-variant hover:text-secondary border border-surface-variant hover:border-secondary transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
                aria-hidden="true"
              >
                {isMenuOpen ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="4" y1="7" x2="20" y2="7" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="17" x2="20" y2="17" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu drawer */}
      <div
        id="mobile-menu"
        className={`md:hidden absolute top-full left-0 right-0 w-full overflow-hidden border-b-2 border-surface-variant bg-surface-container-low shadow-lg transition-all duration-200 ease-out origin-top ${
          isMenuOpen
            ? 'opacity-100 translate-y-0 scale-y-100 pointer-events-auto'
            : 'opacity-0 -translate-y-2 scale-y-95 pointer-events-none'
        }`}
      >
        <nav className="flex flex-col px-4 sm:px-6 py-4 gap-1.5" aria-label="Mobile navigation">
          {/* Search - mobile */}
          <form onSubmit={(e) => { e.preventDefault(); handleSearch(e); }} className="flex mb-2">
            <input
              type="search"
              placeholder="Search pastes & files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search"
              className="flex-1 min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 text-sm font-mono text-on-surface placeholder-on-surface-variant focus:border-secondary focus:outline-none transition-colors"
            />
            <button type="submit" aria-label="Search"
              className="min-h-[44px] border-2 border-l-0 border-surface-variant bg-surface-container-low px-3 py-2.5 text-sm font-mono text-on-surface-variant hover:border-secondary hover:text-secondary transition-colors">
              &gt;
            </button>
          </form>
          {NAV_LINKS.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] items-center px-4 py-2.5 text-sm font-mono font-bold uppercase tracking-wider transition-all ${
                  active
                    ? 'text-secondary border-l-2 border-secondary bg-secondary/5'
                    : 'text-on-surface-variant hover:text-secondary hover:border-l-2 hover:border-secondary'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default Header;
