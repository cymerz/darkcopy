'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';

function QRGeneratorContent() {
  const searchParams = useSearchParams();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Read path query parameter if present
  useEffect(() => {
    if (!searchParams) return;
    const pathParam = searchParams.get('path');
    if (pathParam) {
      setText(`${window.location.origin}${pathParam}`);
    }
  }, [searchParams]);

  // Generate QR Code on text change
  useEffect(() => {
    if (!text.trim()) {
      setError(null);
      // Clear canvas
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
      return;
    }

    const generateQR = async () => {
      try {
        setError(null);
        if (canvasRef.current) {
          await QRCode.toCanvas(canvasRef.current, text, {
            width: 300,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#ffffff',
            },
            errorCorrectionLevel: 'M',
          });
        }
      } catch (err: any) {
        console.error(err);
        setError(err?.message || 'Failed to generate QR Code');
      }
    };

    generateQR();
  }, [text]);

  const handleDownload = () => {
    if (!canvasRef.current || !text.trim()) return;

    try {
      const url = canvasRef.current.toDataURL('image/png');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `qr-code-${encodeURIComponent(text.substring(0, 20))}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      {/* Terminal-style header */}
      <div className="border-2 border-secondary bg-secondary/5 px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-success-green animate-terminal-blink" />
            </div>
            <h1 className="font-mono text-sm text-secondary uppercase tracking-wider">
              {'>'} QR_GENERATOR.SYS
            </h1>
          </div>
          <span className="text-label-caps text-outline">STATUS: ONLINE</span>
        </div>
      </div>

      <div className="border-2 border-surface-variant bg-surface-container-lowest p-6 space-y-6">
        {/* Input Form */}
        <div className="space-y-2">
          <label htmlFor="qr-input" className="text-label-caps text-outline block">
            ENTER URL OR TEXT
          </label>
          <input
            id="qr-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="https://example.com/..."
            className="w-full bg-terminal-bg border-2 border-surface-variant px-4 py-2.5 font-mono text-sm text-on-surface focus:border-secondary focus:outline-none transition-colors"
          />
        </div>

        {/* QR Code Output Screen */}
        <div className="border-2 border-surface-variant bg-terminal-bg p-6 flex flex-col items-center justify-center min-h-[340px] rounded-lg">
          {text.trim() ? (
            <div className="space-y-4 flex flex-col items-center">
              <div className="bg-white p-3 rounded-lg border-2 border-surface-variant">
                <canvas ref={canvasRef} className="max-w-full h-auto block" />
              </div>
              {error && (
                <p className="text-xs font-mono text-danger-red uppercase tracking-wider">
                  ERROR: {error}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs font-mono text-outline uppercase tracking-wider">
              AWAITING INPUT...
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleDownload}
            disabled={!text.trim() || !!error}
            className="flex-1 inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary font-mono font-bold text-sm uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)] active:translate-y-[2px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            DOWNLOAD QR CODE
          </button>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center border-2 border-surface-variant text-on-surface-variant font-mono text-sm uppercase tracking-wider transition-all hover:border-secondary hover:text-secondary px-6"
          >
            BACK TO HOME
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function QRGeneratorPage() {
  return (
    <Suspense fallback={
      <div className="text-center font-mono text-xs text-outline py-12 uppercase tracking-wider">
        LOADING GENERATOR...
      </div>
    }>
      <QRGeneratorContent />
    </Suspense>
  );
}
