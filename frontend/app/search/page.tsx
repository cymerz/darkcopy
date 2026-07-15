import { searchPastes, searchFiles } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = q?.trim() || '';

  let pastes: any[] = [];
  let files: any[] = [];
  let errorMsg = '';

  if (query) {
    try {
      const [pastesResult, filesResult] = await Promise.all([
        searchPastes(query),
        searchFiles(query),
      ]);
      pastes = pastesResult ?? [];
      files = filesResult ?? [];
    } catch (err) {
      console.error('Search failed:', err);
      errorMsg = 'Search failed. Please try again.';
    }
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-surface-variant pb-4">
        <h1 className="font-mono text-xl font-bold text-secondary flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-secondary animate-terminal-blink" />
          SEARCH_RESULTS
        </h1>
        {query && (
          <p className="text-sm text-on-surface-variant font-mono mt-1">
            Query: <span className="text-secondary font-bold">&quot;{query}&quot;</span>
          </p>
        )}
      </div>

      {errorMsg ? (
        <div className="border-2 border-danger-red/50 bg-surface-container-low px-6 py-8 text-center">
          <p className="text-danger-red font-mono text-sm">{errorMsg}</p>
        </div>
      ) : !query ? (
        <div className="border-2 border-dashed border-surface-variant bg-surface-container-low px-6 py-12 text-center">
          <p className="text-on-surface font-mono text-sm">No query provided</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="space-y-4">
            <h2 className="text-label-caps text-secondary font-mono text-sm">
              PASTES ({pastes.length})
            </h2>
            {pastes.length > 0 ? (
              <div className="space-y-2">
                {pastes.map((p: any) => (
                  <a
                    key={p.slug}
                    href={`/${p.slug}`}
                    className="block border-2 border-surface-variant bg-surface-container-lowest px-4 py-3 hover:border-secondary transition-colors"
                  >
                    <p className="font-mono text-sm text-on-surface font-bold">{p.title || 'untitled'}</p>
                    <p className="font-mono text-xs text-on-surface-variant mt-1">{p.language} • {p.slug}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant font-mono text-sm">No pastes found</p>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-label-caps text-secondary font-mono text-sm">
              FILES ({files.length})
            </h2>
            {files.length > 0 ? (
              <div className="space-y-2">
                {files.map((f: any) => (
                  <a
                    key={f.slug}
                    href={`/f/${f.slug}`}
                    className="block border-2 border-surface-variant bg-surface-container-lowest px-4 py-3 hover:border-secondary transition-colors"
                  >
                    <p className="font-mono text-sm text-on-surface font-bold">{f.filename}</p>
                    <p className="font-mono text-xs text-on-surface-variant mt-1">{f.mime_type} • {f.slug}</p>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant font-mono text-sm">No files found</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
