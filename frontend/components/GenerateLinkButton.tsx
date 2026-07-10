'use client';

import { useEffect, useState } from 'react';

interface Props {
  slug: string;
}

export function GenerateLinkButton({ slug }: Props) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');
  useEffect(() => { setUrl(`${window.location.origin}/api/f/${slug}/direct`); }, [slug]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!url}
      className="flex min-h-[44px] w-full items-center justify-center gap-2 border-2 border-surface-variant text-on-surface-variant font-mono text-sm uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
    >
      [ {copied ? 'COPIED!' : url ? 'GENERATE DIRECT LINK' : 'LOADING...'} ]
    </button>
  );
}

export default GenerateLinkButton;
