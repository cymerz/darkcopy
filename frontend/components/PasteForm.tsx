'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { createPaste } from '@/lib/api';
import { APIError } from '@/lib/types';
import type { ExpiryOption, Language } from '@/lib/types';

interface PasteFormProps {
  languages: Language[];
  expiryOptions: ExpiryOption[];
  disabled?: boolean;
}

type Visibility = 'public' | 'unlisted' | 'password_protected';

const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'public', label: 'PUBLIK' },
  { value: 'unlisted', label: 'UNLISTED' },
  { value: 'password_protected', label: 'PROTECTED' },
];

const FIELD_CLASS =
  'w-full min-h-[44px] border-2 border-surface-variant bg-surface-container-lowest px-3 py-2.5 ' +
  'text-on-surface placeholder-on-surface-variant font-mono text-sm transition-colors ' +
  'focus:border-secondary focus:outline-none focus:shadow-[0_0_10px_rgba(76,215,246,0.2)] disabled:cursor-not-allowed disabled:opacity-60';

function resolveSlug(result: { slug?: string; url?: string }): string | null {
  if (result.slug && result.slug.trim()) return result.slug.trim();
  if (result.url && result.url.trim()) {
    const trimmed = result.url.trim().replace(/\/+$/, '');
    const segment = trimmed.split('/').filter(Boolean).pop();
    if (segment) return segment;
  }
  return null;
}

