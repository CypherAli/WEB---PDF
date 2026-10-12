// Resource downloads run in the extension origin when host access is granted;
// a content-script fetch still obeys the website's CORS policy.
export async function fetchBinary(url) {
  const response=await fetch(url,{credentials:'include',cache:'force-cache',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const blob=await response.blob();
  if(!/^(image\/|font\/)|font|octet-stream/i.test(blob.type))throw new Error(`Không phải ảnh/phông chữ: ${blob.type}`);
  if(blob.size>40*1024*1024)throw new Error('Tài nguyên trên 40 MB.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Không đọc được tài nguyên.'));reader.readAsDataURL(blob);});
}

export async function loadResource({url,tabId,message,api=chrome}) {
  const attempts=[];
  const fromPage=await message(tabId,'RESOURCE',{url}).catch(error=>({error:error.message}));
  if(fromPage?.data)return {data:fromPage.data,method:'page-fetch'};
  attempts.push({stage:'page-fetch',error:fromPage?.error || 'Trang nguồn không trả dữ liệu.'});
  if(/^https?:/.test(url)) {
    const granted=await api.permissions.contains({origins:[new URL(url).origin+'/*']});
    if(granted) {
      try{return {data:await fetchBinary(url),method:'extension-fetch'};}
      catch(error){attempts.push({stage:'extension-fetch',error:error.message});}
    } else attempts.push({stage:'extension-fetch',error:'Chưa có quyền đọc website chứa ảnh/phông chữ.'});
  }
  // Last resort: read the already decoded source image at its natural size.
  // Cross-origin tainted images are refused, never substituted with a screenshot.
  const decoded=await message(tabId,'LOADED_IMAGE',{url}).catch(error=>({error:error.message}));
  if(decoded?.data)return {...decoded,method:'loaded-image-png'};
  attempts.push({stage:'loaded-image',error:decoded?.error || 'Không lấy được ảnh đã hiển thị.'});
  const error=new Error(attempts.map(a=>`${a.stage}: ${a.error}`).join(' · '));error.attempts=attempts;throw error;
}
