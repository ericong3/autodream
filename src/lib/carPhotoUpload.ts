import { supabase } from './supabase';

// Same compression and bucket as the Inventory add-car form.
function compressImage(file: File, maxWidth = 900, quality = 0.78): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export async function uploadCarPhoto(file: File, folder: string): Promise<string> {
  const compressed = await compressImage(file);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from('car-photos').upload(path, compressed, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return supabase.storage.from('car-photos').getPublicUrl(path).data.publicUrl;
}
