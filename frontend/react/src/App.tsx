import React,{useEffect,useState,useRef} from 'react';
import AreaOrganization from './AreaOrganization';
type Any=any;
type User={id:string,name:string,role:string,companyId?:string,teamId?:string,username:string};
const labels:Record<string,string>={SUPER_ADMIN:'مدير النظام',COMPANY_ADMIN:'مدير الشركة',
  TEAM_MANAGER:'مدير الفريق',REP:'مندوب طبي'};
const typeLabels:Record<string,string>={DOCTOR:'أطباء',PHARMACY:'صيدليات',HOSPITAL:'مشافي'};
async function api(path:string,options:Any={}) {
  const r=await fetch('/api'+path,{credentials:'include',...options,
    headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||'تعذر تنفيذ الطلب');
  return data;
}
const post=(path:string,body:Any)=>api(path,{method:'POST',body:JSON.stringify(body)});
const patch=(path:string,body:Any)=>api(path,{method:'PATCH',body:JSON.stringify(body)});
const val=(fd:FormData,k:string)=>String(fd.get(k)||'').trim();
// A date input needs YYYY-MM-DD independent of browser locale formatting.
const today=()=>{
  const now=new Date();
  const local=new Date(now.getTime()-now.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
};
function Section({title,children,actions}:Any){
  return <section className="section"><div className="section-title"><h2>{title}</h2>{actions}</div>{children}</section>;
}
function Notice({children,kind='info'}:Any){return <div className={'notice '+kind}>{children}</div>}
function Empty({text='لا توجد بيانات بعد'}:Any){return <div className="empty">{text}</div>}
function Submit({children='حفظ'}:Any){return <button type="submit" className="btn primary">{children}</button>}
function TextInput({name,label,type='text',required=true,placeholder='',defaultValue,listId}:Any){
  return <label className="field">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} list={listId}/></label>;
}
function SelectInput({name,label,options,required=true,placeholder='اختر...',defaultValue}:Any){
  return <label className="field">{label}<select name={name} required={required} defaultValue={defaultValue}>
    <option value="">{placeholder}</option>{options.map((o:Any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
}
function Form({children,onSave}:Any){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[success,setSuccess]=useState('');
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setError('');setSuccess('');setBusy(true);
    const form=e.currentTarget;
    try{await onSave(new FormData(form));setSuccess('تم الحفظ بنجاح');form.reset();}
    catch(err:Any){setError(err.message||'حدث خطأ');}
    finally{setBusy(false);}
  }
  return <form className="form" onSubmit={submit}>{children}{error&&<Notice kind="error">{error}</Notice>}
    {success&&<Notice kind="success">{success}</Notice>}<button disabled={busy} type="submit" className="btn primary">
      {busy?'جارٍ الحفظ...':'حفظ التغييرات'}</button></form>;
}
function useData(path:string|null,refresh=0){
  // Keep each response associated with the exact filter and refresh version
  // that requested it. A slow, older request must never populate a new view.
  const key=JSON.stringify([path,refresh]);
  const [result,setResult]=useState<{key:string,data:Any,error:string}>({
    key:'',data:null,error:''
  });
  useEffect(()=>{
    let active=true;
    setResult({key,data:null,error:''});
    if(!path)return()=>{active=false};
    api(path).then(data=>{
      if(active)setResult({key,data,error:''});
    }).catch((error:Error)=>{
      if(active)setResult({key,data:null,error:error.message});
    });
    return()=>{active=false};
  },[key,path]);
  return result.key===key?{data:result.data,error:result.error}:{data:null,error:''};
}
function Login({onLogin}:Any){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    const fd=new FormData(e.currentTarget);
    try{const d=await post('/login',{username:val(fd,'username'),password:val(fd,'password')});onLogin(d.user);}
    catch(e:Any){setError(e.message);}finally{setBusy(false);}
  }
  return <div className="login-wrap"><div className="login-card">
    <span className="brand-symbol">M</span><h1>Mandob</h1><p>إدارة المندوبين الطبيين</p>
    <form onSubmit={submit} className="form">
      <TextInput name="username" label="اسم المستخدم" placeholder="username"/>
      <TextInput name="password" label="كلمة المرور" type="password"/>
      {error&&<Notice kind="error">{error}</Notice>}
      <button className="btn primary large" disabled={busy}>{busy?'جارٍ التحقق...':'تسجيل الدخول'}</button>
    </form><small>يلزم حساب مُنشأ من مدير النظام. لا توجد حسابات تجريبية افتراضية.</small>
  </div></div>;
}
function Dashboard({refresh}:Any){
  const {data,error}=useData('/dashboard',refresh);
  if(error)return <Notice kind="error">{error}</Notice>;
  if(!data)return <Empty text="جارٍ تحميل لوحة التحكم..."/>;
  const items=[['المندوبون',data.reps],['الأطباء',data.doctors],['الصيدليات',data.pharmacies],
    ['المشافي',data.hospitals],['الجولات المسجلة',data.visits],['إجازات بانتظار المراجعة',data.pendingLeaves]];
  return <Section title="نظرة عامة"><div className="stats">{items.map(([label,num])=>
    <div className="stat" key={label}><span>{label}</span><strong>{num}</strong></div>)}</div>
    <Notice>الأرقام المعروضة هنا تُقرأ من PostgreSQL مباشرة، ولا تحتوي بيانات تجريبية.</Notice></Section>;
}
function Records({kind,refresh}:Any){
  const path=kind==='visits'?'/visits':'/leaves';
  const pageSize=50;
  const [data,setData]=useState<Any[]>([]);
  const [offset,setOffset]=useState(0);
  const [hasMore,setHasMore]=useState(true);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reload,setReload]=useState(0),[retry,setRetry]=useState(0);
  const [reviewBusy,setReviewBusy]=useState<string|null>(null);
  const [typeFilter,setTypeFilter]=useState(''),[statusFilter,setStatusFilter]=useState('');
  const [dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState('');
  const [repFilter,setRepFilter]=useState('');
  const [actionError,setActionError]=useState(''),[actionOk,setActionOk]=useState('');
  const user=(window as Any).__mandobUser as User;
  const canReview=user?.role==='COMPANY_ADMIN'||user?.role==='TEAM_MANAGER';
  const {data:reps}=useData(canReview?'/users':null,refresh);
  const filters=new URLSearchParams();
  if(kind==='visits'&&typeFilter)filters.set('type',typeFilter);
  if(kind==='leaves'&&statusFilter)filters.set('status',statusFilter);
  if(dateFrom)filters.set('from',dateFrom);
  if(dateTo)filters.set('to',dateTo);
  if(canReview&&repFilter)filters.set('repId',repFilter);
  const query=filters.toString();
  useEffect(()=>{
    setData([]);setOffset(0);setHasMore(true);
  },[path,refresh,reload,query]);
  useEffect(()=>{
    let valid=true;setLoading(true);setError('');
    api(path+'?limit='+pageSize+'&offset='+offset+(query?'&'+query:''))
      .then((rows:Any[])=>{
        if(!valid)return;
        setData(previous=>offset===0?rows:[
          ...previous,...rows.filter(row=>!previous.some(item=>item.id===row.id))
        ]);
        setHasMore(rows.length===pageSize);
      })
      .catch((e:Error)=>{if(valid)setError(e.message)})
      .finally(()=>{if(valid)setLoading(false)});
    return()=>{valid=false};
  },[path,refresh,reload,offset,retry,query]);
  async function review(id:string,status:string){
    if(reviewBusy)return;
    setReviewBusy(id);setActionError('');setActionOk('');
    try{
      await patch('/leaves/'+id+'/status',{status});
      setActionOk('تمت مراجعة الطلب وتحديث القائمة');
      setReload(x=>x+1);
    }catch(e:Any){setActionError(e.message);}
    finally{setReviewBusy(null);}
  }
  return <Section title={kind==='visits'?'سجل الجولات':'طلبات الإجازة'}>
    <div className="form-grid">
      {kind==='visits'?<label className="field">نوع الجولة
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(typeLabels).map(([value,label])=>
            <option value={value} key={value}>{label}</option>)}
        </select></label>:<label className="field">حالة الإجازة
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="">كل الحالات</option>
          {['PENDING','APPROVED','REJECTED'].map(v=><option key={v} value={v}>{v}</option>)}
        </select></label>}
      {canReview&&<label className="field">المندوب
        <select value={repFilter} onChange={e=>setRepFilter(e.target.value)}>
          <option value="">كل المندوبين</option>
          {(reps||[]).filter((r:Any)=>r.role==='REP').map((r:Any)=>
            <option value={r.id} key={r.id}>{r.name}</option>)}
        </select>
      </label>}
      <label className="field">من تاريخ
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/>
      </label>
      <label className="field">إلى تاريخ
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
      </label>
    </div>
    <p className="muted">{kind==='leaves'?'تظهر الإجازات التي تتداخل مع الفترة المختارة':'الفلترة تشمل كامل السجلات من قاعدة البيانات، وليس الصفحة المعروضة فقط'}</p>
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    {actionOk&&<Notice kind="success">{actionOk}</Notice>}
    {error&&<Notice kind="error">{error}</Notice>}
    {!data.length&&loading?<Empty text="جارٍ تحميل السجلات..."/>:
      !data.length?<Empty/>:<div className="table-wrap"><table><thead><tr>
      {kind==='visits'?<><th>المندوب</th><th>النوع</th><th>التاريخ</th><th>الجهات</th><th>الموقع</th></>:
        <><th>المندوب</th><th>نوع الإجازة</th><th>الفترة</th><th>الحالة</th><th>الإجراء</th></>}
      </tr></thead><tbody>{data.map((r:Any)=><tr key={r.id}>
        {kind==='visits'?<><td>{r.repName}</td><td>{typeLabels[r.type]||r.type}</td><td>{r.visitDate}</td>
          <td>{r.targets?.map((x:Any)=>x.name).join('، ')}</td>
          <td><a href={'https://www.google.com/maps?q='+r.location.latitude+','+r.location.longitude}
            target="_blank" rel="noopener noreferrer">فتح الموقع</a><small>±{Math.round(r.location.accuracy)} م</small></td></>:
          <><td>{r.rep?.name}</td><td>{r.type}</td><td>{r.fromDate} — {r.toDate}</td>
            <td><span className={'tag '+r.status}>{r.status}</span></td>
            <td>{canReview&&r.status==='PENDING'?<div className="button-group">
              <button type="button" className="btn small" disabled={reviewBusy!==null}
                onClick={()=>review(r.id,'APPROVED')}>موافقة</button>
              <button type="button" className="btn small danger" disabled={reviewBusy!==null}
                onClick={()=>review(r.id,'REJECTED')}>رفض</button>
            </div>:'—'}</td></>}
      </tr>)}</tbody></table></div>}
    {data.length>0&&<p className="muted">السجلات المعروضة: {data.length}</p>}
    {error&&<button type="button" className="btn outline" disabled={loading}
      onClick={()=>setRetry(n=>n+1)}>إعادة محاولة تحميل الصفحة</button>}
    {hasMore&&data.length>0&&!error&&<button type="button" className="btn outline"
      disabled={loading} onClick={()=>setOffset(o=>o+pageSize)}>
      {loading?'جارٍ تحميل المزيد...':'عرض سجلات أقدم'}
    </button>}
    {loading&&data.length>0&&!hasMore&&<p className="muted">جارٍ التحديث...</p>}
  </Section>;
}
function NewVisit({refresh,done}:Any){
  const [type,setType]=useState('DOCTOR'),[targetIds,setTargetIds]=useState<string[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[last,setLast]=useState('');
  const [search,setSearch]=useState(''),[areaFilter,setAreaFilter]=useState(''),
    [gradeFilter,setGradeFilter]=useState('');
  const retryDraft=useRef<{signature:string,body:Any}|null>(null);
  const route=type==='DOCTOR'?'/doctors':type==='PHARMACY'?'/pharmacies':'/hospitals';
  const {data:targets,error:loadError}=useData(route,refresh);
  const {data:areas}=useData('/areas',refresh);
  const visible=(targets||[]).filter((x:Any)=>{
    const words=[x.name,x.specialty,x.grade,x.category,x.kind,x.area?.name,
      ...(x.doctorAreas||[]).map((v:Any)=>v.area?.name)]
      .join(' ').toLocaleLowerCase();
    const areaMatch=!areaFilter||x.areaId===areaFilter||
      (x.doctorAreas||[]).some((v:Any)=>v.areaId===areaFilter);
    return areaMatch&&(!gradeFilter||x.grade===gradeFilter)&&
      words.includes(search.trim().toLocaleLowerCase());
  });
  useEffect(()=>{setTargetIds([]);setSearch('');setAreaFilter('');setGradeFilter('');},[type]);
  function locate():Promise<GeolocationPosition>{
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(Error('الجهاز لا يدعم تحديد الموقع'));
      navigator.geolocation.getCurrentPosition(resolve,reject,
        {enableHighAccuracy:true,timeout:20000,maximumAge:0});
    });
  }
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setLast('');
    try{
      if(targetIds.length===0)throw Error('اختر جهة واحدة على الأقل');
      const fd=new FormData(e.currentTarget);
      const visitDate=val(fd,'visitDate');
      const signature=JSON.stringify([type,visitDate,[...targetIds].sort()]);
      let body:Any;
      if(retryDraft.current?.signature===signature)body=retryDraft.current.body;
      else{
        const position=await locate();
        body={clientVisitId:crypto.randomUUID(),type,visitDate,targetIds,
          location:{latitude:position.coords.latitude,longitude:position.coords.longitude,
            accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()}};
        retryDraft.current={signature,body};
      }
      const d=await post('/visits',body);
      setLast('تم حفظ الجولة رقم '+d.id+(d.duplicate?' (الطلب كان محفوظاً مسبقاً)':'')+
        ' مع موقع نهاية الجولة');
      retryDraft.current=null;setTargetIds([]);done();
    }catch(err:Any){
      setError(err?.code===1?'لازم تمنح صلاحية الموقع لإنهاء الجولة':err.message||'تعذر تحديد الموقع');
    }finally{setBusy(false);}
  }
  return <Section title="إنهاء جولة جديدة">
    <Notice>يتم أخذ موقع GPS واحد عند إنهاء الجولة. الموقع لا يمكن إدخاله يدوياً، ويلزم إذن المتصفح واتصال HTTPS.</Notice>
    <form className="form" onSubmit={save}><div className="form-grid">
      <label className="field">نوع الجولة<select value={type} onChange={e=>setType(e.target.value)}>
        {Object.entries(typeLabels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
      <TextInput name="visitDate" label="تاريخ الجولة" type="date" defaultValue={today()}/>
    </div>
    <h3>الجهات التي تمت زيارتها</h3>
    <div className="form-grid">
      <label className="field">بحث بالاسم أو الاختصاص
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث..."/>
      </label>
      <label className="field">المنطقة
        <select value={areaFilter} onChange={e=>setAreaFilter(e.target.value)}>
          <option value="">كل المناطق</option>
          {(areas||[]).map((a:Any)=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {type!=='HOSPITAL'&&<label className="field">التصنيف
        <select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {['A','B','C'].map(g=><option key={g} value={g}>{g}</option>)}
        </select>
      </label>}
    </div>
    {loadError&&<Notice kind="error">{loadError}</Notice>}
    {!targets?<Empty text="جارٍ تحميل الجهات..."/>:!targets.length?<Empty text="لا توجد جهات مخصصة لك. اطلب من المدير إسناد مناطقك."/>:
      !visible.length?<Empty text="ما في نتائج مطابقة للفلتر"/>:
      <div className="check-grid">{visible.map((x:Any)=><label className="check-item" key={x.id}>
        <input type="checkbox" checked={targetIds.includes(x.id)}
          onChange={e=>setTargetIds(p=>e.target.checked?[...p,x.id]:p.filter(id=>id!==x.id))}/>
        <span>{x.name}</span><small>{x.doctorAreas?.length?
          [...new Set(x.doctorAreas.map((v:Any)=>v.area.name))].join('، '):
          x.area?.name}</small></label>)}</div>}
    {error&&<Notice kind="error">{error}</Notice>}
    {last&&<Notice kind="success">{last}</Notice>}
    <button className="btn primary" type="submit" disabled={busy||targetIds.length===0}>
      {busy?'جارٍ تحديد الموقع وحفظ الجولة...':'تحديد موقعي وإنهاء الجولة'}</button>
    </form>
  </Section>;
}
function NewLeave({done}:Any){
  return <Section title="تقديم طلب إجازة"><Form onSave={async(fd:FormData)=>{
    await post('/leaves',{type:val(fd,'type'),fromDate:val(fd,'fromDate'),toDate:val(fd,'toDate'),reason:val(fd,'reason')});done();
  }}><div className="form-grid"><TextInput name="type" label="نوع الإجازة" placeholder="سنوية"/>
    <TextInput name="fromDate" label="من تاريخ" type="date"/>
    <TextInput name="toDate" label="حتى تاريخ" type="date"/>
    <label className="field">السبب (اختياري)<textarea name="reason" rows={3}/></label></div></Form></Section>;
}
function Frequency({refresh}:Any){
  const [busy,setBusy]=useState(false),[downloadError,setDownloadError]=useState('');
  const {data,error}=useData('/analytics/frequency',refresh);
  async function exportExcel(){
    if(busy)return;
    setBusy(true);setDownloadError('');
    try{
      const res=await fetch('/api/analytics/frequency.xlsx',{credentials:'include'});
      if(!res.ok){const d=await res.json().catch(()=>({}));
        throw Error(d.error||'تعذر تصدير الإحصائيات');}
      const uri=URL.createObjectURL(await res.blob());
      const a=document.createElement('a');a.href=uri;a.download='mandob-frequency.xlsx';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(uri);
    }catch(e:Any){setDownloadError(e.message);}finally{setBusy(false);}
  }
  if(error)return <Notice kind="error">{error}</Notice>;
  if(!data)return <Empty text="تحميل تقارير التكرار..."/>;
  return <Section title="تكرار زيارات الأطباء">
    <Notice>الأهداف المكتملة: {data.completed} من {data.total} هدف لفريق وطبيب، حسب دورة الزيارات. زيارات مندوبي نفس الفريق بتتجمع، وكل فريق إله هدف مستقل.</Notice>
    {downloadError&&<Notice kind="error">{downloadError}</Notice>}
    <button type="button" className="btn primary" disabled={busy} onClick={exportExcel}>
      {busy?'جارٍ التصدير...':'تصدير Frequency إلى Excel'}
    </button>
    {!data.items?.length?<Empty/>:<div className="table-wrap"><table><thead><tr>
      <th>الفريق</th><th>الطبيب</th><th>المنطقة</th><th>التصنيف</th><th>المنجز / المطلوب</th><th>الإنجاز</th>
      </tr></thead>
      <tbody>{data.items.map((r:Any)=><tr key={(r.teamId||r.representatives?.[0]?.id||'solo')+':'+r.id}>
        <td>{r.teamName||'بدون فريق'}</td><td>{r.name}</td><td>{r.area}</td><td>{r.grade}</td>
        <td>{r.done} / {r.target}</td><td><div className="meter"><span style={{width:r.coverage+'%'}}/></div>{r.coverage}%</td>
      </tr>)}</tbody></table></div>}
  </Section>;
}
function Products({refresh,done}:Any){
  const {data,error}=useData('/products',refresh);
  return <><Section title="المنتجات الطبية">
    {error&&<Notice kind="error">{error}</Notice>}
    {!data?<Empty text="جارٍ تحميل المنتجات..."/>:!data.length?<Empty/>:
      <div className="table-wrap"><table><thead><tr>
        <th>المنتج</th><th>المادة الفعالة</th><th>الحالة</th>
      </tr></thead><tbody>{data.map((p:Any)=><tr key={p.id}>
        <td>{p.name}</td><td>{p.activeIngredient||'—'}</td>
        <td>{p.active?'نشط':'غير نشط'}</td>
      </tr>)}</tbody></table></div>}
  </Section>
  <Section title="إضافة منتج">
    <Form onSave={async(fd:FormData)=>{
      await post('/products',{name:val(fd,'name'),
        activeIngredient:val(fd,'activeIngredient')||null});
      done();
    }}>
      <div className="form-grid">
        <TextInput name="name" label="اسم المنتج"/>
        <TextInput name="activeIngredient" label="المادة الفعالة" required={false}/>
      </div>
    </Form>
  </Section></>;
}
function Teams({refresh,done}:Any){
  const {data,error}=useData('/teams',refresh);
  const {data:products, error:productError}=useData('/products',refresh);
  const [editId,setEditId]=useState<string|null>(null);
  const editing=data?.find((t:Any)=>t.id===editId);
  return <>
    <Section title="الفرق">
      {error&&<Notice kind="error">{error}</Notice>}
      {!data?<Empty text="جارٍ تحميل الفرق..."/>:!data.length?<Empty/>:
        <div className="card-grid">{data.map((t:Any)=>
          <div className="mini-card" key={t.id}>
            <strong>{t.name}</strong>
            <span>{t._count?.users||0} مستخدمين</span>
            <small>الاختصاصات: {t.specialties?.map((x:Any)=>x.specialty).join('، ')||'لا توجد'}</small>
            <small>المنتجات: {t.products?.map((x:Any)=>x.product.name).join('، ')||'لا توجد'}</small>
            <button className="btn small" type="button" onClick={()=>setEditId(t.id)}>
              تعديل الفريق
            </button>
          </div>
        )}</div>}
    </Section>
    {editing&&<Section title={'تعديل الفريق: '+editing.name}>
      <Notice>التعديل يخص اسم الفريق واختصاصاته ومنتجاته فقط، ولا يغير المندوبين أو الزيارات السابقة.</Notice>
      <div key={editing.id}>
        <Form onSave={async(fd:FormData)=>{
          if(!products||productError)throw Error('لا يمكن حفظ الفريق قبل تحميل المنتجات بنجاح');
          await patch('/teams/'+editing.id,{
            name:val(fd,'name'),
            specialties:val(fd,'specialties').split(/[,،]/).map((x:string)=>x.trim()).filter(Boolean),
            productIds:fd.getAll('productIds')
          });
          setEditId(null);done();
        }}>
          <div className="form-grid">
            <TextInput name="name" label="اسم الفريق" defaultValue={editing.name}/>
            <TextInput name="specialties" label="الاختصاصات (مفصولة بفاصلة)" required={false}
              defaultValue={editing.specialties?.map((x:Any)=>x.specialty).join('، ')||''}/>
          </div>
          <label className="field">المنتجات المخصصة للفريق</label>
          {productError&&<Notice kind="error">{productError}</Notice>}
          {!products?<Empty text="جارٍ تحميل المنتجات..."/>:
            <div className="check-grid">{products.filter((p:Any)=>p.active).map((p:Any)=>
              <label className="check-item" key={p.id}>
                <input type="checkbox" name="productIds" value={p.id}
                  defaultChecked={editing.products?.some((x:Any)=>x.productId===p.id)}/>
                {p.name}
              </label>)}</div>}
        </Form>
        <button type="button" className="btn outline" onClick={()=>setEditId(null)}>إلغاء التعديل</button>
      </div>
    </Section>}
    <Section title="إنشاء فريق">
      <Form onSave={async(fd:FormData)=>{
        if(!products||productError)throw Error('لا يمكن إنشاء الفريق قبل تحميل المنتجات بنجاح');
        await post('/teams',{
          name:val(fd,'name'),
          specialties:val(fd,'specialties').split(/[,،]/).map((x:string)=>x.trim()).filter(Boolean),
          productIds:fd.getAll('productIds')
        });
        done();
      }}>
        <div className="form-grid">
          <TextInput name="name" label="اسم الفريق"/>
          <TextInput name="specialties" label="الاختصاصات (مفصولة بفاصلة)" required={false}/>
        </div>
        <label className="field">المنتجات المخصصة للفريق</label>
        {productError&&<Notice kind="error">{productError}</Notice>}
        {!products?<Empty text="جارٍ تحميل المنتجات..."/>:
          <div className="check-grid">{products.filter((p:Any)=>p.active).map((p:Any)=>
            <label className="check-item" key={p.id}>
              <input type="checkbox" name="productIds" value={p.id}/>{p.name}
            </label>)}</div>}
      </Form>
    </Section>
  </>;
}
function RepPreferences({teams,products,initialTeam='',initialMode='TEAM',initialSpecialties=[],initialProductIds=[],isRep=true}:Any){
  const [teamId,setTeamId]=useState(initialTeam||''),[mode,setMode]=useState(initialMode||'TEAM');
  return <>
    <label className="field">الفريق<select name="teamId" value={teamId} onChange={e=>setTeamId(e.target.value)}>
      <option value="">بدون فريق</option>
      {(teams||[]).map((t:Any)=><option key={t.id} value={t.id}>{t.name}</option>)}
    </select></label>
    {isRep&&<>
      <label className="field">وضع اختصاصات المندوب
        <select name="specialtyMode" value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="TEAM">اختصاصات الفريق (TEAM)</option>
          <option value="CUSTOM">اختصاصات مخصصة (CUSTOM)</option>
        </select>
      </label>
      {mode==='CUSTOM'&&<TextInput name="customSpecialties"
        label="اختصاصات خاصة (مفصولة بفاصلة)" required={false}
        defaultValue={(initialSpecialties||[]).join('، ')}/>}
      {!teamId&&<>
        <label className="field">منتجات المندوب بدون فريق</label>
        <div className="check-grid">{(products||[]).filter((item:Any)=>item.active).map((item:Any)=>
          <label key={item.id} className="check-item">
            <input name="customProductIds" type="checkbox" value={item.id}
              defaultChecked={(initialProductIds||[]).includes(item.id)}/>{item.name}
          </label>)}</div>
      </>}
      {teamId&&<small>منتجات الفريق تُستخدم تلقائياً، بدون منتجات خاصة بالمندوب.</small>}
    </>}
  </>;
}
const customSpecValues=(fd:FormData)=>val(fd,'customSpecialties').split(/[,،]/)
  .map(x=>x.trim()).filter(Boolean);
function WeeklyVisits({refresh,user}:Any){
  const {data:users}=useData(user.role==='REP'?null:'/users',refresh);
  const [repId,setRepId]=useState(user.role==='REP'?user.id:'');
  const [onDate,setOnDate]=useState(today());
  const effectiveId=user.role==='REP'?user.id:repId;
  const {data,error}=useData(effectiveId?'/weekly-visits-count?repId='+
    encodeURIComponent(effectiveId)+'&onDate='+encodeURIComponent(onDate):null,refresh);
  return <Section title="عدد الزيارات المستهدفة هذا الأسبوع">
    <Notice>الأسبوع من السبت للجمعة مثل النظام القديم. العدد هو عدد الجهات الطبية المسجلة ضمن الجولات، مو عدد الجولات نفسها.</Notice>
    <div className="form-grid">
      {user.role!=='REP'&&<label className="field">اختر المندوب
        <select value={repId} onChange={e=>setRepId(e.target.value)}>
          <option value="">اختر المندوب...</option>
          {(users||[]).filter((x:Any)=>x.role==='REP').map((x:Any)=>
            <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>}
      <label className="field">تاريخ من الأسبوع
        <input type="date" value={onDate} onChange={e=>setOnDate(e.target.value)}/>
      </label>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    {data&&<div className="stats">
      <div className="stat"><span>الجهات المزارة</span><strong>{data.count}</strong></div>
      <div className="stat"><span>عدد الجولات</span><strong>{data.visits}</strong></div>
      <div className="stat"><span>الفترة</span>
        <strong>{data.start} — {data.end}</strong></div>
    </div>}
  </Section>;
}
function Users({refresh,done,canCreate}:Any){
  const {data,error}=useData('/users',refresh),{data:teams}=useData('/teams',refresh),
    {data:areas}=useData('/areas',refresh),{data:products}=useData('/products',refresh);
  const [newRole,setNewRole]=useState('REP');
  const [editId,setEditId]=useState<string|null>(null);
  const [doctorRepId,setDoctorRepId]=useState<string|null>(null);
  const {data:targetDoctors,error:targetError}=useData(
    doctorRepId?'/reps/'+doctorRepId+'/doctors':null,refresh);
  const editing=data?.find((u:Any)=>u.id===editId);
  return <><Section title="المستخدمون والمندوبون">
    {error&&<Notice kind="error">{error}</Notice>}
    {!data?<Empty text="جارٍ تحميل المستخدمين..."/>:!data.length?<Empty/>:
    <div className="table-wrap"><table><thead><tr>
      <th>الاسم</th><th>المستخدم</th><th>الدور</th><th>الفريق</th><th>المناطق</th><th>الحالة</th>
      {canCreate&&<th>التعديل</th>}<th>الاستهداف</th></tr></thead><tbody>
      {data.map((u:Any)=><tr key={u.id}><td>{u.name}</td><td>{u.username}</td>
        <td>{labels[u.role]||u.role}</td>
        <td>{(teams||[]).find((t:Any)=>t.id===u.teamId)?.name||'—'}</td>
        <td>{u.repAreas?.map((r:Any)=>r.area.name).join('، ')||'—'}</td>
        <td>{u.active?'نشط':'موقوف'}</td>
        {canCreate&&<td>{['REP','TEAM_MANAGER'].includes(u.role)?
          <button type="button" className="btn small" onClick={()=>setEditId(u.id)}>تعديل</button>:'—'}</td>}
        <td>{u.role==='REP'?<button className="btn small outline"
          type="button" onClick={()=>setDoctorRepId(u.id)}>أطباء المندوب</button>:'—'}</td>
      </tr>)}</tbody></table></div>}
  </Section>
  {canCreate&&editing&&<Section title={'تعديل بيانات: '+editing.name}>
    <div key={editing.id}>
      <Notice>تعديل الفريق ما بينقل الجولات السابقة؛ بتضل محسوبة للفريق اللي انعملت فيه.</Notice>
      <Form onSave={async(fd:FormData)=>{
        if(!teams||!areas||!products)throw Error('بيانات الفرق والمناطق والمنتجات لم تكتمل');
        await patch('/users/'+editing.id,{
          name:val(fd,'name'),teamId:val(fd,'teamId')||null,
          dailyTarget:Number(val(fd,'dailyTarget')),
          annualLeaveBalance:Number(val(fd,'annualLeaveBalance')),
          areaIds:fd.getAll('areaIds'),
          active:fd.get('active')==='on',
          ...(editing.role==='REP'?{
            specialtyMode:val(fd,'specialtyMode'),
            customSpecialties:val(fd,'specialtyMode')==='CUSTOM'?customSpecValues(fd):[],
            customProductIds:val(fd,'teamId')?[]:fd.getAll('customProductIds')
          }:{})
        });
        setEditId(null);done();
      }}>
        <div className="form-grid">
          <TextInput name="name" label="الاسم" defaultValue={editing.name}/>
          <RepPreferences key={editing.id} teams={teams} products={products}
            initialTeam={editing.teamId} initialMode={editing.specialtyMode}
            initialSpecialties={editing.repSpecialties?.map((r:Any)=>r.specialty)||[]}
            initialProductIds={editing.repProducts?.map((r:Any)=>r.productId)||[]}
            isRep={editing.role==='REP'}/>
          <TextInput name="dailyTarget" label="الهدف اليومي" type="number"
            defaultValue={editing.dailyTarget}/>
          <TextInput name="annualLeaveBalance" label="رصيد الإجازات السنوي" type="number"
            defaultValue={editing.annualLeaveBalance}/>
          <label className="check-item"><input type="checkbox" name="active"
            defaultChecked={editing.active}/>الحساب مفعّل</label>
        </div>
        <label className="field">المناطق المخصصة</label>
        <div className="check-grid">{(areas||[]).map((a:Any)=>
          <label className="check-item" key={a.id}><input type="checkbox" name="areaIds"
            value={a.id} defaultChecked={editing.repAreas?.some((r:Any)=>r.areaId===a.id)}/>
            {a.name}</label>)}</div>
      </Form>
      <button type="button" className="btn outline" onClick={()=>setEditId(null)}>إلغاء التعديل</button>
    </div>
  </Section>}
  {canCreate&&<Section title="إضافة مستخدم">
    <Form onSave={async(fd:FormData)=>{
      if(!teams||!areas||!products)throw Error('بيانات الفرق والمناطق والمنتجات لم تكتمل');
      await post('/users',{name:val(fd,'name'),username:val(fd,'username'),
        password:val(fd,'password'),role:val(fd,'role'),
        teamId:val(fd,'teamId')||null,areaIds:fd.getAll('areaIds'),
        ...(val(fd,'role')==='REP'?{
          specialtyMode:val(fd,'specialtyMode'),
          customSpecialties:val(fd,'specialtyMode')==='CUSTOM'?customSpecValues(fd):[],
          customProductIds:val(fd,'teamId')?[]:fd.getAll('customProductIds')
        }:{})
      });
      done();
    }}>
      <div className="form-grid">
        <TextInput name="name" label="الاسم"/>
        <TextInput name="username" label="اسم المستخدم"/>
        <TextInput name="password" label="كلمة المرور (12 محرفاً على الأقل)" type="password"/>
        <label className="field">الدور<select name="role" value={newRole}
          onChange={e=>setNewRole(e.target.value)}>
          <option value="REP">مندوب</option>
          <option value="TEAM_MANAGER">مدير فريق</option>
        </select></label>
        <RepPreferences teams={teams} products={products} isRep={newRole==='REP'}/>
      </div>
      <label className="field">المناطق المخصصة (للمندوب)</label>
      <div className="check-grid">{(areas||[]).map((a:Any)=><label className="check-item" key={a.id}>
        <input type="checkbox" name="areaIds" value={a.id}/>{a.name}</label>)}</div>
    </Form>
  </Section>}
  {doctorRepId&&<Section title="الأطباء المستهدفون حسب اختصاصات المندوب">
    <Notice>للعرض والمراجعة، بدون تغيير طريقة تسجيل الجولة الحالية.</Notice>
    {targetError&&<Notice kind="error">{targetError}</Notice>}
    {!targetDoctors&&!targetError?<Empty text="تحميل الأطباء..."/>:
      targetDoctors?.length?<div className="table-wrap"><table>
        <thead><tr><th>الطبيب</th><th>الاختصاص</th><th>المناطق</th></tr></thead>
        <tbody>{targetDoctors.map((d:Any)=><tr key={d.id}>
          <td>{d.name}</td><td>{d.specialty}</td>
          <td>{d.doctorAreas?.map((x:Any)=>x.area.name).join('، ')||d.area?.name||'—'}</td>
        </tr>)}</tbody></table></div>:<Empty/>}
    <button type="button" className="btn outline" onClick={()=>setDoctorRepId(null)}>إغلاق</button>
  </Section>}</>;
}
function DoctorExcelImport({done}:Any){
  const [file,setFile]=useState<File|null>(null);
  const [clientImportId,setClientImportId]=useState('');
  const [preview,setPreview]=useState<Any>(null);
  const [choices,setChoices]=useState<Record<number,Any>>({});
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [summary,setSummary]=useState<Any>(null);
  async function previewFile(){
    if(!file||!file.name.toLowerCase().endsWith('.xlsx')){
      setError('اختر ملف Excel بصيغة .xlsx');return;
    }
    setBusy(true);setError('');setSummary(null);
    try{
      const result=await api('/doctors/import/preview',{
        method:'POST',body:file,
        headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
      });
      setPreview(result);setClientImportId(crypto.randomUUID());
      setChoices(Object.fromEntries(result.rows
        .filter((r:Any)=>r.status==='new')
        .map((r:Any)=>[r.row,{action:'create'}])));
    }catch(e:Any){setPreview(null);setError(e.message||'تعذر قراءة الملف');}
    finally{setBusy(false);}
  }
  function updateAction(row:number,action:string){
    setChoices(v=>({...v,[row]:{action}}));
  }
  function updateSameTarget(row:number,value:string){
    const [kind,key]=value.split(':');
    setChoices(v=>({...v,[row]:{
      action:'same',
      ...(kind==='existing'?{doctorId:key}:kind==='file'?{sourceRow:Number(key)}:{})
    }}));
  }
  const valid=preview?.rows?.filter((r:Any)=>r.status!=='invalid')||[];
  const ready=valid.length>0&&valid.every((r:Any)=>{
    const decision=choices[r.row];
    return decision?.action&&(
      decision.action!=='same' ||
      decision.doctorId || Number.isInteger(decision.sourceRow)
    );
  });
  async function commit(){
    if(!ready)return;
    setBusy(true);setError('');
    try{
      const rows=valid.map((r:Any)=>{
        const {row,name,areaName,specialty,grade,city}=r;
        return {row,name,areaName,specialty,grade,city,...choices[r.row]};
      });
      const response=await post('/doctors/import/commit',{clientImportId,rows});
      setSummary({...response,invalid:preview.invalidCount});
      setPreview(null);setChoices({});setClientImportId('');done();
    }catch(e:Any){setError(e.message||'تعذر اعتماد الاستيراد');}
    finally{setBusy(false);}
  }
  return <Section title="استيراد الأطباء من Excel">
    <Notice>ارفع ملف XLSX بالأعمدة Name و Doctor geo name و Specailist و classification و City. عند تكرار الاسم، المدير يختار واحداً من ثلاثة قرارات؛ لا يتم ربط طبيبين تلقائياً. كل زيارة لنفس Doctor ID تنحسب مرة ضمن هدف الفريق.</Notice>
    <div className="form-grid">
      <label className="field">ملف Excel
        <input type="file" accept=".xlsx" onChange={e=>{
          setFile(e.target.files?.[0]||null);setClientImportId('');
          setPreview(null);setSummary(null);setError('');
        }}/>
      </label>
      <button className="btn primary" type="button" disabled={busy||!file}
        onClick={previewFile}>{busy?'جارٍ القراءة...':'معاينة الملف'}</button>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    {summary&&<Notice kind="success">انتهى الاستيراد: {summary.created} أطباء جدد، {summary.linked} مناطق مرتبطة بأطباء موجودين، {summary.skipped} أسطر متجاهلة، {summary.invalid} أسطر غير صالحة لم تُستورد.</Notice>}
    {preview&&<>
      <Notice>الأسطر: {preview.total} — جديدة: {preview.newCount} — تحتاج قرارك: {preview.reviewCount} — غير صالحة: {preview.invalidCount}. لا يُحفظ أي تغيير قبل ضغط «اعتماد الاستيراد».</Notice>
      {preview.rows.map((r:Any)=><div className="mini-card" key={r.row}>
        <strong>سطر {r.row}: {r.name||'الاسم غير موجود'} — {r.areaName||'بدون منطقة'}</strong>
        <small>الاختصاص: {r.specialty||'—'}، التصنيف: {r.grade||'C'}</small>
        {r.status==='invalid'?<Notice kind="error">{r.error}</Notice>:
          r.status==='new'?<small>طبيب جديد: سيتم إنشاء سجل مستقل.</small>:
          <>
            <strong>اسم موجود مسبقاً. المدير يقرر:</strong>
            <div className="check-grid">
              <label><input type="radio" name={'doctor-'+r.row}
                checked={choices[r.row]?.action==='same'}
                onChange={()=>updateAction(r.row,'same')}/> نفس الطبيب: ربط المنطقة الجديدة بنفس Doctor ID</label>
              <label><input type="radio" name={'doctor-'+r.row}
                checked={choices[r.row]?.action==='different'}
                onChange={()=>updateAction(r.row,'different')}/> طبيب مختلف: إنشاء سجل مستقل</label>
              <label><input type="radio" name={'doctor-'+r.row}
                checked={choices[r.row]?.action==='skip'}
                onChange={()=>updateAction(r.row,'skip')}/> تجاهل السطر دون تعديل</label>
            </div>
            {choices[r.row]?.action==='same'&&
              <label className="field">اختر سجل الطبيب الذي تريد ربط المنطقة به
                <select value={choices[r.row]?.doctorId?'existing:'+choices[r.row].doctorId:
                  Number.isInteger(choices[r.row]?.sourceRow)?'file:'+choices[r.row].sourceRow:''}
                  onChange={e=>updateSameTarget(r.row,e.target.value)}>
                  <option value="">اختر الطبيب بشكل صريح...</option>
                  {r.candidates.map((c:Any)=><option
                    key={c.type==='existing'?'existing:'+c.id:'file:'+c.sourceRow}
                    value={c.type==='existing'?'existing:'+c.id:'file:'+c.sourceRow}>
                    {c.name} — {c.areas?.join('، ')} {c.type==='file'?'(من سطر '+c.sourceRow+')':''}
                  </option>)}
                </select>
              </label>}
          </>}
      </div>)}
      <button type="button" className="btn primary" disabled={!ready||busy}
        onClick={commit}>{busy?'جارٍ الاعتماد...':'اعتماد الاستيراد حسب الخيارات'}</button>
    </>}
  </Section>;
}
function VisitReports({refresh}:Any){
  const [from,setFrom]=useState(today().slice(0,8)+'01'),[to,setTo]=useState(today());
  const [busy,setBusy]=useState(false),[downloadError,setDownloadError]=useState('');
  const valid=from.length===10&&to.length===10&&from<=to;
  const query='?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);
  const {data,error}=useData(valid?'/reports/visits'+query:null,refresh);
  async function exportExcel(){
    if(!valid||busy)return;
    setBusy(true);setDownloadError('');
    try{
      const response=await fetch('/api/reports/visits.xlsx'+query,{credentials:'include'});
      if(!response.ok){
        const err=await response.json().catch(()=>({}));
        throw Error(err.error||'فشل تصدير التقرير');
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=url;link.download='mandob-visits-'+from+'-'+to+'.xlsx';
      document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }catch(e:Any){setDownloadError(e.message);}finally{setBusy(false);}
  }
  return <Section title="تقارير الزيارات">
    <Notice>تقرير الجولات حسب التاريخ والفريق وقت الزيارة، بدون تغيير طريقة حساب الـ Frequency.</Notice>
    <div className="form-grid">
      <label className="field">من تاريخ<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="field">إلى تاريخ<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    {!valid&&<Notice kind="error">اختر فترة زمنية صحيحة</Notice>}
    {error&&<Notice kind="error">{error}</Notice>}
    {downloadError&&<Notice kind="error">{downloadError}</Notice>}
    {!data&&!error&&valid&&<Empty text="جارٍ تحميل التقرير..."/>}
    {data&&<>
      <div className="stats">{[
        ['الجولات',data.total],['الأطباء',data.byType?.DOCTOR||0],
        ['الصيدليات',data.byType?.PHARMACY||0],['المشافي',data.byType?.HOSPITAL||0]
      ].map(([name,n])=><div className="stat" key={String(name)}><span>{name}</span><strong>{n}</strong></div>)}</div>
      <button type="button" className="btn primary" disabled={busy} onClick={exportExcel}>
        {busy?'جارٍ التصدير...':'تصدير Excel'}
      </button>
      <h3>الجولات حسب الفريق</h3>
      {!data.byTeam?.length?<Empty/>:<div className="table-wrap"><table>
        <thead><tr><th>الفريق وقت الزيارة</th><th>الجولات</th><th>أطباء</th><th>صيدليات</th><th>مشافي</th></tr></thead>
        <tbody>{data.byTeam.map((r:Any)=><tr key={r.teamId||'solo'}>
          <td>{r.name}</td><td>{r.total}</td><td>{r.DOCTOR}</td><td>{r.PHARMACY}</td><td>{r.HOSPITAL}</td>
        </tr>)}</tbody></table></div>}
      <h3>الجولات حسب المندوب</h3>
      {!data.byRepresentative?.length?<Empty/>:<div className="table-wrap"><table>
        <thead><tr><th>المندوب</th><th>الجولات</th><th>أطباء</th><th>صيدليات</th><th>مشافي</th></tr></thead>
        <tbody>{data.byRepresentative.map((r:Any)=><tr key={r.repId}>
          <td>{r.name}</td><td>{r.total}</td><td>{r.DOCTOR}</td><td>{r.PHARMACY}</td><td>{r.HOSPITAL}</td>
        </tr>)}</tbody></table></div>}
      <h3>تفاصيل الزيارات</h3>
      {!data.rows?.length?<Empty/>:<div className="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>المندوب</th><th>الفريق</th><th>النوع</th><th>الجهات</th></tr></thead>
        <tbody>{data.rows.map((r:Any)=><tr key={r.id}>
          <td>{r.date}</td><td>{r.repName}</td><td>{r.teamName}</td>
          <td>{typeLabels[r.type]||r.type}</td><td>{r.targets?.join('، ')||'—'}</td>
        </tr>)}</tbody></table></div>}
    </>}
  </Section>;
}
function Directory({kind,refresh,done}:Any){
  const c=kind==='areas'?'المناطق':kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي';
  const [includeArchived,setIncludeArchived]=useState(false);
  const [query,setQuery]=useState('');
  const [actionError,setActionError]=useState('');
  const [busyId,setBusyId]=useState<string|null>(null);
  const [editId,setEditId]=useState<string|null>(null);
  const isMedical=['doctors','pharmacies','hospitals'].includes(kind);
  const dataPath=isMedical&&includeArchived?'/'+kind+'?includeArchived=true':'/'+kind;
  const {data,error}=useData(dataPath,refresh),{data:areas}=useData('/areas',refresh);
  const {data:specialties}=useData(kind==='doctors'?'/specialties':null,refresh);
  const usesArea=kind!=='areas';
  const editing=isMedical?data?.find((item:Any)=>item.id===editId):null;
  const filtered=(data||[]).filter((x:Any)=>
    [x.name,x.specialty,x.city,x.area?.name,x.grade,x.category,
      ...(x.doctorAreas||[]).map((link:Any)=>link.area?.name)]
      .some(value=>String(value||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  async function changeMedicalStatus(item:Any){
    const next=!item.active;
    const unit=kind==='doctors'?'الطبيب':kind==='pharmacies'?'الصيدلية':'المشفى';
    const message=next?'استعادة '+unit+' وإتاحته للجولات الجديدة؟':
      'أرشفة '+unit+'؟ سيختفي من الجولات الجديدة وتبقى زياراته السابقة محفوظة.';
    if(!window.confirm(message))return;
    setActionError('');setBusyId(item.id);
    try{
      await patch('/'+kind+'/'+item.id+'/status',{active:next});
      done();
    }catch(e:Any){setActionError(e.message||'تعذر تغيير حالة السجل');}
    finally{setBusyId(null);}
  }
  return <>{kind==='doctors'&&<datalist id="doctor-specialty-options">
    {(specialties||[]).map((name:string)=><option key={name} value={name}/>)}
  </datalist>}
  <Section title={c} actions={isMedical?
    <label className="check-item"><input type="checkbox" checked={includeArchived}
      onChange={e=>setIncludeArchived(e.target.checked)}/>عرض المؤرشفين أيضاً</label>:null}>
    {error&&<Notice kind="error">{error}</Notice>}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    <label className="field">بحث بالاسم أو المنطقة
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="اكتب للبحث في النتائج المعروضة"/>
    </label>
    {!data&&!error?<Empty text="جارٍ تحميل البيانات..."/>:!filtered.length?<Empty/>:<div className="table-wrap"><table><thead><tr><th>الاسم</th><th>المنطقة</th><th>التفاصيل</th>
      {isMedical&&<><th>الحالة</th><th>الإجراء</th></>}</tr></thead><tbody>
      {filtered.map((x:Any)=><tr key={x.id}><td>{x.name}</td><td>{kind==='doctors'&&x.doctorAreas?.length?
          [...new Set(x.doctorAreas.map((link:Any)=>link.area.name))].join('، '):
          x.area?.name||x.city||'—'}</td>
        <td>{x.specialty||x.grade||x.category||'—'}</td>
        {isMedical&&<><td>{x.active?'نشط':'مؤرشف'}</td><td>
          <button type="button" className="btn small outline" disabled={busyId!==null}
            onClick={()=>setEditId(x.id)}>تعديل البيانات</button>
          <button type="button" className={'btn small'+(x.active?' danger':'')}
            disabled={busyId!==null} onClick={()=>changeMedicalStatus(x)}>
            {busyId===x.id?'جارٍ الحفظ...':x.active?'أرشفة':'استعادة'}
          </button>
        </td></>}</tr>)}</tbody></table></div>}
  </Section>
  {editing&&<Section title={'تعديل بيانات '+editing.name}>
    <Notice>التعديل هون للبيانات الوصفية فقط؛ ما بيغيّر مناطق الطبيب، رقم السجل، الأرشفة أو زياراته السابقة.</Notice>
    <div key={editing.id}>
      <Form onSave={async(fd:FormData)=>{
        const changes:Any={name:val(fd,'name')};
        if(kind==='doctors'){
          changes.specialty=val(fd,'specialty');changes.grade=val(fd,'grade');
          changes.city=val(fd,'city')||null;
        }
        if(kind==='pharmacies'){
          changes.grade=val(fd,'grade');changes.target=Number(val(fd,'target'));
          changes.kind=val(fd,'kind');
        }
        if(kind==='hospitals'){
          changes.category=val(fd,'category');changes.specialty=val(fd,'specialty');
          changes.target=Number(val(fd,'target'));
        }
        await patch('/'+kind+'/'+editing.id,changes);
        setEditId(null);done();
      }}>
        <div className="form-grid">
          <TextInput name="name" label="الاسم" defaultValue={editing.name}/>
          {kind==='doctors'&&<>
            <TextInput name="specialty" label="الاختصاص" defaultValue={editing.specialty}
              listId="doctor-specialty-options"/>
            <SelectInput name="grade" label="التصنيف" defaultValue={editing.grade}
              options={['A','B','C'].map(v=>({value:v,label:v}))}/>
            <TextInput name="city" label="المدينة" required={false} defaultValue={editing.city||''}/>
          </>}
          {kind==='pharmacies'&&<>
            <SelectInput name="grade" label="التصنيف" defaultValue={editing.grade}
              options={['A','B','C'].map(v=>({value:v,label:v}))}/>
            <TextInput name="target" label="عدد الزيارات المستهدف" type="number"
              defaultValue={String(editing.target)}/>
            <TextInput name="kind" label="نوع الصيدلية" defaultValue={editing.kind}/>
          </>}
          {kind==='hospitals'&&<>
            <TextInput name="category" label="تصنيف المشفى" defaultValue={editing.category}/>
            <TextInput name="specialty" label="الاختصاص" defaultValue={editing.specialty}/>
            <TextInput name="target" label="عدد الزيارات المستهدف" type="number"
              defaultValue={String(editing.target)}/>
          </>}
        </div>
      </Form>
      <button type="button" className="btn outline" onClick={()=>setEditId(null)}>إلغاء التعديل</button>
    </div>
  </Section>}
  {kind==='doctors'&&<DoctorExcelImport done={done}/>}
  <Section title={'إضافة إلى '+c}><Form onSave={async(fd:FormData)=>{
    const body:Any={name:val(fd,'name')};
    if(usesArea)body.areaId=val(fd,'areaId');
    if(kind==='areas')body.city=val(fd,'city');
    if(kind==='doctors'){body.specialty=val(fd,'specialty');body.grade=val(fd,'grade');}
    if(kind==='pharmacies'){body.grade=val(fd,'grade');body.target=Number(val(fd,'target')||4);}
    if(kind==='hospitals'){body.category=val(fd,'category')||'خاص';body.specialty=val(fd,'specialty')||'عام';body.target=Number(val(fd,'target')||4);}
    await post('/'+kind,body);done();
  }}><div className="form-grid"><TextInput name="name" label="الاسم"/>
    {usesArea?<SelectInput name="areaId" label="المنطقة" options={(areas||[]).map((a:Any)=>({value:a.id,label:a.name}))}/>:
      <TextInput name="city" label="المدينة" required={false}/>}
    {(kind==='doctors'||kind==='hospitals')&&<TextInput name="specialty" label="الاختصاص"
      listId={kind==='doctors'?'doctor-specialty-options':undefined}
      required={kind==='doctors'}/>}
    {(kind==='doctors'||kind==='pharmacies')&&<SelectInput name="grade" label="التصنيف"
      options={['A','B','C'].map(v=>({value:v,label:v}))}/>}
    {kind==='hospitals'&&<TextInput name="category" label="تصنيف المشفى" required={false}/>}
    {(kind==='pharmacies'||kind==='hospitals')&&<TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue="4"/>}
  </div></Form></Section>
  {kind==='areas'&&<AreaOrganization revision={refresh} onChange={done}/>}</>;
}
function Settings({refresh,done}:Any){
  const {data,error}=useData('/settings',refresh);
  return <Section title="إعدادات دورة الزيارات">{error&&<Notice kind="error">{error}</Notice>}
    {data&&<Form onSave={async(fd:FormData)=>{
      await patch('/settings',{frequencyA:Number(val(fd,'frequencyA')),frequencyB:Number(val(fd,'frequencyB')),
        frequencyC:Number(val(fd,'frequencyC')),cycleStart:val(fd,'cycleStart')||null,
        cycleEnd:val(fd,'cycleEnd')||null,annualLeaveBalance:Number(val(fd,'annualLeaveBalance'))});done();
    }}><div className="form-grid">
      {['A','B','C'].map(k=><TextInput key={k} name={'frequency'+k} label={'عدد زيارات التصنيف '+k}
        type="number" defaultValue={data['frequency'+k]}/>)}
      <TextInput name="cycleStart" type="date" required={false} label="تاريخ بداية الدورة" defaultValue={data.cycleStart?.slice(0,10)}/>
      <TextInput name="cycleEnd" type="date" required={false} label="تاريخ نهاية الدورة" defaultValue={data.cycleEnd?.slice(0,10)}/>
      <TextInput name="annualLeaveBalance" label="الرصيد السنوي الافتراضي" type="number" defaultValue={data.annualLeaveBalance}/>
    </div></Form>}
  </Section>;
}
function Companies({refresh,done}:Any){
  const {data,error}=useData('/companies',refresh);
  return <><Section title="الشركات">{error&&<Notice kind="error">{error}</Notice>}
    {!data?.length?<Empty/>:<div className="card-grid">{data.map((c:Any)=><div key={c.id} className="mini-card">
      <strong>{c.name}</strong><span>{c._count?.users||0} مستخدمين</span>
      <small>{c._count?.visits||0} جولة مسجلة</small></div>)}</div>}</Section>
    <Section title="إنشاء شركة"><Form onSave={async(fd:FormData)=>{await post('/companies',{name:val(fd,'name')});done();}}>
      <TextInput name="name" label="اسم الشركة"/></Form></Section>
    <Section title="إنشاء مدير شركة"><Form onSave={async(fd:FormData)=>{
      await post('/companies/'+val(fd,'companyId')+'/admins',{name:val(fd,'name'),
        username:val(fd,'username'),password:val(fd,'password')});done();
    }}><SelectInput name="companyId" label="الشركة" options={(data||[]).map((c:Any)=>({value:c.id,label:c.name}))}/>
      <TextInput name="name" label="اسم المدير"/><TextInput name="username" label="اسم الدخول"/>
      <TextInput name="password" label="كلمة مرور قوية" type="password"/></Form></Section>
  </>;
}
const menus:Record<string,Array<[string,string]>>={
  SUPER_ADMIN:[['companies','الشركات']],
  COMPANY_ADMIN:[['dashboard','الرئيسية'],['users','المندوبون'],['teams','الفرق'],['products','المنتجات'],['areas','المناطق'],
    ['doctors','الأطباء'],['pharmacies','الصيدليات'],['hospitals','المشافي'],
    ['visits','الجولات'],['leaves','الإجازات'],['reports','التقارير'],['frequency','الإحصائيات'],['settings','الإعدادات']],
  TEAM_MANAGER:[['dashboard','الرئيسية'],['users','الفريق'],['visits','الجولات'],['leaves','الإجازات'],['reports','التقارير'],['frequency','الإحصائيات']],
  REP:[['dashboard','الرئيسية'],['new-visit','إنهاء جولة'],['visits','جولاتي'],['new-leave','طلب إجازة'],
    ['leaves','إجازاتي'],['frequency','إنجاز الزيارات']]
};
export default function App(){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),
    [section,setSection]=useState('dashboard'),[revision,setRevision]=useState(0),[shellError,setShellError]=useState('');
  useEffect(()=>{api('/me').then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  useEffect(()=>{(window as Any).__mandobUser=user;},[user]);
  useEffect(()=>{if(user)setSection(user.role==='SUPER_ADMIN'?'companies':'dashboard');},[user?.role]);
  function refresh(){setRevision(v=>v+1);}
  async function logout(){
    setShellError('');
    try{
      await post('/logout',{});
      // Clear the UI only once the server has revoked the session.
      setUser(null);
    }catch(e:Any){
      setShellError('تعذر تسجيل الخروج؛ جلسة المستخدم ربما ما زالت فعّالة. '+(e.message||''));
    }
  }
  if(loading)return <div className="loading">جارٍ التحقق من الجلسة...</div>;
  if(!user)return <Login onLogin={(u:User)=>{setUser(u);setShellError('')}}/>;
  const m=menus[user.role]||[];
  const title=m.find(x=>x[0]===section)?.[1]||'لوحة التحكم';
  let contents:React.ReactNode=null;
  switch(section){
    case 'dashboard':contents=user.role==='REP'?<>
      <Dashboard refresh={revision}/><WeeklyVisits refresh={revision} user={user}/>
    </>:<Dashboard refresh={revision}/>;break;
    case 'new-visit':contents=<NewVisit refresh={revision} done={refresh}/>;break;
    case 'visits':contents=<Records kind="visits" refresh={revision}/>;break;
    case 'new-leave':contents=<NewLeave done={refresh}/>;break;
    case 'leaves':contents=<Records kind="leaves" refresh={revision}/>;break;
    case 'reports':contents=<><VisitReports refresh={revision}/>
      <WeeklyVisits refresh={revision} user={user}/></>;break;
    case 'frequency':contents=<Frequency refresh={revision}/>;break;
    case 'teams':contents=<Teams refresh={revision} done={refresh}/>;break;
    case 'products':contents=<Products refresh={revision} done={refresh}/>;break;
    case 'users':contents=<Users refresh={revision} done={refresh} canCreate={user.role==='COMPANY_ADMIN'}/>;break;
    case 'settings':contents=<Settings refresh={revision} done={refresh}/>;break;
    case 'companies':contents=<Companies refresh={revision} done={refresh}/>;break;
    case 'areas':case 'doctors':case 'pharmacies':case 'hospitals':
      contents=<Directory key={section} kind={section} refresh={revision} done={refresh}/>;break;
    default:contents=<Empty/>;
  }
  return <div className="layout">
    <aside className="sidebar"><div className="brand"><span className="brand-symbol">M</span>
      <div><strong>Mandob</strong><small>Medical Representatives</small></div></div>
      <div className="side-label">القائمة الرئيسية</div>
      <nav>{m.map(([key,label])=><button key={key} type="button" className={section===key?'active':''}
        onClick={()=>setSection(key)}>{label}</button>)}</nav>
      <div className="side-footer"><strong>{user.name}</strong><small>{labels[user.role]}</small>
        <button type="button" className="btn outline" onClick={logout}>تسجيل الخروج</button></div>
    </aside>
    <main className="main"><header className="topbar"><div><span className="eyebrow">إدارة المندوبين الطبيين</span>
      <h1>{title}</h1></div><span className="avatar">{user.name.slice(0,1)}</span></header>
      {shellError&&<Notice kind="error">{shellError}</Notice>}
      <div className="page" key={section}>{contents}</div>
    </main>
  </div>;
}
