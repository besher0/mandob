import React,{useEffect,useState,useRef} from 'react';
import {BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext, useSearchParams} from 'react-router-dom';
import AreaOrganization from './AreaOrganization';
import {inArea,targetsForAreas,retainSelectedTargets} from './tourFlow.mjs';
import {homePath,routePath} from './routing.mjs';
import {reportRange} from './repReport.mjs';
type Any=any;
type User={id:string,name:string,role:string,companyId?:string,teamId?:string,username:string};
const labels:Record<string,string>={SUPER_ADMIN:'مدير النظام',COMPANY_ADMIN:'مدير الشركة',
  TEAM_MANAGER:'مدير الفريق',REP:'مندوب طبي'};
const typeLabels:Record<string,string>={DOCTOR:'أطباء',PHARMACY:'صيدليات',HOSPITAL:'مشافي'};
class ApiError extends Error {
  status:number;
  code?:string;
  constructor(message:string,status=0,code?:string){super(message);this.name='ApiError';this.status=status;this.code=code;}
}
async function api(path:string,options:Any={}) {
  let r:Response;
  try{
    r=await fetch('/api'+path,{credentials:'include',...options,
      headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  }catch(_error){
    throw new ApiError('تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.');
  }
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    throw new ApiError(data.error||'تعذر تنفيذ الطلب',r.status,data.code);
  }
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
function TextInput({name,label,type='text',required=true,placeholder='',defaultValue,listId,max}:Any){
  return <label className="field">{label}<input name={name} type={type} required={required}
    placeholder={placeholder} defaultValue={defaultValue} list={listId} max={max}/></label>;
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

type CacheEntry={expiresAt:number,promise:Promise<Any>};
const dataRequestCache=new Map<string,CacheEntry>();
function cachedData(path:string,version:number|string){
  const key=JSON.stringify([path,version]),now=Date.now();
  const current=dataRequestCache.get(key);
  if(current&&current.expiresAt>now)return current.promise;
  const promise=api(path).catch(error=>{
    if(dataRequestCache.get(key)?.promise===promise)dataRequestCache.delete(key);
    throw error;
  });
  dataRequestCache.set(key,{expiresAt:now+20000,promise});
  if(dataRequestCache.size>100){
    const oldest=dataRequestCache.keys().next().value;
    if(oldest!==undefined)dataRequestCache.delete(oldest);
  }
  return promise;
}

function useData(path:string|null,refresh:number|string=0){
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
    cachedData(path,refresh).then(data=>{
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
    try{const d=await post('/login',{username:val(fd,'username'),password:val(fd,'password')});dataRequestCache.clear();onLogin(d.user);}
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

/**
 * Representative-only workspace based on the old MedREP home shortcuts.
 * Every number comes from the authenticated v2 API, never legacy mock data.
 */
function RepHome({refresh,user,navigate}:Any){
  const {data:weekly,error:weeklyError}=useData(
    '/weekly-visits-count?repId='+encodeURIComponent(user.id)+'&onDate='+today(),refresh);
  const {data:workspace,error:workspaceError}=useData('/rep-workspace-summary',refresh);
  const {data:plan,error:planError}=useData('/rep-plan',refresh);
  const {data:overview,error:overviewError}=useData('/analytics/rep-overview',refresh);
  const coverage=overview?.coverage,frequency=overview?.frequency;
  const coverageError=overviewError,frequencyError=overviewError;
  const {data:settings,error:settingsError}=useData('/settings',refresh);
  const {data:assignedAreas,error:assignedAreaError}=useData('/areas',refresh);
  const groupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const team=(coverage?.teamTotals||[]).find((row:Any)=>row.groupKey===groupKey)||null;
  const cycleEnd=String(settings?.cycleEnd||'').slice(0,10);
  const remainingDays=cycleEnd&&Number.isFinite(Date.parse(cycleEnd+'T00:00:00Z'))?
    Math.max(0,Math.floor((Date.parse(cycleEnd+'T00:00:00Z')-
      Date.parse(today()+'T00:00:00Z'))/86400000)+1):null;
  const weeklyTarget=plan&&settings?
    Number(plan.dailyTarget)*new Set(Array.isArray(settings.workingDays)?settings.workingDays:[]).size:null;
  // Reuse one live achieved/target indicator in both the hero and workspace plan.
  // weekly.count counts medical targets, not merely the number of rounds.
  const weeklyVisitsRatio=weekly&&weeklyTarget!==null&&
    Number.isFinite(weeklyTarget)&&weeklyTarget>0?
    weekly.count+'/'+weeklyTarget:'—';
  const weeklyProgress=weekly&&weeklyTarget!==null&&weeklyTarget>0?
    Math.round(weekly.count/weeklyTarget*100):null;
  const areaIds=new Set((assignedAreas||[]).map((area:Any)=>area.id));
  const myAreaRows=(coverage?.areas||[]).filter((area:Any)=>
    area.groupKey===groupKey&&areaIds.has(area.areaId));
  // Preserve the legacy area-coverage card's doctor-weighted average.
  const areaDoctorWeight=myAreaRows.reduce((sum:number,area:Any)=>sum+area.doctors,0);
  const areaCoverage=areaDoctorWeight?
    Math.round(myAreaRows.reduce((sum:number,area:Any)=>
      sum+area.coverage*area.doctors,0)/areaDoctorWeight):0;
  const needsAttention=myAreaRows.filter((area:Any)=>
    area.target>0&&area.done<area.target)
    .sort((a:Any,b:Any)=>a.coverage-b.coverage||
      a.areaName.localeCompare(b.areaName));
  const unvisitedA=(frequency?.items||[]).filter((item:Any)=>
    item.grade==='A'&&item.done===0&&
    (user.teamId?item.teamId===user.teamId:!item.teamId)).length;
  const errors=[weeklyError,workspaceError,planError,coverageError,frequencyError,
    settingsError,assignedAreaError].filter(Boolean);
  const cards=[
    {id:'doctors',symbol:'👨‍⚕️',title:'الأطباء',
      caption:'قائمة الأطباء مع التصنيف والاختصاص وتكرار الزيارة.',tone:'doctors',
      metrics:[
        {value:workspace?workspace.doctors.total:'—',label:'طبيب'},
        {value:workspace?workspace.doctors.unvisited:'—',label:'غير مزار'}
      ]},
    {id:'pharmacies',symbol:'💊',title:'الصيدليات',
      caption:'كل الصيدليات مصنفة حسب الفئة والمنطقة.',tone:'pharmacies',
      metrics:[
        {value:workspace?workspace.pharmacies.total:'—',label:'صيدلية'},
        {value:workspace?workspace.pharmacies.unvisited:'—',label:'غير مزارة'}
      ]},
    {id:'hospitals',symbol:'🏥',title:'المشافي',
      caption:'المشافي العامة والخاصة والمراكز التخصصية.',tone:'hospitals',
      metrics:[
        {value:workspace?workspace.hospitals.total:'—',label:'مشفى'},
        {value:workspace?workspace.hospitals.needsVisit:'—',label:'بحاجة زيارة'}
      ]},
    {id:'areas',symbol:'📍',title:'المناطق',
      caption:'التغطية وتوزع الجهات الطبية ضمن كل منطقة.',tone:'areas',
      metrics:[
        {value:assignedAreas?assignedAreas.length:'—',label:'مناطق'},
        {value:coverage&&assignedAreas?areaCoverage+'%':'—',label:'تغطية'}
      ]}
  ];
  return <div className="rep-home">
    <div className="rep-hero">
      <h2>أهلاً، {user.name}</h2>
      <p>كل ما تحتاجه لإدارة أسبوعك وسايكلك الحالي.</p>
      <div className="rep-hero-metrics">
        <div><strong>{team?team.coverage+'%':'—'}</strong><span>تغطية السايكل للفريق</span></div>
        <div><strong>{remainingDays===null?'—':remainingDays}</strong>
          <span>أيام متبقية لنهاية السايكل (شامل اليوم)</span></div>
        <div><strong>{weeklyVisitsRatio}</strong><span>زيارات الأسبوع / الهدف</span></div>
        <div><strong>{team?Math.max(0,team.target-team.done):'—'}</strong>
          <span>زيارات الأطباء المتبقية للفريق</span></div>
      </div>
      {settings?.cycleStart&&settings?.cycleEnd&&<p className="rep-cycle-period">
        دورة العمل: {String(settings.cycleStart).slice(0,10)} — {cycleEnd}
      </p>}
    </div>
    {errors.length>0&&<Notice kind="error">تعذر تحميل بعض مؤشرات الرئيسية: {errors.join('، ')}</Notice>}
    {coverage?.unattributedHistoricalVisits>0&&<Notice>
      توجد {coverage.unattributedHistoricalVisits} زيارة قديمة دون منطقة مؤكدة،
      محسوبة للفريق فقط دون إضافتها لتغطية منطقة بعينها.
    </Notice>}
    <div className="rep-section-heading">
      <h2>تنبيهات مهمة</h2>
      <button type="button" className="rep-text-link" onClick={()=>navigate('analytics')}>عرض الكل</button>
    </div>
    <div className="rep-alerts">
      <button type="button" className="rep-alert" onClick={()=>navigate('analytics')}>
        <span className="rep-alert-dot urgent" aria-hidden="true"/>
        <span><strong>{frequency?unvisitedA+' أطباء A غير مزارين':'جارٍ تحميل أطباء A...'}</strong>
          <small>أولوية متابعة ضمن أهداف الفريق والسايكل الحالي</small></span>
        <span aria-hidden="true">←</span>
      </button>
      <button type="button" className="rep-alert" onClick={()=>navigate('analytics')}>
        <span className="rep-alert-dot warning" aria-hidden="true"/>
        <span><strong>{coverage&&assignedAreas?needsAttention.length+' مناطق بحاجة تغطية':
          'جارٍ تحميل تغطية المناطق...'}</strong>
          <small>{needsAttention.length?needsAttention.slice(0,2).map((a:Any)=>a.areaName).join('، '):
            'تابع نسب التغطية من صفحة التحليل'}</small></span>
        <span aria-hidden="true">←</span>
      </button>
    </div>
    <div className="rep-section-heading">
      <h2>مساحة العمل</h2><span className="muted">وصول سريع للجهات والخطة</span>
    </div>
    <div className="rep-hub-grid">{cards.map(item=>
      <button type="button" key={item.id}
        className={'rep-hub-card '+item.tone}
        onClick={()=>navigate(item.id)}>
        <span className="rep-hub-icon" aria-hidden="true">{item.symbol}</span>
        <strong>{item.title}</strong><small>{item.caption}</small>
        <span className="rep-hub-metrics">
          {item.metrics.map(metric=><span key={metric.label}>
            <b>{metric.value}</b><small>{metric.label}</small>
          </span>)}
        </span>
      </button>)}
      <button type="button" className="rep-hub-card plan wide" onClick={()=>navigate('plan-products')}>
        <span className="rep-plan-header">
          <span className="rep-plan-heading"><span className="rep-hub-icon" aria-hidden="true">🗂️</span>
            <strong>الخطة والأصناف</strong><small>أهداف السايكل والأصناف ذات الأولوية.</small></span>
          <span className="rep-plan-badge">{weeklyProgress!==null?
            weeklyProgress+'% منجزة':'—'}</span>
        </span>
        <span className="rep-hub-metrics rep-plan-metrics">
          <span><b>{weeklyVisitsRatio}</b><small>زيارات الأسبوع</small></span>
          <span><b>{plan?plan.products.length:'—'}</b><small>أصناف أساسية</small></span>
          <span><b>{remainingDays===null?'—':remainingDays}</b><small>أيام متبقية</small></span>
        </span>
      </button>
    </div>
  </div>;
}

function RepAnalytics({refresh,user,navigate}:Any){
  const {data:overview,error:overviewError}=useData('/analytics/rep-overview',refresh);
  const frequency=overview?.frequency,coverage=overview?.coverage;
  const frequencyError=overviewError,coverageError=overviewError;
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:plan,error:planError}=useData('/rep-plan',refresh);
  const groupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const team=(coverage?.teamTotals||[]).find((row:Any)=>row.groupKey===groupKey);
  const allDoctors=(frequency?.items||[]).filter((row:Any)=>
    user.teamId?row.teamId===user.teamId:!row.teamId);
  const areaIds=new Set((areas||[]).map((row:Any)=>row.id));
  const areaRows=(coverage?.areas||[]).filter((row:Any)=>
    row.groupKey===groupKey&&areaIds.has(row.areaId));
  const unvisited=allDoctors.filter((row:Any)=>row.done===0);
  const unvisitedA=unvisited.filter((row:Any)=>row.grade==='A');
  const lowAreas=areaRows.filter((row:Any)=>row.target>0&&row.done<row.target);
  const targetTotal=allDoctors.reduce((sum:number,row:Any)=>sum+row.target,0);
  const achieved=allDoctors.reduce((sum:number,row:Any)=>
    sum+Math.min(row.done,row.target),0);
  const compliance=targetTotal?Math.round(achieved/targetTotal*100):0;
  const panels=[
    {kind:'frequency',icon:'🔁',title:'Frequency',subtitle:'الملتزم والمتأخر حسب عدد الزيارات'},
    {kind:'unvisited',icon:'⚠️',title:'غير مزار',subtitle:'الأطباء غير المزارين حسب المنطقة والتصنيف'},
    {kind:'coverage',icon:'📍',title:'تغطية المناطق',subtitle:'مقارنة المناطق حسب نسبة التغطية'},
    {kind:'aDoctors',icon:'⭐',title:'أطباء A',subtitle:'متابعة الأولويات الأعلى'},
    {kind:'products',icon:'💊',title:'أداء الأصناف',subtitle:'ترويج الأصناف ضمن الجولات',disabled:true,
      disabledReason:'يلزم حفظ الأصناف التي تم ترويجها داخل كل جولة'},
    {kind:'cycles',icon:'📈',title:'مقارنة السايكلات',subtitle:'مقارنة الدورات السابقة',disabled:true,
      disabledReason:'يلزم حفظ سجل مستقل لكل سايكل سابق'}
  ];
  return <div className="rep-home rep-analytics-page">
    <div className="rep-hero rep-analytics-hero">
      <p>ملخص السايكل الحالي</p>
      <h2>التحليل</h2>
      <div className="rep-hero-metrics">
        <div><strong>{frequency?compliance+'%':'—'}</strong><span>التزام Frequency</span></div>
        <div><strong>{frequency?unvisited.length:'—'}</strong><span>طبيب غير مزار</span></div>
        <div><strong>{team?team.coverage+'%':'—'}</strong><span>تغطية السايكل للفريق</span></div>
        <div><strong>{frequency?unvisitedA.length:'—'}</strong><span>أطباء A غير مزارين</span></div>
      </div>
    </div>
    {(frequencyError||coverageError||areasError||planError)&&<Notice kind="error">
      تعذّر تحميل بعض التحليلات: {[frequencyError,coverageError,areasError,planError].filter(Boolean).join('، ')}
    </Notice>}
    <div className="rep-section-heading"><h2>اختر نوع التحليل</h2>
      <span className="muted">اضغط لعرض التفاصيل</span></div>
    <div className="rep-analysis-actions">{panels.map(item=>
      <button key={item.kind} type="button" className="rep-analysis-card"
        disabled={Boolean(item.disabled)}
        onClick={()=>navigate('analysis-detail',{kind:item.kind})}>
        <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong>
        <small>{item.subtitle}</small>
        {item.disabled&&<small className="rep-disabled-label">{item.disabledReason||'بانتظار ربط بيانات هذا التحليل'}</small>}
      </button>)}</div>
    <Section title="تنبيهات مهمة">
      <div className="rep-alerts">
        <button type="button" className="rep-alert"
          onClick={()=>navigate('analysis-detail',{kind:'aDoctors'})}>
          <span className="rep-alert-dot urgent" aria-hidden="true"/>
          <span><strong>{frequency?unvisitedA.length:'—'} أطباء A غير مزارين</strong>
            <small>أولوية المتابعة للأطباء غير المزارين ضمن السايكل</small></span>
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" className="rep-alert"
          onClick={()=>navigate('analysis-detail',{kind:'coverage'})}>
          <span className="rep-alert-dot warning" aria-hidden="true"/>
          <span><strong>{coverage&&areas?lowAreas.length:'—'} مناطق بحاجة تغطية</strong>
            <small>نسب التغطية والأهداف الحقيقية حسب المنطقة</small></span>
          <span aria-hidden="true">←</span>
        </button>
      </div>
    </Section>
    {plan&&<p className="muted">الأصناف المسندة إليك: {plan.products.length}.
      بيانات مرات الترويج غير محفوظة حالياً ضمن سجلات الجولة، لذلك لا نعرض إحصائيات ترويج وهمية.</p>}
  </div>;
}

function RepAnalysisDetail({refresh,user,navigate,kind}:Any){
  const [grade,setGrade]=useState('all');
  const [areaId,setAreaId]=useState('all');
  const {data:overview,error:overviewError}=useData('/analytics/rep-overview',refresh);
  const frequency=overview?.frequency,coverage=overview?.coverage;
  const frequencyError=overviewError,coverageError=overviewError;
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const groupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const analysisMeta:Record<string,{title:string;subtitle:string;icon:string}>={
    frequency:{title:'تحليل Frequency',subtitle:'متابعة الالتزام بعدد الزيارات خلال السايكل',icon:'🔁'},
    unvisited:{title:'الأطباء غير المزارين',subtitle:'متابعة الأطباء الذين لم تتم زيارتهم بعد',icon:'⚠️'},
    coverage:{title:'تغطية المناطق',subtitle:'مقارنة التغطية الفعلية مع أهداف كل منطقة',icon:'📍'},
    aDoctors:{title:'أطباء A',subtitle:'متابعة أطباء الأولوية الأعلى ضمن السايكل',icon:'⭐'}
  };
  const meta=analysisMeta[kind];
  if(!meta)return <Section title="التحليل"><Empty text="نوع التحليل غير متاح"/>
    <button className="btn outline" type="button" onClick={()=>navigate('analytics')}>العودة للتحليل</button>
  </Section>;
  const title=meta.title;
  const selectedArea=(areas||[]).find((row:Any)=>row.id===areaId);
  const allDoctors=(frequency?.items||[]).filter((row:Any)=>
    user.teamId?row.teamId===user.teamId:!row.teamId);
  // API frequency rows expose area names; do not pretend they contain exact
  // per-area visit attribution. Coverage view uses the recorded area IDs.
  const matchesArea=(row:Any)=>areaId==='all'||String(row.area||'').split('،')
    .map((v:string)=>v.trim()).includes(selectedArea?.name||'');
  const rows=allDoctors.filter((row:Any)=>
    (grade==='all'||row.grade===grade)&&matchesArea(row));
  const doctors=kind==='unvisited'?rows.filter((row:Any)=>row.done===0):
    kind==='aDoctors'?rows.filter((row:Any)=>row.grade==='A'):rows;
  const areaIds=new Set((areas||[]).map((area:Any)=>area.id));
  const coverageRows=(coverage?.areas||[]).filter((row:Any)=>
    row.groupKey===groupKey&&areaIds.has(row.areaId)&&
    (areaId==='all'||row.areaId===areaId)).sort((a:Any,b:Any)=>a.coverage-b.coverage);
  const done=doctors.filter((row:Any)=>row.done>=row.target).length;
  const unvisited=doctors.filter((row:Any)=>row.done===0).length;
  const behind=doctors.filter((row:Any)=>row.done>0&&row.done<row.target).length;
  const targetTotal=doctors.reduce((sum:number,row:Any)=>sum+row.target,0);
  const achievedTotal=doctors.reduce((sum:number,row:Any)=>
    sum+Math.min(row.done,row.target),0);
  const compliance=targetTotal?Math.min(100,Math.round(achievedTotal/targetTotal*100)):0;
  const unvisitedAreas=new Set(doctors.flatMap((row:Any)=>String(row.area||'').split('،')
    .map((name:string)=>name.trim()).filter(Boolean)));
  const averageCoverage=coverageRows.length?Math.round(
    coverageRows.reduce((sum:number,row:Any)=>sum+Number(row.coverage||0),0)/coverageRows.length):0;
  const lowCoverage=coverageRows.filter((row:Any)=>Number(row.coverage)<50).length;
  const highCoverage=coverageRows.filter((row:Any)=>Number(row.coverage)>70).length;
  const kpis=kind==='coverage'?
    [{label:'متوسط التغطية',value:averageCoverage+'%'},
      {label:'مناطق أقل من 50%',value:lowCoverage},
      {label:'مناطق أكثر من 70%',value:highCoverage}]:
    kind==='unvisited'?
    [{label:'أطباء بحاجة زيارة',value:doctors.length},
      {label:'منهم أطباء A',value:doctors.filter((row:Any)=>row.grade==='A').length},
      {label:'عدد المناطق',value:unvisitedAreas.size}]:
    kind==='frequency'?
    [{label:'نسبة الالتزام',value:compliance+'%'},{label:'مكتمل',value:done},
      {label:'ناقص / غير مزار',value:behind+unvisited}]:
    [{label:'أطباء A',value:doctors.length},{label:'مكتمل',value:done},
      {label:'ناقص / غير مزار',value:behind+unvisited}];

  function saveAnalysisPdf(){
    const popup=window.open('','_blank');
    if(!popup){window.alert('المتصفح منع نافذة التقرير. اسمح بالنوافذ المنبثقة ثم حاول مرة ثانية.');return;}
    const escapeHtml=(value:Any)=>String(value??'').replace(/[&<>"']/g,(ch:string)=>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[ch]);
    const metricHtml=kpis.map((stat:Any)=>'<div class="metric"><b>'+
      escapeHtml(stat.value)+'</b><span>'+escapeHtml(stat.label)+'</span></div>').join('');
    const bodyRows=kind==='coverage'
      ?coverageRows.map((row:Any,index:number)=>'<tr><td>'+String(index+1)+'</td><td>'+
        escapeHtml(row.areaName)+'</td><td>'+escapeHtml(row.doctors)+'</td><td>'+
        escapeHtml(row.unvisited)+'</td><td>'+escapeHtml(row.done)+' / '+
        escapeHtml(row.target)+'</td><td>'+escapeHtml(row.coverage)+'%</td></tr>').join('')
      :doctors.map((row:Any,index:number)=>'<tr><td>'+String(index+1)+'</td><td>'+
        escapeHtml(row.name)+'</td><td>'+escapeHtml(row.grade)+'</td><td>'+
        escapeHtml(row.area)+'</td><td>'+escapeHtml(row.done)+' / '+
        escapeHtml(row.target)+'</td><td>'+escapeHtml(row.coverage)+'%</td></tr>').join('');
    const headers=kind==='coverage'
      ?'<tr><th>#</th><th>المنطقة</th><th>الأطباء</th><th>غير مزار</th><th>الزيارات</th><th>التغطية</th></tr>'
      :'<tr><th>#</th><th>الطبيب</th><th>التصنيف</th><th>المنطقة</th><th>الزيارات</th><th>الالتزام</th></tr>';
    const cycleLabel=escapeHtml((frequency?.cycleStart||'')+' — '+(frequency?.cycleEnd||''));
    const fileTitle='Mandob - '+title;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'+
      '<title>'+escapeHtml(fileTitle)+'</title><style>'+
      '@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#193529;direction:rtl;margin:0;line-height:1.6}'+
      '.head{border-bottom:3px solid #167c5a;padding-bottom:12px;margin-bottom:18px}.head h1{margin:0;color:#167c5a;font-size:22px}.head p{margin:4px 0 0;color:#617568;font-size:12px}'+
      '.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:16px 0 22px}.metric{border:1px solid #d8e8dd;border-radius:9px;padding:12px;background:#f7fbf8}.metric b{display:block;color:#167c5a;font-size:21px}.metric span{font-size:11px;color:#607568}'+
      'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}th,td{border:1px solid #dce8df;padding:7px;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{background:#edf7f0;color:#244d38}tr{break-inside:avoid}'+
      '.foot{margin-top:16px;color:#748278;font-size:10px}@media print{button{display:none}}'+
      '</style></head><body><div class="head"><h1>'+escapeHtml(title)+'</h1><p>'+
      escapeHtml(meta.subtitle)+'</p><p>السايكل: '+cycleLabel+'</p></div>'+
      '<div class="metrics">'+metricHtml+'</div><table><thead>'+headers+'</thead><tbody>'+
      (bodyRows||'<tr><td colspan="6">لا توجد نتائج ضمن الفلاتر الحالية</td></tr>')+
      '</tbody></table><p class="foot">تم إنشاء التقرير من بيانات Mandob الحالية والفلاتر المختارة.</p>'+
      '<script>window.onload=function(){window.focus();window.print();}<\/script></body></html>');
    popup.document.close();
  }

  return <div className="rep-home rep-analysis-detail">
    <div className="rep-hero rep-analytics-hero rep-analysis-detail-hero">
      <button type="button" className="rep-analysis-back" onClick={()=>navigate('analytics')}>
        <span aria-hidden="true">→</span> رجوع للتحليل
      </button>
      <div className="rep-analysis-detail-title">
        <span className="rep-analysis-detail-icon" aria-hidden="true">{meta.icon}</span>
        <div><p>{meta.subtitle}</p><h2>{title}</h2></div>
      </div>
      <div className="rep-hero-metrics rep-analysis-detail-metrics">
        {kpis.map((stat:Any)=><div key={stat.label}>
          <strong>{stat.value}</strong><span>{stat.label}</span>
        </div>)}
      </div>
    </div>
    <Section title="فلاتر التحليل" actions={<button className="btn small outline"
      type="button" onClick={()=>{setGrade('all');setAreaId('all');}}>إعادة ضبط</button>}>
      <div className="rep-report-dates">
        <label className="field">الفترة
          <select value="cycle" disabled><option value="cycle">السايكل الحالي</option></select>
        </label>
        <label className="field">المنطقة
          <select value={areaId} onChange={event=>setAreaId(event.target.value)}>
            <option value="all">كل المناطق</option>
            {(areas||[]).map((area:Any)=><option key={area.id} value={area.id}>
              {area.name}</option>)}
          </select></label>
      </div>
      {kind!=='coverage'&&<div className="rep-grade-chips" aria-label="فلترة تصنيف الأطباء">
        {['all','A','B','C'].map(value=><button key={value} type="button"
          className={grade===value?'active':''} aria-pressed={grade===value}
          onClick={()=>setGrade(value)}>{value==='all'?'الكل':value}</button>)}
      </div>}
      <p className="muted">التحليلات تستخدم دورة العمل الحالية.
        فلاتر الأسبوع والشهر القديمة غير مدعومة من واجهة Frequency الحالية،
        لذلك لا نعرضها كفلاتر تعمل ظاهرياً فقط.</p>
    </Section>
    {(frequencyError||coverageError||areasError)&&<Notice kind="error">
      {[frequencyError,coverageError,areasError].filter(Boolean).join('، ')}</Notice>}
    {kind==='coverage'?<div className="rep-report-entries">
      {coverageRows.map((row:Any)=><div key={row.groupKey+':'+row.areaId}
        className="rep-report-entry">
        <div className="rep-entry-heading"><strong>{row.areaName}</strong>
          <span className="rep-plan-badge">{row.coverage}%</span></div>
        <small>{row.doctors} طبيب • {row.unvisited} غير مزار • {row.done} / {row.target} زيارة</small>
        <div className="meter"><span style={{width:row.coverage+'%'}}/></div>
      </div>)}
      {coverage&&!coverageRows.length&&<Empty text="ما في نتائج تغطية ضمن الفلاتر"/>}
    </div>:<div className="rep-report-entries">
      {doctors.map((row:Any)=><div key={row.teamId+':'+row.id} className="rep-report-entry">
        <div className="rep-entry-heading"><strong>{row.name}</strong>
          <span className={'rep-grade rep-grade-'+row.grade}>{row.grade}</span></div>
        <small>{row.area}</small>
        <div className="rep-entry-heading"><span>الزيارات: {row.done} / {row.target}</span>
          <span className="rep-entry-state">{row.done===0?'غير مزار':
            row.done>=row.target?'مكتمل':'ناقص'}</span></div>
        <div className="meter"><span style={{width:row.coverage+'%'}}/></div>
      </div>)}
      {frequency&&!doctors.length&&<Empty text="لا توجد نتائج ضمن الفلاتر الحالية"/>}
    </div>}
    <div className="rep-report-actions">
      <button className="btn primary" type="button" onClick={saveAnalysisPdf}
        disabled={!frequency||!coverage}>حفظ التحليل PDF</button>
    </div>
  </div>;
}

// Print a standalone real report, not the surrounding application controls.
function printRepReport(popup:Window|null,report:Any,repName:string){
  if(!popup)throw Error('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع.');
  const escapeHtml=(value:Any)=>String(value??'').replace(/[&<>"']/g,(ch:string)=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[ch]);
  const typeName=(type:string)=>typeLabels[type]||type;
  const rows=Array.isArray(report.rows)?report.rows:[];
  const details=rows.map((item:Any,index:number)=>
    '<tr><td>'+String(index+1)+'</td><td>'+escapeHtml(item.date)+
    '</td><td>'+escapeHtml(typeName(item.type))+'</td><td>'+
    escapeHtml((item.targets||[]).map((target:Any)=>target.name+
      ' ('+target.area+')').join('، ')||'—')+'</td></tr>').join('');
  const content='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'+
    '<title>تقرير زيارات المندوب - Mandob</title>'+
    '<style>@page{size:A4;margin:16mm}body{font-family:Tahoma,Arial,sans-serif;color:#193529;direction:rtl;line-height:1.65;margin:0}'+
    'h1{font-size:22px;color:#167c5a;margin:0 0 4px}h2{font-size:16px;margin-top:26px}'+
    '.meta{color:#536b5b;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:22px 0}'+
    '.metric{border:1px solid #d2e5d9;padding:12px;border-radius:8px}.metric b{display:block;font-size:21px;color:#137456}'+
    'table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}th,td{border:1px solid #dde7e0;padding:8px;vertical-align:top;overflow-wrap:anywhere;text-align:right}'+
    'th{background:#edf7f0}tr{break-inside:avoid}th:nth-child(1){width:7%}th:nth-child(2){width:18%}th:nth-child(3){width:16%}'+
    '.foot{font-size:11px;color:#6b796f;margin-top:25px}'+
    '</style></head><body>'+
    '<h1>تقرير زيارات المندوب</h1><div class="meta">نظام Mandob — التقرير من السجلات المحفوظة</div>'+
    '<p><b>المندوب:</b> '+escapeHtml(repName)+'<br><b>الفترة:</b> '+
    escapeHtml(report.from)+' — '+escapeHtml(report.to)+'</p>'+
    '<div class="metrics">'+[
      ['الجولات',report.tours],['الجهات الطبية',report.totalTargets],
      ['الأطباء',report.byType?.DOCTOR],['الصيدليات',report.byType?.PHARMACY],
      ['المشافي',report.byType?.HOSPITAL],['متوسط يوم العمل',report.averagePerWorkingDay??'—']
    ].map(([name,value])=>'<div class="metric"><span>'+escapeHtml(name)+
      '</span><b>'+escapeHtml(value)+'</b></div>').join('')+'</div>'+
    '<p class="meta">أيام العمل في الفترة: '+escapeHtml(report.workingDays)+'</p>'+
    '<h2>تفاصيل الجولات والجهات المزارة</h2>'+
    '<table><thead><tr><th>#</th><th>التاريخ</th><th>نوع الجولة</th><th>الجهات والمنطقة وقت الزيارة</th></tr></thead>'+
    '<tbody>'+(details||'<tr><td colspan="4">لم تُسجّل جولات في هذه الفترة</td></tr>')+
    '</tbody></table><p class="foot">تم إنشاء هذا التقرير من قاعدة بيانات Mandob وقت الطلب.</p></body></html>';
  popup.document.open();
  popup.onload=()=>{popup.focus();popup.print();};
  popup.document.write(content);
  popup.document.close();
}

function RepReports({refresh,user}:Any){
  const [mode,setMode]=useState('weekly');
  const [range,setRange]=useState(()=>reportRange(today(),'weekly'));
  const [busy,setBusy]=useState(''),[actionError,setActionError]=useState('');
  const [success,setSuccess]=useState(''),[sentVersion,setSentVersion]=useState(0);
  function changeMode(next:string){
    setMode(next);
    if(next!=='custom')setRange(reportRange(today(),next));
  }
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(range.from)&&
    /^\d{4}-\d{2}-\d{2}$/.test(range.to)&&range.from<=range.to;
  const query=new URLSearchParams({from:range.from,to:range.to}).toString();
  const {data,error}=useData(valid?'/rep-report?'+query:null,refresh);
  const {data:sent,error:sentError}=useData('/rep-reports',String(refresh)+':'+sentVersion);
  async function printDetailed(){
    if(!valid||busy||!data)return;
    setActionError('');setSuccess('');
    const popup=window.open('','_blank');
    if(!popup){setActionError('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول ثانية.');return;}
    setBusy('print');
    try{
      popup.document.write('<html lang="ar" dir="rtl"><meta charset="utf-8"><body>جارٍ إعداد التقرير...</body></html>');
      const report=await api('/rep-report?'+query+'&details=true');
      printRepReport(popup,report,user.name);
    }catch(err:Any){popup.close();setActionError(err.message||'تعذر تجهيز التقرير');}
    finally{setBusy('');}
  }
  async function sendReport(){
    if(!valid||busy||!data)return;
    setBusy('send');setActionError('');setSuccess('');
    try{
      await post('/rep-reports',{from:range.from,to:range.to});
      setSuccess('تم حفظ نسخة فعلية من التقرير وإرسالها إلى '+(user.teamId?'مدير الفريق':'إدارة الشركة')+'.');
      setSentVersion(v=>v+1);
    }catch(err:Any){setActionError(err.message||'فشل حفظ وإرسال التقرير');}
    finally{setBusy('');}
  }
  return <div className="rep-home rep-report-page">
    <div className="rep-section-heading"><h2>التقارير</h2>
      <span className="muted">تقارير زياراتك المحفوظة</span></div>
    <div className="rep-report-tabs" role="group" aria-label="نوع التقرير">
      {[
        {id:'weekly',label:'أسبوعي'},
        {id:'daily',label:'يومي'},
        {id:'custom',label:'مخصص'}
      ].map(item=><button type="button" key={item.id}
        className={mode===item.id?'active':''} aria-pressed={mode===item.id}
        onClick={()=>changeMode(item.id)}>{item.label}</button>)}
    </div>
    <Section title="الفترة الزمنية">
      <div className="rep-report-dates">
        <label className="field">من تاريخ<input type="date" value={range.from}
          onChange={event=>{setMode('custom');setRange(previous=>({...previous,from:event.target.value}));}}/></label>
        <label className="field">إلى تاريخ<input type="date" value={range.to}
          onChange={event=>{setMode('custom');setRange(previous=>({...previous,to:event.target.value}));}}/></label>
      </div>
      {!valid&&<Notice kind="error">اختر فترة بداية ونهاية صحيحة للتقرير.</Notice>}
      {error&&<Notice kind="error">{error}</Notice>}
    </Section>
    <div className="rep-medical-stats">
      {[
        {label:'أطباء',number:data?.byType?.DOCTOR},
        {label:'صيدليات',number:data?.byType?.PHARMACY},
        {label:'مشافي',number:data?.byType?.HOSPITAL}
      ].map(item=><div key={item.label}><strong>{data?item.number:'—'}</strong>
        <small>{item.label}</small></div>)}
    </div>
    <div className="rep-report-preview">
      <div className="rep-entry-heading"><strong>معاينة التقرير {mode==='daily'?'اليومي':
        mode==='weekly'?'الأسبوعي':'المخصص'}</strong>
        <span className="rep-plan-badge">{data?'جاهز':'بانتظار البيانات'}</span></div>
      <p>{data?data.totalTargets+' زيارة لجهات طبية ضمن '+data.tours+
        ' جولة':'جارٍ تحميل بيانات التقرير...'}</p>
      <small>الفترة: {range.from} — {range.to}</small>
    </div>
    <div className="rep-report-preview rep-report-average">
      <div className="rep-entry-heading"><strong>متوسط الزيارات بأيام العمل</strong>
        <strong>{data?(data.averagePerWorkingDay??'—'):'—'}</strong></div>
      <small>{data?data.workingDays+' يوم عمل ضمن الفترة المختارة':'الأرقام من قاعدة البيانات فقط'}</small>
    </div>
    <div className="rep-report-actions">
      <button className="btn primary" type="button" disabled={!data||!valid||Boolean(busy)}
        onClick={printDetailed}>{busy==='print'?'جارٍ تجهيز الطباعة...':'طباعة التقرير / حفظ PDF'}</button>
      <button className="btn outline" type="button" disabled={!data||!valid||Boolean(busy)}
        onClick={sendReport}>{busy==='send'?'جارٍ الإرسال...':'حفظ وإرسال للمدير'}</button>
    </div>
    <small className="muted">للحفظ كملف PDF اختر «حفظ بتنسيق PDF» من نافذة الطباعة.</small>
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    {success&&<Notice kind="success">{success}</Notice>}
    <Section title="التقارير التي أرسلتها">
      {sentError&&<Notice kind="error">{sentError}</Notice>}
      {!sent&&!sentError&&<Empty text="جارٍ تحميل التقارير المرسلة..."/>}
      {sent&&!sent.length&&<Empty text="لم تُرسل أي تقارير بعد"/>}
      {sent?.slice(0,8).map((item:Any)=><div className="rep-submitted-item" key={item.id}>
        <span><strong>{item.from} — {item.to}</strong>
          <small>أُرسل بتاريخ {new Date(item.createdAt).toLocaleString('ar')}</small></span>
        <span className="rep-entry-state">محفوظ</span>
      </div>)}
    </Section>
  </div>;
}
function SubmittedRepReports({refresh}:Any){
  const {data,error}=useData('/rep-reports',refresh);
  const [selected,setSelected]=useState('');
  const {data:details,error:detailsError}=useData(
    selected?'/rep-reports/'+encodeURIComponent(selected):null,refresh);
  const [printError,setPrintError]=useState('');
  function printSubmitted(){
    if(!details)return;
    setPrintError('');
    const popup=window.open('','_blank');
    try{printRepReport(popup,details.snapshot,details.repName);}
    catch(err:Any){popup?.close();setPrintError(err.message||'تعذر طباعة التقرير');}
  }
  return <Section title="تقارير المندوبين المستلمة">
    <p className="muted">تقارير محفوظة عند إرسالها، من مندوبي فريقك أو الشركة حسب صلاحياتك.</p>
    {error&&<Notice kind="error">{error}</Notice>}
    {!data&&!error&&<Empty text="جارٍ تحميل التقارير..."/>}
    {data&&!data.length&&<Empty text="لم يتم إرسال تقارير بعد"/>}
    {data?.map((item:Any)=><button className="rep-submitted-item rep-submitted-button"
      type="button" key={item.id} onClick={()=>setSelected(item.id===selected?'':item.id)}>
      <span><strong>{item.repName}</strong><small>{item.from} — {item.to}</small></span>
      <small>{new Date(item.createdAt).toLocaleString('ar')}</small>
    </button>)}
    {selected&&detailsError&&<Notice kind="error">{detailsError}</Notice>}
    {selected&&details&&<div className="rep-report-preview rep-submitted-details">
      <div className="rep-entry-heading"><strong>تقرير {details.repName}</strong>
        <span>{details.snapshot.from} — {details.snapshot.to}</span></div>
      <p>{details.snapshot.totalTargets} زيارة لجهات طبية في {details.snapshot.tours} جولة</p>
      <small>أطباء: {details.snapshot.byType?.DOCTOR||0} • صيدليات: {details.snapshot.byType?.PHARMACY||0}
        {' '}• مشافي: {details.snapshot.byType?.HOSPITAL||0}</small>
      <button type="button" className="btn primary" onClick={printSubmitted}>
        طباعة التقرير / حفظ PDF</button>
      {printError&&<Notice kind="error">{printError}</Notice>}
    </div>}
  </Section>;
}
function RepPlanProducts({refresh,user,navigate}:Any){
  const {data:plan,error:planError}=useData('/rep-plan',refresh);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:settings,error:settingsError}=useData('/settings',refresh);
  const items=(frequency?.items||[]).filter((item:Any)=>
    user.teamId?item.teamId===user.teamId:!item.teamId);
  const target=items.reduce((sum:number,row:Any)=>sum+row.target,0);
  const done=items.reduce((sum:number,row:Any)=>sum+Math.min(row.done,row.target),0);
  return <div className="rep-home">
    <div className="rep-hero"><h2>الخطة والأصناف</h2>
      <p>{plan?.teamName?'فريق '+plan.teamName:'الخطة الفردية'} • السايكل الحالي</p>
      <div className="rep-hero-metrics">
        <div><strong>{target?Math.round(done/target*100)+'%':frequency?'0%':'—'}</strong>
          <span>إنجاز أهداف الأطباء</span></div>
        <div><strong>{plan?plan.dailyTarget:'—'}</strong><span>هدف الجهات اليومي</span></div>
        <div><strong>{plan?plan.products.length:'—'}</strong><span>الأصناف المكلف بها</span></div>
        <div><strong>{frequency?Math.max(0,target-done):'—'}</strong>
          <span>زيارات الأطباء المتبقية</span></div>
      </div>
      {settings?.cycleStart&&settings?.cycleEnd&&<p className="rep-cycle-period">
        دورة العمل: {String(settings.cycleStart).slice(0,10)} — {String(settings.cycleEnd).slice(0,10)}
      </p>}
    </div>
    {(planError||frequencyError||settingsError)&&<Notice kind="error">
      تعذر تحميل بعض بيانات الخطة: {[planError,frequencyError,settingsError].filter(Boolean).join('، ')}
    </Notice>}
    <Section title="أصنافي">
      {!plan&&!planError?<Empty text="جارٍ تحميل أصنافك..."/>:
        plan?.products.length?<div className="rep-product-list">{plan.products.map((p:Any)=>
          <div className="rep-product-card" key={p.id}>
            <span className="rep-product-icon" aria-hidden="true">💊</span>
            <span><strong>{p.name}</strong>
              <small>{p.activeIngredient||'لم تُحدد مادة فعالة'}</small></span>
          </div>)}</div>:
        <Empty text="ما في أصناف مخصصة لحسابك أو فريقك حالياً"/>}
      <p className="muted">الأصناف المعروضة هي الأصناف النشطة المسندة لك أو لفريقك، وليست كل منتجات الشركة.</p>
    </Section>
    <Section title="أهدافي"><div className="rep-plan-actions">
      <div className="rep-plan-stat"><strong>{done} / {target}</strong>
        <small>زيارات الأطباء المنجزة للفريق ضمن السايكل</small></div>
      <button type="button" className="btn outline" onClick={()=>navigate('frequency')}>
        تفاصيل Frequency</button>
    </div>
    <div className="meter"><span style={{width:target?Math.min(100,done/target*100)+'%':'0%'}}/></div>
    <Notice>أهداف الفريق تشمل زيارات زملائك أيضاً؛ الأهداف الفردية تُعرض بشكل مستقل في Frequency.</Notice>
    </Section>
  </div>;
}

function RepProfile({user,navigate,onLogout}:Any){
  const actions=[
    {id:'visits',icon:'🗓️',title:'سجل الجولات',caption:'الجولات والزيارات المحفوظة'},
    {id:'new-leave',icon:'📝',title:'طلب إجازة',caption:'تقديم طلب إجازة'},
    {id:'leaves',icon:'📬',title:'طلباتي السابقة',caption:'حالات الإجازات وقرارات المدير'},
    {id:'frequency',icon:'📊',title:'إنجاز الزيارات',caption:'إنجاز أهداف الأطباء'},
    {id:'area-coverage',icon:'📍',title:'تغطية المناطق',caption:'التغطية الفعلية للسايكل'}
  ];
  return <div className="rep-home rep-profile-page">
    <div className="rep-profile-card">
      <span className="rep-profile-avatar" aria-hidden="true">{user.name.slice(0,1)}</span>
      <div className="rep-profile-identity"><h2>{user.name}</h2>
        <p>مندوب طبي{user.teamId?' • عضو في فريق':''}</p>
        <small>اسم المستخدم: {user.username}</small>
      </div>
    </div>
    <Section title="حسابي"><div className="rep-profile-links">
      {actions.map(item=><button type="button" key={item.id}
        onClick={()=>navigate(item.id)}>
        <span className="rep-profile-link-icon" aria-hidden="true">{item.icon}</span>
        <span className="rep-profile-link-text"><strong>{item.title}</strong>
          <small>{item.caption}</small></span>
        <span className="rep-profile-arrow" aria-hidden="true">←</span>
      </button>)}
    </div></Section>
    <button className="btn outline rep-profile-logout" type="button" onClick={onLogout}>
      تسجيل الخروج
    </button>
  </div>;
}

function RepMedicalDirectory({kind,refresh,user,onBeginTour}:Any){
  const type=kind==='doctors'?'DOCTOR':kind==='pharmacies'?'PHARMACY':'HOSPITAL';
  const title=kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي';
  const emoji=kind==='doctors'?'👨‍⚕️':kind==='pharmacies'?'💊':'🏥';
  const [search,setSearch]=useState('');
  const [areaId,setAreaId]=useState('');
  const [grade,setGrade]=useState('');
  const [page,setPage]=useState(0);
  const pageSize=100;
  const {data:areas,error:areaError}=useData('/areas',refresh);
  const params=new URLSearchParams({limit:String(pageSize),offset:String(page*pageSize)});
  if(search.trim())params.set('search',search.trim());
  if(areaId)params.set('areaId',areaId);
  const {data,error}=useData('/'+kind+'?'+params.toString(),refresh);
  const shown=(data||[]).filter((item:Any)=>!grade||item.grade===grade);
  const gradeA=shown.filter((item:Any)=>item.grade==='A').length;
  const linkedAreaNames=(item:Any)=>kind==='doctors'&&item.doctorAreas?.length?
    [...new Set(item.doctorAreas.map((link:Any)=>link.area?.name).filter(Boolean))].join('، '):
    item.area?.name||'منطقة غير محددة';
  return <div className="rep-medical-page">
    <div className="rep-medical-hero">
      <span aria-hidden="true" className="rep-medical-hero-icon">{emoji}</span>
      <div><h2>دليل {title}</h2><p>ابحث وصنّف واستعرض الجهات ضمن المناطق المخصصة إليك.</p></div>
    </div>
    <div className="rep-medical-stats">
      <div><strong>{data?shown.length:'—'}</strong><small>ضمن النتائج المعروضة</small></div>
      <div><strong>{data?gradeA:'—'}</strong><small>تصنيف A في النتائج</small></div>
      <div><strong>{areas?areas.length:'—'}</strong><small>المناطق المخصصة</small></div>
    </div>
    {(error||areaError)&&<Notice kind="error">{[error,areaError].filter(Boolean).join('، ')}</Notice>}
    <Section title={'قائمة '+title} actions={
      <button type="button" className="btn primary" onClick={()=>onBeginTour(type,areaId||undefined)}>
        ابدأ جولة {title}</button>}>
      <div className="rep-directory-filters">
        <label className="field">بحث
          <input value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}}
            placeholder={'ابحث في '+title}/></label>
        <label className="field">المنطقة
          <select value={areaId} onChange={event=>{setAreaId(event.target.value);setPage(0);}}>
            <option value="">جميع مناطقي</option>
            {(areas||[]).map((area:Any)=><option key={area.id} value={area.id}>{area.name}</option>)}
          </select></label>
      </div>
      {kind!=='hospitals'&&<div className="rep-grade-chips" aria-label="تصفية التصنيف">
        {['','A','B','C'].map(value=><button type="button" key={value||'all'}
          className={grade===value?'active':''} aria-pressed={grade===value}
          onClick={()=>setGrade(value)}>{value||'الكل'}</button>)}
      </div>}
      {!data&&!error?<Empty text={'جارٍ تحميل '+title+'...'}/>:
        !shown.length?<Empty text="لا توجد نتائج ضمن الفلاتر الحالية"/>:
        <div className="rep-medical-list">{shown.map((item:Any)=><div
          className="rep-medical-card" key={item.id}>
          <div className="rep-medical-card-head">
            <span className="rep-medical-mini-icon" aria-hidden="true">{emoji}</span>
            <span><strong>{item.name}</strong>
              <small>{item.specialty||item.kind||item.category||'—'}</small></span>
            {item.grade&&<span className={'rep-grade rep-grade-'+item.grade}>{item.grade}</span>}
          </div>
          <div className="rep-medical-meta">📍 {linkedAreaNames(item)}</div>
          <button className="rep-medical-action" type="button"
            onClick={()=>onBeginTour(type,areaId||undefined)}>
            بدء جولة {title} ←</button>
        </div>)}</div>}
      {grade&&<p className="muted">فلتر التصنيف يطبق على نتائج الصفحة الحالية فقط.</p>}
      <div className="rep-medical-pagination">
        <button className="btn small outline" type="button" disabled={page===0}
          onClick={()=>setPage(v=>Math.max(0,v-1))}>السابقة</button>
        <span>الصفحة {page+1}</span>
        <button className="btn small outline" type="button"
          disabled={!data||data.length<pageSize} onClick={()=>setPage(v=>v+1)}>
          التالية</button>
      </div>
    </Section>
  </div>;
}


type RouteContext={user:User,revision:number,refresh:()=>void,navigateTo:(key:string,query?:Record<string,string|undefined>)=>void,onLogout:()=>void};

function PageContent({section}:Any){
  const {user,revision,refresh,navigateTo,onLogout}=useOutletContext<RouteContext>();
  const [params]=useSearchParams();
  const queryArea=params.get('areaId');
  const queryType=params.get('type');
  switch(section){
    case 'dashboard':return user.role==='REP'?<RepHome refresh={revision} user={user}
      navigate={(key:string)=>navigateTo(key)}/>:<Dashboard refresh={revision}/>;
    case 'analytics':return <RepAnalytics refresh={revision} user={user}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>;
    case 'analysis-detail':return <RepAnalysisDetail refresh={revision} user={user}
      kind={params.get('kind')||'frequency'} navigate={(key:string)=>navigateTo(key)}/>;
    case 'plan-products':return <RepPlanProducts refresh={revision} user={user}
      navigate={(key:string)=>navigateTo(key)}/>;
    case 'profile':return <RepProfile user={user} onLogout={onLogout}
      navigate={(key:string)=>navigateTo(key)}/>;
    case 'new-visit':return <NewVisit key={(queryArea||'standalone')+':'+(queryType||'unset')}
      initialAreaId={queryArea} initialType={queryType} refresh={revision}
      done={refresh} onSaved={()=>navigateTo('visits')} user={user}/>;
    case 'visits':return <Records kind="visits" refresh={revision}/>;
    case 'new-leave':return <NewLeave done={refresh}/>;
    case 'leaves':return <Records kind="leaves" refresh={revision}/>;
    case 'reports':return user.role==='REP'?<RepReports refresh={revision} user={user}/>:
      <><SubmittedRepReports refresh={revision}/><VisitReports refresh={revision}/>
        <WeeklyVisits refresh={revision} user={user}/></>;
    case 'frequency':return <Frequency refresh={revision} user={user} done={refresh}/>;
    case 'area-coverage':return <AreaCoverage refresh={revision}/>;
    case 'teams':return <Teams refresh={revision} done={refresh}/>;
    case 'products':return <Products refresh={revision} done={refresh}/>;
    case 'users':return <Users refresh={revision} done={refresh} canCreate={user.role==='COMPANY_ADMIN'}/>;
    case 'settings':return <Settings refresh={revision} done={refresh}/>;
    case 'companies':return <Companies refresh={revision} done={refresh}/>;
    case 'areas':return user.role==='REP'?
      <RepAreas refresh={revision} user={user}
        onBeginAreaTour={(areaId:string)=>navigateTo('new-visit',{areaId,type:'DOCTOR'})}/>:
      <Directory key={section} kind={section} refresh={revision} done={refresh} user={user}/>;
    case 'doctors':case 'pharmacies':case 'hospitals':
      return user.role==='REP'?
        <RepMedicalDirectory key={section} kind={section} refresh={revision} user={user}
          onBeginTour={(type:string,areaId?:string)=>navigateTo('new-visit',{type,areaId})}/>:
        <Directory key={section} kind={section} refresh={revision} done={refresh}
          user={user} onBeginTour={(type:string)=>navigateTo('new-visit',{type})}/>;
    default:return <Empty/>;
  }
}

function PageLayout({user,revision,onLogout,onRefresh}:Any){
  const location=useLocation();
  const navigate=useNavigate();
  const menu=menus[user.role]||[];
  const section=menu.find(([key])=>location.pathname===routePath(user.role,key))?.[0]||
    (user.role==='SUPER_ADMIN'?'companies':'dashboard');
  function navigateTo(key:string,query?:Record<string,string|undefined>){
    if(key==='__refresh__')return;
    navigate(routePath(user.role,key,query));
  }
  const title=menu.find(x=>x[0]===section)?.[1]||'لوحة التحكم';
  // The original REP shell has only four primary tabs. Keep secondary routes
  // protected and bookmarkable, but open them from their contextual entrypoints.
  const visibleMenu=user.role==='REP'?menu.filter(([key]:[string,string])=>
    ['dashboard','analytics','reports','profile'].includes(key)):menu;
  return <div className={user.role==='REP'?'layout rep-layout':'layout'}>
    <aside className="sidebar"><div className="brand"><span className="brand-symbol">M</span>
      <div><strong>Mandob</strong><small>Medical Representatives</small></div></div>
      <div className="side-label">القائمة الرئيسية</div>
      <nav>{visibleMenu.map(([key,label])=><button key={key} type="button" className={section===key?'active':''}
        onClick={()=>navigateTo(key)}>{label}</button>)}</nav>
      <div className="side-footer"><strong>{user.name}</strong><small>{labels[user.role]}</small>
        <button type="button" className="btn outline" onClick={onLogout}>تسجيل الخروج</button></div>
    </aside>
    <main className="main"><header className="topbar"><div><span className="eyebrow">إدارة المندوبين الطبيين</span>
      <h1>{title}</h1></div><span className="avatar">{user.name.slice(0,1)}</span></header>
      <div className="page"><Outlet context={{user,revision,refresh:onRefresh,navigateTo,onLogout}}/></div>
    </main>
    {user.role==='REP'&&<>
      {section!=='new-visit'&&<button type="button" className="rep-tour-fab"
        onClick={()=>navigateTo('new-visit',section==='doctors'?{type:'DOCTOR'}:
          section==='pharmacies'?{type:'PHARMACY'}:section==='hospitals'?{type:'HOSPITAL'}:undefined)}
        aria-label="ابدأ جولة جديدة">
        <span aria-hidden="true">▶</span> {section==='doctors'?'جولة أطباء':
          section==='pharmacies'?'جولة صيدليات':
          section==='hospitals'?'جولة مشافي':'ابدأ جولة'}
      </button>}
      <nav className="rep-bottom-nav" aria-label="التنقل الرئيسي للمندوب">
        {[
          {id:'dashboard',icon:'home',label:'الرئيسية'},
          {id:'analytics',icon:'analytics',label:'التحليل'},
          {id:'reports',icon:'reports',label:'التقارير'},
          {id:'profile',icon:'account',label:'حسابي'}
        ].map(item=><button key={item.id} type="button"
          className={section===item.id?'active':''}
          aria-current={section===item.id?'page':undefined}
          onClick={()=>navigateTo(item.id)}>
          <img className="rep-nav-icon" src={'/icons/'+item.icon+'.svg'} alt=""/>
          <span>{item.label}</span>
        </button>)}
      </nav>
    </>}
  </div>;
}

function AuthenticatedRoutes({user,revision,onLogout,onRefresh}:Any){
  const allowed=menus[user.role]||[];
  return <Routes>
    <Route element={<PageLayout user={user} revision={revision} onLogout={onLogout} onRefresh={onRefresh}/> }>
      {allowed.map(([key])=><Route key={key} path={routePath(user.role,key)}
        element={<PageContent section={key}/>}/>) }
      <Route path="*" element={<Navigate to={homePath(user.role)} replace/>}/>
    </Route>
  </Routes>;
}

function RoutedApp(){
  const location=useLocation();
  const navigate=useNavigate();
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  const [shellError,setShellError]=useState('');
  useEffect(()=>{
    api('/me').then(data=>setUser(data.user)).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{(window as Any).__mandobUser=user;},[user]);
  useEffect(()=>{
    if(!loading&&!user&&location.pathname!=='/login')navigate('/login',{replace:true});
  },[loading,user,location.pathname,navigate]);
  async function logout(){
    setShellError('');
    try{await post('/logout',{});dataRequestCache.clear();setUser(null);navigate('/login',{replace:true});}
    catch(error:Any){setShellError('تعذر تسجيل الخروج. '+(error.message||''));}
  }
  if(loading)return <div className="loading">جارٍ التحقق من الجلسة...</div>;
  if(!user)return <><Login onLogin={(next:User)=>{
    setUser(next);setShellError('');navigate(homePath(next.role),{replace:true});
  }}/>{shellError&&<Notice kind="error">{shellError}</Notice>}</>;
  return <AuthenticatedRoutes user={user} revision={revision} onLogout={logout}
    onRefresh={()=>setRevision(value=>value+1)}/>;
}

export default function App(){
  return <BrowserRouter><RoutedApp/></BrowserRouter>;
}
function RepAreas({refresh,user,onBeginAreaTour}:Any){
  const {data:areas,error:areaError}=useData('/areas',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const [selected,setSelected]=useState<string|null>(null);
  const [entityType,setEntityType]=useState('DOCTOR');
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[selected,entityType]);
  const pageSize=100;
  const path=!selected?null:entityType==='DOCTOR'?
    '/reps/'+encodeURIComponent(user.id)+'/doctors':
    '/'+(entityType==='PHARMACY'?'pharmacies':'hospitals')+
      '?areaId='+encodeURIComponent(selected)+'&limit='+pageSize+'&offset='+page*pageSize;
  const {data:entities,error:entityError}=useData(path,refresh);
  const current=areas?.find((area:Any)=>area.id===selected);
  // For doctors the permission-aware endpoint applies TEAM/CUSTOM specialties;
  // pharmacies/hospitals are already restricted to the chosen assigned area.
  const visibleEntities=(entities||[]).filter((item:Any)=>
    inArea(item,selected||''));
  const entityName=entityType==='DOCTOR'?'الأطباء المستهدفون':
    entityType==='PHARMACY'?'الصيدليات':'المشافي';
  return <>
    <div className="rep-medical-hero rep-areas-hero">
      <span className="rep-medical-hero-icon" aria-hidden="true">📍</span>
      <div><h2>مناطقي</h2><p>استعرض تغطية كل منطقة والجهات الطبية المرتبطة بها.</p></div>
    </div>
    <Section title="المناطق المخصصة إليك">
      <Notice>الزيارة تنحسب فقط للمنطقة اللي تم اختيارها فعلياً مع الجهة.
        تغطية كل منطقة مبنية على هدف الفريق، والطبيب ما بيتكرر ضمن إجمالي الفريق.</Notice>
      {areaError&&<Notice kind="error">{areaError}</Notice>}
      {coverageError&&<Notice kind="error">{coverageError}</Notice>}
      {!areas&&!areaError?<Empty text="جارٍ تحميل المناطق..."/>:
        !areas?.length?<Empty text="ما في مناطق مسندة لحسابك"/>:
        <div className="rep-area-grid">{areas.map((area:Any)=>{
          const metrics=(coverage?.areas||[]).find((row:Any)=>row.areaId===area.id);
          return <button type="button" className={'rep-area-card'+
            (selected===area.id?' active':'')} key={area.id}
            onClick={()=>setSelected(previous=>previous===area.id?null:area.id)}>
            <div className="rep-area-preview-head">
              <strong>{area.name}</strong><strong>{metrics?metrics.coverage+'%':'—'}</strong>
            </div>
            <div className="meter"><span style={{width:(metrics?.coverage||0)+'%'}}/></div>
            <small>{metrics?metrics.doctors+' أطباء • '+metrics.unvisited+
              ' غير مزار • '+metrics.done+' / '+metrics.target+' زيارة':
              'لا يوجد هدف فريق محسوب لهذه المنطقة'}</small>
          </button>;
        })}</div>}
    </Section>
    {current&&<Section title={'تفاصيل المنطقة: '+current.name}>
      <div className="button-group tour-actions">
        <button className="btn primary" type="button"
          onClick={()=>onBeginAreaTour(current.id)}>
          جولة من هذه المنطقة
        </button>
        <button className="btn outline" type="button" onClick={()=>setSelected(null)}>
          إغلاق التفاصيل
        </button>
      </div>
      <div className="rep-area-tabs" role="group" aria-label="نوع الجهات الطبية">
        {Object.entries(typeLabels).map(([value,label])=>
          <button key={value} type="button" className={'btn small'+
            (entityType===value?' primary':'')} aria-pressed={entityType===value}
            onClick={()=>setEntityType(value)}>{label}</button>)}
      </div>
      <h3>{entityName} في {current.name}</h3>
      {entityError&&<Notice kind="error">{entityError}</Notice>}
      {!entities&&!entityError?<Empty text="جارٍ تحميل الجهات..."/>:
        !visibleEntities.length?<Empty text="ما في جهات متاحة من هذا النوع بالمنطقة"/>:
        <div className="rep-doctor-list">{visibleEntities.map((item:Any)=>
          <div className="rep-doctor-item" key={item.id}>
            <strong>{item.name}</strong>
            <small>{item.specialty||item.kind||item.category||'—'}
              {item.grade?' • '+item.grade:''}</small>
          </div>)}</div>}
      {entityType!=='DOCTOR'&&<div className="button-group tour-actions">
        <button type="button" className="btn small outline"
          disabled={page===0||!entities} onClick={()=>setPage(x=>Math.max(0,x-1))}>
          السابقة
        </button>
        <span className="muted">الصفحة {page+1}</span>
        <button type="button" className="btn small outline"
          disabled={!entities||entities.length<pageSize}
          onClick={()=>setPage(x=>x+1)}>التالية</button>
      </div>}
      <Notice>الجهات المعروضة للقراءة وفق مناطقك وصلاحياتك.
        للأطباء يتم تطبيق الاختصاصات الحالية. تغطية الأطباء موجودة في
        «تغطية المناطق»، ولا تُمثل القوائم هنا سجلاً للزيارات المنجزة.</Notice>
    </Section>}
  </>;
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
          <td>{r.targets?.map((x:Any)=>x.name+
            (x.areaNameAtVisit?' — '+x.areaNameAtVisit:' — منطقة غير مسجلة')).join('، ')}</td>
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
function isGpsError(error:Any){
  return error?.code==='GPS_INVALID'||error?.code===1||
    (error?.status===400&&/الموقع|إحداث|دقة|GPS/i.test(error?.message||''));
}
function NewVisit({refresh,done,user,onSaved,initialAreaId=null,initialType=null}:Any){
  type TourStep='setup'|'targets'|'review';
  const maxTargets=100;
  const [step,setStep]=useState<TourStep>(initialAreaId?'targets':'setup');
  const [type,setType]=useState(initialType||'DOCTOR');
  const [selectedAreaIds,setSelectedAreaIds]=useState<string[]>(
    initialAreaId?[initialAreaId]:[]);
  const [targetIds,setTargetIds]=useState<string[]>([]);
  // Exactly one area for every target within this tour. This is NOT a
  // location guess from the final GPS fix (one fix covers the whole tour).
  const [areaByTarget,setAreaByTarget]=useState<Record<string,string>>({});
  const [visitDate,setVisitDate]=useState(today());
  const [search,setSearch]=useState(''),[gradeFilter,setGradeFilter]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[last,setLast]=useState('');
  const [loadRetry,setLoadRetry]=useState(0);
  const retryDraft=useRef<{signature:string,body:Any}|null>(null);
  const route=type==='DOCTOR'?'/reps/'+user.id+'/doctors':
    type==='PHARMACY'?'/pharmacies':'/hospitals';
  const {data:targets,error:loadError}=useData(route,refresh+':'+loadRetry);
  const {data:areas,error:areaError}=useData('/areas',refresh+':'+loadRetry);
  const steps:{id:TourStep,label:string}[]=[
    {id:'setup',label:'النوع والمناطق'},
    {id:'targets',label:'اختيار الجهات'},
    {id:'review',label:'إنهاء الجولة'}
  ];

  // The medical scope comes from the authorized API, never a client-supplied area name.
  const chosenAreas=(areas||[]).filter((area:Any)=>selectedAreaIds.includes(area.id));
  const allowedTargets=targetsForAreas(targets||[],selectedAreaIds);
  const filteredTargets=allowedTargets.filter((item:Any)=>{
    const words=[item.name,item.specialty,item.grade,item.category,item.kind,
      item.area?.name,...(item.doctorAreas||[]).map((link:Any)=>link.area?.name)]
      .join(' ').toLocaleLowerCase();
    return (!gradeFilter||item.grade===gradeFilter)&&
      words.includes(search.trim().toLocaleLowerCase());
  });
  const selectedTargets=allowedTargets.filter((item:Any)=>targetIds.includes(item.id));
  const matchingAreaIds=(item:Any)=>selectedAreaIds.filter(areaId=>inArea(item,areaId));
  const selectionValid=targetIds.length>0&&targetIds.length<=maxTargets&&
    targetIds.length===selectedTargets.length&&
    selectedTargets.every((item:Any)=>matchingAreaIds(item).includes(areaByTarget[item.id]));

  function chooseType(next:string){
    if(next!==type){
      setType(next);setSelectedAreaIds([]);setTargetIds([]);setAreaByTarget({});
      setSearch('');setGradeFilter('');retryDraft.current=null;
    }
    setError('');setLast('');setStep('setup');
  }
  function proceedToTargets(){
    if(!areas||areaError||!targets||loadError){
      setError('لازم تكتمل بيانات المناطق والجهات قبل المتابعة');
      return;
    }
    if(!selectedAreaIds.length){
      setError('اختر منطقة واحدة على الأقل');return;
    }
    setTargetIds(previous=>retainSelectedTargets(previous,allowedTargets));
    // Preserve valid choices and auto-select ONLY when a target has one
    // linked area among the selected areas.
    setAreaByTarget(previous=>{
      const next:Record<string,string>={};
      for(const item of allowedTargets){
        const possibilities=selectedAreaIds.filter(areaId=>inArea(item,areaId));
        if(possibilities.includes(previous[item.id]))next[item.id]=previous[item.id];
        else if(possibilities.length===1)next[item.id]=possibilities[0];
      }
      return next;
    });
    setSearch('');setGradeFilter('');setError('');setStep('targets');
  }
  function proceedToReview(){
    if(!selectionValid||loadError||areaError){
      setError('اختر الجهات وحدد منطقة الزيارة لكل جهة، بحد أقصى 100 جهة');return;
    }
    setError('');setStep('review');
  }
  function locate():Promise<GeolocationPosition>{
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(Error('الجهاز لا يدعم تحديد الموقع'));
      navigator.geolocation.getCurrentPosition(resolve,reject,
        {enableHighAccuracy:true,timeout:20000,maximumAge:0});
    });
  }
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setLast('');
    try{
      if(!selectionValid||!chosenAreas.length||loadError||areaError)
        throw Error('الجهات المختارة غير مكتملة؛ لازم تحدد منطقة زيارة لكل جهة');
      if(!visitDate||visitDate>today())throw Error('تاريخ الجولة غير صحيح أو في المستقبل');
      // Reuse the exact same ID + GPS fix on a transport retry; do not create
      // another visit when the previous request might have reached the server.
      const orderedAreas=[...targetIds].sort().map(id=>[id,areaByTarget[id]]);
      const signature=JSON.stringify([type,visitDate,orderedAreas]);
      let body:Any;
      if(retryDraft.current?.signature===signature)body=retryDraft.current.body;
      else{
        const position=await locate();
        body={clientVisitId:crypto.randomUUID(),type,visitDate,targetIds:[...targetIds],
          areaByTarget:Object.fromEntries(orderedAreas),
          location:{latitude:position.coords.latitude,longitude:position.coords.longitude,
            accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()}};
        retryDraft.current={signature,body};
      }
      const result=await post('/visits',body);
      setLast('تم حفظ الجولة رقم '+result.id+
        (result.duplicate?' (كانت محفوظة مسبقاً)':'')+' مع موقع نهاية الجولة');
      retryDraft.current=null;setTargetIds([]);setSelectedAreaIds([]);setAreaByTarget({});
      setSearch('');setGradeFilter('');setStep('setup');done();onSaved?.();
    }catch(err:Any){
      // GPS failures need a fresh fix; transport/database failures retain the
      // exact draft and clientVisitId so a committed visit cannot be duplicated.
      if(isGpsError(err))retryDraft.current=null;
      setError(err?.code===1?'لازم تمنح صلاحية الموقع لإنهاء الجولة':
        err?.message||'تعذر تحديد الموقع أو حفظ الجولة');
    }finally{setBusy(false);}
  }
  function back(to:TourStep){
    if(busy)return;
    setError('');setStep(to);
  }
  return <Section title="إنهاء جولة جديدة">
    <ol className="tour-steps" aria-label="خطوات إنهاء الجولة">
      {steps.map((item,index)=><li key={item.id}
        className={'tour-step'+(item.id===step?' active':'')}
        aria-current={item.id===step?'step':undefined}>
        <span>{index+1}</span>{item.label}
      </li>)}
    </ol>
    {last&&<Notice kind="success">{last}</Notice>}
    {error&&<Notice kind="error">{error}</Notice>}

    {step==='setup'&&<>
      <h3>نوع الجولة</h3>
      <div className="rep-tour-type-grid" role="group" aria-label="نوع الجولة">
        {[
          {type:'DOCTOR',symbol:'👨‍⚕️',label:'أطباء',text:'زيارات الأطباء'},
          {type:'PHARMACY',symbol:'💊',label:'صيدليات',text:'زيارات الصيدليات'},
          {type:'HOSPITAL',symbol:'🏥',label:'مشافي',text:'زيارات المشافي'}
        ].map(item=><button type="button" key={item.type}
          className={'rep-tour-type'+(type===item.type?' active':'')}
          aria-pressed={type===item.type} onClick={()=>chooseType(item.type)} disabled={busy}>
          <span aria-hidden="true">{item.symbol}</span><strong>{item.label}</strong>
          <small>{item.text}</small></button>)}
      </div>
      <div className="rep-section-heading">
        <h3>اختر منطقة أو أكثر</h3>
        <span className="muted">{areas?areas.length+' مناطق متاحة':'جارٍ تحميل المناطق'}</span>
      </div>
      {(areaError||loadError)&&<div className="notice error" role="alert">
        {areaError&&<p>تعذّر تحميل المناطق: {areaError}</p>}
        {loadError&&<p>تعذّر تحميل الجهات: {loadError}</p>}
        <button type="button" className="btn small outline"
          onClick={()=>setLoadRetry(value=>value+1)}>إعادة التحميل</button>
      </div>}
      {!areas&&!areaError?<Empty text="جارٍ تحميل المناطق..."/>:
        areas?.length===0?<Empty text="ما في مناطق مخصصة لك، اطلب من المدير إسناد مناطق"/>:
        <div className="rep-tour-area-list">{(areas||[]).map((area:Any)=>{
          const count=(targets||[]).filter((item:Any)=>inArea(item,area.id)).length;
          return <label className={'rep-tour-area'+
            (selectedAreaIds.includes(area.id)?' active':'')} key={area.id}>
            <input type="checkbox" checked={selectedAreaIds.includes(area.id)}
              disabled={busy||Boolean(areaError||loadError)}
              onChange={e=>{
                setSelectedAreaIds(previous=>e.target.checked?
                  [...previous,area.id]:previous.filter(id=>id!==area.id));
                setError('');
              }}/>
            <span><strong>{area.name}</strong>
              <small>{targets?count+' جهة متاحة':'جارٍ تحميل الجهات'}</small></span>
          </label>;
        })}</div>}
      <div className="rep-tour-sticky-actions">
        <span><strong>{selectedAreaIds.length} مناطق</strong>
          <small>{selectedAreaIds.length?'تم اختيار مناطق الجولة':'اختر مناطق الجولة أولاً'}</small></span>
        <button type="button" className="btn primary" onClick={proceedToTargets}
          disabled={busy||!areas||!targets||Boolean(areaError||loadError)||
            selectedAreaIds.length===0}>التالي</button>
      </div>
    </>}

    {step==='targets'&&<>
      <h3>اختيار الجهات المزارة</h3>
      <p className="muted">المناطق: {chosenAreas.map((area:Any)=>area.name).join('، ')}</p>
      <div className="form-grid">
        <label className="field">بحث بالاسم أو الاختصاص
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="ابحث ضمن المناطق المختارة"/>
        </label>
        {type!=='HOSPITAL'&&<label className="field">التصنيف
          <select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}>
            <option value="">كل التصنيفات</option>
            {['A','B','C'].map(g=><option key={g} value={g}>{g}</option>)}
          </select>
        </label>}
      </div>
      {(loadError||areaError)&&<div className="notice error" role="alert">
        تعذّر تحديث قائمة الجهات
        <button type="button" className="btn small outline"
          onClick={()=>setLoadRetry(value=>value+1)}>إعادة التحميل</button>
      </div>}
      {!targets&&!loadError?<Empty text="جارٍ تحميل الجهات..."/>:
        !filteredTargets.length?<Empty text="لا توجد جهات مطابقة ضمن المناطق المختارة"/>:
        <div className="check-grid">{filteredTargets.map((item:Any)=>{
          const possible=matchingAreaIds(item);
          const chosen=targetIds.includes(item.id);
          return <div className="tour-target-card" key={item.id}>
            <label className="check-item">
              <input type="checkbox" checked={chosen}
                disabled={busy||Boolean(loadError||areaError)||
                  (targetIds.length>=maxTargets&&!chosen)}
                onChange={e=>{
                  const selected=e.target.checked;
                  setTargetIds(previous=>selected?
                    (previous.length>=maxTargets?previous:[...previous,item.id]):
                    previous.filter(id=>id!==item.id));
                  setAreaByTarget(previous=>{
                    const next={...previous};
                    if(!selected)delete next[item.id];
                    else if(possible.length===1)next[item.id]=possible[0];
                    return next;
                  });
                  setError('');
                }}/>
              <span>{item.name}</span>
            </label>
            {chosen&&<label className="field">
              منطقة الزيارة {possible.length>1?'(اختيار إلزامي)':''}
              <select value={areaByTarget[item.id]||''} disabled={busy}
                required onChange={e=>{setAreaByTarget(previous=>({
                  ...previous,[item.id]:e.target.value
                }));setError('');}}>
                <option value="">اختر منطقة الزيارة</option>
                {chosenAreas.filter((area:Any)=>possible.includes(area.id))
                  .map((area:Any)=><option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </label>}
          </div>;
        })}</div>}
      <p className="muted">الجهات المحددة: {targetIds.length} / {maxTargets}</p>
      <div className="button-group tour-actions">
        <button type="button" className="btn outline" onClick={()=>back('setup')}>رجوع للمناطق</button>
        {targetIds.length>0&&<button type="button" className="btn outline"
          disabled={busy} onClick={()=>setTargetIds([])}>إلغاء التحديد</button>}
        <button type="button" className="btn primary" onClick={proceedToReview}
          disabled={busy||!selectionValid||Boolean(loadError||areaError)}>
          التالي: مراجعة الجولة
        </button>
      </div>
    </>}

    {step==='review'&&<>
      <h3>مراجعة الجولة وإنهاؤها</h3>
      <div className="tour-summary">
        <p><strong>النوع:</strong> {typeLabels[type]}</p>
        <p><strong>المناطق ({chosenAreas.length}):</strong> {chosenAreas.map((a:Any)=>a.name).join('، ')}</p>
        <p><strong>الجهات ({selectedTargets.length}):</strong></p>
        <ul>{selectedTargets.map((item:Any)=><li key={item.id}>
          {item.name} — {chosenAreas.find((area:Any)=>area.id===areaByTarget[item.id])?.name||
            'لم تُحدّد المنطقة'}
        </li>)}</ul>
      </div>
      <Notice>يتم أخذ موقع GPS مرة واحدة عند الضغط على إنهاء الجولة، وليس عند اختيار الجهات.
        لازم تمنح إذن الموقع، ويكون الاتصال عبر HTTPS. في حال انقطع الاتصال بعد الإرسال،
        إعادة المحاولة بنفس الاختيارات تستخدم نفس رقم الجولة لتجنب التكرار.</Notice>
      <form className="form" onSubmit={save}>
        <label className="field">تاريخ الجولة المختار
          <input type="date" value={visitDate} max={today()}
            onChange={e=>setVisitDate(e.target.value)} required disabled={busy}/>
        </label>
        <div className="button-group tour-actions">
          <button type="button" className="btn outline" disabled={busy}
            onClick={()=>back('targets')}>رجوع للجهات</button>
          <button type="submit" className="btn primary" disabled={busy||!selectionValid}>
            {busy?'جارٍ تحديد الموقع وحفظ الجولة...':'تحديد موقعي وإنهاء الجولة'}
          </button>
        </div>
      </form>
    </>}
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
function DoctorGoalEditor({refresh,done}:Any){
  const {data:listing,error:listError}=useData('/doctor-goals',refresh);
  const {data:teams,error:teamError}=useData('/teams',refresh);
  const {data:users,error:userError}=useData('/users',refresh);
  const [scope,setScope]=useState('TEAM'),[ownerId,setOwnerId]=useState('');
  const [search,setSearch]=useState(''),[doctorId,setDoctorId]=useState('');
  const [target,setTarget]=useState('5'),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const url='/doctors?limit=100'+(search.trim()?'&search='+encodeURIComponent(search.trim()):'');
  const {data:doctors,error:doctorError}=useData(url,refresh);
  const owners=scope==='TEAM'?(teams||[]):(users||[]).filter((u:Any)=>u.role==='REP');
  const selectedDoctor=(doctors||[]).some((d:Any)=>d.id===doctorId);
  const priorDoctor=listing?.goals?.find((g:Any)=>g.doctorId===doctorId);
  async function writeGoal(goal:Any){
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      await api('/doctor-goals',{method:'PUT',body:JSON.stringify(goal)});
      setMessage(goal.target===null?'تمت إزالة الهدف المخصص':'تم حفظ الهدف');
      done();
    }catch(e:Any){setError(e.message||'فشل الحفظ');}finally{setBusy(false);}
  }
  return <Section title="إدارة أهداف الفريق والمندوب">
    <Notice>مثال: هدف الفريق للدكتور د هو 5 زيارات، وهدف المندوب أ 3 زيارات، وهدف ب زيارتان. كل زيارة تُحتسب لصاحبها وتدخل بمجموع فريقه أيضاً. الهدف الجماعي لا يضمن تحقيق كل هدف فردي.</Notice>
    {listing&&<p className="muted">الدورة: {listing.cycleStart} إلى {listing.cycleEnd}. بدون هدف صريح للفريق، تبقى أهداف تصنيف الطبيب الافتراضية.</p>}
    {[listError,teamError,userError,doctorError,error].filter(Boolean).map((e:string,i)=>
      <Notice key={i} kind="error">{e}</Notice>)}
    {message&&<Notice kind="success">{message}</Notice>}
    <form className="form" onSubmit={e=>{
      e.preventDefault();
      if(!ownerId||!doctorId){setError('حدد صاحب الهدف والطبيب');return;}
      void writeGoal({scope,ownerId,doctorId,target:Number(target)});
    }}>
      <div className="form-grid">
        <label className="field">الاحتساب
          <select value={scope} onChange={e=>{setScope(e.target.value);setOwnerId('');}}>
            <option value="TEAM">هدف فريق</option>
            <option value="REP">هدف فردي</option>
          </select>
        </label>
        <label className="field">{scope==='TEAM'?'الفريق':'المندوب'}
          <select required value={ownerId} onChange={e=>setOwnerId(e.target.value)}>
            <option value="">اختر...</option>
            {owners.map((o:Any)=><option value={o.id} key={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="field">ابحث عن الطبيب
          <input value={search} onChange={e=>{setSearch(e.target.value);setDoctorId('');}}
            placeholder="الاسم أو الاختصاص أو المنطقة"/>
        </label>
        <label className="field">الطبيب
          <select required value={doctorId} onChange={e=>setDoctorId(e.target.value)}>
            <option value="">اختر...</option>
            {doctorId&&!selectedDoctor&&priorDoctor&&<option value={doctorId}>
              {priorDoctor.doctor?.name||doctorId}</option>}
            {(doctors||[]).map((d:Any)=><option value={d.id} key={d.id}>
              {d.name} — {d.specialty} — {d.area?.name}</option>)}
          </select>
        </label>
        <label className="field">عدد الزيارات المطلوب
          <input type="number" min="1" max="3650" step="1" required value={target}
            onChange={e=>setTarget(e.target.value)}/>
        </label>
      </div>
      <button className="btn primary" type="submit" disabled={busy||!listing||!teams||!users||!doctors}>
        {busy?'جارٍ الحفظ...':'حفظ الهدف'}
      </button>
    </form>
    <h3>الأهداف المخصصة لهالدورة</h3>
    {!listing?<Empty text="تحميل الأهداف..."/>:!listing.goals?.length?<Empty text="ما في أهداف مخصصة حالياً"/>:
      <div className="table-wrap"><table><thead><tr>
        <th>النوع</th><th>صاحب الهدف</th><th>الطبيب</th><th>الزيارات</th><th>الإجراء</th>
      </tr></thead><tbody>{listing.goals.map((g:Any)=><tr key={g.id}>
        <td>{g.scope==='TEAM'?'فريق':'فردي'}</td>
        <td>{(g.scope==='TEAM'?(teams||[]):(users||[]))
          .find((x:Any)=>x.id===g.ownerId)?.name||g.ownerId}</td>
        <td>{g.doctor?.name||g.doctorId}</td><td>{g.target}</td>
        <td><div className="button-group">
          <button type="button" className="btn small" disabled={busy} onClick={()=>{
            setScope(g.scope);setOwnerId(g.ownerId);setSearch(g.doctor?.name||'');
            setDoctorId(g.doctorId);setTarget(String(g.target));
          }}>تعديل</button>
          <button type="button" className="btn small danger" disabled={busy} onClick={()=>{
            if(window.confirm('إزالة الهدف المخصص؟ الزيارات القديمة تبقى محفوظة.'))
              void writeGoal({scope:g.scope,ownerId:g.ownerId,doctorId:g.doctorId,target:null});
          }}>إزالة</button>
        </div></td>
      </tr>)}</tbody></table></div>}
  </Section>;
}
function Frequency({refresh,user,done}:Any){
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
  return <><Section title="تكرار زيارات الأطباء">
    <Notice>الإنجاز الجماعي: {data.completed} من {data.total} هدف للفريق والطبيب. الأهداف المخصصة للفريق تتجاوز هدف التصنيف الافتراضي، والزيارات الفردية تظل محسوبة لكل مندوب أيضاً.</Notice>
    {downloadError&&<Notice kind="error">{downloadError}</Notice>}
    <button type="button" className="btn primary" disabled={busy} onClick={exportExcel}>
      {busy?'جارٍ التصدير...':'تصدير الفريق والأفراد إلى Excel'}
    </button>
    {!data.items?.length?<Empty/>:<div className="table-wrap"><table><thead><tr>
      <th>الفريق</th><th>الطبيب</th><th>المناطق</th><th>التصنيف</th>
      <th>الهدف</th><th>المنجز / المطلوب</th><th>الإنجاز</th>
    </tr></thead><tbody>{data.items.map((r:Any)=><tr
      key={(r.teamId||r.representatives?.[0]?.id||'solo')+':'+r.id}>
      <td>{r.teamName||'بدون فريق'}</td><td>{r.name}</td><td>{r.area}</td>
      <td>{r.grade}</td><td>{r.goalSource==='EXPLICIT'?'مخصص للفريق':'افتراضي'}</td>
      <td>{r.done} / {r.target}</td>
      <td><div className="meter"><span style={{width:r.coverage+'%'}}/></div>{r.coverage}%</td>
    </tr>)}</tbody></table></div>}
    <h3>الأهداف الفردية للمندوبين</h3>
    <Notice>الإنجاز الفردي للمندوب لا يزيد بزيارة نفذها زميله حتى لو كانا بنفس الفريق.</Notice>
    <p className="muted">الأهداف الفردية المكتملة: {data.personalCompleted||0} من {data.personalTotal||0}</p>
    {!data.personalItems?.length?<Empty text="لا توجد أهداف فردية محددة في هالدورة"/>:
      <div className="table-wrap"><table><thead><tr>
        <th>المندوب</th><th>الطبيب</th><th>المناطق</th><th>المنجز / المطلوب</th><th>الإنجاز</th>
      </tr></thead><tbody>{data.personalItems.map((r:Any)=><tr key={r.repId+':'+r.id}>
        <td>{r.repName}</td><td>{r.name}</td><td>{r.area}</td>
        <td>{r.done} / {r.target}</td>
        <td><div className="meter"><span style={{width:r.coverage+'%'}}/></div>{r.coverage}%</td>
      </tr>)}</tbody></table></div>}
  </Section>
  {user.role==='COMPANY_ADMIN'&&<DoctorGoalEditor refresh={refresh} done={done}/>}</>;
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
function Directory({kind,refresh,done,user,onBeginTour}:Any){
  const c=kind==='areas'?'المناطق':kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي';
  const canManage=user?.role==='COMPANY_ADMIN';
  const [includeArchived,setIncludeArchived]=useState(false);
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(0);
  const pageSize=100;
  const [actionError,setActionError]=useState('');
  const [exportBusy,setExportBusy]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [editId,setEditId]=useState<string|null>(null);
  const isMedical=['doctors','pharmacies','hospitals'].includes(kind);
  const medicalParams=new URLSearchParams();
  if(isMedical){
    medicalParams.set('limit',String(pageSize));medicalParams.set('offset',String(page*pageSize));
    if(includeArchived)medicalParams.set('includeArchived','true');
    if(query.trim())medicalParams.set('search',query.trim());
  }
  const dataPath='/'+kind+(isMedical?'?'+medicalParams.toString():'');
  useEffect(()=>setPage(0),[kind,includeArchived,query]);
  const {data,error}=useData(dataPath,refresh),{data:areas}=useData('/areas',refresh);
  const {data:specialties}=useData(kind==='doctors'?'/specialties':null,refresh);
  const {data:areaGroups}=useData(kind==='areas'?'/area-groups':null,refresh);
  const usesArea=kind!=='areas';
  const editing=isMedical?data?.find((item:Any)=>item.id===editId):null;
  const filtered=isMedical?(data||[]):(data||[]).filter((x:Any)=>
    [x.name,x.specialty,x.city,x.group?.name,x.area?.name,x.grade,x.category]
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
  async function exportDirectory(){
    if(exportBusy||!isMedical)return;
    setActionError('');setExportBusy(true);
    try{
      const response=await fetch('/api/reports/medical.xlsx?kind='+encodeURIComponent(kind)+
        '&includeArchived='+String(includeArchived),{credentials:'include'});
      if(!response.ok){
        const body=await response.json().catch(()=>({}));
        throw Error(body.error||'تعذر تصدير القائمة');
      }
      const url=URL.createObjectURL(await response.blob());
      const a=document.createElement('a');
      a.href=url;a.download='mandob-'+kind+'.xlsx';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    }catch(e:Any){setActionError(e.message||'تعذر التصدير');}
    finally{setExportBusy(false);}
  }
  return <>{kind==='doctors'&&<datalist id="doctor-specialty-options">
    {(specialties||[]).map((name:string)=><option key={name} value={name}/>)}
  </datalist>}
  <Section title={c} actions={isMedical&&user?.role==='REP'?
    <button type="button" className="btn primary"
      onClick={()=>onBeginTour(kind==='doctors'?'DOCTOR':
        kind==='pharmacies'?'PHARMACY':'HOSPITAL')}>
      ابدأ جولة {c}
    </button>:isMedical&&canManage?
    <div className="button-group">
      <label className="check-item"><input type="checkbox" checked={includeArchived}
        onChange={e=>setIncludeArchived(e.target.checked)}/>عرض المؤرشفين أيضاً</label>
      <button className="btn small" type="button" disabled={exportBusy}
        onClick={exportDirectory}>{exportBusy?'جارٍ التصدير...':'تصدير Excel'}</button>
    </div>:null}>
    {error&&<Notice kind="error">{error}</Notice>}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    <label className="field">بحث بالاسم أو المنطقة
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="اكتب للبحث في النتائج المعروضة"/>
    </label>
    {!data&&!error?<Empty text="جارٍ تحميل البيانات..."/>:!filtered.length?<Empty/>:<div className="table-wrap"><table><thead><tr><th>الاسم</th><th>المنطقة</th><th>التفاصيل</th>
      {isMedical&&<th>الحالة</th>}{isMedical&&canManage&&<th>الإجراء</th>}</tr></thead><tbody>
      {filtered.map((x:Any)=><tr key={x.id}><td>{x.name}</td><td>{kind==='doctors'&&x.doctorAreas?.length?
          [...new Set(x.doctorAreas.map((link:Any)=>link.area.name))].join('، '):
          x.area?.name||x.city||'—'}</td>
        <td>{x.specialty||x.grade||x.category||'—'}</td>
        {isMedical&&<td>{x.active?'نشط':'مؤرشف'}</td>}{isMedical&&canManage&&<td>
          <button type="button" className="btn small outline" disabled={busyId!==null}
            onClick={()=>setEditId(x.id)}>تعديل البيانات</button>
          <button type="button" className={'btn small'+(x.active?' danger':'')}
            disabled={busyId!==null} onClick={()=>changeMedicalStatus(x)}>
            {busyId===x.id?'جارٍ الحفظ...':x.active?'أرشفة':'استعادة'}
          </button>
        </td>}</tr>)}</tbody></table></div>}
    {isMedical&&<div className="button-group">
      <button className="btn small outline" type="button" disabled={page===0||!data}
        onClick={()=>setPage(p=>Math.max(0,p-1))}>الصفحة السابقة</button>
      <span className="muted">الصفحة {page+1}</span>
      <button className="btn small outline" type="button"
        disabled={!data||data.length<pageSize}
        onClick={()=>setPage(p=>p+1)}>الصفحة التالية</button>
    </div>}
  </Section>
  {canManage&&editing&&<Section title={'تعديل بيانات '+editing.name}>
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
  {canManage&&kind==='doctors'&&<DoctorExcelImport done={done}/>}
  {canManage&&<Section title={'إضافة إلى '+c}><Form onSave={async(fd:FormData)=>{
    const body:Any={name:val(fd,'name')};
    if(usesArea)body.areaId=val(fd,'areaId');
    if(kind==='areas'){body.city=val(fd,'city');body.groupId=val(fd,'groupId')||null;}
    if(kind==='doctors'){body.specialty=val(fd,'specialty');body.grade=val(fd,'grade');}
    if(kind==='pharmacies'){body.grade=val(fd,'grade');body.target=Number(val(fd,'target')||4);}
    if(kind==='hospitals'){body.category=val(fd,'category')||'خاص';body.specialty=val(fd,'specialty')||'عام';body.target=Number(val(fd,'target')||4);}
    await post('/'+kind,body);done();
  }}><div className="form-grid"><TextInput name="name" label="الاسم"/>
    {usesArea?<SelectInput name="areaId" label="المنطقة" options={(areas||[]).map((a:Any)=>({value:a.id,label:a.name}))}/>:
      <><TextInput name="city" label="المدينة" required={false}/>
        <SelectInput name="groupId" label="مجموعة المنطقة" required={false}
          options={(areaGroups||[]).map((g:Any)=>({value:g.id,label:g.name}))}/></>}
    {(kind==='doctors'||kind==='hospitals')&&<TextInput name="specialty" label="الاختصاص"
      listId={kind==='doctors'?'doctor-specialty-options':undefined}
      required={kind==='doctors'}/>}
    {(kind==='doctors'||kind==='pharmacies')&&<SelectInput name="grade" label="التصنيف"
      options={['A','B','C'].map(v=>({value:v,label:v}))}/>}
    {kind==='hospitals'&&<TextInput name="category" label="تصنيف المشفى" required={false}/>}
    {(kind==='pharmacies'||kind==='hospitals')&&<TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue="4"/>}
  </div></Form></Section>}
  {kind==='areas'&&<AreaOrganization revision={refresh} onChange={done} canEdit={canManage}/>}</>;
}
function Settings({refresh,done}:Any){
  const {data,error}=useData('/settings',refresh);
  return <Section title="إعدادات دورة الزيارات">{error&&<Notice kind="error">{error}</Notice>}
    {data&&<Form onSave={async(fd:FormData)=>{
      const workingDays=fd.getAll('workingDays').map(Number);
      if(!workingDays.length)throw Error('حدّد يوم عمل واحداً على الأقل');
      await patch('/settings',{frequencyA:Number(val(fd,'frequencyA')),frequencyB:Number(val(fd,'frequencyB')),
        frequencyC:Number(val(fd,'frequencyC')),cycleStart:val(fd,'cycleStart')||null,
        cycleEnd:val(fd,'cycleEnd')||null,annualLeaveBalance:Number(val(fd,'annualLeaveBalance')),
        workingDays});done();
    }}><div className="form-grid">
      {['A','B','C'].map(k=><TextInput key={k} name={'frequency'+k} label={'عدد زيارات التصنيف '+k}
        type="number" defaultValue={data['frequency'+k]}/>)}
      <TextInput name="cycleStart" type="date" required={false} label="تاريخ بداية الدورة" defaultValue={data.cycleStart?.slice(0,10)}/>
      <TextInput name="cycleEnd" type="date" required={false} label="تاريخ نهاية الدورة" defaultValue={data.cycleEnd?.slice(0,10)}/>
      <TextInput name="annualLeaveBalance" label="الرصيد السنوي الافتراضي" type="number" defaultValue={data.annualLeaveBalance}/>
    </div>
    <label className="field">أيام العمل المعتمدة للإجازات</label>
    <div className="check-grid">{[
      ['0','الأحد'],['1','الإثنين'],['2','الثلاثاء'],['3','الأربعاء'],
      ['4','الخميس'],['5','الجمعة'],['6','السبت']
    ].map(([id,name])=><label className="check-item" key={id}>
      <input type="checkbox" name="workingDays" value={id}
        defaultChecked={(data.workingDays||[]).includes(Number(id))}/>{name}
    </label>)}</div>
    </Form>}
  </Section>;
}
function AreaCoverage({refresh}:Any){
  const {data,error}=useData('/analytics/area-coverage',refresh);
  if(error)return <Section title="تغطية المناطق"><Notice kind="error">{error}</Notice></Section>;
  if(!data)return <Section title="تغطية المناطق"><Empty text="جارٍ حساب تغطية المناطق..."/></Section>;
  return <Section title="نسبة تغطية المناطق">
    <Notice>كل زيارة تُنسب لمنطقة واحدة محددة عند تسجيلها.
      الطبيب المرتبط بمنطقتين يظهر ضمن هدف كل منطقة، لكن هدف الفريق الإجمالي
      يحسب الطبيب مرة واحدة فقط. التغطية مبنية على أهداف الفريق خلال الدورة،
      وليست مجموع الأهداف الفردية للمندوبين.</Notice>
    <p className="muted">الدورة: {data.cycleStart||'—'} إلى {data.cycleEnd||'—'}</p>
    {data.unattributedHistoricalVisits>0&&<Notice kind="error">
      يوجد {data.unattributedHistoricalVisits} زيارة طبيب قديمة دون منطقة محفوظة.
      لم نوزّعها تلقائياً على المناطق؛ تبقى ضمن إنجاز الفريق الإجمالي فقط.
    </Notice>}
    {!data.areas.length?<Empty text="لا توجد مناطق أو أهداف متاحة للتغطية"/>:
      <div className="table-wrap"><table><thead><tr>
        <th>الفريق</th><th>المنطقة</th><th>الأطباء</th><th>غير مزار</th>
        <th>زيارات منجزة / مطلوبة</th><th>التغطية</th>
      </tr></thead><tbody>{data.areas.map((row:Any)=><tr key={row.groupKey+':'+row.areaId}>
        <td>{row.teamName}</td><td>{row.areaName}</td>
        <td>{row.doctors}</td><td>{row.unvisited}</td>
        <td>{row.done} / {row.target}</td><td>
          <strong>{row.coverage}%</strong>
          <div className="meter"><span style={{width:row.coverage+'%'}}/></div>
        </td>
      </tr>)}</tbody></table></div>}
    <h3>إجمالي الفريق — كل طبيب مرة واحدة</h3>
    <div className="card-grid">{data.teamTotals.map((row:Any)=>
      <div key={row.groupKey} className="mini-card">
        <strong>{row.teamName}</strong>
        <span>{row.doctors} طبيب • {row.done} / {row.target} زيارة</span>
        <strong>{row.coverage}%</strong>
      </div>)}</div>
    <p className="muted">ما بصير نجمع مطلوب المناطق لاستخراج مطلوب الفريق، لأن الطبيب
      المرتبط بأكثر من منطقة رح يتكرر. إجمالي الفريق محسوب من الأطباء الفريدين.</p>
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
    ['visits','الجولات'],['leaves','الإجازات'],['reports','التقارير'],['frequency','الإحصائيات'],['area-coverage','تغطية المناطق'],['settings','الإعدادات']],
  TEAM_MANAGER:[['dashboard','الرئيسية'],['users','الفريق'],['areas','المناطق'],
    ['doctors','الأطباء'],['pharmacies','الصيدليات'],['hospitals','المشافي'],
    ['visits','الجولات'],['leaves','الإجازات'],['reports','التقارير'],['frequency','الإحصائيات'],['area-coverage','تغطية المناطق']],
  REP:[['dashboard','الرئيسية'],['analytics','التحليل'],['analysis-detail','تفاصيل التحليل'],
    ['reports','التقارير'],['profile','حسابي'],['doctors','الأطباء'],['pharmacies','الصيدليات'],
    ['hospitals','المشافي'],['areas','المناطق'],['plan-products','الخطة والأصناف'],
    ['new-visit','إنهاء جولة'],['visits','جولاتي'],['new-leave','طلب إجازة'],
    ['leaves','إجازاتي'],['frequency','إنجاز الزيارات'],
    ['area-coverage','تغطية المناطق']]
};
function LegacyApp(){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),
    [section,setSection]=useState('dashboard'),[revision,setRevision]=useState(0),
    [tourEntryAreaId,setTourEntryAreaId]=useState<string|null>(null),
    [tourEntryType,setTourEntryType]=useState<string|null>(null),
    [shellError,setShellError]=useState('');
  useEffect(()=>{api('/me').then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  useEffect(()=>{(window as Any).__mandobUser=user;},[user]);
  useEffect(()=>{if(user)setSection(user.role==='SUPER_ADMIN'?'companies':'dashboard');},[user?.role]);
  function refresh(){setRevision(v=>v+1);}
  function navigate(key:string){
    setTourEntryAreaId(null);setTourEntryType(null);
    setSection(key);
  }
  function beginAreaTour(areaId:string){
    setTourEntryAreaId(areaId);setTourEntryType('DOCTOR');
    setSection('new-visit');
  }
  function beginMedicalTour(type:string){
    setTourEntryAreaId(null);setTourEntryType(type);
    setSection('new-visit');
  }
  async function logout(){
    setShellError('');
    try{
      await post('/logout',{});
      dataRequestCache.clear();
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
    case 'dashboard':contents=user.role==='REP'?
      <RepHome refresh={revision} user={user} navigate={navigate}/>:
      <Dashboard refresh={revision}/>;break;
    case 'new-visit':contents=<NewVisit key={(tourEntryAreaId||'standalone')+':'+(tourEntryType||'unset')}
      initialAreaId={tourEntryAreaId} initialType={tourEntryType}
      refresh={revision} done={refresh} user={user}/>;break;
    case 'visits':contents=<Records kind="visits" refresh={revision}/>;break;
    case 'new-leave':contents=<NewLeave done={refresh}/>;break;
    case 'leaves':contents=<Records kind="leaves" refresh={revision}/>;break;
    case 'reports':contents=<><VisitReports refresh={revision}/>
      <WeeklyVisits refresh={revision} user={user}/></>;break;
    case 'frequency':contents=<Frequency refresh={revision} user={user} done={refresh}/>;break;
    case 'area-coverage':contents=<AreaCoverage refresh={revision}/>;break;
    case 'teams':contents=<Teams refresh={revision} done={refresh}/>;break;
    case 'products':contents=<Products refresh={revision} done={refresh}/>;break;
    case 'users':contents=<Users refresh={revision} done={refresh} canCreate={user.role==='COMPANY_ADMIN'}/>;break;
    case 'settings':contents=<Settings refresh={revision} done={refresh}/>;break;
    case 'companies':contents=<Companies refresh={revision} done={refresh}/>;break;
    case 'areas':
      contents=user.role==='REP'?
        <RepAreas refresh={revision} user={user} onBeginAreaTour={beginAreaTour}/>:
        <Directory key={section} kind={section} refresh={revision} done={refresh} user={user}/>;
      break;
    case 'doctors':case 'pharmacies':case 'hospitals':
      contents=<Directory key={section} kind={section} refresh={revision} done={refresh}
        user={user} onBeginTour={beginMedicalTour}/>;
      break;
    default:contents=<Empty/>;
  }
  return <div className="layout">
    <aside className="sidebar"><div className="brand"><span className="brand-symbol">M</span>
      <div><strong>Mandob</strong><small>Medical Representatives</small></div></div>
      <div className="side-label">القائمة الرئيسية</div>
      <nav>{m.map(([key,label])=><button key={key} type="button" className={section===key?'active':''}
        onClick={()=>navigate(key)}>{label}</button>)}</nav>
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
