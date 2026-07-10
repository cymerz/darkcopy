import { getNewPasteOptions } from '@/lib/api';
import { PasteForm } from '@/components/PasteForm';

export const dynamic = 'force-dynamic';

export default async function NewPastePage() {
  let languages;
  let expiryOptions;
  let disableNewPastes = false;
  try {
    const data = await getNewPasteOptions();
    languages = data.languages;
    expiryOptions = data.expiryOptions;
    disableNewPastes = data.disable_new_pastes ?? false;
  } catch (error) {
    console.error('Failed to load paste creation options:', error);
    throw error;
  }

  return (
    <section>
      <h1 className="font-display text-headline-lg text-secondary mb-6 drop-shadow-[0_0_15px_rgba(76,215,246,0.3)]">
        {'>'} INITIALIZE_PASTE.EXE
      </h1>
      <PasteForm languages={languages} expiryOptions={expiryOptions} disabled={disableNewPastes} />
    </section>
  );
}
