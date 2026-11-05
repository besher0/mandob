import React,{useEffect,useState} from 'react';
type Entry=Record<string,any>;
async function request(path:string,method='GET',body?:Entry){
  const response=await fetch('/api'+path,{
    method,credentials:'include',
    headers:body?{'Content-Type':'application/json'}:{},
    body:body?JSON.stringify(body):undefined
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'تعذّر تنفيذ الطلب');
  return result;
}
export default function AreaOrganization({revision,onChange,canEdit=true}:{revision:number,onChange:()=>void,canEdit?:boolean}){
  const [groups,setGroups]=useState<Entry[]|null>(null);
  const [areas,setAreas]=useState<Entry[]|null>(null);
  const [groupName,setGroupName]=useState('');
  const [edit,setEdit]=useState<Entry|null>(null);
  const [detailId,setDetailId]=useState<string|null>(null);
  const [details,setDetails]=useState<Entry|null>(null);
  const [detailError,setDetailError]=useState('');
  const [detailRetry,setDetailRetry]=useState(0);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [listRetry,setListRetry]=useState(0);
  useEffect(()=>{
    let valid=true;setError('');
    Promise.all([request('/area-groups'),request('/areas')]).then(([g,a])=>{
      if(valid){setGroups(g);setAreas(a);}
    }).catch(e=>{if(valid)setError(e.message)});
    return()=>{valid=false};
  },[revision,listRetry]);
  useEffect(()=>{
    let valid=true;setDetails(null);setDetailError('');
    if(detailId)request('/areas/'+detailId+'/details').then(d=>{
      if(valid)setDetails(d);
    }).catch((e:Error)=>{if(valid)setDetailError(e.message||'تعذّر تحميل تفاصيل المنطقة')});
    return()=>{valid=false};
  },[detailId,revision,detailRetry]);
  async function save(action:()=>Promise<unknown>){
    if(busy)return;
    setError('');setBusy(true);
    try{await action();setEdit(null);onChange();}
    catch(e:any){setError(e.message||'تعذّر الحفظ');}
    finally{setBusy(false);}
  }
  return <>
    <section className="section">
      <div className="section-title"><h2>مجموعات المناطق</h2></div>
      <p className="muted">للتنظيم فقط، دون أي أرشفة أو حذف للمناطق.</p>
      {error&&<div className="notice error" role="alert">
        {error}
        <button type="button" className="btn small outline"
          disabled={busy} onClick={()=>setListRetry(n=>n+1)}>إعادة تحميل المناطق</button>
      </div>}
      {!groups?error?<div className="empty">تعذّر تحميل مجموعات المناطق</div>:
        <div className="empty">تحميل المجموعات...</div>:
        <div className="card-grid">{groups.map(g=><div className="mini-card" key={g.id}>
          <strong>{g.name}</strong><small>{g._count?.areas||0} منطقة</small>
        </div>)}</div>}
      {canEdit&&<form className="form" onSubmit={e=>{e.preventDefault();
        void save(async()=>{await request('/area-groups','POST',{name:groupName});
          setGroupName('');});
      }}>
        <label className="field">اسم مجموعة جديدة
          <input value={groupName} onChange={e=>setGroupName(e.target.value)}
            required maxLength={120}/>
        </label>
        <button className="btn primary" type="submit" disabled={!groups||busy}>إضافة مجموعة</button>
      </form>}
    </section>
    <section className="section">
      <div className="section-title"><h2>إدارة المناطق وتفاصيلها</h2></div>
      {!areas?error?<div className="empty">تعذّر تحميل المناطق</div>:
        <div className="empty">تحميل المناطق...</div>:
        <div className="table-wrap"><table>
          <thead><tr><th>المنطقة</th><th>المدينة</th><th>المجموعة</th><th>الإجراء</th></tr></thead>
          <tbody>{areas.map(a=><tr key={a.id}>
            <td>{a.name}</td><td>{a.city||'—'}</td><td>{a.group?.name||'—'}</td>
            <td><div className="button-group">
              {canEdit&&<button type="button" className="btn small" onClick={()=>setEdit({
                id:a.id,name:a.name,city:a.city||'',groupId:a.groupId||''
              })}>تعديل</button>}
              <button type="button" className="btn small outline"
                onClick={()=>setDetailId(a.id)}>تفاصيل</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}
      {canEdit&&edit&&<form className="form" onSubmit={e=>{e.preventDefault();
        void save(()=>request('/areas/'+edit.id,'PATCH',{
          name:edit.name,city:edit.city||null,groupId:edit.groupId||null
        }));
      }}>
        <h3>تعديل {edit.name}</h3>
        <div className="form-grid">
          <label className="field">اسم المنطقة<input required value={edit.name}
            onChange={e=>setEdit({...edit,name:e.target.value})}/></label>
          <label className="field">المدينة<input value={edit.city}
            onChange={e=>setEdit({...edit,city:e.target.value})}/></label>
          <label className="field">مجموعة المنطقة
            <select value={edit.groupId||''}
              onChange={e=>setEdit({...edit,groupId:e.target.value})}>
              <option value="">بدون مجموعة</option>
              {(groups||[]).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn primary" type="submit" disabled={busy||!groups}>حفظ</button>
        <button className="btn outline" type="button" onClick={()=>setEdit(null)}>إلغاء</button>
      </form>}
    </section>
    {detailId&&<section className="section">
      <div className="section-title"><h2>تفاصيل المنطقة</h2></div>
      {!details?detailError?<div className="notice error" role="alert">
        {detailError}
        <button type="button" className="btn small outline"
          onClick={()=>setDetailRetry(n=>n+1)}>إعادة المحاولة</button>
      </div>:<div className="empty">تحميل التفاصيل...</div>:<>
        <strong>{details.area?.name}</strong>
        <p>المجموعة: {details.area?.group?.name||'—'}</p>
        <div className="stats">{[
          ['المندوبون',details.totals.reps],['الأطباء',details.totals.doctors],
          ['الصيدليات',details.totals.pharmacies],['المشافي',details.totals.hospitals]
        ].map(([name,num])=><div key={String(name)} className="stat">
          <span>{name}</span><strong>{num}</strong>
        </div>)}</div>
        <div className="card-grid">{([
          ['المندوبون',details.reps],['الأطباء',details.doctors],
          ['الصيدليات',details.pharmacies],['المشافي',details.hospitals]
        ] as [string,Entry[]][]).map(([label,records])=><div key={label} className="mini-card">
          <strong>{label}</strong><small>{records.map(item=>item.name).join('، ')||'—'}</small>
        </div>)}</div>
      </>}
      <button className="btn outline" type="button" onClick={()=>setDetailId(null)}>
        إغلاق التفاصيل
      </button>
    </section>}
  </>;
}
