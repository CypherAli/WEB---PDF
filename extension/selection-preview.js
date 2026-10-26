// Full mode uses DOM text. Exact-region mode deliberately exports these pixels.
export async function cropSelection(imageUrl,{rect,viewport},{maxWidth=1100,maxHeight=1400}={}) {
  const img=new Image();img.src=imageUrl;await img.decode();
  const sx=img.naturalWidth/viewport.width,sy=img.naturalHeight/viewport.height;
  const left=Math.max(0,rect.left*sx),top=Math.max(0,rect.top*sy);
  const width=Math.min(img.naturalWidth-left,rect.width*sx),height=Math.min(img.naturalHeight-top,rect.height*sy);
  if(width<1 || height<1)throw new Error('Vùng chọn không có ảnh đang thấy trên màn hình.');
  const scale=Math.min(1,maxWidth/width,maxHeight/height),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(img,left,top,width,height,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
}
