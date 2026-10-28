const MAX_PHOTO_BYTES=2097152;
export async function prepareDamagePhoto(file:File):Promise<File>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG or WebP photo.');
 if(file.size<=MAX_PHOTO_BYTES)return file;
 if(file.size>20971520)throw Error('Choose a photo smaller than 20 MB.');
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('This photo could not be opened. Try a JPEG photo.');});
 try{
  for(const [limit,quality] of [[1920,0.82],[1280,0.7],[960,0.6]]){
   const scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('Photo resizing is unavailable. Choose a photo up to 2 MB.');
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
   if(blob&&blob.size<=MAX_PHOTO_BYTES)return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
  }
  throw Error('This photo is still too large. Choose a photo up to 2 MB.');
 }finally{bitmap.close();}
}
