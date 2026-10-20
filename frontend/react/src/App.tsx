import React,{useEffect,useState} from 'react';
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
const today=()=>new Date().toLocaleDateString('en-CA'); // local day for visit date
function Section({title,children,actions}:Any){
  return <section className="section"><div className="section-title"><h2>{title}</h2>{actions}</div>{children}</section>;
}
function Notice({children,kind='info'}:Any){return <div className={'notice '+kind}>{children}</div>}
function Empty({text='لا توجد بيانات بعد'}:Any){return <div className="empty">{text}</div>}
function Submit({children='حفظ'}:Any){return <button type="submit" className="btn primary">{children}</button>}
function TextInput({name,label,type='text',required=true,placeholder='',defaultValue}:Any){
  return <label className="field">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue}/></label>;
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
  const [data,setData]=useState<Any>(null),[error,setError]=useState('');
  useEffect(()=>{let valid=true;if(!path)return;
    setError('');api(path).then(d=>{if(valid)setData(d)}).catch(e=>{if(valid)setError(e.message)});
    return()=>{valid=false};
  },[path,refresh]);
  return {data,error};
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
  const [reload,setReload]=useState(0);
  const [actionError,setActionError]=useState(''),[actionOk,setActionOk]=useState('');
  const user=(window as Any).__mandobUser as User;
  const canReview=user?.role==='COMPANY_ADMIN'||user?.role==='TEAM_MANAGER';
  useEffect(()=>{
    setData([]);setOffset(0);setHasMore(true);
  },[path,refresh,reload]);
  useEffect(()=>{
    let valid=true;setLoading(true);setError('');
    api(path+'?limit='+pageSize+'&offset='+offset)
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
  },[path,refresh,reload,offset]);
  async function review(id:string,status:string){
    setActionError('');setActionOk('');
    try{
      await patch('/leaves/'+id+'/status',{status});
      setActionOk('تمت مراجعة الطلب وتحديث القائمة');
      setReload(x=>x+1);
    }catch(e:Any){setActionError(e.message);}
  }
  return <Section title={kind==='visits'?'سجل الجولات':'طلبات الإجازة'}>
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
              <button type="button" className="btn small" onClick={()=>review(r.id,'APPROVED')}>موافقة</button>
              <button type="button" className="btn small danger" onClick={()=>review(r.id,'REJECTED')}>رفض</button>
            </div>:'—'}</td></>}
      </tr>)}</tbody></table></div>}
    {data.length>0&&<p className="muted">السجلات المعروضة: {data.length}</p>}
    {hasMore&&data.length>0&&<button type="button" className="btn outline"
      disabled={loading} onClick={()=>setOffset(o=>o+pageSize)}>
      {loading?'جارٍ تحميل المزيد...':'عرض سجلات أقدم'}
    </button>}
    {loading&&data.length>0&&!hasMore&&<p className="muted">جارٍ التحديث...</p>}
  </Section>;
}
function NewVisit({refresh,done}:Any){
  const [type,setType]=useState('DOCTOR'),[targetIds,setTargetIds]=useState<string[]>([]);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[last,setLast]=useState('');
  const route=type==='DOCTOR'?'/doctors':type==='PHARMACY'?'/pharmacies':'/hospitals';
  const {data:targets,error:loadError}=useData(route,refresh);
  useEffect(()=>setTargetIds([]),[type]);
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
      const position=await locate();
      const body={clientVisitId:crypto.randomUUID(),type,visitDate:val(fd,'visitDate'),targetIds,
        location:{latitude:position.coords.latitude,longitude:position.coords.longitude,
          accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()}};
      const d=await post('/visits',body);setLast('تم حفظ الجولة رقم '+d.id+' مع موقع نهاية الجولة');
      setTargetIds([]);done();
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
    {loadError&&<Notice kind="error">{loadError}</Notice>}
    {!targets?<Empty text="جارٍ تحميل الجهات..."/>:targets.length===0?<Empty text="لا توجد جهات مخصصة لك. اطلب من المدير إسناد مناطقك."/>:
      <div className="check-grid">{targets.map((x:Any)=><label className="check-item" key={x.id}>
        <input type="checkbox" checked={targetIds.includes(x.id)}
          onChange={e=>setTargetIds(p=>e.target.checked?[...p,x.id]:p.filter(id=>id!==x.id))}/>
        <span>{x.name}</span><small>{x.area?.name}</small></label>)}</div>}
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
  const {data,error}=useData('/analytics/frequency',refresh);
  if(error)return <Notice kind="error">{error}</Notice>;
  if(!data)return <Empty text="تحميل تقارير التكرار..."/>;
  return <Section title="تكرار زيارات الأطباء">
    <Notice>المكتملون: {data.completed} من {data.total} طبيب، حسب إعدادات دورة الزيارات.</Notice>
    {!data.items?.length?<Empty/>:<div className="table-wrap"><table><thead><tr><th>الطبيب</th><th>المنطقة</th><th>التصنيف</th><th>المنجز / المطلوب</th><th>الإنجاز</th></tr></thead>
      <tbody>{data.items.map((r:Any)=><tr key={r.id}><td>{r.name}</td><td>{r.area}</td><td>{r.grade}</td>
        <td>{r.done} / {r.target}</td><td><div className="meter"><span style={{width:r.coverage+'%'}}/></div>{r.coverage}%</td></tr>)}</tbody></table></div>}
  </Section>;
}
function Teams({refresh,done}:Any){
  const {data,error}=useData('/teams',refresh);
  return <><Section title="الفرق">{error&&<Notice kind="error">{error}</Notice>}
    {data?.length?<div className="card-grid">{data.map((t:Any)=><div className="mini-card" key={t.id}>
      <strong>{t.name}</strong><span>{t._count?.users||0} مستخدمين</span>
      <small>{t.specialties?.map((s:Any)=>s.specialty).join('، ')||'لا توجد اختصاصات'}</small></div>)}</div>:<Empty/>}</Section>
    <Section title="إنشاء فريق"><Form onSave={async(fd:FormData)=>{
      await post('/teams',{name:val(fd,'name'),specialties:val(fd,'specialties').split(',').map(s=>s.trim()).filter(Boolean)});done();
    }}><TextInput name="name" label="اسم الفريق"/><TextInput name="specialties" label="الاختصاصات (مفصولة بفاصلة)" required={false}/></Form></Section></>;
}
function Users({refresh,done,canCreate}:Any){
  const {data,error}=useData('/users',refresh),{data:teams}=useData('/teams',refresh),
    {data:areas}=useData('/areas',refresh);
  const [editId,setEditId]=useState<string|null>(null);
  const editing=data?.find((u:Any)=>u.id===editId);
  return <><Section title="المستخدمون والمندوبون">
    {error&&<Notice kind="error">{error}</Notice>}
    {!data?<Empty text="جارٍ تحميل المستخدمين..."/>:!data.length?<Empty/>:
    <div className="table-wrap"><table><thead><tr>
      <th>الاسم</th><th>المستخدم</th><th>الدور</th><th>الفريق</th><th>المناطق</th><th>الحالة</th>
      {canCreate&&<th>التعديل</th>}</tr></thead><tbody>
      {data.map((u:Any)=><tr key={u.id}><td>{u.name}</td><td>{u.username}</td>
        <td>{labels[u.role]||u.role}</td>
        <td>{(teams||[]).find((t:Any)=>t.id===u.teamId)?.name||'—'}</td>
        <td>{u.repAreas?.map((r:Any)=>r.area.name).join('، ')||'—'}</td>
        <td>{u.active?'نشط':'موقوف'}</td>
        {canCreate&&<td>{['REP','TEAM_MANAGER'].includes(u.role)?
          <button type="button" className="btn small" onClick={()=>setEditId(u.id)}>تعديل</button>:'—'}</td>}
      </tr>)}</tbody></table></div>}
  </Section>
  {canCreate&&editing&&<Section title={'تعديل بيانات: '+editing.name}>
    <div key={editing.id}>
      <Notice>تعديل الفريق ما بينقل الجولات السابقة؛ بتضل محسوبة للفريق اللي انعملت فيه.</Notice>
      <Form onSave={async(fd:FormData)=>{
        await patch('/users/'+editing.id,{
          name:val(fd,'name'),teamId:val(fd,'teamId')||null,
          dailyTarget:Number(val(fd,'dailyTarget')),
          annualLeaveBalance:Number(val(fd,'annualLeaveBalance')),
          areaIds:fd.getAll('areaIds'),
          active:fd.get('active')==='on'
        });
        setEditId(null);done();
      }}>
        <div className="form-grid">
          <TextInput name="name" label="الاسم" defaultValue={editing.name}/>
          <SelectInput name="teamId" label="الفريق" required={false}
            defaultValue={editing.teamId||''}
            options={(teams||[]).map((t:Any)=>({value:t.id,label:t.name}))}/>
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
    <Form onSave={async(fd:FormData)=>{await post('/users',{name:val(fd,'name'),username:val(fd,'username'),
      password:val(fd,'password'),role:val(fd,'role'),teamId:val(fd,'teamId')||null,areaIds:fd.getAll('areaIds')});done();}}>
      <div className="form-grid"><TextInput name="name" label="الاسم"/>
        <TextInput name="username" label="اسم المستخدم"/>
        <TextInput name="password" label="كلمة المرور (12 محرفاً على الأقل)" type="password"/>
        <SelectInput name="role" label="الدور" options={[{value:'REP',label:'مندوب'},{value:'TEAM_MANAGER',label:'مدير فريق'}]}/>
        <SelectInput name="teamId" label="الفريق" required={false}
          options={(teams||[]).map((t:Any)=>({value:t.id,label:t.name}))}/>
      </div><label className="field">المناطق المخصصة (للمندوب)</label>
      <div className="check-grid">{(areas||[]).map((a:Any)=><label className="check-item" key={a.id}>
        <input type="checkbox" name="areaIds" value={a.id}/>{a.name}</label>)}</div>
    </Form></Section>}</>;
}
function Directory({kind,refresh,done}:Any){
  const c=kind==='areas'?'المناطق':kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي';
  const [includeArchived,setIncludeArchived]=useState(false);
  const [actionError,setActionError]=useState('');
  const [busyId,setBusyId]=useState<string|null>(null);
  const isMedical=['doctors','pharmacies','hospitals'].includes(kind);
  const dataPath=isMedical&&includeArchived?'/'+kind+'?includeArchived=true':'/'+kind;
  const {data,error}=useData(dataPath,refresh),{data:areas}=useData('/areas',refresh);
  const usesArea=kind!=='areas';
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
  return <><Section title={c} actions={isMedical?
    <label className="check-item"><input type="checkbox" checked={includeArchived}
      onChange={e=>setIncludeArchived(e.target.checked)}/>عرض المؤرشفين أيضاً</label>:null}>
    {error&&<Notice kind="error">{error}</Notice>}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    {!data?.length?<Empty/>:<div className="table-wrap"><table><thead><tr><th>الاسم</th><th>المنطقة</th><th>التفاصيل</th>
      {isMedical&&<><th>الحالة</th><th>الإجراء</th></>}</tr></thead><tbody>
      {data.map((x:Any)=><tr key={x.id}><td>{x.name}</td><td>{x.area?.name||x.city||'—'}</td>
        <td>{x.specialty||x.grade||x.category||'—'}</td>
        {isMedical&&<><td>{x.active?'نشط':'مؤرشف'}</td><td>
          <button type="button" className={'btn small'+(x.active?' danger':'')}
            disabled={busyId!==null} onClick={()=>changeMedicalStatus(x)}>
            {busyId===x.id?'جارٍ الحفظ...':x.active?'أرشفة':'استعادة'}
          </button>
        </td></>}</tr>)}</tbody></table></div>}
  </Section><Section title={'إضافة إلى '+c}><Form onSave={async(fd:FormData)=>{
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
    {(kind==='doctors'||kind==='hospitals')&&<TextInput name="specialty" label="الاختصاص" required={kind==='doctors'}/>}
    {(kind==='doctors'||kind==='pharmacies')&&<SelectInput name="grade" label="التصنيف"
      options={['A','B','C'].map(v=>({value:v,label:v}))}/>}
    {kind==='hospitals'&&<TextInput name="category" label="تصنيف المشفى" required={false}/>}
    {(kind==='pharmacies'||kind==='hospitals')&&<TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue="4"/>}
  </div></Form></Section></>;
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
  COMPANY_ADMIN:[['dashboard','الرئيسية'],['users','المندوبون'],['teams','الفرق'],['areas','المناطق'],
    ['doctors','الأطباء'],['pharmacies','الصيدليات'],['hospitals','المشافي'],
    ['visits','الجولات'],['leaves','الإجازات'],['frequency','الإحصائيات'],['settings','الإعدادات']],
  TEAM_MANAGER:[['dashboard','الرئيسية'],['users','الفريق'],['visits','الجولات'],['leaves','الإجازات'],['frequency','الإحصائيات']],
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
    try{await post('/logout',{});}catch(e:Any){setShellError(e.message);}
    setUser(null);
  }
  if(loading)return <div className="loading">جارٍ التحقق من الجلسة...</div>;
  if(!user)return <Login onLogin={(u:User)=>{setUser(u);setShellError('')}}/>;
  const m=menus[user.role]||[];
  const title=m.find(x=>x[0]===section)?.[1]||'لوحة التحكم';
  let contents:React.ReactNode=null;
  switch(section){
    case 'dashboard':contents=<Dashboard refresh={revision}/>;break;
    case 'new-visit':contents=<NewVisit refresh={revision} done={refresh}/>;break;
    case 'visits':contents=<Records kind="visits" refresh={revision}/>;break;
    case 'new-leave':contents=<NewLeave done={refresh}/>;break;
    case 'leaves':contents=<Records kind="leaves" refresh={revision}/>;break;
    case 'frequency':contents=<Frequency refresh={revision}/>;break;
    case 'teams':contents=<Teams refresh={revision} done={refresh}/>;break;
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
