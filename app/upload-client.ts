export type UploadedFile={id:string;url:string;name:string;size:number;mime:string};
async function api<T>(url:string,body:BodyInit,json=false):Promise<T>{
 const response=await fetch(url,{method:'POST',body,headers:json?{'Content-Type':'application/json'}:undefined});
 const data=await response.json() as T&{error?:string};
 if(!response.ok)throw new Error(data.error||'Не удалось загрузить файл');
 return data;
}
export async function uploadAsset(file:File,onProgress:(percent:number)=>void):Promise<UploadedFile>{
 if(!file.size)throw new Error('Файл «'+file.name+'» пуст. Дождись окончания сохранения.');
 if(file.size>10*1024**3)throw new Error('Одна запись может занимать до 10 ГБ. Для более крупного файла добавь ссылку.');
 if(file.size<=50*1024**2){const result=await api<UploadedFile>('/api/assets?name='+encodeURIComponent(file.name)+'&mime='+encodeURIComponent(file.type||'application/octet-stream'),file);onProgress(100);return result;}
 const session=await api<{id:string;uploadId:string;partSize:number}>('/api/assets/multipart',JSON.stringify({action:'create',name:file.name,mime:file.type||'application/octet-stream',size:file.size}),true);
 const parts:{partNumber:number;etag:string}[]=[];
 try{
  let offset=0;
  for(let number=1;offset<file.size;number++){
   const end=Math.min(offset+session.partSize,file.size);
   const part=await api<{partNumber:number;etag:string}>('/api/assets/multipart?action=part&id='+encodeURIComponent(session.id)+'&uploadId='+encodeURIComponent(session.uploadId)+'&partNumber='+number,file.slice(offset,end));
   parts.push(part);offset=end;onProgress(Math.round(offset/file.size*100));
  }
  return await api<UploadedFile>('/api/assets/multipart',JSON.stringify({action:'complete',id:session.id,uploadId:session.uploadId,parts}),true);
 }catch(error){
  await api('/api/assets/multipart',JSON.stringify({action:'abort',id:session.id,uploadId:session.uploadId}),true).catch(()=>{});
  throw error;
 }
}
