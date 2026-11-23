import React,{useEffect,useState} from 'react';

type Location={latitude?:number|null;longitude?:number|null};
type Props={location?:Location|null};
const cache=new Map<string,string>();
/**
 * The end location is different from the areas assigned to visited targets.
 * Reverse geocoding is best-effort and must never silently replace GPS truth
 * with an assigned area name. The public OpenStreetMap service receives the
 * coordinates only when a user opens the round details containing this widget.
 */
export default function EndLocationArea({location}:Props){
  const lat=Number(location?.latitude),lon=Number(location?.longitude);
  const valid=Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&
    Math.abs(lon)<=180&&location?.latitude!=null&&location?.longitude!=null;
  const key=valid?lat.toFixed(5)+','+lon.toFixed(5):'';
  const [result,setResult]=useState<{key:string;name:string;status:'ready'|'error'}|null>(null);
  useEffect(()=>{
    if(!valid)return;
    const cached=cache.get(key);
    if(cached){setResult({key,name:cached,status:'ready'});return;}
    const abort=new AbortController();
    const url='https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=ar&lat='+
      encodeURIComponent(String(lat))+'&lon='+encodeURIComponent(String(lon));
    fetch(url,{signal:abort.signal,headers:{Accept:'application/json'}})
      .then(async response=>{
        if(!response.ok)throw Error('reverse geocode unavailable');
        return response.json();
      }).then(data=>{
        const a=data?.address||{};
        const name=[a.suburb||a.neighbourhood||a.quarter||a.city_district||
          a.village||a.town||a.city||a.county,a.city||a.town||a.state]
          .filter(Boolean).filter((item:string,index:number,array:string[])=>array.indexOf(item)===index)
          .join('، ');
        if(!name)throw Error('no location name');
        cache.set(key,name);setResult({key,name,status:'ready'});
      }).catch(error=>{
        if(error?.name!=='AbortError')setResult({key,name:'تعذّر تحديد اسم المنطقة من GPS',status:'error'});
      });
    return ()=>abort.abort();
  },[key,valid,lat,lon]);
  if(!valid)return <p className="end-location-area" role="status">منطقة نهاية الجولة: لم يُسجل موقع GPS صالح</p>;
  const status=result?.key===key?result:null;
  return <div className="end-location-area" role="status">
    <strong>منطقة نهاية الجولة (حسب GPS)</strong>
    <span>{!status?'جارٍ تحديد المنطقة من إحداثيات نهاية الجولة…':status.name}</span>
    <small>المصدر: © OpenStreetMap contributors — تحديد جغرافي تقريبي، وليس بالضرورة اسم منطقة التكليف.</small>
  </div>;
}