export function PasteForm({ languages, expiryOptions, disabled }: PasteFormProps) {
  const router = useRouter();

  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState(languages[0]?.id ?? '');
  const [expiresIn, setExpiresIn] = useState(
    expiryOptions[0] ? String(expiryOptions[0].duration) : '',
  );
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [password, setPassword] = useState('');
  const [customSlug, setCustomSlug] = useState('');

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const isFormDisabled = isSubmitting || disabled;

  const lineCount = Math.max(1, content.split('\n').length);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new URLSearchParams();
      formData.append('content', content);
      formData.append('title', title);
      formData.append('language', language);
      formData.append('expires_in', expiresIn);
      formData.append('visibility', visibility);
      if (customSlug.trim()) formData.append('custom_slug', customSlug.trim().toLowerCase());
      if (visibility === 'password_protected') formData.append('password', password);

      const result = await createPaste(formData);
      const slug = resolveSlug(result);
      if (!slug) { setError('Gagal membuat paste. Silakan coba lagi.'); setIsSubmitting(false); return; }
      router.push(`/${slug}`);
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Terjadi kesalahan saat membuat paste.');
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {disabled && (
        <div className="border-2 border-tertiary bg-surface-container-low px-4 py-3">
          <p className="text-sm font-mono text-tertiary">⚠ PASTE CREATION SUSPENDED — SYSTEM MAINTENANCE</p>
        </div>
      )}

      {/* Content with line numbers — terminal style */}
      <div className="border-2 border-surface-variant bg-surface-container-lowest rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border-b-2 border-surface-variant">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-danger-red" />
            <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
            <span className="w-2.5 h-2.5 rounded-full bg-success-green" />
          </div>
          <span className="text-xs text-on-surface-variant font-mono uppercase tracking-wider ml-2">EDITOR</span>
          <span className="ml-auto text-xs text-on-surface-variant font-mono">paste_content.txt</span>
        </div>
        <div className="flex">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="select-none overflow-hidden bg-terminal-bg px-3 py-3 text-right font-mono text-sm leading-6 text-outline border-r-2 border-surface-variant"
          >
            {lineNumbers.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
          <textarea
            id="content"
            name="content"
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onScroll={handleTextareaScroll}
            placeholder="// PASTE YOUR CODE HERE..."
            spellCheck={false}
            rows={14}
            disabled={isFormDisabled}
            className="min-h-[280px] flex-1 resize-y bg-transparent px-3 py-3 font-mono text-sm leading-6 text-on-surface placeholder-on-surface-variant focus:outline-none disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Title */}
        <div className="space-y-2">
          <label htmlFor="title" className="text-label-caps text-secondary">PASTE_TITLE</label>
          <input type="text" id="title" name="title" value={title}
            onChange={(e) => setTitle(e.target.value)} placeholder="untitled" disabled={isFormDisabled}
            className={FIELD_CLASS} />
        </div>

        {/* Language */}
        <div className="space-y-2">
          <label htmlFor="language" className="text-label-caps text-secondary">LANGUAGE_SPEC</label>
          <select id="language" name="language" value={language}
            onChange={(e) => setLanguage(e.target.value)} disabled={isFormDisabled}
            className={FIELD_CLASS}>
            {languages.map((lang) => (
              <option key={lang.id} value={lang.id} className="bg-background">{lang.name}</option>
            ))}
          </select>
        </div>

        {/* Custom slug */}
        <div className="space-y-2">
          <label htmlFor="custom_slug" className="text-label-caps text-secondary">CUSTOM_SLUG</label>
          <div className="flex items-center border-2 border-surface-variant bg-surface-container-lowest transition-colors focus-within:border-secondary focus-within:shadow-[0_0_10px_rgba(76,215,246,0.2)]">
            <span className="shrink-0 select-none border-r-2 border-surface-variant bg-terminal-bg px-3 py-2.5 text-sm text-outline font-mono">
              {origin}/
            </span>
            <input type="text" id="custom_slug" name="custom_slug" value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="slug-kustom" disabled={isFormDisabled}
              className="min-h-[44px] flex-1 bg-transparent px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-variant font-mono focus:outline-none disabled:cursor-not-allowed" />
          </div>
          <p className="text-xs text-outline font-mono">Only lowercase letters, numbers, hyphens. Leave empty for auto-slug.</p>
        </div>

        {/* Expiry */}
        <div className="space-y-2">
          <label htmlFor="expires_in" className="text-label-caps text-secondary">EXPIRED_IN</label>
          <select id="expires_in" name="expires_in" value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value)} disabled={isFormDisabled}
            className={FIELD_CLASS}>
            {expiryOptions.map((option) => (
              <option key={option.label} value={String(option.duration)} className="bg-background">{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Visibility */}
      <fieldset className="space-y-2">
        <legend className="text-label-caps text-secondary">VISIBILITY</legend>
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:gap-3">
          {VISIBILITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 border-2 border-surface-variant bg-surface-container-lowest px-4 py-2.5 text-sm text-on-surface font-mono transition-colors hover:border-secondary has-[:checked]:border-secondary has-[:checked]:bg-secondary/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={visibility === option.value}
                onChange={() => setVisibility(option.value)}
                disabled={isFormDisabled}
                className="appearance-none w-4 h-4 border-2 border-surface-variant rounded-full checked:border-secondary checked:shadow-[inset_0_0_0_4px_#4cd7f6] transition-all"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Conditional password */}
      {visibility === 'password_protected' && (
        <div className="space-y-2">
          <label htmlFor="password" className="text-label-caps text-secondary">PASSWORD</label>
          <input type="password" id="password" name="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="********"
            autoComplete="new-password" disabled={isFormDisabled}
            className={FIELD_CLASS} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div role="alert" className="border-2 border-danger-red bg-error-container/20 px-4 py-3">
          <p className="text-sm font-mono text-error">⚠ ERROR: {error}</p>
        </div>
      )}

      {/* Submit */}
      <div>
        <button type="submit" disabled={isFormDisabled}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 border-2 border-secondary text-secondary px-8 py-3 font-mono font-bold uppercase tracking-wider transition-all duration-200 hover:bg-secondary hover:text-black hover:shadow-[0_0_20px_rgba(76,215,246,0.4)] active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting && (
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {isSubmitting ? 'INITIALIZING...' : '> CREATE PASTE'}
        </button>
      </div>
    </form>
  );
}

export default PasteForm;
