import { ErrorDisplay } from '@/components/ErrorDisplay';

/**
 * App Router 404 page (Req 7.1).
 *
 * Rendered whenever a route doesn't match or a Server Component calls
 * Next.js's `notFound()` (e.g. when the backend returns HTTP 404 for a paste
 * or file slug). This is a Server Component — it has no interactivity beyond a
 * navigational link, so it intentionally omits the `'use client'` directive.
 *
 * Per Req 7.1 it shows the title "Not Found", an illustrative icon, and a
 * "Kembali ke Home" action. The dark-themed presentation is provided by the
 * shared {@link ErrorDisplay} component (Req 7.5).
 */
export default function NotFound() {
  return (
    <ErrorDisplay
      title="Not Found"
      message="The page or content you are looking for was not found. The link may be incorrect or the content has been removed."
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      }
      action={{ label: 'Kembali ke Home', href: '/' }}
    />
  );
}
