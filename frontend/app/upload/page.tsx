import { getUploadOptions } from '@/lib/api';
import { FileUploader } from '@/components/FileUploader';

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  let data;
  try {
    data = await getUploadOptions();
  } catch (error) {
    console.error('Gagal memuat opsi unggah file:', error);
    throw error;
  }

  return (
    <section>
      <h1 className="font-display text-headline-lg text-secondary mb-6 drop-shadow-[0_0_15px_rgba(76,215,246,0.3)]">
        {'>'} UPLOAD_FILE.SYS
      </h1>
      <FileUploader
        expiryOptions={data.expiry_options}
        visibilities={data.visibilities}
        maxFileSize={data.max_file_size}
        disabled={data.disable_file_uploads ?? false}
        useDirectUpload={data.use_direct_upload ?? false}
      />
    </section>
  );
}
