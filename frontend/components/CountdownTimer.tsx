'use client';

import { useEffect, useState } from 'react';
import { formatRemainingTime } from '@/lib/utils';

interface CountdownTimerProps {
  remainingSeconds: number;
}

export function CountdownTimer({ remainingSeconds }: CountdownTimerProps) {
  const [seconds, setSeconds] = useState(remainingSeconds);
  const [prevRemaining, setPrevRemaining] = useState(remainingSeconds);
  if (prevRemaining !== remainingSeconds) { setPrevRemaining(remainingSeconds); setSeconds(remainingSeconds); }

  useEffect(() => {
    if (remainingSeconds <= 0) return;
    const id = setInterval(() => { setSeconds((prev) => { const n = prev - 60; if (n <= 0) { clearInterval(id); return 0; } return n; }); }, 60000);
    return () => clearInterval(id);
  }, [remainingSeconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-tertiary border border-tertiary px-2 py-0.5" aria-live="polite">
      <span className="animate-terminal-blink">⏱</span> {formatRemainingTime(seconds)}
    </span>
  );
}

export default CountdownTimer;
