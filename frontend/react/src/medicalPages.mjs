// Fetch every authorized medical-directory page without silently losing rows
// after the backend's 500-item response cap.
export const MEDICAL_PAGE_SIZE=500;
export const MAX_MEDICAL_ENTRIES=10000;

export function medicalPageUrl(path,limit,offset){
  if(typeof path!=='string'||!path.startsWith('/'))
    throw new Error('مسار دليل الجهات غير صحيح');
  if(!Number.isInteger(limit)||limit<1||limit>500||
     !Number.isInteger(offset)||offset<0||offset>100000)
    throw new Error('حدود صفحات الجهات غير صحيحة');
  const url=new URL(path,'https://mandob.invalid');
  url.searchParams.set('limit',String(limit));
  url.searchParams.set('offset',String(offset));
  return url.pathname+url.search;
}

export async function fetchAllMedicalPages(load,path,{
  pageSize=MEDICAL_PAGE_SIZE,maxRecords=MAX_MEDICAL_ENTRIES
}={}){
  if(!path)return [];
  if(typeof load!=='function'||!Number.isInteger(pageSize)||pageSize<1||
     pageSize>500||!Number.isInteger(maxRecords)||maxRecords<pageSize||
     maxRecords%pageSize!==0||maxRecords>100000)
    throw new Error('إعدادات تحميل الجهات غير صحيحة');
  const results=[],ids=new Set();
  for(let offset=0;offset<=maxRecords;offset+=pageSize){
    const page=await load(medicalPageUrl(path,pageSize,offset));
    if(!Array.isArray(page)||page.length>pageSize)
      throw new Error('استجابة دليل الجهات غير صالحة');
    for(const row of page){
      if(!row||typeof row.id!=='string'||ids.has(row.id))
        throw new Error('تغيّرت قائمة الجهات أثناء التحميل، أعد المحاولة');
      ids.add(row.id);
      results.push(row);
    }
    if(results.length>maxRecords)
      throw new Error('عدد الجهات يتجاوز حد العرض الآمن؛ استخدم البحث أو فلتر المنطقة');
    if(page.length<pageSize)return results;
  }
  throw new Error('تعذّر إكمال تحميل الجهات؛ يرجى تضييق الفلاتر');
}
