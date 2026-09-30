import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { listInstallationPhotos } from '../lib/garageInvoices';

// Photos the installer attached when completing the job — renders nothing
// if there are none.
export default function GarageInstallationPhotos({ invoiceId, refreshKey }: { invoiceId: string; refreshKey?: unknown }) {
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);

  useEffect(() => {
    listInstallationPhotos(invoiceId).then(setPhotos).catch(() => setPhotos([]));
  }, [invoiceId, refreshKey]);

  if (photos.length === 0) return null;

  return (
    <div>
      <p className="text-white/40 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Camera size={12} /> Installation Photos
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((p) => (
          <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
            className="block aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-gold-400/50 transition-colors">
            <img src={p.url} alt="Installation photo" className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
