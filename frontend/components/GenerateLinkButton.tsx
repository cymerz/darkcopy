'use client';

export function GenerateLinkButton() {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(window.location.href)}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-surface-variant text-on-surface-variant font-mono text-sm uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary active:translate-y-[2px]"
    >
      [ GENERATE LINK ]
    </button>
  );
}

export default GenerateLinkButton;
