import React,{useEffect,useState,useRef} from 'react';
import {BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useOutletContext, useSearchParams} from 'react-router-dom';
import AreaOrganization from './AreaOrganization';
import {inArea,targetsForAreas,retainSelectedTargets,matchingTourAreas,
  resolvedTourArea,filterTourTargets,normalizeTourFilters} from './tourFlow.mjs';
import {GPS_WAIT_MS,watchAccurateLocation} from './locationFix.mjs';
import {requestLocationPermission} from './locationPermission.mjs';
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

function SpecialtyInput({name='specialty',label='الاختصاص',options=[],defaultValue='',
  required=true}:Any){
  const listId=React.useId();
  return <label className="field">{label}
    <input type="text" name={name} required={required} defaultValue={defaultValue||''}
      list={listId} placeholder="اختر من القائمة أو اكتب اختصاصاً جديداً"/>
    <datalist id={listId}>{(options||[]).map((item:string)=>
      <option value={item} key={item}/>)}</datalist>
  </label>;
}
function SpecialtyMultiPicker({name,label,options=[],initial=[]}:Any){
  const initialValues=[...new Set<string>((initial||[]).filter(Boolean))];
  const [checked,setChecked]=useState<string[]>(initialValues);
  const catalog=[...new Set<string>([...(options||[]),...initialValues])];
  return <div className="rep-specialty-picker">
    <strong>{label}</strong>
    <div className="check-grid">
      {catalog.map((specialty:string)=><label key={specialty} className="check-item">
        <input type="checkbox" name={name} value={specialty}
          checked={checked.includes(specialty)}
          onChange={e=>setChecked(old=>e.target.checked?
            [...old,specialty]:old.filter(item=>item!==specialty))}/>
        {specialty}
      </label>)}
    </div>
    <label className="field">إضافة اختصاص جديد (اختياري)
      <input name={name+'Extra'} placeholder="اكتب الاختصاص، ويمكن إضافة أكثر من واحد بفاصلة"/>
    </label>
  </div>;
}
function selectedSpecialties(fd:FormData,name:string){
  const extra=val(fd,name+'Extra').split(/[,،]/).map(x=>x.trim()).filter(Boolean);
  return [...new Set([...fd.getAll(name).map(value=>String(value).trim()).filter(Boolean),
    ...extra])];
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

function TeamManagerHome({refresh,user,navigate}:Any){
  const [localRefresh,setLocalRefresh]=useState(0);
  const refreshKey=refresh+':'+localRefresh;
  const {data:dashboard,error:dashboardError}=useData('/dashboard',refreshKey);
  const {data:users,error:usersError}=useData('/users',refreshKey);
  const {data:teams}=useData('/teams',refreshKey);
  const {data:homeAreas}=useData('/areas',refreshKey);
  const {data:visits,error:visitsError}=useData('/visits?limit=200&offset=0',refreshKey);
  const {data:reports,error:reportsError}=useData('/rep-reports',refreshKey);
  const {data:leaves,error:leavesError}=useData('/leaves?status=PENDING&limit=100&offset=0',refreshKey);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refreshKey);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refreshKey);
  const {data:settings}=useData('/settings',refreshKey);
  const {data:weekActivity,error:weekError}=useData(
    '/manager/team-weekly-activity?onDate='+today(),refreshKey);
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const team=Array.isArray(teams)?teams.find((row:Any)=>row.id===user.teamId):null;
  const teamCoverage=(coverage?.teamTotals||[]).find((row:Any)=>
    row.groupKey==='team:'+user.teamId)||(coverage?.teamTotals||[])[0];
  const frequencyRows=(frequency?.items||[]).filter((row:Any)=>!user.teamId||row.teamId===user.teamId);
  const goalDone=frequencyRows.reduce((sum:number,row:Any)=>
    sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const goalTarget=frequencyRows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const planCoverage=goalTarget?Math.min(100,Math.round(goalDone/goalTarget*100)):0;
  const delayedGoals=frequencyRows.filter((row:Any)=>(Number(row.done)||0)<(Number(row.target)||0)).length;
  const areaRows=(coverage?.areas||[]).filter((row:Any)=>
    !user.teamId||row.groupKey==='team:'+user.teamId).sort((a:Any,b:Any)=>a.coverage-b.coverage);
  const visitRows=visits||[];
  const weekByRep=new Map<string,number>((weekActivity?.perRep||[])
    .map((row:Any)=>[row.repId,Number(row.count)||0]));
  const activeDays=new Set<number>(Array.isArray(settings?.workingDays)?
    settings.workingDays:[0,1,2,3,4,6]);
  let elapsedDays=0;
  if(weekActivity?.start){
    const startDate=new Date(weekActivity.start+'T00:00:00Z');
    const todayDate=new Date(today()+'T00:00:00Z');
    for(let day=0;day<7;day++){
      const current=new Date(startDate);
      current.setUTCDate(startDate.getUTCDate()+day);
      if(current>todayDate)break;
      if(activeDays.has(current.getUTCDay()))elapsedDays++;
    }
  }
  const repProgress=(repId:string)=>{
    const rep=reps.find((row:Any)=>row.id===repId);
    const target=Number(rep?.dailyTarget||8)*elapsedDays;
    if(!weekActivity||!target)return null;
    return Math.min(100,Math.round((weekByRep.get(repId)||0)/target*100));
  };
  const repVisits=(rep:Any)=>visitRows.filter((visit:Any)=>
    visit.repId===rep.id||visit.rep?.id===rep.id||visit.repName===rep.name);
  const lastByRep=new Map<string,string>((weekActivity?.lastByRep||[]).map((row:Any)=>[
    row.repId,row.lastVisit]));
  const currentWeekByRep=new Map<string,number>((weekActivity?.perRep||[]).map((row:Any)=>[
    row.repId,row.count]));
  const lastActivity=(rep:Any)=>lastByRep.get(rep.id)||'لا يوجد';
  const dayNames=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const byDay=(weekActivity?.days||[]).filter((d:Any)=>d.weekday!==5)
    .map((d:Any)=>({day:d.weekday,label:dayNames[d.weekday],count:d.count}));
  const dayMax=Math.max(1,...byDay.map(row=>row.count));
  const recent=[...visitRows].sort((a:Any,b:Any)=>
    String(b.visitDate).localeCompare(String(a.visitDate))).slice(0,3);
  const errors=[dashboardError,usersError,visitsError,reportsError,leavesError,
    coverageError,frequencyError,weekError].filter(Boolean);
  const [leaveBusy,setLeaveBusy]=useState<string|null>(null);
  const [leaveActionError,setLeaveActionError]=useState('');
  async function reviewLeave(id:string,status:string){
    if(leaveBusy)return;setLeaveBusy(id);setLeaveActionError('');
    try{await patch('/leaves/'+id+'/status',{status});setLocalRefresh(v=>v+1);}
    catch(e:Any){setLeaveActionError(e.message||'تعذر تحديث الطلب');}
    finally{setLeaveBusy(null);}
  }
  return <div className="manager-dashboard-legacy">
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    <section className="hero"><div><h2>أهلاً، {user.name} 👋</h2>
      <p>فريقك يحقق {planCoverage}% من أهداف الزيارات الحالية. يوجد {
        leaves?.length||0} طلب إجازة بانتظار قرارك، وتغطية المناطق وصلت إلى {
        teamCoverage?.coverage??0}%.</p></div>
      <div className="hero-status">
        <div className="row"><span>المحافظة</span><b>{[...new Set((homeAreas||[]).map((area:Any)=>area.city).filter(Boolean))].join('، ')||'غير محددة'}</b></div>
        <div className="row"><span>الفريق</span><b>{team?.name||'الفريق الحالي'}</b></div>
        <div className="row"><span>عدد المندوبين</span><b>{reps.length} مندوبين</b></div>
        <div className="row"><span>الدورة</span><b>{frequency?.cycleStart||'—'} — {frequency?.cycleEnd||'—'}</b></div>
      </div>
    </section>

    <section className="kpis">
      {[
        ['👥','الفريق',reps.length,'أعضاء الفريق'],
        ['🎯','الخطة',planCoverage+'%','تحقيق الخطة'],
        ['📍','التغطية',(teamCoverage?.coverage??0)+'%','تغطية المناطق'],
        ['🚗','الجولات',dashboard?.visits??visitRows.length,'الجولات المسجلة'],
        ['📄','تقارير',Array.isArray(reports)?reports.length:'—','تقارير مستلمة'],
        ['⚠️','تنبيه',delayedGoals,'أهداف تحتاج متابعة']
      ].map(([icon,badge,value,label])=><div className="card kpi" key={String(label)}>
        <div className="kpi-top"><div className="kpi-icon">{icon}</div><span className="delta">{badge}</span></div>
        <div className="value">{value}</div><div className="label">{label}</div>
      </div>)}
    </section>

    <section className="grid">
      <div className="card section"><div className="section-head">
        <h3>أداء الفريق خلال الأسبوع</h3>
        <button type="button" onClick={()=>navigate('frequency')}>عرض التحليل الكامل</button></div>
        <div className="chart">{byDay.map(row=><div className="bar-wrap" key={row.day}>
          <div className="bar" style={{height:Math.max(12,Math.round(row.count/dayMax*100))+'%'}}
            title={row.count+' جولة'}></div><span>{row.label}</span><small>{row.count}</small>
        </div>)}</div>
      </div>
      <div className="card section"><div className="section-head"><h3>النشاط المباشر</h3>
        <button type="button" onClick={()=>navigate('visits')}>مشاهدة الكل</button></div>
        <div className="live-list">{recent.length?recent.map((visit:Any,index:number)=>
          <div className="activity" key={visit.id}><span className={'dot dot-'+index}></span>
            <div><b>{visit.repName} أنهى جولة {typeLabels[visit.type]||visit.type}</b>
              <p>{visit.targets?.length||0} زيارة — {
                [...new Set((visit.targets||[]).map((x:Any)=>x.areaNameAtVisit).filter(Boolean))].slice(0,2).join('، ')||'بدون منطقة'}</p></div>
            <time>{visit.visitDate}</time></div>):<Empty text="لا يوجد نشاط مسجل"/>}</div>
      </div>
    </section>

    <section className="card table-card"><div className="section-head"><h3>أداء أعضاء الفريق</h3>
      <button type="button" onClick={()=>navigate('users')}>إدارة الفريق</button></div>
      {!reps.length?<Empty/>:<table><thead><tr><th>المندوب</th><th>المناطق</th>
        <th>الجولات</th><th>تحقيق الخطة</th><th>آخر نشاط</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{reps.slice(0,8).map((rep:Any)=>{
          const progress=repProgress(rep.id);
          return <tr key={rep.id}><td><div className="rep"><div className="avatar">
            {managerInitials(rep.name)}</div><div><b>{rep.name}</b><small>{
              team?.name||'ضمن الفريق'}</small></div></div></td>
            <td>{rep.repAreas?.map((x:Any)=>x.area?.name).filter(Boolean).join('، ')||'—'}</td>
            <td>{weekActivity?currentWeekByRep.get(rep.id)||0:'—'}</td><td><div className="manager-progress-cell">
              <div className="progress"><i style={{width:(progress||0)+'%'}}/></div>
              <strong>{progress===null?'—':progress+'%'}</strong></div></td>
            <td>{lastActivity(rep)}</td><td><span className={'badge '+(rep.active?'':'danger')}>
              {rep.active?'نشط':'موقوف'}</span></td>
            <td><button className="btn secondary" type="button" onClick={()=>navigate('users',{repId:rep.id})}>التفاصيل</button></td>
          </tr>})}</tbody></table>}
    </section>

    <section className="mini-grid">
      <div className="card section"><div className="section-head"><h3>تغطية المناطق</h3>
        <button type="button" onClick={()=>navigate('areas')}>عرض المناطق</button></div>
        <div className="area-list">{areaRows.slice(0,4).map((area:Any)=>
          <div className="area" key={area.areaId}><div className="area-icon">📍</div>
            <div className="area-info"><b>{area.areaName}</b><small>{area.coverage}% تغطية — {
              area.done} / {area.target} زيارة</small></div>
            <span className={'badge '+(area.coverage<60?'warn':'')}>{area.coverage<60?'يحتاج متابعة':'جيد'}</span>
          </div>)}
          {!areaRows.length&&<Empty text="لا توجد مناطق محسوبة"/>}</div>
      </div>
      <div className="card section"><div className="section-head"><h3>طلبات تحتاج قرارك</h3>
        <button type="button" onClick={()=>navigate('leaves')}>عرض الكل</button></div>
        {leaveActionError&&<Notice kind="error">{leaveActionError}</Notice>}
        <div className="request-list">{(leaves||[]).slice(0,3).map((leave:Any)=>
          <div className="request" key={leave.id}><div className="avatar">{managerInitials(leave.repName)}</div>
            <div><b>{leave.repName}</b><small>{leave.type||'إجازة'}</small></div>
            <div className="request-actions"><button className="approve" type="button"
              disabled={leaveBusy!==null} onClick={()=>reviewLeave(leave.id,'APPROVED')}>قبول</button>
              <button className="reject" type="button" disabled={leaveBusy!==null}
                onClick={()=>reviewLeave(leave.id,'REJECTED')}>رفض</button></div>
          </div>)}
          {leaves&&!leaves.length&&<Empty text="لا توجد طلبات تحتاج قرارك"/>}</div>
      </div>
    </section>
  </div>;
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
  const coverage=overview?.coverage;
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
  const areaIds=new Set((assignedAreas||[]).map((area:Any)=>area.id));
  const myAreaRows=(coverage?.areas||[]).filter((area:Any)=>
    area.groupKey===groupKey&&areaIds.has(area.areaId));
  // Preserve the legacy area-coverage card's doctor-weighted average.
  const areaDoctorWeight=myAreaRows.reduce((sum:number,area:Any)=>sum+area.doctors,0);
  const areaCoverage=areaDoctorWeight?
    Math.round(myAreaRows.reduce((sum:number,area:Any)=>
      sum+area.coverage*area.doctors,0)/areaDoctorWeight):0;
  // The old warning lists regions below 50% coverage, not all incomplete ones.
  const needsAttention=myAreaRows.filter((area:Any)=>
    area.target>0&&area.coverage<50)
    .sort((a:Any,b:Any)=>a.coverage-b.coverage||
      a.areaName.localeCompare(b.areaName));
  const myUnvisitedA=workspace?.doctors?.unvisitedA;
  const myUnvisitedAAreas=(workspace?.doctors?.unvisitedAAreas||[])
    .filter((area:Any)=>areaIds.has(area.id))
    .map((area:Any)=>area.name);
  const personalCoverage=workspace?.doctors?.coverage;
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
        <div className="rep-dual-cycle-coverage">
          <strong>{personalCoverage!==undefined?personalCoverage+'%':'—'}</strong>
          <span>تغطية السايكل للمندوب</span>
          <small>الفريق: {team?team.coverage+'%':'—'}</small>
        </div>
        <div><strong>{remainingDays===null?'—':remainingDays}</strong>
          <span>أيام متبقية لنهاية السايكل (شامل اليوم)</span></div>
        <div><strong>{weeklyVisitsRatio}</strong><span>زيارات الأسبوع / الهدف</span></div>
        <div><strong>{workspace?.doctors?.remainingVisits??'—'}</strong>
          <span>الزيارات المتبقية للمندوب</span></div>
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
      <div className="rep-alert rep-alert-static">
        <span className="rep-alert-dot urgent" aria-hidden="true"/>
        <span><strong>{myUnvisitedA!==undefined?myUnvisitedA+' أطباء A غير مزارين':'جارٍ تحميل أطباء A...'}</strong>
          <small>{!workspace||!assignedAreas?'جارٍ تحميل المناطق...':
            myUnvisitedA===0?'لا يوجد أطباء A غير مزارين حالياً.':
            myUnvisitedAAreas.length?'موزعون على '+myUnvisitedAAreas.join('، ')+'.':
            'لا توجد مناطق محددة لهؤلاء الأطباء ضمن مناطق المندوب.'}</small></span>
      </div>
      <button type="button" className="rep-alert" onClick={()=>navigate('analysis-detail',{kind:'coverage'})}>
        <span className="rep-alert-dot warning" aria-hidden="true"/>
        <span><strong>{coverage&&assignedAreas?needsAttention.length+' مناطق بحاجة تغطية':
          'جارٍ تحميل تغطية المناطق...'}</strong>
          <small>{needsAttention.length?
            needsAttention.map((a:Any)=>a.areaName).join('، ')+' — تغطيتها أقل من 50% خلال السايكل':
            'لا توجد مناطق بتغطية أقل من 50% حالياً'}</small></span>
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
            <strong>الخطة والأصناف</strong><small>أهداف السايكل، الأصناف ذات الأولوية وتعليمات المدير.</small></span>
          <span className="rep-plan-badge">{personalCoverage!==undefined?
            personalCoverage+'% منجزة':'—'}</span>
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
  const {data:workspace,error:workspaceError}=useData('/rep-workspace-summary',refresh);
  const groupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const team=(coverage?.teamTotals||[]).find((row:Any)=>row.groupKey===groupKey);
  const allDoctors=(frequency?.items||[]).filter((row:Any)=>
    user.teamId?row.teamId===user.teamId:!row.teamId);
  const areaIds=new Set((areas||[]).map((row:Any)=>row.id));
  const areaRows=(coverage?.areas||[]).filter((row:Any)=>
    row.groupKey===groupKey&&areaIds.has(row.areaId));
  const unvisited=allDoctors.filter((row:Any)=>row.done===0);
  const unvisitedA=unvisited.filter((row:Any)=>row.grade==='A');
  const lowAreas=areaRows.filter((row:Any)=>row.target>0&&row.coverage<50);
  const targetTotal=allDoctors.reduce((sum:number,row:Any)=>sum+row.target,0);
  const achieved=allDoctors.reduce((sum:number,row:Any)=>
    sum+Math.min(row.done,row.target),0);
  const compliance=targetTotal?Math.round(achieved/targetTotal*100):0;
  const panels=[
    {kind:'frequency',icon:'🔁',title:'Frequency',subtitle:'الملتزم والمتأخر حسب عدد الزيارات'},
    {kind:'unvisited',icon:'⚠️',title:'غير مزار',subtitle:'الأطباء غير المزارين حسب المنطقة والتصنيف'},
    {kind:'coverage',icon:'📍',title:'تغطية المناطق',subtitle:'مقارنة المناطق حسب نسبة التغطية'},
    {kind:'aDoctors',icon:'⭐',title:'أطباء A',subtitle:'متابعة الأولويات الأعلى'},
    {kind:'products',icon:'💊',title:'أداء الأصناف',subtitle:'ترويج الأصناف ضمن الجولات'},
    {kind:'cycles',icon:'📈',title:'مقارنة السايكلات',subtitle:'مقارنة الدورات السابقة'}
  ];
  return <div className="rep-home rep-analytics-page">
    <div className="rep-hero rep-analytics-hero">
      <p>ملخص السايكل الحالي</p>
      <h2>التحليل</h2>
      <div className="rep-hero-metrics">
        <div><strong>{frequency?compliance+'%':'—'}</strong><span>التزام Frequency</span></div>
        <div><strong>{frequency?unvisited.length:'—'}</strong><span>طبيب غير مزار</span></div>
        <div className="rep-dual-cycle-coverage">
          <strong>{workspace?workspace.doctors.coverage+'%':'—'}</strong>
          <span>تغطية السايكل للمندوب</span>
          <small>الفريق: {team?team.coverage+'%':'—'}</small>
        </div>
        <div className="rep-dual-cycle-coverage">
          <strong>{workspace?workspace.doctors.unvisitedA:'—'}</strong>
          <span>أطباء A غير مزارين للمندوب</span>
          <small>الفريق: {frequency?unvisitedA.length:'—'}</small>
        </div>
      </div>
    </div>
    {(frequencyError||coverageError||areasError||planError||workspaceError)&&<Notice kind="error">
      تعذّر تحميل بعض التحليلات: {[frequencyError,coverageError,areasError,planError,workspaceError].filter(Boolean).join('، ')}
    </Notice>}
    <div className="rep-section-heading"><h2>اختر نوع التحليل</h2>
      <span className="muted">اضغط لعرض التفاصيل</span></div>
    <div className="rep-analysis-actions">{panels.map(item=>
      <button key={item.kind} type="button" className="rep-analysis-card"
        onClick={()=>navigate('analysis-detail',{kind:item.kind})}>
        <span aria-hidden="true">{item.icon}</span><strong>{item.title}</strong>
        <small>{item.subtitle}</small>
      </button>)}</div>
    <Section title="تنبيهات مهمة">
      <div className="rep-alerts">
        <button type="button" className="rep-alert"
          onClick={()=>navigate('analysis-detail',{kind:'aDoctors'})}>
          <span className="rep-alert-dot urgent" aria-hidden="true"/>
          <span><strong>{workspace?workspace.doctors.unvisitedA:'—'} أطباء A غير مزارين</strong>
            <small>للمندوب: {workspace?.doctors?.unvisitedA??'—'} • للفريق: {frequency?unvisitedA.length:'—'}</small></span>
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" className="rep-alert"
          onClick={()=>navigate('analysis-detail',{kind:'coverage'})}>
          <span className="rep-alert-dot warning" aria-hidden="true"/>
          <span><strong>{coverage&&areas?lowAreas.length:'—'} مناطق بحاجة تغطية</strong>
            <small>{lowAreas.length?lowAreas.map((x:Any)=>x.areaName).join('، ')+
              ' — أقل من 50%':'لا توجد مناطق بتغطية أقل من 50% حالياً'}</small></span>
          <span aria-hidden="true">←</span>
        </button>
      </div>
    </Section>
    {plan&&<p className="muted">الأصناف المسندة إليك: {plan.products.length}. يتم احتساب أداء الأصناف من الأصناف المحددة فعلياً داخل الجولات الجديدة.</p>}
  </div>;
}

function RepProductAnalysis({refresh,navigate}:Any){
  const [period,setPeriod]=useState<'cycle'|'week'|'month'>('cycle');
  const periodQuery='?period='+encodeURIComponent(period)+'&onDate='+today();
  const {data,error}=useData('/analytics/product-performance'+periodQuery,refresh);
  const [query,setQuery]=useState('');
  const [selectedProductId,setSelectedProductId]=useState<string|null>(null);
  const {data:detail,error:detailError}=useData(
    selectedProductId?'/analytics/product-performance/'+selectedProductId+periodQuery:null,refresh);
  const items=(data?.items||[]).filter((item:Any)=>
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const promoted=(data?.items||[]).filter((item:Any)=>item.promotions>0);
  function savePdf(){
    if(!data)return;
    const popup=window.open('','_blank');
    if(!popup){window.alert('المتصفح منع نافذة التقرير. اسمح بالنوافذ المنبثقة ثم حاول مرة ثانية.');return;}
    const escapeHtml=(value:Any)=>String(value??'').replace(/[&<>"']/g,(ch:string)=>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[ch]);
    const rows=(data.items||[]).map((item:Any,index:number)=>'<tr><td>'+String(index+1)+
      '</td><td>'+escapeHtml(item.name)+'</td><td>'+escapeHtml(item.promotions)+'</td><td>'+
      escapeHtml(item.quantity)+'</td><td>'+escapeHtml(item.lastPromotedAt||'—')+'</td></tr>').join('');
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'+
      '<title>Mandob - أداء الأصناف</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}'+
      'body{font-family:Tahoma,Arial,sans-serif;color:#193529;direction:rtl;line-height:1.5}'+
      'h1{color:#167c5a;margin-bottom:4px}p{color:#617568}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}'+
      '.metric{border:1px solid #d8e8dd;border-radius:8px;padding:10px}.metric b{display:block;font-size:20px;color:#167c5a}.metric span{font-size:11px}'+
      'table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #dce8df;padding:7px;text-align:right}th{background:#edf7f0}</style></head><body>'+
      '<h1>أداء الأصناف</h1><p>السايكل: '+escapeHtml(data.cycleStart)+' — '+escapeHtml(data.cycleEnd)+'</p>'+
      '<p>الفترة: '+escapeHtml(data.periodStart||'—')+' — '+escapeHtml(data.periodEnd||'—')+'</p>'+
      '<div class="metrics"><div class="metric"><b>'+escapeHtml(data.totalPromotions)+'</b><span>جولات ترويج</span></div>'+
      '<div class="metric"><b>'+escapeHtml(data.totalQuantity)+'</b><span>إجمالي الكمية الموزعة</span></div>'+
      '<div class="metric"><b>'+escapeHtml(promoted.length)+'</b><span>أصناف تم ترويجها</span></div></div>'+
      '<table><thead><tr><th>#</th><th>الصنف</th><th>جولات الترويج</th><th>الكمية الموزعة</th><th>آخر ترويج</th></tr></thead>'+
      '<tbody>'+(rows||'<tr><td colspan="5">لا توجد أصناف مسندة</td></tr>')+'</tbody></table>'+
      '<script>window.onload=function(){window.focus();window.print();}<\/script></body></html>');
    popup.document.close();
  }
  return <div className="rep-home rep-analysis-detail">
    <div className="rep-hero rep-analytics-hero rep-analysis-detail-hero">
      <button type="button" className="rep-analysis-back" onClick={()=>navigate('analytics')}>
        <span aria-hidden="true">→</span> رجوع للتحليل
      </button>
      <div className="rep-analysis-detail-title">
        <span className="rep-analysis-detail-icon" aria-hidden="true">💊</span>
        <div><p>الأصناف والكميات المسجلة على مستوى الجولة كاملة</p><h2>أداء الأصناف</h2></div>
      </div>
      <div className="rep-hero-metrics rep-analysis-detail-metrics">
        <div><strong>{data?data.totalPromotions:'—'}</strong><span>جولات ترويج</span></div>
        <div><strong>{data?data.totalQuantity:'—'}</strong><span>الكمية الموزعة</span></div>
        <div><strong>{data?promoted.length:'—'}</strong><span>أصناف تم ترويجها</span></div>
      </div>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    <Section title="فلاتر التحليل">
      <div className="rep-report-dates">
        <label className="field">الفترة
          <select value={period} onChange={event=>{
            setSelectedProductId(null);
            setPeriod(event.target.value as 'cycle'|'week'|'month');
          }}>
            <option value="cycle">السايكل الحالي</option>
            <option value="week">هذا الأسبوع</option>
            <option value="month">هذا الشهر</option>
          </select>
        </label>
      </div>
      <small>الفترة: {data?.periodStart||'—'} — {data?.periodEnd||'—'}</small>
    </Section>
    <Section title="الأصناف">
      <label className="field">بحث عن صنف
        <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="اسم الصنف"/>
      </label>
    </Section>
    {!data&&!error?<Empty text="جارٍ تحميل أداء الأصناف..."/>:
      <div className="rep-report-entries">
        {items.map((item:Any)=><button type="button"
          className="rep-report-entry rep-product-performance rep-product-performance-button"
          key={item.id} onClick={()=>setSelectedProductId(item.id)}>
          <div className="rep-entry-heading"><strong>{item.name}</strong>
            <span className="rep-plan-badge">{item.quantity} كمية</span></div>
          {!item.assigned&&<small className="muted">صنف تم ترويجه سابقاً وغير مسند حالياً</small>}
          <div className="rep-product-breakdown">
            <span>📣 {item.promotions} جولات ترويج</span>
            <span>📦 {item.quantity} كمية موزعة</span>
          </div>
          <small>آخر ترويج: {item.lastPromotedAt||'لا يوجد بعد'} • اضغط للتفاصيل</small>
        </button>)}
        {data&&!items.length&&<Empty text="لا توجد أصناف مطابقة"/>}
      </div>}
    {detailError&&<Notice kind="error">{detailError}</Notice>}
    {selectedProductId&&detail&&<Section title={'تفاصيل الصنف: '+detail.name}
      actions={<button type="button" className="btn small outline"
        onClick={()=>setSelectedProductId(null)}>إغلاق</button>}>
      <div className="stats">
        <div className="stat"><span>جولات الترويج</span><strong>{detail.promotions}</strong></div>
        <div className="stat"><span>الكمية الموزعة</span><strong>{detail.quantity}</strong></div>
      </div>
      {!detail.rows?.length?<Empty text="لا توجد جولات ترويج لهذا الصنف"/>:
        <div className="rep-report-entries">{detail.rows.map((row:Any)=>
          <div className="rep-report-entry" key={row.visitId}>
            <div className="rep-entry-heading"><strong>{row.visitDate}</strong>
              <span className="rep-plan-badge">{row.quantity} كمية</span></div>
            <small>{typeLabels[row.type]||row.type} • دقة الموقع ±{Math.round(row.locationAccuracy)} م</small>
            <small>{row.targets?.map((target:Any)=>target.name+
              (target.areaName?' — '+target.areaName:'')).join('، ')||'—'}</small>
          </div>)}</div>}
    </Section>}
    <div className="rep-report-actions">
      <button className="btn primary" type="button" onClick={savePdf} disabled={!data}>
        حفظ تحليل الأصناف PDF
      </button>
    </div>
  </div>;
}
function RepCycleComparison({refresh,navigate}:Any){
  const {data,error}=useData('/analytics/cycles',refresh);
  const items=data?.items||[];
  const current=items.find((item:Any)=>item.current)||items[0];
  const previous=items.find((item:Any)=>item!==current);
  const delta=(now:number,old:number)=>old===0?(now===0?'0':'+'+now):
    ((now-old)>=0?'+':'')+(now-old);
  return <div className="rep-home rep-analysis-detail">
    <div className="rep-hero rep-analytics-hero rep-analysis-detail-hero">
      <button type="button" className="rep-analysis-back" onClick={()=>navigate('analytics')}>
        <span aria-hidden="true">→</span> رجوع للتحليل
      </button>
      <div className="rep-analysis-detail-title">
        <span className="rep-analysis-detail-icon" aria-hidden="true">📈</span>
        <div><p>مقارنة بيانات الجولات الفعلية بين الدورات المحفوظة</p><h2>مقارنة السايكلات</h2></div>
      </div>
      <div className="rep-hero-metrics rep-analysis-detail-metrics">
        <div><strong>{current?.visits??'—'}</strong><span>جولات السايكل الحالي</span></div>
        <div><strong>{current?.targets??'—'}</strong><span>جهات مزارة</span></div>
        <div><strong>{current?.quantity??'—'}</strong><span>كمية موزعة</span></div>
      </div>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    {!data&&!error?<Empty text="جارٍ تحميل السايكلات..."/>:
      !items.length?<Empty text="لا يوجد سايكل محفوظ بعد"/>:<>
      {items.length===1&&<Notice>السايكل الحالي محفوظ. ستظهر المقارنة تلقائياً بعد وجود سايكل سابق محفوظ أو أهداف تاريخية.</Notice>}
      {current&&previous&&<Section title="الفرق عن السايكل السابق">
        <div className="stats">
          <div className="stat"><span>الجولات</span><strong>{delta(current.visits,previous.visits)}</strong></div>
          <div className="stat"><span>الجهات المزارة</span><strong>{delta(current.targets,previous.targets)}</strong></div>
          <div className="stat"><span>الأطباء المختلفون</span><strong>{delta(current.uniqueDoctors,previous.uniqueDoctors)}</strong></div>
          <div className="stat"><span>المناطق</span><strong>{delta(current.areas,previous.areas)}</strong></div>
          <div className="stat"><span>ترويج الأصناف</span><strong>{delta(current.productPromotions,previous.productPromotions)}</strong></div>
          <div className="stat"><span>الكمية</span><strong>{delta(current.quantity,previous.quantity)}</strong></div>
        </div>
      </Section>}
      <div className="rep-report-entries">{items.map((item:Any)=>
        <div className="rep-report-entry" key={item.startDate+'-'+item.endDate}>
          <div className="rep-entry-heading"><strong>{item.startDate} — {item.endDate}</strong>
            {item.current&&<span className="rep-plan-badge">الحالي</span>}</div>
          <div className="rep-product-breakdown">
            <span>🧭 {item.visits} جولات</span><span>🎯 {item.targets} جهات</span>
            <span>👨‍⚕️ {item.uniqueDoctors} أطباء</span><span>📍 {item.areas} مناطق</span>
            <span>📣 {item.productPromotions} ترويج</span><span>📦 {item.quantity} كمية</span>
          </div>
        </div>)}</div>
    </>}
  </div>;
}

function RepAnalysisDetail({refresh,user,navigate,kind}:Any){
  const [grade,setGrade]=useState('all');
  const [areaId,setAreaId]=useState('all');
  const [period,setPeriod]=useState<'cycle'|'week'|'month'>('cycle');
  const periodQuery='?period='+encodeURIComponent(period)+'&onDate='+today();
  const [aDoctorScope,setADoctorScope]=useState<'rep'|'team'>('rep');
  const {data:personalWorkspace,error:personalError}=useData(
    kind==='aDoctors'?'/rep-workspace-summary'+periodQuery:null,refresh);
  const {data:personalDoctors,error:personalDoctorsError}=useData(
    kind==='aDoctors'?'/reps/'+encodeURIComponent(user.id)+'/doctors':null,refresh);
  const {data:overview,error:overviewError}=useData('/analytics/rep-overview'+periodQuery,refresh);
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
  const personalRows=(personalDoctors||[]).filter((doctor:Any)=>doctor.grade==='A')
    .map((doctor:Any)=>{
      const done=Number(personalWorkspace?.visitCounts?.doctors?.[doctor.id]||0);
      const target=Number(personalWorkspace?.visitTargets?.doctors?.[doctor.id]||0);
      const names=doctor.doctorAreas?.length?
        doctor.doctorAreas.map((link:Any)=>link.area?.name).filter(Boolean):
        [doctor.area?.name].filter(Boolean);
      return {id:doctor.id,teamId:'personal',name:doctor.name,
        grade:doctor.grade,area:[...new Set(names)].join('، ')||'منطقة غير محددة',
        done,target,coverage:target?Math.min(100,Math.round(done/target*100)):0,
        last:personalWorkspace?.lastVisitDates?.doctors?.[doctor.id]||'ما تم الزيارة'};
    });
  const rows=(kind==='aDoctors'&&aDoctorScope==='rep'?personalRows:allDoctors)
    .filter((row:Any)=>(grade==='all'||row.grade===grade)&&matchesArea(row));
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
    const periodLabel=escapeHtml((period==='cycle'?'السايكل الحالي':
      period==='week'?'هذا الأسبوع':'هذا الشهر')+' ('+
      (frequency?.periodStart||'—')+' — '+(frequency?.periodEnd||'—')+')');
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
      escapeHtml(meta.subtitle)+'</p><p>السايكل: '+cycleLabel+'</p><p>الفترة المحددة: '+periodLabel+'</p></div>'+
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
    {kind==='aDoctors'&&<div className="rep-analysis-scope-toggle"
      role="group" aria-label="نطاق أطباء A">
      <button type="button" className={aDoctorScope==='rep'?'active':''}
        aria-pressed={aDoctorScope==='rep'} onClick={()=>setADoctorScope('rep')}>
        أطباء A للمندوب
      </button>
      <button type="button" className={aDoctorScope==='team'?'active':''}
        aria-pressed={aDoctorScope==='team'} onClick={()=>setADoctorScope('team')}>
        أطباء A للفريق
      </button>
    </div>}
    <Section title="فلاتر التحليل" actions={<button className="btn small outline"
      type="button" onClick={()=>{setGrade('all');setAreaId('all');setPeriod('cycle');}}>إعادة ضبط</button>}>
      <div className="rep-report-dates">
        <label className="field">الفترة
          <select value={period} onChange={event=>
            setPeriod(event.target.value as 'cycle'|'week'|'month')}>
            <option value="cycle">السايكل الحالي</option>
            <option value="week">هذا الأسبوع</option>
            <option value="month">هذا الشهر</option>
          </select>
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
      <p className="muted">الفترة المحددة: {frequency?.periodStart||'—'} — {frequency?.periodEnd||'—'}.
        الزيارات المحسوبة ضمن الفترة المختارة، وتُقارن بالأهداف المعتمدة للسايكل.
        يبدأ الأسبوع يوم السبت وينتهي الجمعة.</p>
    </Section>
    {(frequencyError||coverageError||areasError||personalError||personalDoctorsError)&&<Notice kind="error">
      {[frequencyError,coverageError,areasError,personalError,personalDoctorsError]
        .filter(Boolean).join('، ')}</Notice>}
    {kind==='aDoctors'&&aDoctorScope==='rep'&&
      (!personalWorkspace||!personalDoctors)&&!personalError&&!personalDoctorsError&&
      <Empty text="جارٍ تحميل زيارات أطباء A الخاصة بالمندوب..."/>}
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
      {(kind==='aDoctors'&&aDoctorScope==='rep'?
        Boolean(personalWorkspace&&personalDoctors):Boolean(frequency))&&
        !doctors.length&&<Empty text="لا توجد نتائج ضمن الفلاتر الحالية"/>}
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
      ' ('+target.area+')').join('، ')||'—')+'</td><td>'+
    escapeHtml(item.note||'—')+'</td></tr>').join('');
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
      ['المشافي',report.byType?.HOSPITAL],['متوسط يوم العمل',report.averagePerWorkingDay??'—'],
      ['تغطية السايكل',report.cycleCoverage===undefined?'—':report.cycleCoverage+'%']
    ].map(([name,value])=>'<div class="metric"><span>'+escapeHtml(name)+
      '</span><b>'+escapeHtml(value)+'</b></div>').join('')+'</div>'+
    '<p class="meta">أيام العمل في الفترة: '+escapeHtml(report.workingDays)+'</p>'+
    '<h2>تفاصيل الجولات والجهات المزارة</h2>'+
    '<table><thead><tr><th>#</th><th>التاريخ</th><th>نوع الجولة</th><th>الجهات والمنطقة وقت الزيارة</th><th>ملاحظة الجولة</th></tr></thead>'+
    '<tbody>'+(details||'<tr><td colspan="5">لم تُسجّل جولات في هذه الفترة</td></tr>')+
    '</tbody></table><p class="foot">تم إنشاء هذا التقرير من قاعدة بيانات Mandob وقت الطلب.</p></body></html>';
  popup.document.open();
  popup.onload=()=>{popup.focus();popup.print();};
  popup.document.write(content);
  popup.document.close();
}

function RepAccountHeader({title,onBack,backLabel}:Any){
  return <div className="rep-legacy-page-head rep-account-header">
    <button type="button" className="rep-account-back" onClick={onBack}
      aria-label={backLabel||'رجوع'} title={backLabel||'رجوع'}>→</button>
    <h2>{title}</h2>
  </div>;
}

function RepSavedReportDetails({report,onPrint}:Any){
  const snapshot=report?.snapshot||{};
  const rows=Array.isArray(snapshot.rows)?snapshot.rows:[];
  const [shown,setShown]=useState(15);
  return <div className="rep-legacy-saved-report rep-full-report-detail">
    <div className="rep-legacy-report-detail-title">
      <strong>تفاصيل التقرير المحفوظ</strong>
      <small>{snapshot.from||'—'} — {snapshot.to||'—'}</small>
    </div>
    <div className="rep-legacy-report-overview">
      <div><strong>{snapshot.totalTargets??0}</strong><small>الزيارات</small></div>
      <div><strong>{snapshot.tours??0}</strong><small>الجولات</small></div>
      <div><strong>{snapshot.averagePerWorkingDay??'—'}</strong><small>متوسط يوم العمل</small></div>
      <div><strong>{snapshot.cycleCoverage===undefined?'—':snapshot.cycleCoverage+'%'}</strong>
        <small>تغطية السايكل عند الإرسال</small></div>
    </div>
    <div className="rep-legacy-report-type-stats">
      <span>أطباء: <b>{snapshot.byType?.DOCTOR??0}</b></span>
      <span>صيدليات: <b>{snapshot.byType?.PHARMACY??0}</b></span>
      <span>مشافي: <b>{snapshot.byType?.HOSPITAL??0}</b></span>
    </div>
    <h4 className="rep-legacy-detail-subtitle">الجولات والجهات المزارة</h4>
    {!rows.length&&<Empty text="لا توجد جولات مسجلة ضمن هذا التقرير"/>}
    {rows.slice(0,shown).map((visit:Any,index:number)=>
      <div className="rep-legacy-report-visit" key={visit.id||index}>
        <div className="rep-legacy-activity-head">
          <strong>جولة {typeLabels[visit.type]||visit.type}</strong>
          <small>{visit.date||'—'}</small>
        </div>
        <div className="rep-legacy-visit-summary">
          {(visit.targets||[]).map((target:Any,i:number)=>
            <small key={i}>{target.name||'جهة غير مسجلة'} • {target.area||'منطقة غير مسجلة'}</small>)}
          {!visit.targets?.length&&<small>لا توجد جهات مسجلة</small>}
        </div>
        {visit.note&&<div className="visit-note-detail">
          <strong>ملاحظة الجولة</strong><p>{visit.note}</p>
        </div>}
      </div>)}
    {rows.length>shown&&<button className="btn outline rep-legacy-report-open"
      type="button" onClick={()=>setShown(value=>value+15)}>
      عرض المزيد ({rows.length-shown} جولة متبقية)
    </button>}
    <button type="button" className="btn primary rep-legacy-report-open" onClick={onPrint}>
      طباعة التقرير / حفظ PDF
    </button>
  </div>;
}

function RepReports({refresh,user,navigate}:Any){
  const [params]=useSearchParams();
  const historyMode=params.get('view')==='history';
  const [mode,setMode]=useState('weekly');
  const [range,setRange]=useState(()=>reportRange(today(),'weekly'));
  const [busy,setBusy]=useState(''),[actionError,setActionError]=useState('');
  const [success,setSuccess]=useState(''),[sentVersion,setSentVersion]=useState(0);
  const [selectedReportId,setSelectedReportId]=useState('');
  function changeMode(next:string){
    setMode(next);
    if(next!=='custom')setRange(reportRange(today(),next));
  }
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(range.from)&&
    /^\d{4}-\d{2}-\d{2}$/.test(range.to)&&range.from<=range.to;
  const query=new URLSearchParams({from:range.from,to:range.to}).toString();
  const {data,error}=useData(!historyMode&&valid?'/rep-report?'+query:null,refresh);
  const {data:sent,error:sentError}=useData('/rep-reports',String(refresh)+':'+sentVersion);
  const {data:savedReport,error:savedError}=useData(
    historyMode&&selectedReportId?'/rep-reports/'+encodeURIComponent(selectedReportId):null,refresh);
  function printSavedReport(){
    if(!savedReport)return;
    setActionError('');
    const popup=window.open('','_blank');
    try{printRepReport(popup,savedReport.snapshot,savedReport.repName);}
    catch(err:Any){popup?.close();setActionError(err.message||'تعذرت طباعة التقرير المحفوظ');}
  }
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
      setSuccess('تم حفظ التقرير في سجلك وإرساله إلى '+(user.teamId?'مدير الفريق':'إدارة الشركة')+'.');
      setSentVersion(v=>v+1);
    }catch(err:Any){setActionError(err.message||'فشل حفظ وإرسال التقرير');}
    finally{setBusy('');}
  }
  const savedList=Array.isArray(sent)?sent:[];
  const latest=savedList[0]||null;
  const typeName=mode==='weekly'?'الأسبوعي':mode==='daily'?'اليومي':'المخصص';
  if(historyMode)return <div className="rep-home rep-report-page rep-legacy-report-history">
    <RepAccountHeader title="سجل التقارير" onBack={()=>navigate('profile')}
      backLabel="الرجوع إلى حسابي"/>
    {sentError&&<Notice kind="error">{sentError}</Notice>}
    {!sent&&!sentError&&<Empty text="جارٍ تحميل التقارير المحفوظة..."/>}
    {sent&&!savedList.length&&<Empty text="ما في تقارير محفوظة أو مرسلة بعد"/>}
    {savedList.map((item:Any)=><div className="rep-legacy-activity-card" key={item.id}>
      <div className="rep-legacy-activity-head">
        <div><strong>تقرير {item.from===item.to?'يومي':'زيارات'}</strong>
          <small>{item.from} — {item.to}</small></div>
        <span className="rep-legacy-sent-badge">مرسل للمدير</span>
      </div>
      <small>{item.totalTargets??'—'} زيارة • {item.tours??'—'} جولة</small>
      <small>تاريخ الإرسال: {new Date(item.createdAt).toLocaleString('ar')}</small>
      <button type="button" className="btn outline rep-legacy-report-open"
        onClick={()=>setSelectedReportId(selectedReportId===item.id?'':item.id)}>
        {selectedReportId===item.id?'إغلاق التقرير':'عرض التقرير'}
      </button>
      {selectedReportId===item.id&&<>
        {savedError&&<Notice kind="error">{savedError}</Notice>}
        {!savedReport&&!savedError&&<Empty text="جارٍ تحميل التقرير..."/>}
        {savedReport?.id===item.id&&
          <RepSavedReportDetails key={item.id} report={savedReport} onPrint={printSavedReport}/>} 
      </>}
    </div>)}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
  </div>;
  return <div className="rep-home rep-report-page rep-legacy-reports">
    <RepAccountHeader title="التقارير" onBack={()=>navigate('dashboard')}
      backLabel="الرجوع إلى الرئيسية"/>
    <div className="rep-report-tabs rep-legacy-tabs" role="group" aria-label="نوع التقرير">
      {[
        {id:'weekly',label:'أسبوعي'},
        {id:'daily',label:'يومي'},
        {id:'custom',label:'مخصص'}
      ].map(item=><button type="button" key={item.id}
        className={mode===item.id?'active':''} aria-pressed={mode===item.id}
        onClick={()=>changeMode(item.id)}>{item.label}</button>)}
    </div>
    <div className="rep-legacy-list-card rep-legacy-range">
      <label>من تاريخ<input type="date" value={range.from}
        onChange={event=>{setMode('custom');setRange(previous=>({...previous,from:event.target.value}));}}/></label>
      <label>إلى تاريخ<input type="date" value={range.to}
        onChange={event=>{setMode('custom');setRange(previous=>({...previous,to:event.target.value}));}}/></label>
      {!valid&&<Notice kind="error">اختر فترة بداية ونهاية صحيحة للتقرير.</Notice>}
      {error&&<Notice kind="error">{error}</Notice>}
    </div>
    <div className="rep-medical-stats rep-legacy-stats-row">
      {[
        {label:'أطباء',number:data?.byType?.DOCTOR},
        {label:'صيدليات',number:data?.byType?.PHARMACY},
        {label:'مشافي',number:data?.byType?.HOSPITAL}
      ].map(item=><div key={item.label}><strong>{data?item.number:'—'}</strong>
        <small>{item.label}</small></div>)}
    </div>
    <div className="rep-report-preview rep-legacy-report-preview">
      <div className="rep-legacy-activity-head">
        <strong>معاينة التقرير {typeName}</strong>
        <span className="rep-legacy-sent-badge">
          {data?'جاهز':'بانتظار البيانات'}</span>
      </div>
      <p>{data?data.totalTargets+' زيارة • متوسط '+(data.averagePerWorkingDay??0)+
        ' في يوم العمل • تغطية السايكل '+data.cycleCoverage+'% • '+
        data.tours+' جولة':'جارٍ تحميل التقرير...'}</p>
      <small>{range.from} — {range.to}</small>
    </div>
    <div className="rep-legacy-list-card rep-legacy-average-card">
      <div className="rep-legacy-activity-head">
        <strong>المتوسط {mode==='weekly'?'الأسبوعي':mode==='daily'?'اليومي':'للفترة'}</strong>
        <strong>{data?data.totalTargets+' زيارة':'—'}</strong>
      </div>
      <small>متوسط {data?.averagePerWorkingDay??'—'} زيارة يومياً خلال {data?.workingDays??'—'} يوم عمل.</small>
    </div>
    <div className="rep-report-actions rep-legacy-dual-actions">
      <button className="btn outline" type="button" disabled={!data||!valid||Boolean(busy)}
        onClick={printDetailed}>
        {busy==='print'?'جارٍ تجهيز التقرير...':'تنزيل PDF'}
      </button>
      <button className="btn primary" type="button" disabled={!data||!valid||Boolean(busy)}
        onClick={sendReport}>
        {busy==='send'?'جارٍ الإرسال...':'حفظ وإرسال للمدير'}
      </button>
    </div>
    <small className="muted">لتنزيل التقرير اختر «حفظ بتنسيق PDF» من نافذة الطباعة.</small>
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    {success&&<Notice kind="success">{success}</Notice>}
    <div className="rep-legacy-section-title">
      <h3>آخر التقارير المحفوظة</h3>
      <button type="button" onClick={()=>navigate('reports',{view:'history'})}>عرض السجل</button>
    </div>
    {sentError&&<Notice kind="error">{sentError}</Notice>}
    {!sent&&!sentError&&<Empty text="جارٍ تحميل التقارير..."/>}
    {sent&&!latest&&<Empty text="لم يتم حفظ أي تقارير بعد"/>}
    {latest&&<div className="rep-legacy-activity-card">
      <div className="rep-legacy-activity-head">
        <div><strong>تقرير زيارات محفوظ</strong>
          <small>{latest.from} — {latest.to}</small></div>
        <span className="rep-legacy-sent-badge">مرسل</span>
      </div>
      <small>{latest.totalTargets??'—'} زيارة • {latest.tours??'—'} جولة</small>
      <small>أُرسل بتاريخ {new Date(latest.createdAt).toLocaleString('ar')}</small>
      <button type="button" className="btn outline rep-legacy-report-open"
        onClick={()=>navigate('reports',{view:'history'})}>عرض التقرير</button>
    </div>}
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
        {' '}• مشافي: {details.snapshot.byType?.HOSPITAL||0} • تغطية السايكل:
        {' '}{details.snapshot.cycleCoverage===undefined?'—':details.snapshot.cycleCoverage+'%'}</small>
      <button type="button" className="btn primary" onClick={printSubmitted}>
        طباعة التقرير / حفظ PDF</button>
      {printError&&<Notice kind="error">{printError}</Notice>}
    </div>}
  </Section>;
}
function RepPlanProducts({refresh,user,navigate}:Any){
  const {data:plan,error:planError}=useData('/rep-plan',refresh);
  const {data:workspace,error:workspaceError}=useData('/rep-workspace-summary',refresh);
  const {data:settings,error:settingsError}=useData('/settings',refresh);
  const {data:weekly,error:weeklyError}=useData(
    '/weekly-visits-count?repId='+encodeURIComponent(user.id)+'&onDate='+today(),refresh);
  const cycleEnd=String(settings?.cycleEnd||'').slice(0,10);
  const remainingDays=cycleEnd&&Number.isFinite(Date.parse(cycleEnd+'T00:00:00Z'))?
    Math.max(0,Math.floor((Date.parse(cycleEnd+'T00:00:00Z')-
      Date.parse(today()+'T00:00:00Z'))/86400000)+1):null;
  const coverage=workspace?.doctors?.coverage;
  const workingDayCount=Array.isArray(settings?.workingDays)?
    new Set(settings.workingDays).size:null;
  const weeklyTarget=plan&&workingDayCount!==null?
    Number(plan.dailyTarget)*workingDayCount:null;
  const weeklyDone=weekly?.count??null;
  const gradeATotal=Number(workspace?.doctors?.gradeA||0);
  const gradeAVisited=gradeATotal-Number(workspace?.doctors?.unvisitedA||0);
  const gradeACoverage=gradeATotal?Math.round(gradeAVisited/gradeATotal*100):0;
  const targetACoverage=Number(plan?.targetACoverage??80);
  const priorityLabels:Record<string,string>={
    PRIMARY:'أولوية أولى',SECONDARY:'أولوية ثانية',SUPPORT:'داعم'};
  return <div className="rep-home rep-plan-legacy-page">
    <div className="rep-legacy-page-head">
      <h2>الخطة</h2>
      <button type="button" className="rep-legacy-back"
        onClick={()=>navigate('dashboard')}>← الرجوع للرئيسية</button>
    </div>
    <div className="rep-hero rep-plan-cycle-hero">
      <p>السايكل الحالي</p>
      <h2>{settings?.cycleStart&&settings?.cycleEnd?
        String(settings.cycleStart).slice(0,10)+' — '+cycleEnd:'جارٍ تحميل الدورة...'}</h2>
      <div className="rep-hero-metrics rep-plan-cycle-metrics">
        <div><strong>{coverage!==undefined?coverage+'%':'—'}</strong>
          <span>التغطية</span></div>
        <div><strong>{remainingDays===null?'—':remainingDays+' أيام'}</strong>
          <span>المتبقي</span></div>
      </div>
    </div>
    {(planError||workspaceError||settingsError||weeklyError)&&<Notice kind="error">
      تعذّر تحميل بعض بيانات الخطة: {[planError,workspaceError,settingsError,weeklyError]
        .filter(Boolean).join('، ')}
    </Notice>}
    <div className="rep-section-heading rep-plan-section-heading">
      <h2>أصنافي</h2>
      <span className="muted">{plan?plan.products.length+' أصناف':'—'}</span>
    </div>
    {!plan&&!planError?<Empty text="جارٍ تحميل الأصناف..."/>:
      plan?.products?.length?<div className="rep-product-list rep-plan-products-list">
        {plan.products.map((p:Any)=>
          <div className="rep-legacy-product-card" key={p.id}>
            <span className="rep-plan-product-copy"><strong>{p.name}</strong>
              <small>{p.targetSpecialties?.length?
                p.targetSpecialties.join(' • '):
                p.activeIngredient||'الاختصاصات المستهدفة غير محددة'}</small></span>
            <span className={'rep-priority-badge '+(p.priority||'SUPPORT')}>
              {priorityLabels[p.priority]||priorityLabels.SUPPORT}</span>
          </div>)}
      </div>:<Empty text="لا توجد أصناف مسندة لحسابك حالياً"/>}
    <div className="rep-section-heading rep-plan-section-heading"><h2>أهدافي</h2></div>
    <div className="rep-legacy-list-card rep-plan-legacy-goal-card">
      <div className="rep-plan-legacy-goal-header">
        <strong>الزيارات الأسبوعية</strong><strong>{weeklyTarget??'—'}</strong>
      </div>
      <p>المنجز حالياً {weeklyDone??'—'} زيارة.</p>
    </div>
    <div className="rep-legacy-list-card rep-plan-legacy-goal-card">
      <div className="rep-plan-legacy-goal-header">
        <strong>تغطية أطباء A</strong><strong>{targetACoverage}%</strong>
      </div>
      <p>المطلوب خلال السايكل الحالي.
        {workspace?' المنجز '+gradeACoverage+'% ('+gradeAVisited+' من '+gradeATotal+' طبيب).':''}
      </p>
    </div>
    <div className="rep-section-heading rep-plan-section-heading">
      <h2>تعليمات المدير</h2>
    </div>
    <div className="rep-legacy-company-note">
      {plan?.managerInstructions||'لا توجد تعليمات جديدة من المدير حالياً.'}
    </div>
  </div>;
}
function RepProfile({user,navigate,onLogout,refresh}:Any){
  const {data:plan}=useData('/rep-plan',refresh);
  const actions=[
    {id:'visits',title:'سجل الزيارات',caption:'الجولات والزيارات المسجلة'},
    {id:'reports',query:{view:'history'},title:'سجل التقارير',
      caption:'المحفوظة والمرسلة إلى المدير'},
    {id:'new-leave',title:'الإجازات',caption:'طلب جديد ومتابعة الطلبات'},
    {id:'rep-settings',title:'الإعدادات',caption:'الإشعارات واللغة'}
  ];
  return <div className="rep-home rep-profile-page rep-legacy-account-page">
    <RepAccountHeader title="حسابي" onBack={()=>navigate('dashboard')}
      backLabel="الرجوع إلى الرئيسية"/>
    <div className="rep-legacy-list-card rep-legacy-account-identity">
      <strong>{user.name}</strong>
      <small>مندوب طبي{user.teamId?' • '+(plan?.teamName||'فريق غير محدد'):''}</small>
    </div>
    <div className="rep-legacy-profile-links">
      {actions.map(item=><button type="button" key={item.id}
        className="rep-legacy-profile-link"
        onClick={()=>navigate(item.id,item.query)}>
        <span><strong>{item.title}</strong><small>{item.caption}</small></span>
        <span className="rep-legacy-profile-arrow" aria-hidden="true">←</span>
      </button>)}
    </div>
    <button type="button" className="btn outline rep-legacy-account-logout"
      onClick={onLogout}>تسجيل الخروج</button>
  </div>;
}

function RepVisitHistory({refresh,navigate}:Any){
  const [typeFilter,setTypeFilter]=useState('');
  const [page,setPage]=useState(0);
  const [opened,setOpened]=useState('');
  const query=new URLSearchParams({limit:'50',offset:String(page*50)});
  if(typeFilter)query.set('type',typeFilter);
  const {data,error}=useData('/visits?'+query.toString(),refresh);
  function visitAreaNames(visit:Any){
    const names=[...new Set<string>((visit.targets||[]).map((target:Any)=>
      String(target.areaNameAtVisit||'').trim()).filter(Boolean))];
    return names.join('، ')||'منطقة غير مسجلة';
  }
  return <div className="rep-home rep-legacy-visit-history">
    <RepAccountHeader title="سجل الزيارات" onBack={()=>navigate('profile')}
      backLabel="الرجوع إلى حسابي"/>
    <div className="rep-legacy-tabs rep-legacy-visit-tabs" role="group" aria-label="نوع الجولة">
      {[{id:'',label:'الكل'},{id:'DOCTOR',label:'أطباء'},
        {id:'PHARMACY',label:'صيدليات'},{id:'HOSPITAL',label:'مشافي'}]
        .map(item=><button key={item.id||'all'} type="button"
          aria-pressed={typeFilter===item.id} className={typeFilter===item.id?'active':''}
          onClick={()=>{setTypeFilter(item.id);setPage(0);setOpened('');}}>
          {item.label}
        </button>)}
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    {!data&&!error&&<Empty text="جارٍ تحميل سجل الزيارات..."/>}
    {data&&!data.length&&<Empty text="لم يتم تسجيل جولات ضمن هذا النوع بعد"/>}
    {(data||[]).map((visit:Any)=><div className="rep-legacy-activity-card" key={visit.id}>
      <div className="rep-legacy-activity-head">
        <div><strong>جولة {typeLabels[visit.type]||visit.type}</strong>
          <small>{String(visit.visitDate||'').slice(0,10)}</small></div>
        <span className="rep-legacy-sent-badge">مكتملة</span>
      </div>
      <div className="rep-legacy-visit-summary">
        <small>📍 {visitAreaNames(visit)}</small>
        <small>{(visit.targets||[]).map((target:Any)=>target.name).join('، ')||
          'لا توجد جهات مسجلة'}</small>
        {Boolean(visit.products?.length)&&<small>
          {visit.products.map((product:Any)=>product.name).filter(Boolean).join('، ')}
        </small>}
      </div>
      <button type="button" className="btn outline rep-legacy-report-open"
        onClick={()=>setOpened(previous=>previous===visit.id?'':visit.id)}>
        {opened===visit.id?'إغلاق التفاصيل':'عرض التفاصيل'}
      </button>
      {opened===visit.id&&<div className="rep-legacy-saved-report rep-full-visit-detail">
        <div className="rep-legacy-activity-head">
          <strong>تفاصيل جولة {typeLabels[visit.type]||visit.type}</strong>
          <small>{visit.visitDate||'—'}</small>
        </div>
        <div className="rep-legacy-visit-summary">
          <small>📍 {visitAreaNames(visit)}</small>
          <small>{(visit.targets||[]).length} جهة مزارة</small>
        </div>
        <h4 className="rep-legacy-detail-subtitle">الجهات المزارة</h4>
        {(visit.targets||[]).map((target:Any,index:number)=>
          <div key={target.id||index} className="rep-legacy-setting-row">
            <span>{target.name}</span>
            <small>{target.areaNameAtVisit||'منطقة غير مسجلة'}</small>
          </div>)}
        <h4 className="rep-legacy-detail-subtitle">الأصناف المذكورة في الجولة</h4>
        {!visit.products?.length?<small>لا توجد أصناف مسجلة</small>:
          visit.products.map((product:Any)=><div className="rep-legacy-setting-row"
            key={product.id}>
            <span>{product.name||'صنف غير متاح'}</span>
            <small>الكمية {product.quantity}</small>
          </div>)}
        {visit.note&&<div className="visit-note-detail">
          <h4 className="rep-legacy-detail-subtitle">ملاحظة الجولة</h4>
          <p>{visit.note}</p>
        </div>}
      </div>}
    </div>)}
    {data&&<div className="rep-medical-pagination">
      <button type="button" className="btn small outline" disabled={page===0}
        onClick={()=>{setPage(v=>Math.max(0,v-1));setOpened('');}}>السابقة</button>
      <span>الصفحة {page+1}</span>
      <button type="button" className="btn small outline" disabled={data.length<50}
        onClick={()=>{setPage(v=>v+1);setOpened('');}}>التالية</button>
    </div>}
  </div>;
}

const LEAVE_ATTACHMENT_MAX_BYTES=2*1024*1024;
async function encodeLeaveAttachment(file:File){
  if(file.size===0||file.size>LEAVE_ATTACHMENT_MAX_BYTES)
    throw Error('حجم المرفق يجب أن يكون بين 1 بايت و2 ميغابايت');
  if(!['application/pdf','image/jpeg','image/png'].includes(file.type)||
     !/\.(pdf|jpe?g|png)$/i.test(file.name))
    throw Error('اختر ملف PDF أو JPG أو PNG');
  const result=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(Error('تعذر قراءة المرفق'));
    reader.readAsDataURL(file);
  });
  return {fileName:file.name,mimeType:file.type,base64:result.split(',')[1]||''};
}
function RepLeaves({refresh,onSaved,navigate}:Any){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [version,setVersion]=useState(0);
  const {data:leaves,error:listError}=useData('/leaves?limit=100&offset=0',
    String(refresh)+':'+version);
  const {data:balance,error:balanceError}=useData('/rep-leave-balance',
    String(refresh)+':'+version);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy)return;
    const form=e.currentTarget;
    const fd=new FormData(form);
    const fromDate=val(fd,'fromDate'),toDate=val(fd,'toDate');
    if(!fromDate||!toDate||fromDate>toDate){
      setError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');return;
    }
    setBusy(true);setError('');setSuccess('');
    try{
      const attachmentFile=fd.get('attachment');
      const attachment=attachmentFile instanceof File&&attachmentFile.size?
        await encodeLeaveAttachment(attachmentFile):undefined;
      await post('/leaves',{type:val(fd,'type'),fromDate,toDate,
        reason:val(fd,'reason'),...(attachment?{attachment}:{})});
      form.reset();
      setSuccess('تم إرسال طلب الإجازة للمدير');
      setVersion(v=>v+1);
      onSaved();
    }catch(err:Any){setError(err.message||'تعذر إرسال طلب الإجازة');}
    finally{setBusy(false);}
  }
  const statuses:Record<string,string>={PENDING:'قيد المراجعة',
    APPROVED:'مقبولة',REJECTED:'مرفوضة'};
  return <div className="rep-home rep-legacy-leave-page">
    <RepAccountHeader title="طلب إجازة" onBack={()=>navigate('profile')}
      backLabel="الرجوع إلى حسابي"/>
    <form className="rep-legacy-soft-panel" onSubmit={submit}>
      <label>نوع الإجازة
        <select name="type" required>
          {['سنوية','مرضية','إسعافية','بدون أجر'].map(value=>
            <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <div className="rep-report-dates">
        <label>من تاريخ<input type="date" name="fromDate" required/></label>
        <label>إلى تاريخ<input type="date" name="toDate" required/></label>
      </div>
      <label>السبب أو الملاحظة
        <textarea name="reason" rows={4} placeholder="اكتب ملاحظة مختصرة للمدير"/>
      </label>
      <label className="rep-legacy-attachment-field">مرفق اختياري
        <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/>
        <small>PDF أو JPG أو PNG • الحجم الأقصى 2 ميغابايت • يظهر للمدير المخوّل فقط.</small>
      </label>
      <div className="rep-legacy-leave-balance">
        <span>رصيد الإجازة السنوية</span>
        <strong>{balance?balance.remaining+' أيام متبقية':balanceError?
          'تعذر حساب الرصيد':'جارٍ الحساب...'}</strong>
      </div>
      {balance&&<small className="rep-legacy-leave-balance-detail">
        الرصيد السنوي {balance.annual} يوم • المستخدم {balance.used} يوم عمل خلال {balance.year}
      </small>}
      {balanceError&&<Notice kind="error">{balanceError}</Notice>}
      <button type="submit" className="btn primary" disabled={busy}>
        {busy?'جارٍ إرسال الطلب...':'إرسال الطلب للمدير'}
      </button>
      {error&&<Notice kind="error">{error}</Notice>}
      {success&&<Notice kind="success">{success}</Notice>}
    </form>
    <div className="rep-legacy-section-title"><h3>طلباتي السابقة</h3></div>
    {listError&&<Notice kind="error">{listError}</Notice>}
    {!leaves&&!listError&&<Empty text="جارٍ تحميل الإجازات..."/>}
    {leaves&&!leaves.length&&<Empty text="لم تقدم طلب إجازة بعد"/>}
    {(leaves||[]).map((leave:Any)=><div className="rep-legacy-activity-card" key={leave.id}>
      <div className="rep-legacy-activity-head">
        <div><strong>إجازة {leave.type}</strong>
          <small>{String(leave.fromDate).slice(0,10)} — {String(leave.toDate).slice(0,10)}</small></div>
        <span className={'rep-legacy-leave-badge '+leave.status}>
          {statuses[leave.status]||leave.status}</span>
      </div>
      {leave.reason&&<small>{leave.reason}</small>}
      {leave.attachment&&<a className="rep-legacy-attachment-link"
        href={'/api/leaves/'+encodeURIComponent(leave.id)+'/attachment'}>
        📎 {leave.attachment.fileName} • عرض المرفق
      </a>}
    </div>)}
    {leaves?.length===100&&<p className="muted">تُعرض أحدث 100 طلب إجازة.</p>}
  </div>;
}

function RepAccountSettings({user,navigate}:Any){
  return <div className="rep-home rep-legacy-account-settings">
    <RepAccountHeader title="الإعدادات" onBack={()=>navigate('profile')}
      backLabel="الرجوع إلى حسابي"/>
    <div className="rep-legacy-list-card">
      <strong>معلومات الحساب</strong>
      <div className="rep-legacy-setting-row"><span>اسم المندوب</span><strong>{user.name}</strong></div>
      <div className="rep-legacy-setting-row"><span>اسم المستخدم</span><strong>{user.username}</strong></div>
    </div>
    <div className="rep-legacy-list-card">
      <strong>تفضيلات الواجهة</strong>
      <div className="rep-legacy-setting-row"><span>اللغة</span><strong>العربية</strong></div>
      <small>تغيير اللغة وإعدادات إشعارات المندوب غير مدعومين حالياً.</small>
    </div>
  </div>;
}

function RepMedicalDirectory({kind,refresh,user,onBeginTour,navigate}:Any){
  const type=kind==='doctors'?'DOCTOR':kind==='pharmacies'?'PHARMACY':'HOSPITAL';
  const title=kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي';
  const singular=kind==='doctors'?'الطبيب':kind==='pharmacies'?'الصيدلية':'المشفى';
  const emoji=kind==='doctors'?'👨‍⚕️':kind==='pharmacies'?'💊':'🏥';
  const [search,setSearch]=useState('');
  const [initialFilters]=useState(()=>loadStoredTourFilters(user.id,type));
  const [areaId,setAreaId]=useState(()=>{
    try{return window.localStorage.getItem('mandob:directory-area:'+user.id+':'+type)||'';}
    catch{return '';}
  });
  const [grades,setGrades]=useState<string[]>(initialFilters.grades);
  const [categoriesSelected,setCategoriesSelected]=useState<string[]>(initialFilters.categories);
  const [specialtiesSelected,setSpecialtiesSelected]=useState<string[]>(initialFilters.specialties);
  const [unvisitedOnly,setUnvisitedOnly]=useState(initialFilters.unvisitedOnly);
  const [filterOpen,setFilterOpen]=useState(false);
  const [page,setPage]=useState(0);
  const pageSize=50;
  useEffect(()=>{
    try{
      window.localStorage.setItem('mandob:tour-filters:'+user.id+':'+type,
        JSON.stringify({grades,specialties:specialtiesSelected,
          categories:categoriesSelected,unvisitedOnly}));
      window.localStorage.setItem('mandob:directory-area:'+user.id+':'+type,areaId);
    }catch{/* Private browsing may disable localStorage. */}
  },[user.id,type,grades,specialtiesSelected,categoriesSelected,unvisitedOnly,areaId]);
  useEffect(()=>setPage(0),[grades,specialtiesSelected,categoriesSelected,unvisitedOnly]);
  const {data:areas,error:areaError}=useData('/areas',refresh);
  const {data:workspace,error:workspaceError}=useData('/rep-workspace-summary',refresh);
  const {data:specialtyOptions}=useData(type==='PHARMACY'?null:'/specialties',refresh);
  // Load the representative-authorized directory once before filtering; applying
  // client filters after server pagination incorrectly misses later-page matches.
  // Paginate the filtered result rather than the unfiltered API window.
  const params=new URLSearchParams();
  if(search.trim())params.set('search',search.trim());
  if(areaId)params.set('areaId',areaId);
  const {data,error}=useData('/'+kind+'?'+params.toString(),refresh);
  const visitCounts=workspace?.visitCounts?.[kind]||{};
  const lastVisitDates=workspace?.lastVisitDates?.[kind]||{};
  const visitTargets=workspace?.visitTargets?.[kind]||{};
  const visitedCount=(item:Any)=>Number(visitCounts[item.id]||0);
  const visitTarget=(item:Any)=>Number(visitTargets[item.id]??item.target??0);
  const lastVisit=(item:Any)=>lastVisitDates[item.id]||'ما تم الزيارة';
  const needsVisit=(item:Any)=>kind==='hospitals'?
    visitedCount(item)<Math.max(1,visitTarget(item)):visitedCount(item)===0;
  const specialties=[...new Set<string>([...(specialtyOptions||[]),
    ...(data||[]).map((item:Any)=>String(item.specialty||'').trim())
  ].filter((value:string)=>Boolean(value)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const categories=kind==='pharmacies'?['مستقلة','نقابية','مستوصف','مشفى','حكومية']:
    kind==='hospitals'?['حكومي','خاص','تخصصي','مركز طبي']:[];
  const shown=(data||[]).filter((item:Any)=>
    (!grades.length||grades.includes(item.grade))&&
    (!categoriesSelected.length||categoriesSelected.includes(
      String(kind==='pharmacies'?item.kind:item.category||'')))&&
    (!specialtiesSelected.length||specialtiesSelected.includes(item.specialty))&&
    (!unvisitedOnly||(workspace&&needsVisit(item))));
  const visiblePage=shown.slice(page*pageSize,(page+1)*pageSize);
  const totalPages=Math.max(1,Math.ceil(shown.length/pageSize));
  const summary=workspace?.[kind];
  const gradeALabel=kind==='doctors'?'أطباء A':kind==='pharmacies'?'فئة A':'مشفى خاص';
  const gradeACount=kind==='hospitals'?summary?.privateCount:summary?.gradeA;
  const secondLabel=kind==='hospitals'?'بحاجة زيارة':
    kind==='pharmacies'?'غير مزارة':'غير مزار';
  const secondCount=kind==='hospitals'?summary?.needsVisit:summary?.unvisited;
  const areaLabel=(areas||[]).find((a:Any)=>a.id===areaId)?.name||'منطقة محددة';
  const activeFilters=[
    ...grades.map(value=>({kind:'grade',value,label:'تصنيف '+value})),
    ...categoriesSelected.map(value=>({kind:'category',value,label:value})),
    ...specialtiesSelected.map(value=>({kind:'specialty',value,label:value})),
    ...(unvisitedOnly?[{kind:'status',value:'unvisited',label:secondLabel}]:[]),
    ...(areaId?[{kind:'area',value:areaId,label:areaLabel}]:[])
  ];
  const linkedAreaNames=(item:Any)=>kind==='doctors'&&item.doctorAreas?.length?
    [...new Set(item.doctorAreas.map((link:Any)=>link.area?.name).filter(Boolean))].join('، '):
    item.area?.name||'منطقة غير محددة';
  function resetFilters(){
    setSearch('');setAreaId('');setGrades([]);setCategoriesSelected([]);
    setSpecialtiesSelected([]);setUnvisitedOnly(false);setPage(0);setFilterOpen(false);
  }
  function toggleOption(value:string,setter:Any){
    setter((current:string[])=>current.includes(value)?
      current.filter(item=>item!==value):[...current,value]);
  }
  function removeFilter(kind:string,value:string){
    if(kind==='grade')setGrades(old=>old.filter(x=>x!==value));
    if(kind==='category')setCategoriesSelected(old=>old.filter(x=>x!==value));
    if(kind==='specialty')setSpecialtiesSelected(old=>old.filter(x=>x!==value));
    if(kind==='status')setUnvisitedOnly(false);
    if(kind==='area')setAreaId('');
    setPage(0);
  }
  return <div className="rep-medical-page rep-legacy-directory">
    <div className="rep-legacy-page-head">
      <h2>{title}</h2>
      <button className="rep-legacy-back" type="button"
        onClick={()=>navigate('dashboard')}>← الرجوع للرئيسية</button>
    </div>
    <div className={'rep-medical-hero rep-legacy-entity-hero '+kind}>
      <div><h2>دليل {title}</h2>
        <p>{kind==='doctors'?'ابحث وصنّف واختر زياراتك القادمة بسهولة.':
          kind==='pharmacies'?'الصيدليات ضمن مناطقك وتصنيفات الأولوية.':
          'المشافي العامة والخاصة والمراكز التخصصية ضمن مناطقك.'}</p>
      </div>
      <span aria-hidden="true" className="rep-medical-hero-icon">{emoji}</span>
    </div>
    <div className="rep-medical-stats rep-legacy-stats-row">
      <div><strong>{summary?.total??'—'}</strong><small>إجمالي {title}</small></div>
      <div><strong>{secondCount??'—'}</strong><small>{secondLabel}</small></div>
      <div><strong>{gradeACount??'—'}</strong><small>{gradeALabel}</small></div>
    </div>
    {(error||areaError||workspaceError)&&<Notice kind="error">
      {[error,areaError,workspaceError].filter(Boolean).join('، ')}
    </Notice>}
    <div className="rep-legacy-search-bar">
      <input aria-label={'بحث عن '+singular} value={search}
        onChange={event=>{setSearch(event.target.value);setPage(0);}}
        placeholder={'ابحث باسم '+singular+' أو الاختصاص أو المنطقة'}/>
    </div>
    <div className="rep-legacy-filter-toolbar">
      <button type="button" className="rep-filter-toggle"
        onClick={()=>setFilterOpen(true)}>
        ⚙️ الفلاتر {activeFilters.length?'('+activeFilters.length+')':''}
      </button>
      {Boolean(activeFilters.length||search)&&<button type="button" className="rep-filter-clear"
        onClick={resetFilters}>↻ إعادة الضبط</button>}
    </div>
    {activeFilters.length>0&&<div className="rep-active-filters">
      {activeFilters.map(filter=><button key={filter.kind+':'+filter.value}
        type="button" aria-label={'إزالة فلتر '+filter.label}
        onClick={()=>removeFilter(filter.kind,filter.value)}>
        {filter.label} ×
      </button>)}
    </div>}
    {!data&&!error?<Empty text={'جارٍ تحميل '+title+'...'}/>:
      !shown.length?<Empty text="لا توجد نتائج ضمن الفلاتر الحالية"/>:
      <div className="rep-medical-list">{visiblePage.map((item:Any)=>
        <div className="rep-medical-card" key={item.id}>
          <div className="rep-medical-card-head">
            <span className="rep-medical-mini-icon" aria-hidden="true">{emoji}</span>
            <span><strong>{item.name}</strong>
              <small>{item.specialty||item.kind||item.category||'—'}</small></span>
            {item.grade&&<span className={'rep-grade rep-grade-'+item.grade}>{item.grade}</span>}
          </div>
          <div className="rep-medical-meta">📍 {linkedAreaNames(item)}</div>
          {workspace&&<div className="rep-legacy-cycle-visits">
            <div className="rep-legacy-visit-status">
              <span className={needsVisit(item)?'pending':'visited'}>
                {needsVisit(item)?secondLabel:'تمت الزيارة'}
              </span>
            </div>
            <div className="rep-legacy-cycle-last">
              <small>آخر زيارة بالسايكل:</small>
              <strong>{lastVisit(item)}</strong>
            </div>
            <div className="rep-legacy-cycle-count">
              <small>زيارات السايكل:</small>
              <strong>{visitedCount(item)} من {visitTarget(item)}</strong>
            </div>
            {visitTarget(item)>0&&<div className="rep-legacy-cycle-progress"
              role="progressbar" aria-label="نسبة زيارات السايكل"
              aria-valuemin={0} aria-valuemax={visitTarget(item)}
              aria-valuenow={Math.min(visitedCount(item),visitTarget(item))}>
              <span style={{width:Math.min(100,
                Math.round(visitedCount(item)/visitTarget(item)*100))+'%'}}/>
            </div>}
          </div>}
        </div>)}</div>}
    <div className="rep-medical-pagination">
      <button className="btn small outline" type="button" disabled={page===0}
        onClick={()=>setPage(v=>Math.max(0,v-1))}>السابقة</button>
      <span>الصفحة {page+1} من {totalPages} • {shown.length} نتيجة</span>
      <button className="btn small outline" type="button"
        disabled={!data||page>=totalPages-1}
        onClick={()=>setPage(v=>v+1)}>التالية</button>
    </div>
    {filterOpen&&<div className="rep-filter-layer" role="presentation">
      <button type="button" className="rep-filter-overlay" aria-label="إغلاق الفلاتر"
        onClick={()=>setFilterOpen(false)}/>
      <div className="rep-filter-sheet" role="dialog" aria-modal="true"
        aria-label={'فلترة '+title}>
        <div className="rep-filter-sheet-head">
          <strong>فلترة {title}</strong>
          <button type="button" onClick={()=>setFilterOpen(false)} aria-label="إغلاق">✕</button>
        </div>
        <label className="rep-filter-label">المنطقة
          <select value={areaId} onChange={e=>{setAreaId(e.target.value);setPage(0);}}>
            <option value="">كل المناطق</option>
            {(areas||[]).map((area:Any)=><option key={area.id} value={area.id}>
              {area.name}</option>)}
          </select>
        </label>
        {kind!=='hospitals'&&<div className="rep-filter-section">
          <strong>التصنيف</strong>
          <div className="rep-grade-chips">
            <button type="button" className={!grades.length?'active':''}
              aria-pressed={!grades.length} onClick={()=>setGrades([])}>الكل</button>
            {['A','B','C'].map(value=><button key={value} type="button"
              className={grades.includes(value)?'active':''}
              aria-pressed={grades.includes(value)}
              onClick={()=>toggleOption(value,setGrades)}>{value}</button>)}
          </div>
        </div>}
        {categories.length>0&&<div className="rep-filter-section">
          <strong>{kind==='hospitals'?'نوع المنشأة':'التبعية'}</strong>
          <div className="rep-legacy-category-options">
            <button type="button" className={!categoriesSelected.length?'active':''}
              aria-pressed={!categoriesSelected.length}
              onClick={()=>setCategoriesSelected([])}>الكل</button>
            {categories.map(value=><button type="button" key={value}
              className={categoriesSelected.includes(value)?'active':''}
              aria-pressed={categoriesSelected.includes(value)}
              onClick={()=>toggleOption(value,setCategoriesSelected)}>{value}</button>)}
          </div>
        </div>}
        {kind!=='pharmacies'&&<div className="rep-filter-section">
          <strong>الاختصاص</strong>
          <div className="rep-legacy-category-options">
            <button type="button" className={!specialtiesSelected.length?'active':''}
              aria-pressed={!specialtiesSelected.length}
              onClick={()=>setSpecialtiesSelected([])}>كل الاختصاصات</button>
          </div>
          <div className="rep-tour-specialties">
            {specialties.map(value=><label className="rep-legacy-check" key={value}>
              <input type="checkbox" checked={specialtiesSelected.includes(value)}
                onChange={()=>toggleOption(value,setSpecialtiesSelected)}/>
              <span>{value}</span>
            </label>)}
          </div>
        </div>}
        <label className="rep-legacy-check">
          <input type="checkbox" checked={unvisitedOnly} disabled={!workspace}
            onChange={e=>setUnvisitedOnly(e.target.checked)}/>
          <span>{secondLabel} فقط</span>
        </label>
        <div className="rep-filter-sheet-actions">
          <button className="btn outline" type="button" onClick={resetFilters}>إعادة الضبط</button>
          <button className="btn primary" type="button"
            onClick={()=>{setPage(0);setFilterOpen(false);}}>عرض النتائج</button>
        </div>
      </div>
    </div>}
  </div>;
}



const teamManagerPageMeta:Record<string,{title:string,subtitle:string,icon:string}>={
  users:{title:'إدارة الفريق',subtitle:'متابعة أعضاء الفريق وتوزيع المناطق والاختصاصات',icon:'👥'},
  doctors:{title:'الأطباء',subtitle:'كل الأطباء المسندين إلى فريقك ومناطق العمل التابعة له',icon:'🩺'},
  pharmacies:{title:'الصيدليات',subtitle:'متابعة الصيدليات التابعة لمناطق الفريق وحالتها الحالية',icon:'💊'},
  hospitals:{title:'المشافي والمراكز',subtitle:'متابعة المشافي والمراكز الطبية ضمن نطاق الفريق',icon:'🏥'},
  areas:{title:'المناطق',subtitle:'توزع مناطق الفريق والجهات الطبية المرتبطة بها',icon:'📍'},
  visits:{title:'الجولات',subtitle:'متابعة الجولات المسجلة من مندوبي الفريق',icon:'🚗'},
  reports:{title:'التقارير',subtitle:'مراجعة تقارير الفريق والجولات والأداء الأسبوعي',icon:'📄'},
  leaves:{title:'طلبات الإجازة',subtitle:'مراجعة طلبات إجازات المندوبين والموافقة عليها',icon:'🏖'},
  frequency:{title:'التحليلات',subtitle:'قراءة أداء الفريق وتحقيق أهداف الزيارات خلال الدورة',icon:'📊'},
  'area-coverage':{title:'تغطية المناطق',subtitle:'متابعة إنجاز الزيارات المطلوبة لكل منطقة ضمن الدورة',icon:'📍'}
};

function TeamManagerPageHead({section}:Any){
  const meta=teamManagerPageMeta[section]||{title:'لوحة مدير الفريق',subtitle:'',icon:'▦'};
  return <div className="tm-page-title">
    <div className="tm-page-title-copy">
      <span className="tm-page-title-icon" aria-hidden="true">{meta.icon}</span>
      <div><h2>{meta.title}</h2><p>{meta.subtitle}</p></div>
    </div>
  </div>;
}

function TeamManagerTeamSummary({refresh}:Any){
  const {data,error}=useData('/users',refresh);
  const reps=(data||[]).filter((row:Any)=>row.role==='REP');
  const active=reps.filter((row:Any)=>row.active).length;
  const areaIds=new Set<string>();
  reps.forEach((rep:Any)=>(rep.repAreas||[]).forEach((link:Any)=>{
    if(link.areaId)areaIds.add(link.areaId);
    else if(link.area?.id)areaIds.add(link.area.id);
  }));
  if(error)return <Notice kind="error">{error}</Notice>;
  return <div className="tm-legacy-stats">
    <div className="tm-card tm-small-stat"><span>إجمالي الفريق</span><strong>{reps.length}</strong></div>
    <div className="tm-card tm-small-stat"><span>المندوبون النشطون</span><strong>{active}</strong></div>
    <div className="tm-card tm-small-stat"><span>المناطق الموزعة</span><strong>{areaIds.size}</strong></div>
  </div>;
}

function TeamManagerAnalyticsSummary({refresh,user}:Any){
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:dashboard,error:dashboardError}=useData('/dashboard',refresh);
  const rows=frequency?.items||[];
  const done=rows.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const target=rows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const plan=target?Math.min(100,Math.round(done/target*100)):0;
  const teamCoverage=(coverage?.teamTotals||[]).find((row:Any)=>
    row.groupKey==='team:'+user.teamId)||(coverage?.teamTotals||[])[0];
  const error=frequencyError||coverageError||dashboardError;
  return <>
    {error&&<Notice kind="error">{error}</Notice>}
    <div className="tm-analytics-summary">
      <div className="tm-card tm-analytics-card"><span>تحقيق الخطة</span><strong>{plan}%</strong>
        <small>{done} / {target||0} زيارة مطلوبة</small></div>
      <div className="tm-card tm-analytics-card"><span>تغطية المناطق</span>
        <strong>{teamCoverage?.coverage??0}%</strong><small>{teamCoverage?.doctors??0} طبيب</small></div>
      <div className="tm-card tm-analytics-card"><span>الجولات المسجلة</span>
        <strong>{dashboard?.visits??'—'}</strong><small>ضمن نطاق الفريق</small></div>
      <div className="tm-card tm-analytics-card"><span>المندوبون</span>
        <strong>{dashboard?.reps??'—'}</strong><small>أعضاء الفريق الحاليون</small></div>
    </div>
  </>;
}


function ManagerLegacyHead({title,subtitle,actions}:Any){
  return <div className="page-head manager-page-head">
    <div><h2>{title}</h2><p>{subtitle}</p></div>
    {actions&&<div className="page-actions">{actions}</div>}
  </div>;
}

function ManagerLegacyToolbar({search,setSearch,areas,areaId,setAreaId,grade,setGrade}:Any){
  return <div className="toolbar manager-toolbar">
    <input className="search" value={search} onChange={e=>setSearch(e.target.value)}
      placeholder="بحث..."/>
    {grade!==undefined&&<select className="select" value={grade}
      onChange={e=>setGrade(e.target.value)}>
      <option value="">كل التصنيفات</option><option value="A">A</option>
      <option value="B">B</option><option value="C">C</option>
    </select>}
    {areaId!==undefined&&<select className="select" value={areaId}
      onChange={e=>setAreaId(e.target.value)}>
      <option value="">كل المناطق</option>
      {(areas||[]).map((area:Any)=><option key={area.id} value={area.id}>{area.name}</option>)}
    </select>}
  </div>;
}

const managerInitials=(name:string)=>String(name||'').split(/\s+/).filter(Boolean)
  .slice(0,2).map(x=>x[0]).join('')||'م';

function LegacyManagerTeamPage({refresh,user,done}:Any){
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:activity,error:activityError}=useData(
    '/manager/team-weekly-activity?onDate='+today(),refresh);
  const {data:areas}=useData('/areas',refresh);
  const {data:settings}=useData('/settings',refresh);
  const {data:frequency}=useData('/analytics/frequency',refresh);
  const {data:specialties}=useData('/specialties',refresh);
  const [urlParams,setUrlParams]=useSearchParams();
  const selected=urlParams.get('repId');
  const [search,setSearch]=useState(''),[areaFilter,setAreaFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const [createOpen,setCreateOpen]=useState(false),[editOpen,setEditOpen]=useState(false);
  const [areasOpen,setAreasOpen]=useState(false),[visitPeriod,setVisitPeriod]=useState('week');
  const [visitType,setVisitType]=useState('all');
  const {data:detail,error:detailError}=useData(
    selected?'/manager/reps/'+encodeURIComponent(selected)+'/detail?period='+
      visitPeriod+'&onDate='+today():null,refresh);
  const {data:targetDoctors,error:targetError}=useData(
    selected?'/reps/'+encodeURIComponent(selected)+'/doctors':null,refresh);
  const reps=(users||[]).filter((rep:Any)=>rep.role==='REP');
  const weekCounts=new Map<string,number>((activity?.perRep||[]).map((row:Any)=>[
    row.repId,Number(row.count)||0]));
  const lastDates=new Map<string,string>((activity?.lastByRep||[]).map((row:Any)=>[
    row.repId,row.lastVisit]));
  const workingDays=new Set<number>(Array.isArray(settings?.workingDays)?
    settings.workingDays:[0,1,2,3,4,6]);
  let elapsedWorkingDays=0;
  if(activity?.start){
    const startDate=new Date(activity.start+'T00:00:00Z');
    const endDate=new Date(today()+'T00:00:00Z');
    for(let i=0;i<7;i++){
      const date=new Date(startDate);date.setUTCDate(startDate.getUTCDate()+i);
      if(date>endDate)break;
      if(workingDays.has(date.getUTCDay()))elapsedWorkingDays++;
    }
  }
  const targetFor=(rep:Any)=>Number(rep.dailyTarget||8)*elapsedWorkingDays;
  const progressFor=(rep:Any)=>{
    if(!activity||!elapsedWorkingDays)return null;
    const target=targetFor(rep),done=weekCounts.get(rep.id)||0;
    return target?Math.min(100,Math.round(done/target*100)):0;
  };
  const shown=reps.filter((rep:Any)=>{
    const q=search.trim().toLocaleLowerCase();
    if(q&&![rep.name,rep.username,...(rep.repAreas||[]).map((x:Any)=>x.area?.name)]
      .join(' ').toLocaleLowerCase().includes(q))return false;
    if(areaFilter&&!(rep.repAreas||[]).some((link:Any)=>link.areaId===areaFilter))return false;
    if(statusFilter==='active'&&!rep.active)return false;
    if(statusFilter==='inactive'&&rep.active)return false;
    if(statusFilter==='attention'&&(progressFor(rep)===null||
      (progressFor(rep)||0)>=100))return false;
    return true;
  });
  const average=shown.length&&activity?Math.round(shown.reduce((sum:number,rep:Any)=>
    sum+(progressFor(rep)||0),0)/shown.length):null;
  const selectedRep=reps.find((rep:Any)=>rep.id===selected);
  const selectRep=(id:string|null)=>{
    setEditOpen(false);setAreasOpen(false);setVisitPeriod('week');setVisitType('all');
    setUrlParams(id?{repId:id}:{});
  };
  const allAreas=areas||[];
  const scopedAreaCheckboxes=(values:string[])=><div className="manager-check-grid">
    {allAreas.length?allAreas.map((area:Any)=><label key={area.id} className="manager-check-row">
      <input type="checkbox" name="areaId" value={area.id}
        defaultChecked={values.includes(area.id)}/>{area.name}
    </label>):<Empty text="لم يتم توزيع مناطق على الفريق بعد"/>}
  </div>;
  const chooseAreaIds=(fd:FormData)=>fd.getAll('areaId').map(String);
  if(selected){
    return <div className="manager-legacy-page manager-rep-full-page">
      <ManagerLegacyHead title={selectedRep?.name||detail?.rep?.name||'تفاصيل المندوب'}
        subtitle="ملف المندوب، الزيارات، المناطق، الرصيد والخطة"
        actions={<button className="btn secondary" type="button"
          onClick={()=>selectRep(null)}>← العودة لإدارة الفريق</button>}/>
      {detailError&&<Notice kind="error">{detailError}</Notice>}
      {!selectedRep&&!usersError&&<Empty text="هذا المندوب غير موجود ضمن فريقك"/>}
      {(selectedRep||detail?.rep)&&<>
        <div className="manager-rep-detail-hero card">
          <div className="rep manager-rep-cell"><div className="avatar">
            {managerInitials((selectedRep||detail.rep).name)}</div>
            <div><h3>{(selectedRep||detail.rep).name}</h3><small>
              @{(selectedRep||detail.rep).username} • {selectedRep?.active===false?'موقوف':'نشط'}</small></div>
          </div>
          <div className="manager-rep-actions">
            <button className="btn" type="button" onClick={()=>setEditOpen(true)}>تعديل المندوب</button>
            <button className="btn secondary" type="button"
              onClick={()=>setAreasOpen(true)}>إدارة المناطق</button>
          </div>
        </div>
        <div className="stats-row manager-rep-stats">
          <div className="card small-stat"><span>زيارات الفترة</span><strong>{detail?.targetCounts?
            Object.values(detail.targetCounts as Record<string,number>).reduce((a:number,b:number)=>a+Number(b),0):'—'}</strong></div>
          <div className="card small-stat"><span>الجولات</span><strong>{detail?.tours??'—'}</strong></div>
          <div className="card small-stat"><span>إنجاز الأسبوع</span><strong>{
            progressFor(selectedRep||detail.rep)===null?'—':progressFor(selectedRep||detail.rep)+'%'}</strong></div>
          <div className="card small-stat"><span>رصيد الإجازة</span><strong>{
            (selectedRep||detail.rep).annualLeaveBalance??'—'}</strong></div>
        </div>
        <div className="manager-report-tabs manager-rep-period-tabs" role="group"
          aria-label="فترة زيارات المندوب">
          {[['week','هذا الأسبوع'],['month','هذا الشهر'],['cycle','السايكل الحالي'],
            ['all','كل الزيارات']].map(([id,label])=><button type="button" key={id}
              className={visitPeriod===id?'active':''} onClick={()=>{
                setVisitPeriod(id);setVisitType('all');}}>{label}</button>)}
        </div>
        <div className="manager-rep-period-meta">
          {detail?.periodStart&&detail?.periodEnd?detail.periodStart+' — '+detail.periodEnd:
            visitPeriod==='all'?'من بداية التسجيل':'جارٍ تحميل الفترة'}
          {detail?.lastVisit?' • آخر نشاط: '+detail.lastVisit:''}
        </div>
        <div className="manager-rep-type-grid">
          {[['DOCTOR','الأطباء','🩺'],['PHARMACY','الصيدليات','💊'],
            ['HOSPITAL','المشافي','🏥']].map(([kind,label,icon])=>
            <button type="button" key={kind}
              className={'card manager-rep-type-card '+(visitType===kind?'active':'')}
              onClick={()=>setVisitType(visitType===kind?'all':kind)}>
              <span>{icon} {label}</span><strong>{detail?.targetCounts?.[kind]??'—'}</strong>
              <small>انقر لعرض تفاصيل الزيارات</small>
            </button>)}
        </div>
        <div className="card section manager-rep-tours">
          <div className="section-head"><h3>تفاصيل الزيارات {visitType==='all'?'':
            '• '+typeLabels[visitType]}</h3>
            <span className="muted">آخر 100 جولة كحد أقصى • الإجماليات كاملة</span></div>
          {detail?.visits?<div className="manager-detail-list">
            {detail.visits.filter((visit:Any)=>visitType==='all'||visit.type===visitType)
              .map((visit:Any)=><div key={visit.id}>
                <strong>{typeLabels[visit.type]||visit.type} • {visit.date}</strong>
                <small>{visit.targets?.length||0} جهة • {
                  (visit.targets||[]).map((t:Any)=>t.name+' ('+t.area+')').join('، ')||'—'}</small>
                {visit.note&&<small>ملاحظة: {visit.note}</small>}
              </div>)}
            {!detail.visits.some((visit:Any)=>visitType==='all'||visit.type===visitType)&&
              <Empty text="لا توجد زيارات ضمن هذه الفترة"/>}
          </div>:<Empty text="جارٍ تحميل زيارات المندوب..."/>}
        </div>
        <div className="card section">
          <div className="section-head"><h3>المناطق المسندة</h3>
            <button className="btn secondary" type="button"
              onClick={()=>setAreasOpen(true)}>+ إضافة / إزالة منطقة</button></div>
          <div className="manager-chip-row">{(selectedRep?.repAreas||detail?.rep?.repAreas||[])
            .map((link:Any)=><span key={link.areaId}>{link.area?.name}</span>)}
          </div>
        </div>
        <div className="card section"><div className="section-head">
          <h3>الأطباء المستهدفون</h3><span>{targetDoctors?.length??'—'} طبيب</span></div>
          {targetError&&<Notice kind="error">{targetError}</Notice>}
          {!targetDoctors&&!targetError?<Empty text="جارٍ تحميل الأطباء..."/>:
            <div className="manager-detail-list">{(targetDoctors||[]).map((doctor:Any)=>
              <div key={doctor.id}><b>{doctor.name} • {doctor.grade}</b>
                <small>{doctor.specialty} • {doctor.doctorAreas?.map((link:Any)=>
                  link.area?.name).filter(Boolean).join('، ')||doctor.area?.name||'—'}</small>
              </div>)}</div>}
        </div>
        {editOpen&&<div className="modal-backdrop show manager-inline-modal">
          <div className="modal"><div className="modal-head"><h3>تعديل المندوب</h3>
            <button className="close-btn" type="button" onClick={()=>setEditOpen(false)}>✕</button></div>
            <Form onSave={async(fd:FormData)=>{
              await patch('/manager/reps/'+encodeURIComponent(selected),{
                name:val(fd,'name'),dailyTarget:Number(val(fd,'dailyTarget')),
                annualLeaveBalance:Number(val(fd,'annualLeaveBalance'))});
              setEditOpen(false);done();
            }}>
              <TextInput label="اسم المندوب" name="name"
                defaultValue={selectedRep?.name||detail?.rep?.name}/>
              <TextInput label="الهدف اليومي للزيارات" name="dailyTarget" type="number"
                defaultValue={selectedRep?.dailyTarget??detail?.rep?.dailyTarget}/>
              <TextInput label="الرصيد السنوي للإجازة" name="annualLeaveBalance" type="number"
                defaultValue={selectedRep?.annualLeaveBalance??detail?.rep?.annualLeaveBalance}/>
            </Form>
          </div>
        </div>}
        {areasOpen&&<div className="modal-backdrop show manager-inline-modal">
          <div className="modal"><div className="modal-head"><h3>توزيع مناطق المندوب</h3>
            <button className="close-btn" type="button" onClick={()=>setAreasOpen(false)}>✕</button></div>
            <p className="muted">يمكنك التوزيع ضمن مناطق فريقك فقط، وتبقى الزيارات القديمة محفوظة بمناطقها الأصلية.</p>
            <Form onSave={async(fd:FormData)=>{
              await patch('/manager/reps/'+encodeURIComponent(selected),
                {areaIds:chooseAreaIds(fd)});
              setAreasOpen(false);done();
            }}>{scopedAreaCheckboxes((selectedRep?.repAreas||detail?.rep?.repAreas||[])
                .map((link:Any)=>link.areaId))}
            </Form>
          </div>
        </div>}
      </>}
    </div>;
  }
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="إدارة الفريق"
      subtitle="متابعة أعضاء الفريق وتوزيع المناطق والاختصاصات"
      actions={<button className="btn" type="button"
        onClick={()=>setCreateOpen(true)}>+ إضافة مندوب</button>}/>
    <div className="toolbar manager-toolbar">
      <input className="search" value={search} placeholder="ابحث عن مندوب..."
        onChange={event=>setSearch(event.target.value)}/>
      <select className="select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
        <option value="all">كل الحالات</option><option value="active">نشط</option>
        <option value="inactive">موقوف</option>
        <option value="attention">يحتاج متابعة</option>
      </select>
      <select className="select" value={areaFilter} onChange={e=>setAreaFilter(e.target.value)}>
        <option value="">كل المناطق</option>{allAreas.map((area:Any)=>
          <option value={area.id} key={area.id}>{area.name}</option>)}
      </select>
      <button className="btn secondary" type="button" onClick={()=>{
        setSearch('');setStatusFilter('all');setAreaFilter('');}}>إعادة الضبط</button>
    </div>
    {(usersError||activityError)&&<Notice kind="error">{usersError||activityError}</Notice>}
    <div className="stats-row manager-two-stats">
      <div className="card small-stat"><span>إجمالي الفريق</span><strong>{reps.length}</strong></div>
      <div className="card small-stat"><span>متوسط الإنجاز الأسبوعي</span>
        <strong>{average===null?'—':average+'%'}</strong></div>
    </div>
    <div className="card table-card manager-table-card">
      {!users&&!usersError?<Empty text="جارٍ تحميل الفريق..."/>:!shown.length?<Empty/>:
      <table><thead><tr><th>المندوب</th><th>المناطق</th><th>زيارات الأسبوع</th>
        <th>الإنجاز</th><th>آخر نشاط</th><th>الحالة</th><th></th></tr></thead>
        <tbody>{shown.map((rep:Any)=><tr key={rep.id}>
          <td><div className="rep manager-rep-cell"><div className="avatar">
            {managerInitials(rep.name)}</div><div><b>{rep.name}</b><small>{rep.username}</small></div></div></td>
          <td>{rep.repAreas?.map((link:Any)=>link.area?.name).filter(Boolean).join('، ')||'—'}</td>
          <td>{activity?weekCounts.get(rep.id)||0:'—'}</td>
          <td><div className="manager-progress-cell"><div className="progress">
            <i style={{width:(progressFor(rep)||0)+'%'}}/></div>
            <strong>{progressFor(rep)===null?'—':progressFor(rep)+'%'}</strong></div></td>
          <td>{lastDates.get(rep.id)||'لا يوجد نشاط'}</td>
          <td><span className={'badge '+(!rep.active?'danger':'')}>
            {rep.active?'نشط':'موقوف'}</span></td>
          <td><button className="btn" type="button"
            onClick={()=>selectRep(rep.id)}>التفاصيل</button></td>
        </tr>)}</tbody></table>}
    </div>
    {createOpen&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>إضافة مندوب جديد</h3>
        <button className="close-btn" type="button" onClick={()=>setCreateOpen(false)}>✕</button></div>
        <p className="muted">يُضاف المندوب إلى فريقك الحالي حصراً.</p>
        <Form onSave={async(fd:FormData)=>{
          await post('/manager/reps',{
            name:val(fd,'name'),username:val(fd,'username'),password:val(fd,'password'),
            dailyTarget:Number(val(fd,'dailyTarget')),areaIds:chooseAreaIds(fd),
            specialtyMode:val(fd,'specialtyMode')||'TEAM',
            customSpecialties:val(fd,'customSpecialties').split(/[,،]/)
              .map(x=>x.trim()).filter(Boolean)});
          setCreateOpen(false);done();
        }}>
          <TextInput name="name" label="اسم المندوب"/>
          <TextInput name="username" label="اسم المستخدم"/>
          <TextInput name="password" label="كلمة المرور" type="password"
            placeholder="12 حرفاً على الأقل"/>
          <TextInput name="dailyTarget" label="الهدف اليومي" type="number" defaultValue="8"/>
          <label className="field">وضع الاختصاصات
            <select name="specialtyMode" defaultValue="TEAM">
              <option value="TEAM">اختصاصات الفريق</option>
              <option value="CUSTOM">اختصاصات مخصصة</option>
            </select>
          </label>
          <label className="field">الاختصاصات المخصصة (عند اختيار CUSTOM)
            <input name="customSpecialties" list="managerSpecialties" placeholder="قلبية، داخلية"/>
            <datalist id="managerSpecialties">{(specialties||[]).map((x:string)=>
              <option value={x} key={x}/>)}</datalist>
          </label>
          <strong>المناطق</strong>{scopedAreaCheckboxes([])}
        </Form>
      </div>
    </div>}
  </div>;
}
function LegacyManagerTeamsPage({refresh,done,navigateTo}:Any){
  const {data:teams,error}=useData('/teams',refresh);
  const {data:users}=useData('/users',refresh);
  const {data:products}=useData('/products',refresh);
  const {data:specialties}=useData('/specialties',refresh);
  const [editing,setEditing]=useState<string|null>(null);
  const [managing,setManaging]=useState<string|null>(null);
  const [addInfo,setAddInfo]=useState(false);
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const team=(teams||[]).find((row:Any)=>row.id===editing);
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="الفرق"
      subtitle="إدارة اختصاصات وأصناف فريقك ومتابعة المندوبين"
      actions={<button className="btn" type="button" onClick={()=>setAddInfo(true)}>
        + إضافة فريق</button>}/>
    {error&&<Notice kind="error">{error}</Notice>}
    {!teams&&!error?<Empty text="جارٍ تحميل الفرق..."/>:!teams?.length?<Empty/>:
      <div className="manager-team-grid">{teams.map((item:Any)=>{
        const members=reps.filter((rep:Any)=>rep.teamId===item.id);
        return <div className="card manager-team-card" key={item.id}>
          <h3>{item.name}</h3>
          <div><strong>الاختصاصات:</strong> {
            item.specialties?.map((x:Any)=>x.specialty).join('، ')||'غير محددة'}</div>
          <div><strong>الأصناف:</strong> {
            item.products?.map((x:Any)=>x.product?.name).filter(Boolean).join('، ')||'غير محددة'}</div>
          <div className="manager-team-members"><strong>المندوبون ({members.length}):</strong>
            <div>{members.length?members.map((rep:Any)=><span key={rep.id}>{rep.name}</span>):
              <small>لا يوجد مندوبون ضمن هذا الفريق</small>}</div>
          </div>
          <div className="manager-card-actions">
            <button className="btn secondary" type="button"
              onClick={()=>setEditing(item.id)}>تعديل الفريق</button>
            <button className="btn secondary" type="button"
              onClick={()=>setManaging(item.id)}>إدارة المندوبين</button>
          </div>
        </div>})}</div>}
    {addInfo&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>إضافة فريق جديد</h3>
        <button className="close-btn" type="button" onClick={()=>setAddInfo(false)}>✕</button></div>
        <Notice>إنشاء فريق جديد يتطلب صلاحية مدير الشركة حتى لا تختلط بيانات الفرق.
          بإمكانك تعديل فريقك وإضافة مندوبين إليه من الأزرار الموجودة.</Notice>
        <button className="btn secondary" type="button" onClick={()=>setAddInfo(false)}>إغلاق</button>
      </div>
    </div>}
    {team&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>تعديل الفريق: {team.name}</h3>
        <button className="close-btn" type="button" onClick={()=>setEditing(null)}>✕</button></div>
        <Form key={team.id} onSave={async(fd:FormData)=>{
          await patch('/manager/team',{name:val(fd,'name'),
            specialties:selectedSpecialties(fd,'specialties'),
            productIds:fd.getAll('productId').map(String)});
          setEditing(null);done();
        }}>
          <TextInput name="name" label="اسم الفريق" defaultValue={team.name}/>
          <SpecialtyMultiPicker name="specialties" label="اختصاصات الفريق"
            options={specialties||[]} initial={team.specialties?.map((x:Any)=>x.specialty)||[]}/>
          <strong>الأصناف الخاصة بالفريق</strong>
          <div className="manager-check-grid">{(products||[]).filter((product:Any)=>product.active)
            .map((product:Any)=><label className="manager-check-row" key={product.id}>
              <input type="checkbox" name="productId" value={product.id}
                defaultChecked={team.products?.some((row:Any)=>row.productId===product.id)}/>
              {product.name}</label>)}
          </div>
        </Form>
      </div>
    </div>}
    {managing&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>إدارة مندوبين الفريق</h3>
        <button className="close-btn" type="button" onClick={()=>setManaging(null)}>✕</button></div>
        <p className="muted">يمكن تعديل المندوبين الموجودين ضمن فريقك. نقل مندوب من فريق آخر يتطلب مدير الشركة.</p>
        <div className="manager-detail-list">{reps.filter((rep:Any)=>rep.teamId===managing)
          .map((rep:Any)=><div key={rep.id}>
            <b>{rep.name} • {rep.username}</b>
            <button className="btn secondary" type="button" onClick={()=>{
              setManaging(null);navigateTo('users',{repId:rep.id});}}>التفاصيل والتعديل</button>
          </div>)}</div>
        <button className="btn" type="button" onClick={()=>{
          setManaging(null);navigateTo('users');}}>+ إضافة مندوب</button>
      </div>
    </div>}
  </div>;
}
function LegacyManagerMedicalPage({kind,refresh,user,done}:Any){
  const title=kind==='doctors'?'الأطباء':kind==='pharmacies'?'الصيدليات':'المشافي والمراكز';
  const type=kind==='doctors'?'DOCTOR':kind==='pharmacies'?'PHARMACY':'HOSPITAL';
  const [search,setSearch]=useState(''),[areaId,setAreaId]=useState(''),[grade,setGrade]=useState('');
  const [status,setStatus]=useState('all'),[createOpen,setCreateOpen]=useState(false);
  const [importInfo,setImportInfo]=useState(false),[selected,setSelected]=useState<Any>(null);
  const [page,setPage]=useState(0),pageSize=100;
  const {data:areas}=useData('/areas',refresh);
  const {data:specialties}=useData('/specialties',refresh);
  const params=new URLSearchParams({limit:String(pageSize),offset:String(page*pageSize)});
  if(search.trim())params.set('search',search.trim());
  if(areaId)params.set('areaId',areaId);
  const {data,error}=useData('/'+kind+'?'+params.toString(),refresh);
  const {data:frequency}=useData(kind==='doctors'?'/analytics/frequency':null,refresh);
  const {data:medicalStats,error:statsError}=useData(
    '/manager/medical-stats?kind='+encodeURIComponent(kind),refresh);
  const {data:settings}=useData('/settings',refresh);
  const statsById=new Map<string,Any>((medicalStats||[]).map((row:Any)=>[row.id,row]));
  const linkedAreas=(item:Any)=>kind==='doctors'&&item.doctorAreas?.length?
    [...new Set((item.doctorAreas||[]).map((link:Any)=>link.area?.name).filter(Boolean))].join('، '):
    item.area?.name||item.city||'—';
  const lastVisit=(item:Any)=>statsById.get(item.id)?.lastVisit||
    (medicalStats?'لم تتم زيارته بعد':'جارٍ التحميل...');
  const coverage=(item:Any)=>{
    const done=Number(statsById.get(item.id)?.cycleCount||0);
    if(kind==='doctors'){
      const row=(frequency?.items||[]).find((x:Any)=>x.id===item.id&&
        (!user.teamId||x.teamId===user.teamId));
      if(row)return Number(row.coverage)||0;
      const target=item.grade==='A'?settings?.frequencyA??4:
        item.grade==='B'?settings?.frequencyB??2:settings?.frequencyC??1;
      return target?Math.min(100,Math.round(done/target*100)):0;
    }
    const target=Number(item.target)||0;
    return target?Math.min(100,Math.round(done/target*100)):0;
  };
  const shown=(data||[]).filter((item:Any)=>{
    if(grade&&item.grade!==grade)return false;
    if(status==='attention'&&coverage(item)>=50)return false;
    return true;
  });
  const reset=()=>{setSearch('');setAreaId('');setGrade('');setStatus('all');setPage(0);};
  const create=async(fd:FormData)=>{
    const area=val(fd,'areaId'),name=val(fd,'name');
    const body:Any={areaId:area,name};
    if(kind==='doctors'){
      body.specialty=val(fd,'specialty');body.grade=val(fd,'grade')||'C';
      body.city=val(fd,'city')||null;
    }else if(kind==='pharmacies'){
      body.grade=val(fd,'grade')||'A';body.target=Number(val(fd,'target'));
      body.kind=val(fd,'kind')||'مستقلة';
    }else{
      body.category=val(fd,'category')||'خاص';
      body.specialty=val(fd,'specialty')||'عام';
      body.target=Number(val(fd,'target'));
    }
    await post('/'+kind,body);setCreateOpen(false);done();
  };
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title={title}
      subtitle={kind==='doctors'?'كل الأطباء المسندين إلى فريقك ومناطق عمله':
        kind==='pharmacies'?'متابعة الصيدليات وتواتر زياراتها':'متابعة المشافي والمراكز الطبية'}
      actions={<div className="manager-card-actions">
        <button className="btn" type="button" onClick={()=>setCreateOpen(true)}>
          + إضافة {kind==='doctors'?'طبيب':kind==='pharmacies'?'صيدلية':'مشفى'}</button>
        {kind==='doctors'&&<button className="btn secondary" type="button"
          onClick={()=>setImportInfo(true)}>استيراد Excel</button>}
      </div>}/>
    <div className="toolbar manager-toolbar">
      <input className="search" value={search}
        placeholder={kind==='doctors'?'ابحث باسم الطبيب أو الاختصاص...':
          kind==='pharmacies'?'ابحث عن صيدلية...':'ابحث عن مشفى أو مركز...'}
        onChange={e=>{setSearch(e.target.value);setPage(0)}}/>
      {kind!=='hospitals'&&<select className="select" value={grade} onChange={e=>{
        setGrade(e.target.value);setPage(0)}}>
        <option value="">كل التصنيفات</option>
        {['A','B','C'].map(g=><option value={g} key={g}>{g}</option>)}
      </select>}
      <select className="select" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="all">كل الحالات</option>
        <option value="active">نشط</option>
        <option value="attention">يحتاج متابعة (التغطية أقل من 50%)</option>
      </select>
      <select className="select" value={areaId} onChange={e=>{
        setAreaId(e.target.value);setPage(0)}}>
        <option value="">كل المناطق</option>
        {(areas||[]).map((area:Any)=><option key={area.id} value={area.id}>{area.name}</option>)}
      </select>
      <button className="btn secondary" type="button" onClick={reset}>إعادة ضبط</button>
    </div>
    {(error||statsError)&&<Notice kind="error">{error||statsError}</Notice>}
    <div className="card table-card manager-table-card">
      {!data&&!error?<Empty text={'جارٍ تحميل '+title+'...'}/>:!shown.length?<Empty/>:
      <table><thead><tr><th>{kind==='doctors'?'الطبيب':kind==='pharmacies'?'الصيدلية':'المشفى / المركز'}</th>
        <th>{kind==='doctors'?'الاختصاص':'النوع'}</th><th>التصنيف</th><th>المنطقة</th>
        <th>آخر زيارة</th><th>نسبة التغطية</th><th></th></tr></thead>
        <tbody>{shown.map((item:Any)=>{
          const score=coverage(item);
          return <tr key={item.id}><td><b>{item.name}</b></td>
            <td>{item.specialty||item.kind||item.category||'—'}</td>
            <td>{item.grade?<span className={'badge '+(item.grade==='B'?'blue':
              item.grade==='C'?'warn':'')}>{item.grade}</span>:'—'}</td>
            <td>{linkedAreas(item)}</td><td>{lastVisit(item)}</td>
            <td className="coverage-cell"><b>{score}%</b>
              <div className="progress"><i style={{width:score+'%'}}/></div></td>
            <td><button className="btn" type="button" onClick={()=>setSelected(item)}>
              التفاصيل</button></td>
          </tr>})}</tbody></table>}
    </div>
    <div className="manager-pagination">
      <button className="btn secondary" type="button" disabled={page===0}
        onClick={()=>setPage(v=>Math.max(0,v-1))}>السابق</button>
      <span>الصفحة {page+1}</span>
      <button className="btn secondary" type="button" disabled={!data||data.length<pageSize}
        onClick={()=>setPage(v=>v+1)}>التالي</button>
    </div>
    {selected&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>{selected.name}</h3>
        <button className="close-btn" type="button" onClick={()=>setSelected(null)}>✕</button></div>
        <div className="entity-meta manager-detail-meta">
          <div className="meta"><span>المنطقة</span><b>{linkedAreas(selected)}</b></div>
          <div className="meta"><span>التصنيف</span><b>{selected.grade||'—'}</b></div>
          <div className="meta"><span>آخر زيارة</span><b>{lastVisit(selected)}</b></div>
          <div className="meta"><span>التغطية</span><b>{coverage(selected)}%</b></div>
          <div className="meta"><span>الزيارات المسجلة</span>
            <b>{statsById.get(selected.id)?.total??'—'}</b></div>
        </div>
        <div className="progress manager-progress-wide"><i style={{width:coverage(selected)+'%'}}/></div>
        <button className="btn secondary" type="button" onClick={()=>setSelected(null)}>إغلاق</button>
      </div>
    </div>}
    {createOpen&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>إضافة {title}</h3>
        <button className="close-btn" type="button" onClick={()=>setCreateOpen(false)}>✕</button></div>
        <p className="muted">ستُضاف الجهة ضمن منطقة تابعة لفريقك فقط.</p>
        <Form onSave={create}>
          <TextInput name="name" label="اسم الجهة"/>
          <SelectInput name="areaId" label="المنطقة" options={(areas||[]).map((area:Any)=>({
            value:area.id,label:area.name}))}/>
          {kind==='doctors'?<>
            <SpecialtyInput name="specialty" label="الاختصاص" options={specialties||[]}/>
            <label className="field">التصنيف
              <select name="grade" defaultValue="C"><option>A</option><option>B</option>
                <option>C</option></select></label>
            <TextInput name="city" label="المدينة (اختياري)" required={false}/>
          </>:kind==='pharmacies'?<>
            <label className="field">التصنيف
              <select name="grade" defaultValue="A"><option>A</option><option>B</option>
                <option>C</option></select></label>
            <label className="field">نوع الصيدلية
              <select name="kind" defaultValue="مستقلة">
                {['مستقلة','نقابية','مستوصف','مشفى','حكومية'].map(item=>
                  <option key={item}>{item}</option>)}</select></label>
            <TextInput name="target" label="الزيارات المستهدفة شهرياً" type="number"
              defaultValue="4"/>
          </>:<>
            <label className="field">نوع المنشأة
              <select name="category" defaultValue="خاص">
                {['حكومي','خاص','تخصصي','مركز طبي'].map(item=>
                  <option key={item}>{item}</option>)}</select></label>
            <TextInput name="specialty" label="الاختصاص" defaultValue="عام"/>
            <TextInput name="target" type="number" label="الزيارات المستهدفة"
              defaultValue="4"/>
          </>}
        </Form>
      </div>
    </div>}
    {importInfo&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>استيراد الأطباء Excel</h3>
        <button className="close-btn" type="button" onClick={()=>setImportInfo(false)}>✕</button></div>
        <Notice>الاستيراد الجماعي قد يتضمن أطباء ومناطق لفِرق أخرى، لذلك يبقى ضمن
          صلاحيات مدير الشركة. الإضافة الفردية من مناطق فريقك متاحة من زر «إضافة طبيب».</Notice>
        <button className="btn secondary" type="button"
          onClick={()=>setImportInfo(false)}>إغلاق</button>
      </div>
    </div>}
  </div>;
}
function LegacyManagerAreasPage({refresh,user,done}:Any){
  const {data:areas,error}=useData('/areas',refresh);
  const {data:groups}=useData('/area-groups',refresh);
  const {data:coverage}=useData('/analytics/area-coverage',refresh);
  const {data:users}=useData('/users',refresh);
  const [selected,setSelected]=useState<string|null>(null);
  const [createMode,setCreateMode]=useState<'area'|'group'|null>(null);
  const [editArea,setEditArea]=useState<string|null>(null);
  const {data:details,error:detailsError}=useData(
    selected?'/areas/'+encodeURIComponent(selected)+'/details':null,refresh);
  const {data:performance,error:performanceError}=useData(
    selected?'/manager/areas/'+encodeURIComponent(selected)+'/performance':null,refresh);
  const coverageRows=(coverage?.areas||[]).filter((row:Any)=>
    !user.teamId||row.groupKey==='team:'+user.teamId);
  const coverageFor=(id:string)=>coverageRows.find((row:Any)=>row.areaId===id);
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const areaReps=(id:string)=>reps.filter((rep:Any)=>
    (rep.repAreas||[]).some((link:Any)=>link.areaId===id));
  const total=areas?.length||0;
  const avg=total?Math.round((areas||[]).reduce((sum:number,area:Any)=>
    sum+(coverageFor(area.id)?.coverage||0),0)/total):0;
  const low=(areas||[]).filter((area:Any)=>(coverageFor(area.id)?.coverage||0)<60).length;
  const groupId=(area:Any)=>area.groupId||area.group?.id||null;
  const editing=(areas||[]).find((area:Any)=>area.id===editArea);
  const renderCard=(area:Any)=>{
    const row=coverageFor(area.id),value=row?.coverage??0;
    return <div className="card entity manager-area-card" key={area.id}>
      <div className="entity-top"><div><h4>📍 {area.name}</h4>
        <p>{area.group?.name||'غير مصنفة'}</p></div>
        <span className="badge">{areaReps(area.id).length} مندوب</span></div>
      <div className="entity-meta"><div className="meta"><span>التغطية</span><b>{value}%</b></div>
        <div className="meta"><span>غير مزار</span><b>{row?.unvisited??0}</b></div></div>
      <div className="progress manager-area-progress"><i style={{width:value+'%'}}/></div>
      <div className="manager-card-actions">
        <button className="btn" type="button" onClick={()=>setSelected(area.id)}>عرض التفاصيل</button>
        <button className="btn secondary" type="button"
          onClick={()=>setEditArea(area.id)}>تعديل سريع</button>
      </div>
    </div>;
  };
  if(selected){
    return <div className="manager-legacy-page manager-area-full-page">
      <ManagerLegacyHead title={details?.area?.name||'تفاصيل المنطقة'}
        subtitle={details?.area?.group?.name||'منطقة ضمن نطاق الفريق'}
        actions={<button className="btn secondary" type="button"
          onClick={()=>setSelected(null)}>← العودة للمناطق</button>}/>
      {(detailsError||performanceError)&&<Notice kind="error">
        {detailsError||performanceError}</Notice>}
      <div className="stats-row manager-area-detail-stats">
        {[['المندوبون',details?.totals?.reps],['الأطباء',details?.totals?.doctors],
          ['الصيدليات',details?.totals?.pharmacies],['المشافي',details?.totals?.hospitals]]
          .map(([label,value])=><div className="card small-stat" key={String(label)}>
            <span>{label}</span><strong>{value??'—'}</strong></div>)}
      </div>
      <div className="card section manager-area-cycle-card">
        <div><span>السايكل الحالي</span><strong>{
          performance?.cycle?.start||'—'} — {performance?.cycle?.end||'—'}</strong></div>
        <div><span>Frequency</span><strong>A: {performance?.cycle?.frequency?.A??'—'} • B: {
          performance?.cycle?.frequency?.B??'—'} • C: {
          performance?.cycle?.frequency?.C??'—'}</strong></div>
      </div>
      <div className="rep-section-heading">
        <h2>المندوبون المسؤولون</h2>
        <span className="muted">أداء كل مندوب في هذه المنطقة وفق مواقع الزيارات المسجلة</span>
      </div>
      {!performance&&!performanceError?<Empty text="جارٍ احتساب أداء المنطقة..."/>:
        performance?.reps?.length?<div className="entity-grid manager-area-per-rep">
          {performance.reps.map((rep:Any)=><div className="card entity" key={rep.id}>
            <div className="entity-top"><div><h4>{rep.name}</h4>
              <p>{rep.teamName}</p></div><span className="badge">{rep.coverage}%</span></div>
            <div className="entity-meta">
              <div className="meta"><span>الأطباء المزورون</span>
                <b>{rep.visitedDoctors} من {rep.doctorsCount}</b></div>
              <div className="meta"><span>الزيارات</span>
                <b>{rep.completedVisits} من {rep.requiredVisits}</b></div>
            </div>
            <div className="progress"><i style={{width:rep.coverage+'%'}}/></div>
          </div>)}</div>:<Empty text="لا يوجد مندوبون مستلمون لهذه المنطقة"/>}
      <div className="manager-area-entities-grid">
        {[['الأطباء',details?.doctors],['الصيدليات',details?.pharmacies],
          ['المشافي',details?.hospitals]].map(([label,items])=>
          <div className="card section" key={String(label)}>
            <h3>{label}</h3>
            <div className="manager-detail-list">{(items as Any[]||[]).slice(0,40)
              .map((item:Any)=><div key={item.id}><b>{item.name}</b>
                <small>{item.specialty||item.category||item.grade||'—'}</small></div>)}
              {!items&&<Empty text="جارٍ تحميل الجهات..."/>}
            </div>
          </div>)}
      </div>
    </div>;
  }
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="المناطق" subtitle="إدارة مناطق الفريق وتوزيع المندوبين"
      actions={<div className="manager-card-actions">
        <button className="btn secondary" type="button"
          onClick={()=>setCreateMode('group')}>+ مجموعة جديدة</button>
        <button className="btn" type="button" onClick={()=>setCreateMode('area')}>
          + منطقة جديدة</button>
      </div>}/>
    {error&&<Notice kind="error">{error}</Notice>}
    <div className="stats-row manager-area-stats">
      <div className="card small-stat"><span>إجمالي المناطق</span><strong>{total}</strong></div>
      <div className="card small-stat"><span>متوسط التغطية</span><strong>{avg}%</strong></div>
      <div className="card small-stat"><span>مناطق منخفضة</span><strong>{low}</strong></div>
    </div>
    {!areas&&!error?<Empty text="جارٍ تحميل المناطق..."/>:
      <>
        {(groups||[]).map((group:Any)=>{
          const list=(areas||[]).filter((area:Any)=>groupId(area)===group.id);
          if(!list.length)return null;
          return <section className="manager-area-group" key={group.id}>
            <div className="manager-area-group-head"><div><h3>{group.name}</h3>
              <p>{list.length} منطقة</p></div></div>
            <div className="entity-grid">{list.map(renderCard)}</div>
          </section>;
        })}
        {(areas||[]).some((area:Any)=>!groupId(area))&&<section className="manager-area-group">
          <div className="manager-area-group-head"><div><h3>غير مصنفة</h3>
            <p>{(areas||[]).filter((area:Any)=>!groupId(area)).length} منطقة</p></div></div>
          <div className="entity-grid">{(areas||[]).filter((area:Any)=>!groupId(area)).map(renderCard)}</div>
        </section>}
      </>}
    {createMode&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>{
        createMode==='group'?'إضافة مجموعة مناطق جديدة':'إضافة منطقة جديدة'}</h3>
        <button className="close-btn" type="button" onClick={()=>setCreateMode(null)}>✕</button></div>
        <p className="muted">يجب إسناد المنطقة إلى مندوب من فريقك.
          {createMode==='group'?' أنشئ أول منطقة مع المجموعة حتى تظهر مباشرة ضمن مناطق فريقك.':''}</p>
        <Form onSave={async(fd:FormData)=>{
          await post('/manager/areas',{
            name:val(fd,'name'),city:val(fd,'city')||null,
            ...(createMode==='group'?{newGroupName:val(fd,'newGroupName')}:
              {groupId:val(fd,'groupId')||null}),
            repIds:fd.getAll('repId').map(String)});
          setCreateMode(null);done();
        }}>
          {createMode==='group'&&<TextInput name="newGroupName" label="اسم المجموعة الجديدة"/>}
          <TextInput name="name" label="اسم المنطقة"/>
          <TextInput name="city" label="المحافظة" required={false}/>
          {createMode==='area'&&<SelectInput name="groupId" label="المجموعة"
            required={false} placeholder="غير مصنفة" options={(groups||[]).map((g:Any)=>({
              value:g.id,label:g.name}))}/>}
          <strong>المندوبون الذين ستُسند لهم المنطقة</strong>
          <div className="manager-check-grid">{reps.map((rep:Any)=>
            <label className="manager-check-row" key={rep.id}>
              <input type="checkbox" name="repId" value={rep.id}/>{rep.name}
            </label>)}</div>
        </Form>
      </div>
    </div>}
    {editing&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal"><div className="modal-head"><h3>تعديل منطقة {editing.name}</h3>
        <button className="close-btn" type="button" onClick={()=>setEditArea(null)}>✕</button></div>
        <p className="muted">المناطق المشتركة مع فرق أخرى يحرّر بياناتها مدير الشركة فقط.</p>
        <Form key={editing.id} onSave={async(fd:FormData)=>{
          await patch('/manager/areas/'+encodeURIComponent(editing.id),{
            name:val(fd,'name'),city:val(fd,'city')||null,
            groupId:val(fd,'groupId')||null});
          setEditArea(null);done();
        }}>
          <TextInput name="name" label="اسم المنطقة" defaultValue={editing.name}/>
          <TextInput name="city" label="المحافظة" required={false}
            defaultValue={editing.city||''}/>
          <SelectInput name="groupId" label="المجموعة" required={false}
            defaultValue={editing.groupId||''} placeholder="غير مصنفة"
            options={(groups||[]).map((g:Any)=>({value:g.id,label:g.name}))}/>
        </Form>
      </div>
    </div>}
  </div>;
}
function LegacyManagerVisitsPage({refresh}:Any){
  const {data:users}=useData('/users',refresh);
  const {data:areas}=useData('/areas',refresh);
  const [areaId,setAreaId]=useState('');
  const [page,setPage]=useState(0);
  const [busy,setBusy]=useState(false),[exportError,setExportError]=useState('');
  const [search,setSearch]=useState(''),[type,setType]=useState(''),[repId,setRepId]=useState('');
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[selected,setSelected]=useState<Any>(null);
  const params=new URLSearchParams({limit:'100',offset:String(page*100)});
  if(type)params.set('type',type);if(repId)params.set('repId',repId);
  if(areaId)params.set('areaId',areaId);
  if(search.trim())params.set('search',search.trim());
  if(from)params.set('from',from);if(to)params.set('to',to);
  const {data,error}=useData('/visits?'+params.toString(),refresh);
  const shown=data||[];
  const reset=()=>{setSearch('');setType('');setRepId('');setAreaId('');
    setFrom('');setTo('');setPage(0);};
  async function exportVisits(){
    if(busy)return;setBusy(true);setExportError('');
    try{
      const end=to||today();
      const initial=new Date(end+'T00:00:00Z');
      initial.setUTCDate(initial.getUTCDate()-6);
      const query=new URLSearchParams({from:from||initial.toISOString().slice(0,10),to:end});
      if(type)query.set('type',type);if(repId)query.set('repId',repId);
      if(areaId)query.set('areaId',areaId);if(search.trim())query.set('search',search.trim());
      const response=await fetch('/api/reports/visits.xlsx?'+query.toString(),{
        credentials:'include'});
      if(!response.ok){
        const err=await response.json().catch(()=>({}));
        throw Error(err.error||'تعذر تصدير السجل');
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');link.href=url;
      link.download='mandob-team-visits.xlsx';document.body.appendChild(link);
      link.click();link.remove();URL.revokeObjectURL(url);
    }catch(error:Any){setExportError(error.message||'تعذر التنزيل');}
    finally{setBusy(false);}
  }
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="الجولات" subtitle="متابعة الجولات المنتهية من مندوبي الفريق"
      actions={<button className="btn" type="button" disabled={busy}
        onClick={exportVisits}>{busy?'جارٍ التصدير...':'تصدير السجل Excel'}</button>}/>
    <div className="toolbar manager-toolbar manager-tour-toolbar">
      <input className="search" value={search} onChange={e=>{
        setSearch(e.target.value);setPage(0)}}
        placeholder="ابحث باسم المندوب أو المنطقة..."/>
      <select className="select" value={type} onChange={e=>{setType(e.target.value);setPage(0)}}>
        <option value="">كل أنواع الجولات</option>{Object.entries(typeLabels).map(([value,label])=>
          <option key={value} value={value}>{label}</option>)}</select>
      <select className="select" value={repId} onChange={e=>{setRepId(e.target.value);setPage(0)}}>
        <option value="">كل المندوبين</option>{(users||[]).filter((x:Any)=>x.role==='REP').map((x:Any)=>
          <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select className="select" value={areaId} onChange={e=>{setAreaId(e.target.value);setPage(0)}}>
        <option value="">كل المناطق</option>{(areas||[]).map((area:Any)=>
          <option value={area.id} key={area.id}>{area.name}</option>)}
      </select>
      <label className="manager-date-field">من <input className="select" type="date"
        value={from} onChange={e=>{setFrom(e.target.value);setPage(0)}}/></label>
      <label className="manager-date-field">إلى <input className="select" type="date"
        value={to} onChange={e=>{setTo(e.target.value);setPage(0)}}/></label>
      <button className="btn secondary" type="button" onClick={reset}>إعادة الضبط</button>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}
    {exportError&&<Notice kind="error">{exportError}</Notice>}
    <p className="muted">حالات الجولات الجارية والمتأخرة غير مسجلة حالياً؛ المعروض جولات انتهت وحُفظت مع موقع GPS.</p>
    <div className="card table-card manager-table-card">
      {!data&&!error?<Empty text="جارٍ تحميل الجولات..."/>:!shown.length?<Empty/>:
      <table><thead><tr><th>المندوب</th><th>نوع الجولة</th><th>المنطقة</th>
        <th>عدد الزيارات</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>{shown.map((visit:Any)=><tr key={visit.id}>
          <td>{visit.repName}</td><td>{typeLabels[visit.type]||visit.type}</td>
          <td>{[...new Set((visit.targets||[]).map((x:Any)=>x.areaNameAtVisit).filter(Boolean))].join('، ')||'—'}</td>
          <td>{visit.targets?.length||0}</td><td>{visit.visitDate}</td>
          <td><button className="btn" type="button" onClick={()=>setSelected(visit)}>عرض التفاصيل</button></td>
        </tr>)}</tbody></table>}
    </div>
    <div className="manager-pagination">
      <button className="btn secondary" type="button" disabled={page===0}
        onClick={()=>setPage(n=>Math.max(0,n-1))}>السابق</button>
      <span>الصفحة {page+1}</span>
      <button className="btn secondary" type="button" disabled={!data||data.length<100}
        onClick={()=>setPage(n=>n+1)}>التالي</button>
    </div>
    {selected&&<div className="modal-backdrop show manager-inline-modal"
      onMouseDown={e=>{if(e.currentTarget===e.target)setSelected(null)}}>
      <div className="modal"><div className="modal-head"><div><h3>تفاصيل الجولة</h3>
        <p>{selected.repName} • {selected.visitDate}</p></div>
        <button className="close-btn" type="button" onClick={()=>setSelected(null)}>✕</button></div>
        <div className="entity-meta manager-detail-meta">
          <div className="meta"><span>النوع</span><b>{typeLabels[selected.type]||selected.type}</b></div>
          <div className="meta"><span>عدد الجهات</span><b>{selected.targets?.length||0}</b></div>
          <div className="meta"><span>دقة GPS</span><b>{selected.location?.accuracy?('±'+Math.round(selected.location.accuracy)+' م'):'—'}</b></div>
        </div>
        <h4>الجهات</h4><div className="manager-detail-list">{selected.targets?.map((target:Any)=>
          <div key={target.id}><b>{target.name}</b><small>{target.areaNameAtVisit||'منطقة غير مسجلة'}</small></div>)}</div>
        <h4>الأصناف</h4><div className="manager-chip-row">{selected.products?.length?
          selected.products.map((product:Any)=><span key={product.id}>{product.name} • {product.quantity}</span>):
          <span>لم تسجل أصناف</span>}</div>
        {selected.note&&<div className="visit-note-detail"><h4>ملاحظة الجولة</h4>
          <p>{selected.note}</p></div>}
        {selected.location&&<a className="btn secondary manager-map-link"
          href={'https://www.google.com/maps?q='+selected.location.latitude+','+selected.location.longitude}
          target="_blank" rel="noopener noreferrer">فتح موقع نهاية الجولة</a>}
      </div>
    </div>}
  </div>;
}

function LegacyManagerLeavesPage({refresh,done}:Any){
  const [status,setStatus]=useState(''),[busy,setBusy]=useState<string|null>(null);
  const params=new URLSearchParams({limit:'100',offset:'0'});if(status)params.set('status',status);
  const {data,error}=useData('/leaves?'+params.toString(),refresh);
  const [actionError,setActionError]=useState('');
  async function review(id:string,next:string){
    if(busy)return;setBusy(id);setActionError('');
    try{await patch('/leaves/'+id+'/status',{status:next});done();}
    catch(e:Any){setActionError(e.message||'تعذر تحديث الطلب');}
    finally{setBusy(null);}
  }
  const statusText=(value:string)=>value==='APPROVED'?'مقبولة':
    value==='REJECTED'?'مرفوضة':'قيد المراجعة';
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="طلبات الإجازة"
      subtitle="مراجعة طلبات إجازات المندوبين والموافقة عليها"/>
    <div className="toolbar manager-toolbar manager-leave-toolbar">
      <select className="select" value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="">كل الحالات</option><option value="PENDING">قيد المراجعة</option>
        <option value="APPROVED">مقبولة</option><option value="REJECTED">مرفوضة</option>
      </select>
    </div>
    {error&&<Notice kind="error">{error}</Notice>}{actionError&&<Notice kind="error">{actionError}</Notice>}
    {!data&&!error?<Empty text="جارٍ تحميل طلبات الإجازة..."/>:!data?.length?<div className="card manager-empty-card">
      <strong>لا توجد طلبات إجازة حالياً</strong></div>:
      <div className="request-list manager-leave-list">{data.map((leave:Any)=><div
        className="card request manager-leave-card" key={leave.id}>
        <div className="avatar">{managerInitials(leave.repName)}</div>
        <div className="manager-leave-body">
          <div className="manager-leave-head"><div><b>{leave.repName}</b>
            <small>{leave.type} • من {leave.fromDate} إلى {leave.toDate}</small></div>
            <span className={'badge '+(leave.status==='REJECTED'?'danger':
              leave.status==='PENDING'?'warn':'')}>{statusText(leave.status)}</span></div>
          {leave.reason&&<div className="manager-leave-reason">{leave.reason}</div>}
          {leave.attachment&&<a className="rep-legacy-attachment-link"
            href={'/api/leaves/'+encodeURIComponent(leave.id)+'/attachment'}>
            📎 {leave.attachment.fileName} • تنزيل المرفق
          </a>}
          {leave.status==='PENDING'&&<div className="request-actions manager-leave-actions">
            <button className="approve" type="button" disabled={busy!==null}
              onClick={()=>review(leave.id,'APPROVED')}>قبول</button>
            <button className="reject" type="button" disabled={busy!==null}
              onClick={()=>review(leave.id,'REJECTED')}>رفض</button>
          </div>}
        </div>
      </div>)}</div>}
  </div>;
}

function LegacyManagerReportsPage({refresh,user}:Any){
  const [view,setView]=useState<'submitted'|'visits'|'weekly'>('submitted');
  const {data,error}=useData('/rep-reports',refresh);
  const [search,setSearch]=useState(''),[selected,setSelected]=useState('');
  const {data:details,error:detailsError}=useData(
    selected?'/rep-reports/'+encodeURIComponent(selected):null,refresh);
  const normalized=search.trim().toLocaleLowerCase();
  const shown=(data||[]).filter((item:Any)=>[
    item.repName,item.from,item.to,item.createdAt
  ].join(' ').toLocaleLowerCase().includes(normalized));
  const [printError,setPrintError]=useState('');
  const initialStart=new Date(today()+'T00:00:00Z');
  initialStart.setUTCDate(initialStart.getUTCDate()-6);
  const [exportFrom,setExportFrom]=useState(initialStart.toISOString().slice(0,10));
  const [exportTo,setExportTo]=useState(today());
  const [exportBusy,setExportBusy]=useState(false),[exportError,setExportError]=useState('');
  async function exportUnified(){
    if(exportBusy)return;
    setExportBusy(true);setExportError('');
    try{
      const params=new URLSearchParams({from:exportFrom,to:exportTo});
      const response=await fetch('/api/reports/visits.xlsx?'+params.toString(),{
        credentials:'include'});
      if(!response.ok){
        const body=await response.json().catch(()=>({}));
        throw Error(body.error||'تعذر تنزيل التقرير');
      }
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement('a');
      link.href=url;link.download='mandob-team-unified-report.xlsx';
      document.body.appendChild(link);link.click();link.remove();
      URL.revokeObjectURL(url);
    }catch(err:Any){setExportError(err.message||'تعذر تنزيل التقرير');}
    finally{setExportBusy(false);}
  }
  function printSubmitted(){
    if(!details)return;setPrintError('');
    const popup=window.open('','_blank');
    try{printRepReport(popup,details.snapshot,details.repName);}
    catch(err:Any){popup?.close();setPrintError(err.message||'تعذر طباعة التقرير');}
  }
  const snapshot=details?.snapshot;
  const rows=Array.isArray(snapshot?.rows)?snapshot.rows:[];
  const areas=[...new Set(rows.flatMap((row:Any)=>
    (row.targets||[]).map((target:Any)=>target.area).filter(Boolean)))];
  return <div className="manager-legacy-page manager-reports-page">
    <ManagerLegacyHead title="التقارير" subtitle="مراجعة تقارير الفريق والجولات والأداء الأسبوعي"
      actions={<div className="manager-card-actions manager-unified-export">
        <label className="manager-date-field">من
          <input type="date" className="select" value={exportFrom}
            onChange={e=>setExportFrom(e.target.value)}/></label>
        <label className="manager-date-field">إلى
          <input type="date" className="select" value={exportTo}
            onChange={e=>setExportTo(e.target.value)}/></label>
        <button className="btn" type="button" onClick={exportUnified}
          disabled={exportBusy||!exportFrom||!exportTo}>
          {exportBusy?'جارٍ التصدير...':'تنزيل تقرير موحد Excel'}</button>
      </div>}/>
    {exportError&&<Notice kind="error">{exportError}</Notice>}
    <div className="manager-report-tabs" role="tablist" aria-label="أنواع التقارير">
      {[
        ['submitted','تقارير المندوبين','📄'],
        ['visits','تقرير الزيارات','🚗'],
        ['weekly','الزيارات الأسبوعية','📊']
      ].map(([id,label,icon])=><button key={id} type="button"
        className={view===id?'active':''} onClick={()=>setView(id as Any)}>
        <span>{icon}</span>{label}
      </button>)}
    </div>

    {view==='submitted'&&<>
      <ManagerLegacyToolbar search={search} setSearch={setSearch}/>
      {error&&<Notice kind="error">{error}</Notice>}
      <div className="card table-card manager-table-card manager-report-table">
        {!data&&!error?<Empty text="جارٍ تحميل التقارير..."/>:
          !shown.length?<Empty text="لم يتم إرسال تقارير بعد"/>:
        <table><thead><tr><th>المندوب</th><th>نوع التقرير</th><th>الفترة</th>
          <th>الحالة</th><th>تاريخ الرفع</th><th></th></tr></thead>
          <tbody>{shown.map((item:Any)=><tr key={item.id}>
            <td><div className="rep"><div className="avatar">{managerInitials(item.repName)}</div>
              <div><b>{item.repName}</b><small>تقرير محفوظ</small></div></div></td>
            <td>تقرير زيارات</td><td>{item.from} — {item.to}</td>
            <td><span className="badge">مستلم</span></td>
            <td>{new Date(item.createdAt).toLocaleString('ar')}</td>
            <td><button className="btn" type="button"
              onClick={()=>setSelected(item.id)}>مراجعة التقرير</button></td>
          </tr>)}</tbody></table>}
      </div>
    </>}

    {view==='visits'&&<div className="manager-report-single-panel">
      <VisitReports refresh={refresh}/>
    </div>}

    {view==='weekly'&&<div className="manager-report-single-panel">
      <WeeklyVisits refresh={refresh} user={user}/>
    </div>}

    {selected&&<div className="modal-backdrop show manager-inline-modal manager-report-review-backdrop"
      onMouseDown={e=>{if(e.currentTarget===e.target)setSelected('')}}>
      <div className="modal manager-report-review-modal">
        <div className="modal-head"><div><h3>مراجعة تقرير الزيارات</h3>
          <p>{details?.repName||''}{snapshot?' • '+snapshot.from+' — '+snapshot.to:''}</p></div>
          <button className="close-btn" type="button" onClick={()=>setSelected('')}>✕</button>
        </div>
        {detailsError&&<Notice kind="error">{detailsError}</Notice>}
        {!details&&!detailsError?<Empty text="جارٍ تحميل التقرير..."/>:details&&<>
          <div className="manager-report-review-summary">
            <div><span>الفترة</span><strong>{snapshot.from} — {snapshot.to}</strong></div>
            <div><span>أيام العمل</span><strong>{snapshot.workingDays??'—'}</strong></div>
            <div><span>متوسط الزيارات / يوم عمل</span><strong>{snapshot.averagePerWorkingDay??'—'}</strong></div>
            <div><span>تغطية السايكل عند الإرسال</span>
              <strong>{snapshot.cycleCoverage===undefined?'—':snapshot.cycleCoverage+'%'}</strong></div>
            <div><span>المناطق التي ظهرت بالتقرير</span><strong>{areas.length}</strong></div>
          </div>
          <div className="stats-row manager-report-stats manager-report-main-stats">
            <div className="card small-stat"><span>الجولات</span><strong>{snapshot.tours??0}</strong></div>
            <div className="card small-stat"><span>الجهات المزارة</span><strong>{snapshot.totalTargets??0}</strong></div>
            <div className="card small-stat"><span>الأطباء</span><strong>{snapshot.byType?.DOCTOR||0}</strong></div>
            <div className="card small-stat"><span>الصيدليات</span><strong>{snapshot.byType?.PHARMACY||0}</strong></div>
            <div className="card small-stat"><span>المشافي</span><strong>{snapshot.byType?.HOSPITAL||0}</strong></div>
          </div>

          <div className="manager-report-review-section">
            <div className="manager-report-review-section-head">
              <div><h4>تفاصيل الجولات</h4><p>البيانات المحفوظة وقت إرسال التقرير.</p></div>
              <span className="badge">{rows.length} جولة</span>
            </div>
            {!rows.length?<Empty text="لا توجد جولات ضمن هذا التقرير"/>:
              <div className="manager-report-tour-list">{rows.map((row:Any,index:number)=>
                <div className="manager-report-tour" key={row.id||index}>
                  <div className="manager-report-tour-head">
                    <div><strong>جولة {index+1}</strong><small>{row.date}</small></div>
                    <span className="badge blue">{typeLabels[row.type]||row.type}</span>
                  </div>
                  <div className="manager-report-tour-meta">
                    <span>{row.targets?.length||0} جهة</span>
                    <span>{[...new Set((row.targets||[]).map((target:Any)=>target.area).filter(Boolean))].join('، ')||'منطقة غير مسجلة'}</span>
                  </div>
                  <div className="manager-report-targets">{(row.targets||[]).map((target:Any,targetIndex:number)=>
                    <div key={targetIndex}>
                      <b>{target.name||'—'}</b><small>📍 {target.area||'منطقة غير مسجلة'}</small>
                    </div>)}</div>
                </div>)}</div>}
          </div>

          <div className="manager-report-review-actions">
            <button className="btn" type="button" onClick={printSubmitted}>طباعة التقرير / حفظ PDF</button>
            <button className="btn secondary" type="button" onClick={()=>setSelected('')}>إغلاق</button>
          </div>
          {printError&&<Notice kind="error">{printError}</Notice>}
        </>}
      </div>
    </div>}
  </div>;
}

function LegacyManagerAnalyticsPage({refresh,user}:Any){
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:visits,error:visitsError}=useData('/visits?limit=200&offset=0',refresh);
  const [busy,setBusy]=useState(false),[downloadError,setDownloadError]=useState('');
  const rows=(frequency?.items||[]).filter((row:Any)=>!user.teamId||row.teamId===user.teamId);
  const target=rows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const done=rows.reduce((sum:number,row:Any)=>sum+
    Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const plan=target?Math.min(100,Math.round(done/target*100)):0;
  const personal=frequency?.personalItems||[];
  const reps=new Map<string,{id:string,name:string,done:number,target:number}>();
  personal.forEach((row:Any)=>{
    const current=reps.get(row.repId)||{id:row.repId,name:row.repName,done:0,target:0};
    current.done+=Math.min(Number(row.done)||0,Number(row.target)||0);
    current.target+=Number(row.target)||0;reps.set(row.repId,current);
  });
  const areaRows=(coverage?.areas||[]).filter((row:Any)=>!user.teamId||
    row.groupKey==='team:'+user.teamId);
  const typeCounts={DOCTOR:0,PHARMACY:0,HOSPITAL:0};
  (visits||[]).forEach((visit:Any)=>{if(visit.type in typeCounts)(typeCounts as Any)[visit.type]++});
  const totalVisits=Object.values(typeCounts).reduce((a:number,b:number)=>a+b,0);
  async function exportExcel(){
    if(busy)return;setBusy(true);setDownloadError('');
    try{
      const res=await fetch('/api/analytics/frequency.xlsx',{credentials:'include'});
      if(!res.ok){const body=await res.json().catch(()=>({}));
        throw Error(body.error||'تعذر تصدير التحليلات');}
      const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');
      a.href=url;a.download='mandob-team-analytics.xlsx';document.body.appendChild(a);
      a.click();a.remove();URL.revokeObjectURL(url);
    }catch(e:Any){setDownloadError(e.message);}finally{setBusy(false);}
  }
  const errors=[frequencyError,coverageError,visitsError].filter(Boolean);
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="التحليلات"
      subtitle="قراءة أداء الفريق والتغطية خلال الدورة"
      actions={<button className="btn" type="button" disabled={busy}
        onClick={exportExcel}>{busy?'جارٍ التصدير...':'تصدير Excel'}</button>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    {downloadError&&<Notice kind="error">{downloadError}</Notice>}
    <div className="analytics-grid manager-analytics-grid">
      <div className="card section manager-analytics-card"><div className="section-head">
        <h3>تحقيق الخطة</h3></div>
        <div className="donut manager-donut" style={{'--manager-progress':plan+'%' } as React.CSSProperties}>
          <div><strong>{plan}%</strong><span>إنجاز</span></div></div>
        <p className="manager-centered-muted">تم إنجاز {done} زيارة من أصل {target} زيارة مستهدفة.</p>
      </div>
      <div className="card section manager-analytics-card"><div className="section-head">
        <h3>توزيع الجولات حسب النوع</h3></div>
        {Object.entries(typeLabels).map(([key,label])=>{
          const value=(typeCounts as Any)[key]||0;
          const percent=totalVisits?Math.round(value/totalVisits*100):0;
          return <div className="product-row" key={key}><b>{label}</b>
            <div className="progress"><i style={{width:percent+'%'}}/></div>
            <strong>{value}</strong></div>})}
      </div>
      <div className="card section manager-analytics-card"><div className="section-head">
        <h3>أداء المندوبين</h3></div>
        {[...reps.values()].slice(0,10).map(rep=>{
          const percent=rep.target?Math.min(100,Math.round(rep.done/rep.target*100)):0;
          return <div className="product-row" key={rep.id}><b>{rep.name}</b>
            <div className="progress"><i style={{width:percent+'%'}}/></div>
            <strong>{percent}%</strong></div>})}
        {!reps.size&&<Empty text="لا توجد أهداف فردية للمندوبين"/>}
      </div>
      <div className="card section manager-analytics-card"><div className="section-head">
        <h3>تغطية المناطق</h3></div>
        {areaRows.map((area:Any)=><div className="product-row" key={area.areaId}><b>{area.areaName}</b>
          <div className="progress"><i style={{width:area.coverage+'%'}}/></div>
          <strong>{area.coverage}%</strong></div>)}
        {!areaRows.length&&<Empty text="لا توجد بيانات تغطية"/>}
      </div>
    </div>
  </div>;
}

function LegacyManagerProductsPage({refresh}:Any){
  const {data,error}=useData('/products',refresh);
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="المنتجات" subtitle="متابعة الأصناف الترويجية"/>
    {error&&<Notice kind="error">{error}</Notice>}
    <div className="card table-card manager-table-card">
      {!data&&!error?<Empty text="جارٍ تحميل المنتجات..."/>:!data?.length?<Empty/>:
      <table><thead><tr><th>المنتج</th><th>المادة الفعالة</th><th>الحالة</th></tr></thead>
        <tbody>{data.map((product:Any)=><tr key={product.id}><td><b>{product.name}</b></td>
          <td>{product.activeIngredient||'—'}</td><td><span className={'badge '+(product.active?'':'danger')}>
            {product.active?'نشط':'موقوف'}</span></td></tr>)}</tbody></table>}
    </div>
  </div>;
}

function LegacyManagerSettingsPage({refresh,user,done}:Any){
  const {data:teams,error:teamsError}=useData('/teams',refresh);
  const team=(teams||[]).find((item:Any)=>item.id===user.teamId);
  const [busy,setBusy]=useState(false);
  const [saveError,setSaveError]=useState(''),[saved,setSaved]=useState(false);
  async function saveInstructions(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy||!team)return;
    setBusy(true);setSaveError('');setSaved(false);
    try{
      const fd=new FormData(e.currentTarget);
      await patch('/teams/'+encodeURIComponent(team.id)+'/instructions',{
        managerInstructions:val(fd,'managerInstructions')||null});
      setSaved(true);done();
    }catch(err:Any){setSaveError(err.message||'تعذر حفظ تعليمات المدير');}
    finally{setBusy(false);}
  }
  const {data,error}=useData('/settings',refresh);
  const dayNames=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  return <div className="manager-legacy-page">
    <ManagerLegacyHead title="الإعدادات" subtitle="إعدادات الفريق والصلاحيات والتنبيهات"/>
    <div className="notice">أنت مدير فريق. تظهر لك إعدادات السايكل الحالية للقراءة؛
      تعديلها يبقى من صلاحيات مدير الشركة.</div>
    {error&&<Notice kind="error">{error}</Notice>}
    {!data&&!error?<Empty text="جارٍ تحميل الإعدادات..."/>:data&&
      <div className="settings-grid manager-settings-grid">
        <div className="card section"><h3>إعدادات السايكل</h3>
          <p className="muted">مدة السايكل وعدد الزيارات المطلوبة لكل تصنيف.</p>
          <label>بداية السايكل</label><input className="input" value={data.cycleStart?.slice(0,10)||''} readOnly/>
          <label>نهاية السايكل</label><input className="input" value={data.cycleEnd?.slice(0,10)||''} readOnly/>
          <label>عدد زيارات أطباء A</label><input className="input" value={data.frequencyA} readOnly/>
          <label>عدد زيارات أطباء B</label><input className="input" value={data.frequencyB} readOnly/>
          <label>عدد زيارات أطباء C</label><input className="input" value={data.frequencyC} readOnly/>
        </div>
        <div className="card section"><h3>إعدادات الإجازات</h3>
          <p className="muted">الرصيد الافتراضي تحدده إدارة الشركة.</p>
          <div className="manager-setting-value"><span>الرصيد السنوي الافتراضي</span>
            <strong>{data.annualLeaveBalance} يوم</strong></div>
          <small className="muted">لتعديل رصيد مندوب محدد، افتح «الفريق» ثم «تفاصيل المندوب».</small>
        </div>
        <div className="card section"><h3>بيانات الفريق</h3>
          <p className="muted">اسم فريقك الحالي. إدارة الفرق الأخرى من صلاحية مدير الشركة.</p>
          {team?<Form key={team.id+String(refresh)} onSave={async(fd:FormData)=>{
            await patch('/manager/team',{name:val(fd,'name')});done();
          }}><TextInput name="name" label="اسم الفريق" defaultValue={team.name}/>
          </Form>:<Empty text="لا يوجد فريق مرتبط بحسابك"/>}
        </div>
        <div className="card section"><h3>أيام العمل</h3>
          <p className="muted">أيام العمل المعتمدة خلال السايكل الحالي.</p>
          <div className="manager-settings-days">{dayNames.map((day,index)=>
            <label key={day} className="manager-setting-day">
              <input type="checkbox" disabled
                checked={(data.workingDays||[]).includes(index)}/>{day}
            </label>)}</div>
          <small className="muted">تعديل أيام العمل يتم من مدير الشركة.</small>
        </div>
        {teamsError&&<Notice kind="error">{teamsError}</Notice>}
        {saveError&&<Notice kind="error">{saveError}</Notice>}
        {saved&&<Notice kind="success">تم حفظ تعليمات المندوبين بنجاح</Notice>}
        <div className="card section"><h3>التنبيهات</h3>
          <p className="muted">هذه الخيارات كانت ظاهرة في التصميم القديم دون نظام
            تنبيهات آلية بالخادم. حالياً الجرس يفتح الطلبات المعلقة، ولم نفعل
            إشعارات بريدية أو تنبيهات دورية غير موجودة.</p>
          {['تأخر مندوب عن الخطة','رفع تقرير جديد','زيارة متأخرة لطبيب A',
            'ملخص يومي عبر البريد الإلكتروني'].map((label,index)=>
            <label key={label} className="manager-setting-day">
              <input type="checkbox" disabled checked={index<3}/>{label}
            </label>)}
        </div>
        <div className="card section"><h3>الصلاحيات</h3>
          <div className="manager-setting-value"><span>إضافة أطباء وصيدليات ومشافي</span>
            <strong>مسموح ضمن مناطق الفريق فقط</strong></div>
          <div className="manager-setting-value"><span>تعديل توزيع المناطق والمندوبين</span>
            <strong>مسموح ضمن الفريق</strong></div>
          <div className="manager-setting-value"><span>تعديل فرق أخرى وسايكل الشركة</span>
            <strong>مدير الشركة فقط</strong></div>
        </div>
        <div className="card section"><h3>بيانات المدير</h3>
          <div className="manager-setting-value"><span>الاسم</span>
            <strong>{user.name}</strong></div>
          <div className="manager-setting-value"><span>اسم المستخدم</span>
            <strong>{user.username}</strong></div>
          <small className="muted">البريد ورقم الهاتف غير مسجلين حالياً في حسابات النظام الجديد،
            لذلك لا نعرض بيانات الاتصال التجريبية القديمة.</small>
        </div>
        {team&&<div className="card section">
          <h3>تعليمات المدير للمندوبين</h3>
          <p className="muted">تظهر لمندوبي فريقك في صفحة «الخطة والأصناف»،
            وتبقى تعليمات الشركة هي الافتراضية إذا تركت النص فارغاً.</p>
          <form key={team.id+String(refresh)} onSubmit={saveInstructions}>
            <label className="field">تعليمات هذا الفريق
              <textarea name="managerInstructions" maxLength={1000} rows={5}
                defaultValue={team.managerInstructions||''}
                placeholder="مثال: التركيز على اختصاصات ومناطق محددة هذا الأسبوع"/>
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy?'جارٍ الحفظ...':'حفظ تعليمات الفريق'}
            </button>
          </form>
        </div>}
      </div>}
  </div>;
}

function TeamManagerRoute({section,revision,refresh,user,navigateTo}:Any){
  switch(section){
    case 'users':return <LegacyManagerTeamPage refresh={revision} user={user} done={refresh}/>;
    case 'teams':return <LegacyManagerTeamsPage refresh={revision} done={refresh} navigateTo={navigateTo}/>;
    case 'doctors':case 'pharmacies':case 'hospitals':
      return <LegacyManagerMedicalPage kind={section} refresh={revision} user={user} done={refresh}/>;
    case 'areas':return <LegacyManagerAreasPage refresh={revision} user={user} done={refresh}/>;
    case 'visits':return <LegacyManagerVisitsPage refresh={revision}/>;
    case 'leaves':return <LegacyManagerLeavesPage refresh={revision} done={refresh}/>;
    case 'reports':return <LegacyManagerReportsPage refresh={revision} user={user}/>;
    case 'frequency':return <LegacyManagerAnalyticsPage refresh={revision} user={user}/>;
    case 'products':return <LegacyManagerProductsPage refresh={revision}/>;
    case 'settings':return <LegacyManagerSettingsPage refresh={revision} user={user} done={refresh}/>;
    case 'area-coverage':return <LegacyManagerAreasPage refresh={revision} user={user} done={refresh}/>;
    default:return <Empty/>;
  }
}



function CompanyLegacyHead({title,subtitle,actions}:Any){
  return <div className="page-heading company-page-heading">
    <div><h2>{title}</h2><p>{subtitle}</p></div>
    {actions&&<div className="company-page-actions">{actions}</div>}
  </div>;
}

function companyWeekBounds(){
  const end=today();
  const date=new Date(end+'T12:00:00');
  const daysSinceSaturday=(date.getDay()+1)%7;
  date.setDate(date.getDate()-daysSinceSaturday);
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return {from:local.toISOString().slice(0,10),to:end};
}
function companyMonthBounds(){
  const end=today();
  return {from:end.slice(0,8)+'01',to:end};
}
const companyCity=(area:Any)=>String(area?.city||'غير محددة').trim()||'غير محددة';
const companyCoverageTone=(value:number)=>value>=75?'good':value>=60?'medium':'low';
const companyCoverageLabel=(value:number)=>value>=75?'أداء جيد':value>=60?'متوسط':'بحاجة للمتابعة';
const companyInitials=(name:string)=>String(name||'').split(/\s+/).filter(Boolean)
  .slice(0,2).map((part:string)=>part[0]).join('')||'M';

function CompanyModal({open,title,subtitle,onClose,children,wide=false}:Any){
  if(!open)return null;
  return <div className="company-modal-backdrop" onMouseDown={event=>{
    if(event.currentTarget===event.target)onClose();
  }}>
    <div className={'company-modal-card '+(wide?'wide':'')}>
      <div className="company-modal-head"><div><h3>{title}</h3>
        {subtitle&&<p>{subtitle}</p>}</div>
        <button type="button" className="company-modal-close" onClick={onClose}>×</button></div>
      <div className="company-modal-body">{children}</div>
    </div>
  </div>;
}

function CompanyAdminDashboard({refresh,user,navigate,governorate}:Any){
  const {from,to}=companyWeekBounds();
  const {data:dashboard,error:dashboardError}=useData('/dashboard',refresh);
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:teams,error:teamsError}=useData('/teams',refresh);
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:settings,error:settingsError}=useData('/settings',refresh);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:visitReport,error:visitError}=useData(
    '/reports/visits?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to),refresh);
  const areaById=new Map((areas||[]).map((area:Any)=>[area.id,area]));
  const governorates:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const repRows=(users||[]).filter((row:Any)=>row.role==='REP');
  const managerRows=(users||[]).filter((row:Any)=>row.role==='TEAM_MANAGER');
  const repMatches=(rep:Any,gov:string)=>gov==='all'||(rep.repAreas||[])
    .some((link:Any)=>companyCity(link.area)===gov);
  const visibleReps=repRows.filter((rep:Any)=>repMatches(rep,governorate));
  const visibleTeamIds=new Set(visibleReps.map((rep:Any)=>rep.teamId).filter(Boolean));
  const visibleTeams=(teams||[]).filter((team:Any)=>governorate==='all'||visibleTeamIds.has(team.id));
  const coverageRows=(coverage?.areas||[]).filter((row:Any)=>{
    const area=areaById.get(row.areaId);
    return governorate==='all'||companyCity(area)===governorate;
  });
  const target=coverageRows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const done=coverageRows.reduce((sum:number,row:Any)=>sum+
    Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const coveragePct=target?Math.min(100,Math.round(done/target*100)):0;
  const weeklyRows=(visitReport?.rows||[]).filter((row:Any)=>governorate==='all'||
    (row.targetDetails||[]).some((target:Any)=>companyCity(areaById.get(target.areaIdAtVisit))===governorate));
  const weeklyTargets=weeklyRows.reduce((sum:number,row:Any)=>sum+(row.targetDetails?.length||row.targets?.length||0),0);
  const attention=coverageRows.filter((row:Any)=>row.target>0&&row.coverage<60).length;
  const teamCoverage=(teamId:string)=>{
    const row=(coverage?.teamTotals||[]).find((item:Any)=>item.groupKey==='team:'+teamId);
    return row?.coverage??0;
  };
  const errors=[dashboardError,usersError,teamsError,areasError,coverageError,
    settingsError,frequencyError,visitError].filter(Boolean);
  const governorateStats=governorates.map(gov=>{
    const govAreas=(areas||[]).filter((area:Any)=>companyCity(area)===gov);
    const ids=new Set(govAreas.map((area:Any)=>area.id));
    const govCoverage=(coverage?.areas||[]).filter((row:Any)=>ids.has(row.areaId));
    const govTarget=govCoverage.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
    const govDone=govCoverage.reduce((sum:number,row:Any)=>sum+
      Math.min(Number(row.done)||0,Number(row.target)||0),0);
    const reps=repRows.filter((rep:Any)=>repMatches(rep,gov));
    const teamIds=new Set(reps.map((rep:Any)=>rep.teamId).filter(Boolean));
    const visits=(visitReport?.rows||[]).filter((row:Any)=>
      (row.targetDetails||[]).some((target:Any)=>ids.has(target.areaIdAtVisit)));
    return {name:gov,areas:govAreas.length,reps:reps.length,teams:teamIds.size,
      visits:visits.reduce((sum:number,row:Any)=>sum+(row.targetDetails?.length||0),0),
      coverage:govTarget?Math.min(100,Math.round(govDone/govTarget*100)):0,
      attention:govCoverage.filter((row:Any)=>row.target>0&&row.coverage<60).length};
  }).filter((item:Any)=>governorate==='all'||item.name===governorate);
  return <div className="company-dashboard">
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    <div className="dashboard-heading">
      <div><span className="eyebrow">COMPANY PERFORMANCE</span><h2>أداء الشركة</h2>
        <p>متابعة التغطية والنشاط في جميع المحافظات.</p></div>
      <div className="cycle-badge"><span>السايكل الحالي</span>
        <strong>{settings?.cycleStart?.slice(0,10)||'—'} — {settings?.cycleEnd?.slice(0,10)||'—'}</strong></div>
    </div>
    <div className="stats-grid">
      <article className="stat-card"><div className="stat-head"><span>التغطية</span>
        <span className={'stat-status '+(coveragePct>=75?'success':'warning')}>
          {coveragePct>=75?'جيد':'متابعة'}</span></div><strong>{coveragePct}%</strong>
        <div className="progress-track"><div className="progress-value" style={{width:coveragePct+'%'}}/></div>
        <small>{governorate==='all'?'إجمالي الشركة':'المحافظة: '+governorate}</small></article>
      <article className="stat-card"><div className="stat-head"><span>زيارات هذا الأسبوع</span></div>
        <strong>{weeklyTargets}</strong><small>الجهات الطبية ضمن {weeklyRows.length} جولة</small></article>
      <article className="stat-card"><div className="stat-head"><span>المندوبون</span></div>
        <strong>{visibleReps.length}</strong><small>{visibleReps.filter((rep:Any)=>rep.active).length} نشط حالياً</small></article>
      <article className="stat-card"><div className="stat-head"><span>بحاجة للمتابعة</span>
        <span className="stat-status warning">تنبيه</span></div><strong>{attention}</strong>
        <small>مناطق تغطيتها أقل من 60%</small></article>
    </div>

    <div className="section-heading"><div><h3>أداء المحافظات</h3>
      <p>مقارنة سريعة لأداء كل محافظة</p></div>
      <button className="text-button" type="button" onClick={()=>navigate('governorates')}>عرض كل المحافظات</button></div>
    <div className="governorates-grid">
      {governorateStats.map((gov:Any)=><article className="governorate-card" key={gov.name}
        onClick={()=>navigate('governorates',{gov:gov.name})}>
        <div className="governorate-head"><div className="governorate-title">
          <div className="governorate-icon">{gov.name.slice(0,1)}</div><div><h4>{gov.name}</h4>
            <span>{gov.teams} فرق • {gov.reps} مندوب</span></div></div>
          <span className={'performance-badge '+companyCoverageTone(gov.coverage)}>
            {companyCoverageLabel(gov.coverage)}</span></div>
        <div className="coverage-row"><div><span>التغطية</span><strong>{gov.coverage}%</strong></div>
          <div className="progress-track"><div className="progress-value" style={{width:gov.coverage+'%'}}/></div></div>
        <div className="governorate-metrics"><div><span>زيارات الأسبوع</span><strong>{gov.visits}</strong></div>
          <div><span>فرق</span><strong>{gov.teams}</strong></div>
          <div><span>بحاجة للمتابعة</span><strong>{gov.attention}</strong></div></div>
        <button className="card-action" type="button" onClick={event=>{event.stopPropagation();
          navigate('governorates',{gov:gov.name});}}>عرض المحافظة <span>←</span></button>
      </article>)}
      {!governorateStats.length&&<Empty text="لا توجد محافظات ضمن الفلتر الحالي"/>}
    </div>

    <div className="dashboard-bottom-grid">
      <section className="dashboard-card"><div className="card-heading"><div><h3>أداء الفرق</h3>
        <p>نظرة سريعة على فرق الشركة</p></div>
        <button className="text-button" type="button" onClick={()=>navigate('teams')}>عرض الكل</button></div>
        <div className="team-list">{visibleTeams.slice(0,6).map((team:Any)=>{
          const manager=managerRows.find((row:Any)=>row.teamId===team.id);
          return <div className="team-row" key={team.id}><div className="team-info">
            <div className="team-avatar">{team.name.slice(0,2).toUpperCase()}</div>
            <div><strong>{team.name}</strong><span>{manager?.name||'بدون مدير فريق'}</span></div></div>
            <div className="team-performance"><strong>{teamCoverage(team.id)}%</strong><span>تغطية</span></div>
          </div>})}
          {!visibleTeams.length&&<Empty text="لا توجد فرق ضمن الفلتر الحالي"/>}</div>
      </section>
      <section className="dashboard-card"><div className="card-heading"><div><h3>يحتاج متابعة</h3>
        <p>أهم النقاط التي تحتاج انتباه المدير</p></div></div><div className="attention-list">
        {governorateStats.filter((g:Any)=>g.coverage<60).slice(0,3).map((gov:Any)=>
          <div className="attention-item" key={gov.name}><span className="attention-dot danger"></span>
            <div><strong>تغطية {gov.name} منخفضة</strong><p>التغطية الحالية {gov.coverage}%.</p></div></div>)}
        {visibleTeams.filter((team:Any)=>!managerRows.some((row:Any)=>row.teamId===team.id)).slice(0,2).map((team:Any)=>
          <div className="attention-item" key={team.id}><span className="attention-dot warning"></span>
            <div><strong>{team.name} بدون مدير فريق</strong><p>الفريق بحاجة لتعيين مدير.</p></div></div>)}
        {dashboard?.pendingLeaves>0&&<div className="attention-item"><span className="attention-dot neutral"></span>
          <div><strong>{dashboard.pendingLeaves} طلب إجازة معلق</strong><p>راجع الطلبات من صفحة التقارير.</p></div></div>}
      </div></section>
    </div>
  </div>;
}

function CompanyGovernoratesPage({refresh,governorate,navigate}:Any){
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string|null>(governorate!=='all'?governorate:null);
  const {from,to}=companyWeekBounds();
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:teams}=useData('/teams',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:visits,error:visitError}=useData('/reports/visits?from='+from+'&to='+to,refresh);
  useEffect(()=>{if(governorate!=='all')setSelected(governorate);},[governorate]);
  const areaById=new Map((areas||[]).map((area:Any)=>[area.id,area]));
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const managers=(users||[]).filter((row:Any)=>row.role==='TEAM_MANAGER');
  const cities:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const normalized=search.trim().toLocaleLowerCase();
  const teamCoverage=(teamId:string)=>(coverage?.teamTotals||[])
    .find((row:Any)=>row.groupKey==='team:'+teamId)?.coverage??0;
  const repCoverage=(repId:string)=>{
    const rows=(frequency?.personalItems||[]).filter((row:Any)=>row.repId===repId);
    if(!rows.length)return null;
    const target=rows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
    const done=rows.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
    return target?Math.min(100,Math.round(done/target*100)):0;
  };
  const metrics=cities.map(city=>{
    const cityAreas=(areas||[]).filter((area:Any)=>companyCity(area)===city);
    const ids=new Set(cityAreas.map((area:Any)=>area.id));
    const rows=(coverage?.areas||[]).filter((row:Any)=>ids.has(row.areaId));
    const target=rows.reduce((s:number,row:Any)=>s+(Number(row.target)||0),0);
    const done=rows.reduce((s:number,row:Any)=>s+Math.min(Number(row.done)||0,Number(row.target)||0),0);
    const cityReps=reps.filter((rep:Any)=>(rep.repAreas||[]).some((link:Any)=>ids.has(link.areaId||link.area?.id)));
    const teamIds=new Set(cityReps.map((rep:Any)=>rep.teamId).filter(Boolean));
    const cityVisits=(visits?.rows||[]).filter((visit:Any)=>
      (visit.targetDetails||[]).some((target:Any)=>ids.has(target.areaIdAtVisit)));
    return {city,areas:cityAreas,reps:cityReps,teamIds,visits:
      cityVisits.reduce((sum:number,row:Any)=>sum+(row.targetDetails?.length||0),0),
      coverage:target?Math.min(100,Math.round(done/target*100)):0,
      attention:rows.filter((row:Any)=>row.target>0&&row.coverage<60).length};
  }).filter((item:Any)=>item.city.toLocaleLowerCase().includes(normalized));
  const current=metrics.find((item:Any)=>item.city===selected);
  const errors=[areasError,usersError,coverageError,frequencyError,visitError].filter(Boolean);
  return <div className="company-governorates-page">
    <CompanyLegacyHead title="المحافظات" subtitle="متابعة أداء الشركة وتنظيم العمل حسب المحافظة"
      actions={<button className="primary-button" type="button" onClick={()=>navigate('data')}>
        + إضافة منطقة بمحافظة</button>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    {!current&&<>
      <div className="governorates-toolbar"><div className="search-box"><span>⌕</span>
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="البحث عن محافظة..."/></div>
        <div className="governorates-count"><span>المحافظات</span><strong>{metrics.length}</strong></div></div>
      <div className="governorates-list">{metrics.map((item:Any)=>
        <article className="governorate-list-card" key={item.city}>
          <div className="governorate-list-main"><div className="governorate-icon large">{item.city.slice(0,1)}</div>
            <div><h3>{item.city}</h3><span>{item.teamIds.size} فرق • {item.reps.length} مندوب • {item.areas.length} منطقة</span></div></div>
          <div className="governorate-list-metric"><span>التغطية</span><strong>{item.coverage}%</strong></div>
          <div className="governorate-list-metric"><span>زيارات الأسبوع</span><strong>{item.visits}</strong></div>
          <div className="governorate-list-metric"><span>بحاجة للمتابعة</span><strong>{item.attention}</strong></div>
          <div className="governorate-list-progress"><div className="progress-track">
            <div className="progress-value" style={{width:item.coverage+'%'}}/></div></div>
          <button className="outline-button" type="button" onClick={()=>setSelected(item.city)}>عرض التفاصيل</button>
        </article>)}</div>
    </>}
    {current&&<div className="company-governorate-details">
      <button className="back-button" type="button" onClick={()=>setSelected(null)}>→ العودة للمحافظات</button>
      <div className="governorate-details-head"><div className="governorate-details-title">
        <div className="governorate-icon details">{current.city.slice(0,1)}</div><div>
          <span>المحافظة</span><h2>{current.city}</h2>
          <p>{current.teamIds.size} فرق • {current.reps.length} مندوب • {current.areas.length} منطقة</p></div></div>
        <div className="details-head-actions"><button className="outline-button" type="button"
          onClick={()=>navigate('data')}>إدارة مناطق المحافظة</button></div></div>
      <div className="stats-grid governorate-stats">
        <article className="stat-card"><div className="stat-head"><span>التغطية</span></div>
          <strong>{current.coverage}%</strong><div className="progress-track"><div className="progress-value"
            style={{width:current.coverage+'%'}}/></div><small>السايكل الحالي</small></article>
        <article className="stat-card"><div className="stat-head"><span>زيارات هذا الأسبوع</span></div>
          <strong>{current.visits}</strong><small>الجهات المزارة ضمن فرق المحافظة</small></article>
        <article className="stat-card"><div className="stat-head"><span>المندوبون</span></div>
          <strong>{current.reps.length}</strong><small>المندوبون المسجلون</small></article>
        <article className="stat-card"><div className="stat-head"><span>بحاجة للمتابعة</span></div>
          <strong>{current.attention}</strong><small>مناطق منخفضة التغطية</small></article>
      </div>
      <div className="governorate-details-grid">
        <section className="dashboard-card"><div className="card-heading"><div><h3>الفرق ومدراء الفرق</h3>
          <p>الفرق العاملة ضمن المحافظة</p></div>
          <button className="text-button" type="button" onClick={()=>navigate('teams')}>عرض الكل</button></div>
          <div className="details-team-list">{[...current.teamIds].map((teamId:any)=>{
            const team=(teams||[]).find((row:Any)=>row.id===teamId);
            const repsInTeam=current.reps.filter((rep:Any)=>rep.teamId===teamId);
            const manager=managers.find((row:Any)=>row.teamId===teamId);
            const pct=teamCoverage(teamId);
            return <div className="details-team-row" key={teamId}>
              <div className="details-team-main"><div className="team-avatar">{team?.name?.slice(0,2)||'T'}</div>
                <div><strong>{team?.name||'فريق'}</strong><span>{repsInTeam.length} مندوب</span></div></div>
              <div className="details-team-manager"><span>مدير الفريق</span>
                <strong>{manager?.name||'غير معيّن'}</strong></div>
              <div className="details-team-coverage"><strong>{pct}%</strong><span>تغطية</span></div>
            </div>})}</div></section>
        <section className="dashboard-card"><div className="card-heading"><div><h3>المناطق</h3>
          <p>التغطية حسب مناطق المحافظة</p></div><button className="text-button" type="button"
            onClick={()=>navigate('data')}>عرض الكل</button></div>
          <div className="area-performance-list">{current.areas.map((area:Any)=>{
            const rows=(coverage?.areas||[]).filter((row:Any)=>row.areaId===area.id);
            const target=rows.reduce((s:number,row:Any)=>s+(Number(row.target)||0),0);
            const done=rows.reduce((s:number,row:Any)=>s+Math.min(Number(row.done)||0,Number(row.target)||0),0);
            const pct=target?Math.min(100,Math.round(done/target*100)):0;
            return <div className="area-performance-item" key={area.id}>
              <div className="area-performance-head"><strong>{area.name}</strong><span>{pct}%</span></div>
              <div className="progress-track"><div className="progress-value" style={{width:pct+'%'}}/></div>
            </div>})}</div>
        </section>
      </div>
      <section className="dashboard-card reps-section"><div className="card-heading"><div><h3>المندوبون</h3>
        <p>نظرة سريعة على أداء مندوبي المحافظة</p></div>
        <button className="text-button" type="button" onClick={()=>navigate('teams')}>عرض جميع المندوبين</button></div>
        <div className="simple-table company-rep-performance-table"><div className="simple-table-head">
          <span>المندوب</span><span>الفريق</span><span>التغطية الفردية</span><span>الحالة</span></div>
          <div className="simple-table-body">{current.reps.map((rep:Any)=>{
            const pct=repCoverage(rep.id);
            return <div className="simple-table-row" key={rep.id}>
              <span className="rep-table-user"><i className="rep-table-avatar">{rep.name.slice(0,1)}</i>
                <span><b>{rep.name}</b><small>{rep.username}</small></span></span>
              <span>{rep.team?.name||'—'}</span><strong>{pct===null?'—':pct+'%'}</strong>
              <span className={pct===null?'rep-status neutral':'rep-status '+companyCoverageTone(pct)}>
                {pct===null?(rep.active?'نشط':'موقوف'):companyCoverageLabel(pct)}</span>
            </div>})}</div></div>
      </section>
    </div>}
  </div>;
}

function CompanyTeamsPage({refresh,done,user,governorate}:Any){
  const {from,to}=companyWeekBounds();
  const [cityFilter,setCityFilter]=useState(governorate||'all');
  const [selectedTeamId,setSelectedTeamId]=useState<string|null>(null);
  const [addManager,setAddManager]=useState(false);
  const [advanced,setAdvanced]=useState<'teams'|'users'|null>(null);
  const {data:teams,error:teamsError}=useData('/teams',refresh);
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:areas}=useData('/areas',refresh);
  const {data:coverage}=useData('/analytics/area-coverage',refresh);
  const {data:frequency}=useData('/analytics/frequency',refresh);
  const {data:visits}=useData('/reports/visits?from='+from+'&to='+to,refresh);
  useEffect(()=>setCityFilter(governorate||'all'),[governorate]);
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const managers=(users||[]).filter((row:Any)=>row.role==='TEAM_MANAGER');
  const cities:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const shownCities=cityFilter==='all'?cities:cities.filter(city=>city===cityFilter);
  const teamCoverage=(teamId:string)=>(coverage?.teamTotals||[])
    .find((row:Any)=>row.groupKey==='team:'+teamId)?.coverage??0;
  const teamCity=(teamId:string)=>{
    const values:string[]=[...new Set<string>(reps.filter((rep:Any)=>rep.teamId===teamId)
      .flatMap((rep:Any)=>(rep.repAreas||[]).map((link:Any)=>companyCity(link.area)))
      .filter((value:string)=>value!=='غير محددة'))];
    return values[0]||'غير محددة';
  };
  const repCoverage=(repId:string)=>{
    const rows=(frequency?.personalItems||[]).filter((row:Any)=>row.repId===repId);
    if(!rows.length)return null;
    const target=rows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
    const done=rows.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
    return target?Math.min(100,Math.round(done/target*100)):0;
  };
  const selectedTeam=(teams||[]).find((team:Any)=>team.id===selectedTeamId);
  const selectedReps=reps.filter((rep:Any)=>rep.teamId===selectedTeamId);
  const selectedManager=managers.find((manager:Any)=>manager.teamId===selectedTeamId);
  const selectedVisits=(visits?.rows||[]).filter((visit:Any)=>visit.teamIdAtVisit===selectedTeamId);
  const selectedAttention=selectedReps.filter((rep:Any)=>{
    const pct=repCoverage(rep.id);return pct!==null&&pct<100;
  }).length;
  const unmanagedTeams=(teams||[]).filter((team:Any)=>!managers.some((manager:Any)=>manager.teamId===team.id));
  const [managerCity,setManagerCity]=useState('');
  const managerTeams=unmanagedTeams.filter((team:Any)=>!managerCity||teamCity(team.id)===managerCity);
  const errors=[teamsError,usersError].filter(Boolean);

  if(selectedTeam)return <div className="company-team-details-page">
    <button className="back-button" type="button" onClick={()=>setSelectedTeamId(null)}>→ العودة للفرق</button>
    <div className="team-details-head"><div className="team-details-title">
      <div className="team-avatar team-details-avatar">{selectedTeam.name.slice(0,2)}</div>
      <div><span>{teamCity(selectedTeam.id)}</span><h2>{selectedTeam.name}</h2>
        <p>مدير الفريق: {selectedManager?.name||'غير معيّن'}</p></div></div></div>
    <div className="stats-grid team-details-stats">
      <article className="stat-card"><div className="stat-head"><span>التغطية</span></div>
        <strong>{teamCoverage(selectedTeam.id)}%</strong><div className="progress-track">
          <div className="progress-value" style={{width:teamCoverage(selectedTeam.id)+'%'}}/></div>
        <small>السايكل الحالي</small></article>
      <article className="stat-card"><div className="stat-head"><span>المندوبون</span></div>
        <strong>{selectedReps.length}</strong><small>ضمن الفريق</small></article>
      <article className="stat-card"><div className="stat-head"><span>زيارات الأسبوع</span></div>
        <strong>{selectedVisits.reduce((sum:number,row:Any)=>sum+(row.targetDetails?.length||0),0)}</strong>
        <small>جميع مندوبي الفريق</small></article>
      <article className="stat-card"><div className="stat-head"><span>بحاجة للمتابعة</span></div>
        <strong>{selectedAttention}</strong><small>أهداف فردية متأخرة إن وجدت</small></article>
    </div>
    <div className="team-details-grid">
      <section className="dashboard-card"><div className="card-heading"><div><h3>مدير الفريق</h3>
        <p>المسؤول عن متابعة الفريق</p></div></div>
        <div className="team-details-manager"><div className="manager-avatar">{companyInitials(selectedManager?.name||'TM')}</div>
          <div><strong>{selectedManager?.name||'غير معيّن'}</strong><span>Team Manager</span></div></div>
      </section>
      <section className="dashboard-card"><div className="card-heading"><div><h3>الاختصاصات المستهدفة</h3>
        <p>الاختصاصات التابعة لخطة الفريق</p></div></div>
        <div className="team-specialties">{selectedTeam.specialties?.length?
          selectedTeam.specialties.map((item:Any)=><span className="team-specialty-chip" key={item.specialty}>{item.specialty}</span>):
          <span className="team-specialty-chip">لا توجد اختصاصات محددة</span>}</div>
      </section>
    </div>
    <section className="dashboard-card team-details-reps"><div className="card-heading"><div>
      <h3>مندوبي الفريق</h3><p>متابعة أداء المندوبين ضمن الفريق</p></div></div>
      <div className="simple-table company-team-reps-table"><div className="simple-table-head">
        <span>المندوب</span><span>المناطق</span><span>التغطية</span><span>الحالة</span></div>
        <div className="simple-table-body">{selectedReps.map((rep:Any)=>{
          const pct=repCoverage(rep.id);
          return <div className="simple-table-row" key={rep.id}>
            <span className="rep-table-user"><i className="rep-table-avatar">{rep.name.slice(0,1)}</i>
              <span><b>{rep.name}</b><small>{rep.username}</small></span></span>
            <span>{rep.repAreas?.map((link:Any)=>link.area?.name).filter(Boolean).join('، ')||'—'}</span>
            <strong>{pct===null?'—':pct+'%'}</strong>
            <span className={pct===null?'rep-status neutral':'rep-status '+companyCoverageTone(pct)}>
              {pct===null?(rep.active?'نشط':'موقوف'):companyCoverageLabel(pct)}</span>
          </div>})}</div></div>
    </section>
  </div>;

  return <div className="company-teams-page">
    <CompanyLegacyHead title="الفرق والمندوبون" subtitle="متابعة الفرق ومدراء الفرق والمندوبين حسب المحافظة"
      actions={<>
        <button className="outline-button" type="button" onClick={()=>setAdvanced('teams')}>إدارة الفرق</button>
        <button className="outline-button" type="button" onClick={()=>setAdvanced('users')}>إدارة المندوبين</button>
        <button className="primary-button" type="button" onClick={()=>setAddManager(true)}>+ إضافة مدير فريق</button>
      </>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    <div className="teams-toolbar"><label className="simple-filter"><span>المحافظة</span>
      <select value={cityFilter} onChange={e=>setCityFilter(e.target.value)}>
        <option value="all">كل المحافظات</option>{cities.map(city=><option key={city} value={city}>{city}</option>)}
      </select></label></div>
    {shownCities.map(city=>{
      const cityAreaIds=new Set((areas||[]).filter((area:Any)=>companyCity(area)===city).map((area:Any)=>area.id));
      const cityReps=reps.filter((rep:Any)=>(rep.repAreas||[]).some((link:Any)=>cityAreaIds.has(link.areaId||link.area?.id)));
      const teamIds:string[]=[...new Set<string>(cityReps.map((rep:Any)=>rep.teamId).filter(Boolean) as string[])];
      const cityTeamCoverage=teamIds.length?Math.round(teamIds.reduce((sum:number,id:any)=>sum+teamCoverage(id),0)/teamIds.length):0;
      return <section className="governorate-team-group" key={city}><div className="team-group-heading">
        <div><h3>{city}</h3><span>{teamIds.length} فرق • {cityReps.length} مندوب</span></div>
        <strong>{cityTeamCoverage}% تغطية</strong></div>
        <div className="company-teams-grid">{teamIds.map((teamId:any)=>{
          const team=(teams||[]).find((item:Any)=>item.id===teamId);
          const teamReps=cityReps.filter((rep:Any)=>rep.teamId===teamId);
          const manager=managers.find((row:Any)=>row.teamId===teamId);
          return <article className="company-team-card" key={teamId}>
            <div className="company-team-head"><div className="team-avatar">{team?.name?.slice(0,2)||'T'}</div>
              <div><h4>{team?.name||'فريق'}</h4><span>{teamReps.length} مندوبين</span></div></div>
            <div className={'team-manager-block '+(!manager?'missing':'')}><span>مدير الفريق</span>
              <strong>{manager?.name||'غير معيّن'}</strong></div>
            <div className="team-card-footer"><div><span>التغطية</span><strong>{teamCoverage(teamId)}%</strong></div>
              <button type="button" onClick={()=>manager?setSelectedTeamId(teamId):setAddManager(true)}>
                {manager?'عرض الفريق':'تعيين مدير'}</button></div>
          </article>})}</div>
      </section>;
    })}
    {!shownCities.length&&<Empty text="لا توجد محافظات ضمن الفلتر الحالي"/>}

    <CompanyModal open={addManager} title="إضافة مدير فريق" subtitle="إنشاء حساب TEAM_MANAGER وربطه بفريق موجود."
      onClose={()=>{setAddManager(false);setManagerCity('')}}>
      <Form onSave={async(fd:FormData)=>{
        const teamId=val(fd,'teamId');
        if(managers.some((manager:Any)=>manager.teamId===teamId))
          throw Error('هذا الفريق لديه مدير حالياً. استخدم إدارة المستخدمين لتعديل المدير الحالي.');
        await post('/users',{name:val(fd,'name'),username:val(fd,'username'),
          password:val(fd,'password'),role:'TEAM_MANAGER',teamId,areaIds:[]});
        setAddManager(false);setManagerCity('');done();
      }}>
        <div className="manager-form-grid">
          <TextInput name="name" label="اسم المدير"/>
          <TextInput name="username" label="اسم المستخدم"/>
          <TextInput name="password" label="كلمة المرور (12 محرفاً على الأقل)" type="password"/>
          <label className="field">المحافظة<select value={managerCity}
            onChange={e=>setManagerCity(e.target.value)} required>
            <option value="">اختر المحافظة</option>{cities.map(city=><option key={city} value={city}>{city}</option>)}
          </select></label>
          <SelectInput name="teamId" label="الفريق" options={managerTeams.map((team:Any)=>({
            value:team.id,label:team.name
          }))}/>
        </div>
      </Form>
    </CompanyModal>
    <CompanyModal open={advanced!==null} title={advanced==='teams'?'إدارة الفرق':'إدارة المندوبين والمدراء'}
      subtitle="وظائف الإدارة الحالية محفوظة داخل تصميم مدير الشركة." onClose={()=>setAdvanced(null)} wide>
      <div className="company-embedded-v2">{advanced==='teams'?
        <Teams refresh={refresh} done={done}/>:<Users refresh={refresh} done={done} canCreate={true}/>}</div>
    </CompanyModal>
  </div>;
}

function CompanyCoveragePage({refresh,done,user}:Any){
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:teams,error:teamsError}=useData('/teams',refresh);
  const [goalsOpen,setGoalsOpen]=useState(false);
  const areaById=new Map((areas||[]).map((area:Any)=>[area.id,area]));
  const reps=(users||[]).filter((row:Any)=>row.role==='REP');
  const teamTotals=coverage?.teamTotals||[];
  const companyTarget=teamTotals.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const companyDone=teamTotals.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const companyPct=companyTarget?Math.min(100,Math.round(companyDone/companyTarget*100)):0;
  const areaCoverageTotals=new Map<string,Any>();
  for(const row of coverage?.areas||[]){
    const current=areaCoverageTotals.get(row.areaId)||{
      areaId:row.areaId,areaName:row.areaName,target:0,done:0
    };
    current.target+=Number(row.target)||0;
    current.done+=Math.min(Number(row.done)||0,Number(row.target)||0);
    areaCoverageTotals.set(row.areaId,current);
  }
  const governorates:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const govRows=governorates.map(city=>{
    const ids=new Set((areas||[]).filter((area:Any)=>companyCity(area)===city).map((area:Any)=>area.id));
    const rows=(coverage?.areas||[]).filter((row:Any)=>ids.has(row.areaId));
    const target=rows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
    const done=rows.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
    const cityReps=reps.filter((rep:Any)=>(rep.repAreas||[]).some((link:Any)=>ids.has(link.areaId||link.area?.id)));
    const teamIds=new Set(cityReps.map((rep:Any)=>rep.teamId).filter(Boolean));
    return {city,reps:cityReps.length,teams:teamIds.size,
      coverage:target?Math.min(100,Math.round(done/target*100)):0};
  });
  const lowAreaRows=[...areaCoverageTotals.values()].map((row:Any)=>({
    ...row,coverage:row.target?Math.min(100,Math.round(row.done/row.target*100)):0
  })).filter((row:Any)=>row.target>0&&row.coverage<60)
    .sort((a:Any,b:Any)=>a.coverage-b.coverage).slice(0,8);
  const errors=[coverageError,frequencyError,areasError,usersError,teamsError].filter(Boolean);
  return <div className="company-coverage-page company-coverage-legacy">
    <CompanyLegacyHead title="التغطية" subtitle="متابعة تحقيق الزيارات المطلوبة خلال السايكل الحالي"
      actions={<div className="cycle-badge"><span>السايكل الحالي</span>
        <strong>{coverage?.cycleStart||frequency?.cycleStart||'—'} — {coverage?.cycleEnd||frequency?.cycleEnd||'—'}</strong></div>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    <div className="coverage-overview">
      <article className="coverage-main-card"><div><span>تغطية الشركة</span><strong>{companyPct}%</strong>
        <small>إجمالي التغطية في جميع الفرق</small></div>
        <div className="coverage-main-progress"><div className="progress-track">
          <div className="progress-value" style={{width:companyPct+'%'}}/></div></div></article>
      <article className="coverage-summary-card"><span>الزيارات المنجزة</span><strong>{companyDone}</strong>
        <small>من أصل {companyTarget} زيارة مطلوبة</small></article>
      <article className="coverage-summary-card"><span>بحاجة للمتابعة</span><strong>{lowAreaRows.length}</strong>
        <small>مناطق تغطيتها أقل من 60%</small></article>
    </div>
    <div className="section-heading"><div><h3>التغطية حسب المحافظة</h3>
      <p>مقارنة أداء المحافظات في السايكل الحالي</p></div></div>
    <div className="coverage-governorates">{govRows.map((row:Any)=>
      <div className="coverage-row-card" key={row.city}><div className="coverage-row-name">
        <div className="governorate-icon">{row.city.slice(0,1)}</div><div><strong>{row.city}</strong>
          <span>{row.reps} مندوب • {row.teams} فرق</span></div></div>
        <div className="coverage-row-progress"><span>التغطية</span><strong>{row.coverage}%</strong>
          <div className="progress-track"><div className="progress-value" style={{width:row.coverage+'%'}}/></div></div>
        <span className={'performance-badge '+companyCoverageTone(row.coverage)}>{companyCoverageLabel(row.coverage)}</span>
      </div>)}</div>
    <div className="coverage-bottom-grid">
      <section className="dashboard-card"><div className="card-heading"><div><h3>أداء الفرق</h3>
        <p>الفرق التي تحتاج متابعة أكبر</p></div>
        <button className="text-button" type="button" onClick={()=>setGoalsOpen(true)}>إدارة الأهداف</button></div>
        <div className="coverage-team-list">{teamTotals.slice().sort((a:Any,b:Any)=>a.coverage-b.coverage)
          .map((row:Any)=><div className="coverage-team-item" key={row.groupKey}>
            <div className="team-info"><div className="team-avatar">{row.teamName.slice(0,2)}</div>
              <div><strong>{row.teamName}</strong><span>{row.doctors} طبيب</span></div></div>
            <strong>{row.coverage}%</strong></div>)}</div>
      </section>
      <section className="dashboard-card"><div className="card-heading"><div><h3>مناطق تحتاج متابعة</h3>
        <p>أقل المناطق تحقيقاً للتغطية المطلوبة</p></div></div>
        <div className="area-performance-list">{lowAreaRows.map((row:Any)=>
          <div className="area-performance-item" key={row.areaId}><div className="area-performance-head">
            <strong>{row.areaName}</strong><span>{companyCity(areaById.get(row.areaId))} • {row.coverage}%</span></div>
            <div className="progress-track"><div className="progress-value" style={{width:row.coverage+'%'}}/></div>
          </div>)}
          {!lowAreaRows.length&&<Empty text="لا توجد مناطق منخفضة التغطية حالياً"/>}</div>
      </section>
    </div>
    {coverage?.unattributedHistoricalVisits>0&&<Notice>
      يوجد {coverage.unattributedHistoricalVisits} زيارة تاريخية بلا منطقة محفوظة؛ بقيت ضمن إجمالي الفريق فقط.
    </Notice>}
    <CompanyModal open={goalsOpen} title="الأهداف والتكرار" subtitle="إدارة الأهداف الحالية بدون تغيير طريقة حساب التغطية."
      onClose={()=>setGoalsOpen(false)} wide>
      <div className="company-embedded-v2"><Frequency refresh={refresh} user={user} done={done}/></div>
    </CompanyModal>
  </div>;
}

function CompanyDataPage({refresh,done,user}:Any){
  const [tab,setTab]=useState<'doctors'|'pharmacies'|'hospitals'|'areas'>('doctors');
  const [search,setSearch]=useState('');
  const [city,setCity]=useState('all');
  const [areaId,setAreaId]=useState('all');
  const [modal,setModal]=useState<'add'|'edit'|'import'|null>(null);
  const [selected,setSelected]=useState<Any>(null);
  const [actionError,setActionError]=useState('');
  const [busy,setBusy]=useState(false);
  const [exportBusy,setExportBusy]=useState(false);
  const {data:dashboard}=useData('/dashboard',refresh);
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:areaGroups}=useData('/area-groups',refresh);
  const {data:dataUsers,error:dataUsersError}=useData('/users',refresh);
  const {data:doctors,error:doctorError}=useData('/doctors?limit=500&offset=0&includeArchived=true',refresh);
  const {data:pharmacies,error:pharmacyError}=useData('/pharmacies?limit=500&offset=0&includeArchived=true',refresh);
  const {data:hospitals,error:hospitalError}=useData('/hospitals?limit=500&offset=0&includeArchived=true',refresh);
  const {data:specialtyOptions}=useData('/specialties',refresh);
  const cities:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const cityAreas=(areas||[]).filter((area:Any)=>city==='all'||companyCity(area)===city);
  useEffect(()=>{if(areaId!=='all'&&!cityAreas.some((area:Any)=>area.id===areaId))setAreaId('all');},[city,areas]);
  const allRows=tab==='doctors'?(doctors||[]):tab==='pharmacies'?(pharmacies||[]):tab==='hospitals'?(hospitals||[]):(areas||[]);
  const normalized=search.trim().toLocaleLowerCase();
  const rowArea=(row:Any)=>tab==='areas'?row:row.area;
  const rows=allRows.filter((row:Any)=>{
    const area=rowArea(row);
    const rowCity=companyCity(area);
    if(city!=='all'&&rowCity!==city)return false;
    if(areaId!=='all'&&area?.id!==areaId&&
      !(tab==='doctors'&&row.doctorAreas?.some((link:Any)=>link.areaId===areaId||link.area?.id===areaId)))return false;
    return !normalized||[row.name,row.specialty,row.kind,row.category,row.grade,area?.name,rowCity,row.group?.name]
      .some(value=>String(value||'').toLocaleLowerCase().includes(normalized));
  });
  const labelsMap:Any={doctors:['الأطباء','طبيب'],pharmacies:['الصيدليات','صيدلية'],
    hospitals:['المشافي','مشفى'],areas:['المناطق','منطقة']};
  const currentLabel=labelsMap[tab][0],singleLabel=labelsMap[tab][1];
  const counts:Any={doctors:dashboard?.doctors??doctors?.filter((x:Any)=>x.active).length??0,
    pharmacies:dashboard?.pharmacies??pharmacies?.filter((x:Any)=>x.active).length??0,
    hospitals:dashboard?.hospitals??hospitals?.filter((x:Any)=>x.active).length??0,
    areas:areas?.length??0};
  const errors=[areasError,dataUsersError,doctorError,pharmacyError,hospitalError].filter(Boolean);
  const areaDoctorCount=(id:string)=>(doctors||[]).filter((doctor:Any)=>doctor.active!==false&&
    (doctor.areaId===id||doctor.doctorAreas?.some((link:Any)=>link.areaId===id||link.area?.id===id))).length;
  const areaRepCount=(id:string)=>(dataUsers||[]).filter((row:Any)=>row.role==='REP'&&row.active&&
    row.repAreas?.some((link:Any)=>link.areaId===id||link.area?.id===id)).length;
  function openEdit(row:Any){setSelected(row);setModal('edit');setActionError('');}
  async function toggleStatus(){
    if(!selected||tab==='areas'||busy)return;
    setBusy(true);setActionError('');
    try{await patch('/'+tab+'/'+selected.id+'/status',{active:!selected.active});
      setModal(null);setSelected(null);done();}
    catch(e:Any){setActionError(e.message||'تعذر تغيير حالة السجل');}
    finally{setBusy(false);}
  }
  async function exportCurrent(){
    if(tab==='areas'||exportBusy)return;
    setExportBusy(true);setActionError('');
    try{
      const response=await fetch('/api/reports/medical.xlsx?kind='+encodeURIComponent(tab)+
        '&includeArchived=true',{credentials:'include'});
      if(!response.ok){const body=await response.json().catch(()=>({}));
        throw Error(body.error||'تعذر تصدير القائمة');}
      const uri=URL.createObjectURL(await response.blob()),a=document.createElement('a');
      a.href=uri;a.download='mandob-'+tab+'.xlsx';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(uri);
    }catch(e:Any){setActionError(e.message);}finally{setExportBusy(false);}
  }
  return <div className="company-data-page company-data-legacy">
    <CompanyLegacyHead title="البيانات" subtitle="إدارة بيانات الأطباء والصيدليات والمشافي والمناطق"
      actions={<div className="company-data-head-actions">
        {tab==='doctors'&&<button className="outline-button" type="button" onClick={()=>setModal('import')}>استيراد Excel</button>}
        {tab!=='areas'&&<button className="outline-button" type="button" disabled={exportBusy}
          onClick={exportCurrent}>{exportBusy?'جارٍ التصدير...':'تصدير Excel'}</button>}
        <button className="primary-button" type="button" onClick={()=>{setSelected(null);setModal('add')}}>
          + إضافة {singleLabel}</button></div>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    {actionError&&<Notice kind="error">{actionError}</Notice>}
    <div className="data-tabs">
      {(['doctors','pharmacies','hospitals','areas'] as const).map(id=><button type="button" key={id}
        className={'data-tab '+(tab===id?'active':'')} onClick={()=>{setTab(id);setSearch('');setAreaId('all')}}>
        {labelsMap[id][0]} <strong>{counts[id]}</strong></button>)}
    </div>
    <div className="data-toolbar"><div className="data-search"><span>⌕</span>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'البحث في '+currentLabel+'...'}/></div>
      <select value={city} onChange={e=>setCity(e.target.value)}><option value="all">كل المحافظات</option>
        {cities.map(item=><option key={item} value={item}>{item}</option>)}</select>
      <select value={areaId} onChange={e=>setAreaId(e.target.value)}><option value="all">كل المناطق</option>
        {cityAreas.map((area:Any)=><option key={area.id} value={area.id}>{area.name}</option>)}</select>
    </div>
    <div className="data-panel active">
      {rows.length===0?<Empty text="لا توجد نتائج ضمن الفلاتر الحالية"/>:
      tab==='areas'?<div className="data-table">
        <div className="data-table-head company-area-data-columns">
          <span>المنطقة</span><span>المحافظة</span><span>الأطباء</span><span>المندوبون</span><span></span>
        </div>
        <div>{rows.map((area:Any)=><div className="data-table-row company-area-data-columns" key={area.id}>
          <span><b>{area.name}</b><small>{area.group?.name||'بدون مجموعة'}</small></span>
          <span>{companyCity(area)}</span><span>{areaDoctorCount(area.id)} طبيب</span>
          <span>{areaRepCount(area.id)} مندوب</span>
          <button className="row-action" type="button" onClick={()=>openEdit(area)}>•••</button>
        </div>)}</div>
      </div>:
      <div className="data-table">
        <div className={'data-table-head company-data-columns '+tab}>
          <span>{tab==='doctors'?'الطبيب':tab==='pharmacies'?'الصيدلية':'المشفى'}</span>
          <span>{tab==='doctors'?'الاختصاص':'النوع'}</span><span>المحافظة</span><span>المنطقة</span>
          <span>{tab==='hospitals'?'الهدف':'التصنيف'}</span><span></span></div>
        <div className="doctors-grid">{rows.map((row:Any)=><div className={'data-table-row company-data-columns '+tab} key={row.id}>
          <span><b>{row.name}</b>{row.active===false&&<small className="archived-label">مؤرشف</small>}</span>
          <span>{row.specialty||row.kind||row.category||'—'}</span><span>{companyCity(row.area)}</span>
          <span>{tab==='doctors'&&row.doctorAreas?.length?
            [...new Set<string>(row.doctorAreas.map((link:Any)=>link.area?.name).filter(Boolean) as string[])].join('، '):row.area?.name||'—'}</span>
          <span>{tab==='hospitals'?row.target:(row.grade?<i className={'grade-badge grade-'+String(row.grade).toLowerCase()}>{row.grade}</i>:'—')}</span>
          <button className="row-action" type="button" onClick={()=>openEdit(row)}>•••</button>
        </div>)}</div>
      </div>}
    </div>

    <CompanyModal open={modal==='add'} title={'إضافة '+singleLabel}
      subtitle="يتم الحفظ مباشرة في بيانات الشركة الحالية." onClose={()=>setModal(null)}>
      <Form onSave={async(fd:FormData)=>{
        const body:Any={name:val(fd,'name')};
        if(tab==='areas'){
          body.city=val(fd,'city');body.groupId=val(fd,'groupId')||null;
        }else{
          body.areaId=val(fd,'areaId');
          if(tab==='doctors'){
            body.specialty=val(fd,'specialty');body.grade=val(fd,'grade');
            const selectedArea=(areas||[]).find((area:Any)=>area.id===body.areaId);
            body.city=String(selectedArea?.city||'').trim()||null;
          }
          if(tab==='pharmacies'){
            body.grade=val(fd,'grade');body.target=Number(val(fd,'target')||4);body.kind=val(fd,'kind')||'مستقلة';
          }
          if(tab==='hospitals'){
            body.category=val(fd,'category')||'خاص';body.specialty=val(fd,'specialty')||'عام';
            body.target=Number(val(fd,'target')||4);
          }
        }
        await post('/'+tab,body);setModal(null);done();
      }}>
        <div className="data-form-grid"><TextInput name="name" label="الاسم"/>
          {tab==='areas'?<>
            <TextInput name="city" label="المحافظة"/>
            <SelectInput name="groupId" label="مجموعة المنطقة" required={false}
              options={(areaGroups||[]).map((group:Any)=>({value:group.id,label:group.name}))}/>
          </>:<>
            <SelectInput name="areaId" label="المنطقة" options={(areas||[]).map((area:Any)=>({
              value:area.id,label:companyCity(area)+' — '+area.name
            }))}/>
            {tab==='doctors'&&<><SpecialtyInput options={specialtyOptions||[]}/>
              <SelectInput name="grade" label="التصنيف" options={['A','B','C'].map(v=>({value:v,label:v}))}/></>}
            {tab==='pharmacies'&&<><TextInput name="kind" label="نوع الصيدلية" required={false}/>
              <SelectInput name="grade" label="التصنيف" options={['A','B','C'].map(v=>({value:v,label:v}))}/>
              <TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue="4"/></>}
            {tab==='hospitals'&&<><TextInput name="category" label="تصنيف المشفى" required={false}/>
              <SpecialtyInput options={specialtyOptions||[]} required={false}/>
              <TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue="4"/></>}
          </>}
        </div>
      </Form>
    </CompanyModal>

    <CompanyModal open={modal==='edit'&&!!selected} title={'تعديل '+singleLabel}
      subtitle={selected?'السجل: '+selected.name:''} onClose={()=>{setModal(null);setSelected(null)}}>
      {selected&&<><Form onSave={async(fd:FormData)=>{
        if(tab==='areas'){
          await patch('/areas/'+selected.id,{name:val(fd,'name'),city:val(fd,'city')||null,
            groupId:val(fd,'groupId')||null});
        }else{
          const changes:Any={name:val(fd,'name')};
          if(tab==='doctors'){changes.specialty=val(fd,'specialty');changes.grade=val(fd,'grade');
            changes.city=val(fd,'city')||null;}
          if(tab==='pharmacies'){changes.kind=val(fd,'kind');changes.grade=val(fd,'grade');
            changes.target=Number(val(fd,'target'));}
          if(tab==='hospitals'){changes.category=val(fd,'category');changes.specialty=val(fd,'specialty');
            changes.target=Number(val(fd,'target'));}
          await patch('/'+tab+'/'+selected.id,changes);
        }
        setModal(null);setSelected(null);done();
      }}>
        <div className="data-form-grid"><TextInput name="name" label="الاسم" defaultValue={selected.name}/>
          {tab==='areas'?<>
            <TextInput name="city" label="المحافظة" defaultValue={selected.city||''}/>
            <SelectInput name="groupId" label="مجموعة المنطقة" required={false} defaultValue={selected.groupId||''}
              options={(areaGroups||[]).map((group:Any)=>({value:group.id,label:group.name}))}/>
          </>:<>
            <label className="field">المنطقة<input value={selected.area?.name||'—'} disabled/></label>
            {tab==='doctors'&&<><SpecialtyInput options={specialtyOptions||[]} defaultValue={selected.specialty}/>
              <SelectInput name="grade" label="التصنيف" defaultValue={selected.grade}
                options={['A','B','C'].map(v=>({value:v,label:v}))}/>
              <TextInput name="city" label="المدينة" required={false} defaultValue={selected.city||companyCity(selected.area)}/></>}
            {tab==='pharmacies'&&<><TextInput name="kind" label="نوع الصيدلية" defaultValue={selected.kind}/>
              <SelectInput name="grade" label="التصنيف" defaultValue={selected.grade}
                options={['A','B','C'].map(v=>({value:v,label:v}))}/>
              <TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue={selected.target}/></>}
            {tab==='hospitals'&&<><TextInput name="category" label="تصنيف المشفى" defaultValue={selected.category}/>
              <SpecialtyInput options={specialtyOptions||[]} defaultValue={selected.specialty}/>
              <TextInput name="target" label="عدد الزيارات المستهدف" type="number" defaultValue={selected.target}/></>}
          </>}
        </div>
      </Form>
      {tab!=='areas'&&<div className="company-record-status-action">
        <div><strong>{selected.active?'السجل نشط':'السجل مؤرشف'}</strong>
          <small>{selected.active?'يظهر في الجولات الجديدة.':'الزيارات السابقة ما زالت محفوظة.'}</small></div>
        <button className={selected.active?'danger-button':'outline-button'} type="button"
          disabled={busy} onClick={toggleStatus}>{busy?'جارٍ الحفظ...':selected.active?'أرشفة':'استعادة'}</button>
      </div>}</>}
    </CompanyModal>
    <CompanyModal open={modal==='import'} title="استيراد الأطباء من Excel"
      subtitle="نفس آلية الاستيراد الحالية مع الحفاظ على معالجة التكرارات." onClose={()=>setModal(null)} wide>
      <div className="company-embedded-v2"><DoctorExcelImport done={()=>{done();setModal(null)}}/></div>
    </CompanyModal>
  </div>;
}

function companyEscape(value:Any){
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  } as Any)[char]);
}
function companyPrintReport(title:string,subtitle:string,content:string){
  const popup=window.open('','_blank');
  if(!popup)throw Error('المتصفح منع فتح نافذة الطباعة');
  popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>'+
    companyEscape(title)+'</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#17211f}'+
    'h1{font-size:22px;margin:0 0 6px}p{color:#687471}.summary{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}'+
    '.summary span{border:1px solid #e5eae8;border-radius:10px;padding:10px 14px}table{width:100%;border-collapse:collapse;margin-top:16px}'+
    'th,td{padding:9px;border-bottom:1px solid #e5eae8;text-align:right;font-size:12px}th{color:#687471;background:#f8faf9}'+
    '@media print{button{display:none}}</style></head><body><h1>'+companyEscape(title)+'</h1><p>'+
    companyEscape(subtitle)+'</p>'+content+'<script>window.onload=function(){window.print()}<\/script></body></html>');
  popup.document.close();
}

function CompanyReportsPage({refresh,user}:Any){
  const [governorate,setGovernorate]=useState('all');
  const [teamId,setTeamId]=useState('all');
  const [period,setPeriod]=useState<'cycle'|'week'|'month'>('cycle');
  const [extras,setExtras]=useState<'submitted'|'leaves'|'weekly'|null>(null);
  const {data:settings,error:settingsError}=useData('/settings',refresh);
  const {data:areas,error:areasError}=useData('/areas',refresh);
  const {data:teams,error:teamsError}=useData('/teams',refresh);
  const {data:users,error:usersError}=useData('/users',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:frequency,error:frequencyError}=useData('/analytics/frequency',refresh);
  const bounds=period==='week'?companyWeekBounds():period==='month'?companyMonthBounds():{
    from:settings?.cycleStart?.slice(0,10)||today().slice(0,8)+'01',
    to:settings?.cycleEnd?.slice(0,10)||today()
  };
  const valid=bounds.from&&bounds.to&&bounds.from<=bounds.to;
  const {data:visitReport,error:visitError}=useData(valid?
    '/reports/visits?from='+encodeURIComponent(bounds.from)+'&to='+encodeURIComponent(bounds.to):null,refresh);
  const areaById=new Map((areas||[]).map((area:Any)=>[area.id,area]));
  const cities:string[]=[...new Set<string>((areas||[]).map((area:Any)=>companyCity(area)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const eligibleReps=(users||[]).filter((row:Any)=>row.role==='REP'&&
    (governorate==='all'||row.repAreas?.some((link:Any)=>companyCity(link.area)===governorate)));
  const eligibleRepIds=new Set<string>(eligibleReps.map((row:Any)=>row.id));
  const eligibleTeamIds=new Set<string>(eligibleReps.map((row:Any)=>row.teamId).filter(Boolean) as string[]);
  const teamRows=(teams||[]).filter((team:Any)=>
    (teamId==='all'||team.id===teamId)&&(governorate==='all'||eligibleTeamIds.has(team.id)));
  const filteredVisits=(visitReport?.rows||[]).filter((row:Any)=>{
    if(teamId!=='all'&&row.teamIdAtVisit!==teamId)return false;
    if(governorate!=='all'&&!(row.targetDetails||[]).some((target:Any)=>
      companyCity(areaById.get(target.areaIdAtVisit))===governorate))return false;
    return true;
  });
  const filteredTeamIds=new Set(teamRows.map((team:Any)=>team.id));
  const coverageRows=(coverage?.areas||[]).filter((row:Any)=>{
    if(teamId!=='all'&&row.teamId!==teamId)return false;
    if(governorate!=='all'&&companyCity(areaById.get(row.areaId))!==governorate)return false;
    return true;
  });
  const coverageTarget=coverageRows.reduce((sum:number,row:Any)=>sum+(Number(row.target)||0),0);
  const coverageDone=coverageRows.reduce((sum:number,row:Any)=>sum+Math.min(Number(row.done)||0,Number(row.target)||0),0);
  const coveragePct=coverageTarget?Math.min(100,Math.round(coverageDone/coverageTarget*100)):0;
  const repRows=(frequency?.personalItems||[]).filter((row:Any)=>
    (teamId==='all'||row.teamId===teamId)&&(governorate==='all'||eligibleRepIds.has(row.repId)));
  const visitTargets=filteredVisits.reduce((sum:number,row:Any)=>sum+(row.targetDetails?.length||0),0);
  const reports=[
    {id:'coverage',icon:'%',title:'تقرير التغطية',desc:'التغطية حسب المحافظة والفريق والمنطقة والمندوب',
      meta:coveragePct+'%'},
    {id:'visits',icon:'✓',title:'تقرير الزيارات',desc:'تفاصيل الزيارات المنفذة خلال الفترة',
      meta:visitTargets+' زيارة'},
    {id:'reps',icon:'👤',title:'تقرير أداء المندوبين',desc:'أداء كل مندوب ونسبة تحقيق أهدافه الفردية',
      meta:eligibleReps.filter((row:Any)=>teamId==='all'||row.teamId===teamId).length+' مندوباً'},
    {id:'teams',icon:'RX',title:'تقرير أداء الفرق',desc:'مقارنة أداء الفرق ومدراء الفرق ضمن الشركة',
      meta:teamRows.length+' فرق'},
    {id:'areas',icon:'◎',title:'تقرير المناطق',desc:'التغطية والزيارات والأهداف حسب المناطق',
      meta:new Set(coverageRows.map((row:Any)=>row.areaId)).size+' منطقة'}
  ];
  function printReport(id:string){
    if(id==='coverage'){
      const rows=coverageRows.map((row:Any)=>'<tr><td>'+companyEscape(row.teamName)+'</td><td>'+
        companyEscape(row.areaName)+'</td><td>'+row.done+' / '+row.target+'</td><td>'+row.coverage+'%</td></tr>').join('');
      companyPrintReport('تقرير التغطية',bounds.from+' — '+bounds.to,
        '<div class="summary"><span>التغطية: '+coveragePct+'%</span><span>المنجز: '+coverageDone+
        ' / '+coverageTarget+'</span></div><table><thead><tr><th>الفريق</th><th>المنطقة</th><th>المنجز / المطلوب</th><th>التغطية</th></tr></thead><tbody>'+rows+'</tbody></table>');
      return;
    }
    if(id==='visits'){
      const rows=filteredVisits.map((row:Any)=>'<tr><td>'+companyEscape(row.date)+'</td><td>'+
        companyEscape(row.repName)+'</td><td>'+companyEscape(row.teamName)+'</td><td>'+
        companyEscape(typeLabels[row.type]||row.type)+'</td><td>'+companyEscape((row.targets||[]).join('، '))+
        '</td></tr>').join('');
      companyPrintReport('تقرير الزيارات',bounds.from+' — '+bounds.to,
        '<div class="summary"><span>الجولات: '+filteredVisits.length+'</span><span>الجهات: '+visitTargets+
        '</span></div><table><thead><tr><th>التاريخ</th><th>المندوب</th><th>الفريق</th><th>النوع</th><th>الجهات</th></tr></thead><tbody>'+rows+'</tbody></table>');
      return;
    }
    if(id==='reps'){
      const groups=new Map<string,Any>();
      for(const row of repRows){
        const current=groups.get(row.repId)||{name:row.repName,done:0,target:0};
        current.done+=Number(row.done)||0;current.target+=Number(row.target)||0;groups.set(row.repId,current);
      }
      const rows=[...groups.values()].map((row:Any)=>{
        const pct=row.target?Math.min(100,Math.round(row.done/row.target*100)):0;
        return '<tr><td>'+companyEscape(row.name)+'</td><td>'+row.done+' / '+row.target+'</td><td>'+pct+'%</td></tr>';
      }).join('');
      companyPrintReport('تقرير أداء المندوبين',bounds.from+' — '+bounds.to,
        '<table><thead><tr><th>المندوب</th><th>المنجز / المطلوب</th><th>الإنجاز</th></tr></thead><tbody>'+rows+'</tbody></table>');
      return;
    }
    if(id==='teams'){
      const rows=(coverage?.teamTotals||[]).filter((row:Any)=>filteredTeamIds.has(row.teamId))
        .map((row:Any)=>'<tr><td>'+companyEscape(row.teamName)+'</td><td>'+row.doctors+'</td><td>'+
          row.done+' / '+row.target+'</td><td>'+row.coverage+'%</td></tr>').join('');
      companyPrintReport('تقرير أداء الفرق',bounds.from+' — '+bounds.to,
        '<table><thead><tr><th>الفريق</th><th>الأطباء</th><th>المنجز / المطلوب</th><th>التغطية</th></tr></thead><tbody>'+rows+'</tbody></table>');
      return;
    }
    const grouped=new Map<string,Any>();
    for(const row of coverageRows){
      const current=grouped.get(row.areaId)||{name:row.areaName,done:0,target:0};
      current.done+=Number(row.done)||0;current.target+=Number(row.target)||0;grouped.set(row.areaId,current);
    }
    const rows=[...grouped.values()].map((row:Any)=>{
      const pct=row.target?Math.min(100,Math.round(row.done/row.target*100)):0;
      return '<tr><td>'+companyEscape(row.name)+'</td><td>'+row.done+' / '+row.target+'</td><td>'+pct+'%</td></tr>';
    }).join('');
    companyPrintReport('تقرير المناطق',bounds.from+' — '+bounds.to,
      '<table><thead><tr><th>المنطقة</th><th>المنجز / المطلوب</th><th>التغطية</th></tr></thead><tbody>'+rows+'</tbody></table>');
  }
  const errors=[settingsError,areasError,teamsError,usersError,coverageError,frequencyError,visitError].filter(Boolean);
  return <div className="company-reports-page company-reports-legacy">
    <CompanyLegacyHead title="التقارير" subtitle="عرض وتصدير تقارير الأداء والزيارات والتغطية"
      actions={<div className="company-report-extra-actions">
        <button className="outline-button" type="button" onClick={()=>setExtras('submitted')}>تقارير المندوبين</button>
        <button className="outline-button" type="button" onClick={()=>setExtras('leaves')}>طلبات الإجازة</button>
      </div>}/>
    {errors.length>0&&<Notice kind="error">{errors[0]}</Notice>}
    <div className="report-filters">
      <label className="report-filter-field"><span>المحافظة</span><select value={governorate}
        onChange={e=>setGovernorate(e.target.value)}><option value="all">كل المحافظات</option>
        {cities.map(city=><option key={city} value={city}>{city}</option>)}</select></label>
      <label className="report-filter-field"><span>الفريق</span><select value={teamId}
        onChange={e=>setTeamId(e.target.value)}><option value="all">كل الفرق</option>
        {(teams||[]).map((team:Any)=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label className="report-filter-field"><span>الفترة</span><select value={period}
        onChange={e=>setPeriod(e.target.value as Any)}>
        <option value="cycle">السايكل الحالي</option><option value="week">هذا الأسبوع</option>
        <option value="month">هذا الشهر</option></select></label>
    </div>
    <div className="reports-list">{reports.map(report=>
      <article className="report-card" key={report.id}><div className="report-card-icon">{report.icon}</div>
        <div className="report-card-content"><strong>{report.title}</strong><p>{report.desc}</p>
          <span className="report-card-meta">{report.meta}</span></div>
        <button className="report-export-button" type="button" onClick={()=>printReport(report.id)}>
          تصدير PDF</button></article>)}</div>
    <div className="company-report-tools">
      <button className="text-button" type="button" onClick={()=>setExtras('weekly')}>أداة الزيارات الأسبوعية للمندوبين</button>
      <small>ملفات PDF يتم إنشاؤها من المتصفح باستخدام البيانات الحالية، بدون تغيير Backend.</small>
    </div>
    <CompanyModal open={extras!==null}
      title={extras==='submitted'?'تقارير المندوبين المرسلة':extras==='leaves'?'طلبات الإجازة':'الزيارات الأسبوعية'}
      subtitle="وظيفة النظام الحالية محفوظة داخل واجهة التقارير القديمة." onClose={()=>setExtras(null)} wide>
      <div className="company-embedded-v2">{extras==='submitted'?<SubmittedRepReports refresh={refresh}/>:
        extras==='leaves'?<Records kind="leaves" refresh={refresh}/>:<WeeklyVisits refresh={refresh} user={user}/>}</div>
    </CompanyModal>
  </div>;
}

function CompanySettingsPage({refresh,done,user}:Any){
  const {data,error}=useData('/settings',refresh);
  const [busy,setBusy]=useState(false),[saveError,setSaveError]=useState(''),[saved,setSaved]=useState(false);
  const [goalsOpen,setGoalsOpen]=useState(false);
  const formId='company-settings-form';
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setSaveError('');setSaved(false);
    try{
      const fd=new FormData(event.currentTarget),workingDays=fd.getAll('workingDays').map(Number);
      if(!workingDays.length)throw Error('حدّد يوم عمل واحداً على الأقل');
      await patch('/settings',{
        cycleStart:val(fd,'cycleStart')||null,cycleEnd:val(fd,'cycleEnd')||null,
        frequencyA:Number(val(fd,'frequencyA')),frequencyB:Number(val(fd,'frequencyB')),
        frequencyC:Number(val(fd,'frequencyC')),annualLeaveBalance:Number(val(fd,'annualLeaveBalance')),
        targetACoverage:Number(val(fd,'targetACoverage')),
        managerInstructions:val(fd,'managerInstructions')||null,
        workingDays
      });
      setSaved(true);done();
    }catch(e:Any){setSaveError(e.message||'تعذر حفظ الإعدادات');}
    finally{setBusy(false);}
  }
  return <div className="company-settings-page company-settings-legacy">
    <CompanyLegacyHead title="الإعدادات" subtitle="إعدادات دورة العمل والأهداف الافتراضية للشركة"
      actions={<button className="primary-button" type="submit" form={formId} disabled={busy}>
        {busy?'جارٍ الحفظ...':'حفظ التغييرات'}</button>}/>
    {error&&<Notice kind="error">{error}</Notice>}
    {saveError&&<Notice kind="error">{saveError}</Notice>}
    {saved&&<Notice kind="success">تم حفظ الإعدادات بنجاح</Notice>}
    {data&&<form id={formId} className="settings-layout" onSubmit={submit}>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-icon">↻</div>
        <div><h3>دورة العمل</h3><p>تحديد فترة السايكل الحالية للشركة</p></div></div>
        <div className="settings-fields two-columns">
          <label className="settings-field"><span>بداية السايكل</span>
            <input name="cycleStart" type="date" defaultValue={data.cycleStart?.slice(0,10)||''}/></label>
          <label className="settings-field"><span>نهاية السايكل</span>
            <input name="cycleEnd" type="date" defaultValue={data.cycleEnd?.slice(0,10)||''}/></label>
        </div>
      </section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-icon">◎</div>
        <div><h3>تكرار الزيارات</h3><p>عدد الزيارات المطلوبة لكل تصنيف طبيب خلال السايكل</p></div></div>
        <div className="frequency-settings">{['A','B','C'].map(grade=>
          <div className="frequency-item" key={grade}><div className={'frequency-grade grade-'+grade.toLowerCase()}>{grade}</div>
            <div className="frequency-info"><strong>Class {grade}</strong><span>{
              grade==='A'?'الأطباء الأعلى أولوية':grade==='B'?'الأطباء متوسطي الأولوية':'الأطباء الأقل أولوية'
            }</span></div>
            <label className="frequency-input"><input name={'frequency'+grade} type="number" min="1" max="30"
              defaultValue={data['frequency'+grade]}/><span>{grade==='A'?'زيارات':'زيارة'}</span></label>
          </div>)}</div>
        <div className="settings-note">تطبّق هذه الأهداف على جميع فرق ومندوبي الشركة.
          ويمكن تخصيص هدف لفريق أو مندوب من قسم تخصيص أهداف الأطباء.</div>
        <button className="outline-button company-goals-button" type="button" onClick={()=>setGoalsOpen(true)}>
          تخصيص أهداف الأطباء</button>
      </section>
      <section className="settings-card"><div className="settings-card-heading">
        <div className="settings-icon">★</div>
        <div><h3>الخطة والأصناف</h3><p>الهدف المطلوب لأطباء A والتعليمات الافتراضية للمندوبين</p></div>
      </div>
        <div className="settings-fields two-columns">
          <label className="settings-field"><span>هدف تغطية أطباء A</span>
            <div className="input-with-unit"><input name="targetACoverage" type="number"
              min="0" max="100" defaultValue={data.targetACoverage??80}/><span>%</span></div>
            <small>نسبة أطباء A التي يجب زيارة كل طبيب منها مرة واحدة على الأقل في السايكل.</small>
          </label>
          <label className="settings-field"><span>تعليمات المدير الافتراضية</span>
            <textarea name="managerInstructions" maxLength={1000} rows={4}
              defaultValue={data.managerInstructions||''}
              placeholder="التعليمات التي تظهر للمندوبين دون تعليمات خاصة بفريقهم"/>
          </label>
        </div>
      </section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-icon">⌁</div>
        <div><h3>إعدادات المندوبين الافتراضية</h3><p>القيم التي يتم اعتمادها عند إدارة حسابات المندوبين</p></div></div>
        <div className="settings-fields two-columns">
          <label className="settings-field"><span>الهدف اليومي الافتراضي</span>
            <div className="input-with-unit"><input value="8" disabled/><span>زيارات / يوم</span></div>
            <small>حالياً القيمة الافتراضية ثابتة في النظام؛ تعديل كل مندوب متاح من صفحة الفرق والمندوبون.</small></label>
          <label className="settings-field"><span>رصيد الإجازات السنوي</span>
            <div className="input-with-unit"><input name="annualLeaveBalance" type="number" min="0" max="365"
              defaultValue={data.annualLeaveBalance}/><span>يوم</span></div></label>
        </div>
        <div className="company-working-days"><span>أيام العمل المعتمدة</span><div>
          {[
            ['0','الأحد'],['1','الإثنين'],['2','الثلاثاء'],['3','الأربعاء'],
            ['4','الخميس'],['5','الجمعة'],['6','السبت']
          ].map(([id,name])=><label key={id}><input type="checkbox" name="workingDays" value={id}
            defaultChecked={(data.workingDays||[]).includes(Number(id))}/><span>{name}</span></label>)}</div></div>
      </section>
    </form>}
    <CompanyModal open={goalsOpen} title="تخصيص أهداف الأطباء"
      subtitle="الميزة الجديدة تبقى متاحة بدون تغيير شكل صفحة الإعدادات القديمة." onClose={()=>setGoalsOpen(false)} wide>
      <div className="company-embedded-v2"><DoctorGoalEditor refresh={refresh} done={done}/></div>
    </CompanyModal>
  </div>;
}

function CompanyAdminRoute({section,revision,refresh,user,navigateTo,governorate}:Any){
  switch(section){
    case 'dashboard':return <CompanyAdminDashboard refresh={revision} user={user}
      navigate={navigateTo} governorate={governorate}/>;
    case 'governorates':return <CompanyGovernoratesPage refresh={revision}
      governorate={governorate} navigate={navigateTo}/>;
    case 'teams':return <CompanyTeamsPage refresh={revision} done={refresh}
      user={user} governorate={governorate}/>;
    case 'coverage':return <CompanyCoveragePage refresh={revision} done={refresh} user={user}/>;
    case 'data':return <CompanyDataPage refresh={revision} done={refresh} user={user}/>;
    case 'reports':return <CompanyReportsPage refresh={revision} user={user}/>;
    case 'settings':return <CompanySettingsPage refresh={revision} done={refresh} user={user}/>;
    default:return <Empty/>;
  }
}

type RouteContext={user:User,revision:number,refresh:()=>void,navigateTo:(key:string,query?:Record<string,string|undefined>)=>void,onLogout:()=>void,companyGovernorate?:string};

function PageContent({section}:Any){
  const {user,revision,refresh,navigateTo,onLogout,companyGovernorate='all'}=useOutletContext<RouteContext>();
  const [params]=useSearchParams();
  const queryArea=params.get('areaId');
  const queryType=params.get('type');
  if(user.role==='TEAM_MANAGER'&&section!=='dashboard'){
    return <TeamManagerRoute section={section} revision={revision} refresh={refresh}
      user={user} navigateTo={navigateTo}/>;
  }
  if(user.role==='COMPANY_ADMIN'&&
    ['dashboard','governorates','teams','coverage','data','reports','settings'].includes(section)){
    return <CompanyAdminRoute section={section} revision={revision} refresh={refresh}
      user={user} navigateTo={navigateTo} governorate={params.get('gov')||companyGovernorate}/>;
  }
  switch(section){
    case 'dashboard':return user.role==='REP'?<RepHome refresh={revision} user={user}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>:
      user.role==='TEAM_MANAGER'?<TeamManagerHome refresh={revision} user={user}
        navigate={(key:string)=>navigateTo(key)}/>:<Dashboard refresh={revision}/>;
    case 'analytics':return <RepAnalytics refresh={revision} user={user}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>;
    case 'analysis-detail':return params.get('kind')==='products'?
      <RepProductAnalysis refresh={revision} navigate={(key:string)=>navigateTo(key)}/>:
      params.get('kind')==='cycles'?
      <RepCycleComparison refresh={revision} navigate={(key:string)=>navigateTo(key)}/>:
      <RepAnalysisDetail refresh={revision} user={user}
        kind={params.get('kind')||'frequency'} navigate={(key:string)=>navigateTo(key)}/>;
    case 'plan-products':return <RepPlanProducts refresh={revision} user={user}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>;
    case 'profile':return <RepProfile user={user} refresh={revision} onLogout={onLogout}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>;
    case 'rep-settings':return <RepAccountSettings user={user}
      navigate={(key:string)=>navigateTo(key)}/>;
    case 'new-visit':return <NewVisit key={(queryArea||'standalone')+':'+(queryType||'unset')}
      initialAreaId={queryArea} initialType={queryType} refresh={revision}
      done={refresh} onSaved={()=>navigateTo('visits')} user={user}/>;
    case 'visits':return user.role==='REP'?
      <RepVisitHistory refresh={revision} navigate={(key:string)=>navigateTo(key)}/>:
      <Records kind="visits" refresh={revision}/>;
    case 'new-leave':return user.role==='REP'?
      <RepLeaves refresh={revision} onSaved={refresh}
        navigate={(key:string)=>navigateTo(key)}/>:<NewLeave done={refresh}/>;
    case 'leaves':return <Records kind="leaves" refresh={revision}/>;
    case 'reports':return user.role==='REP'?<RepReports refresh={revision} user={user}
      navigate={(key:string,query?:Record<string,string>)=>navigateTo(key,query)}/>:
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
        navigate={(key:string)=>navigateTo(key)}
        onBeginAreaTour={(areaId:string,type:string)=>navigateTo('new-visit',{areaId,type})}/>:
      <Directory key={section} kind={section} refresh={revision} done={refresh} user={user}/>;
    case 'doctors':case 'pharmacies':case 'hospitals':
      return user.role==='REP'?
        <RepMedicalDirectory key={section} kind={section} refresh={revision} user={user}
          navigate={(key:string)=>navigateTo(key)}
          onBeginTour={(type:string,areaId?:string)=>navigateTo('new-visit',{type,areaId})}/>:
        <Directory key={section} kind={section} refresh={revision} done={refresh}
          user={user} onBeginTour={(type:string)=>navigateTo('new-visit',{type})}/>;
    default:return <Empty/>;
  }
}

function PageLayout({user,revision,onLogout,onRefresh}:Any){
  const location=useLocation();
  const navigate=useNavigate();
  const [companyGovernorate,setCompanyGovernorate]=useState('all');
  const [repAlertsOpen,setRepAlertsOpen]=useState(false);
  const menu=menus[user.role]||[];
  const section=menu.find(([key])=>location.pathname===routePath(user.role,key))?.[0]||
    (user.role==='SUPER_ADMIN'?'companies':'dashboard');
  function navigateTo(key:string,query?:Record<string,string|undefined>){
    if(key==='__refresh__')return;
    navigate(routePath(user.role,key,query));
  }
  const title=menu.find(x=>x[0]===section)?.[1]||'لوحة التحكم';
  useEffect(()=>setRepAlertsOpen(false),[section]);
  const {data:managerDashboard}=useData(user.role==='TEAM_MANAGER'?'/dashboard':null,revision);
  const {data:managerReports}=useData(user.role==='TEAM_MANAGER'?'/rep-reports':null,revision);
  const {data:managerPendingLeaves}=useData(user.role==='TEAM_MANAGER'?'/leaves?status=PENDING&limit=100&offset=0':null,revision);
  const {data:managerSettings}=useData(user.role==='TEAM_MANAGER'?'/settings':null,revision);
  const {data:managerAreas}=useData(user.role==='TEAM_MANAGER'?'/areas':null,revision);
  const {data:companyAreas}=useData(user.role==='COMPANY_ADMIN'?'/areas':null,revision);
  const {data:companySettings}=useData(user.role==='COMPANY_ADMIN'?'/settings':null,revision);
  // The original REP shell has only four primary tabs. Keep secondary routes
  // protected and bookmarkable, but open them from their contextual entrypoints.
  const visibleMenu=user.role==='REP'?menu.filter(([key]:[string,string])=>
    ['dashboard','analytics','reports','profile'].includes(key)):
    user.role==='TEAM_MANAGER'?menu.filter(([key]:[string,string])=>key!=='area-coverage'):
    user.role==='COMPANY_ADMIN'?menu.filter(([key]:[string,string])=>
      ['dashboard','governorates','teams','coverage','data','reports'].includes(key)):menu;
  const managerIcons:Record<string,string>={
    dashboard:'▦',users:'👥',teams:'🗂️',areas:'📍',doctors:'🩺',pharmacies:'💊',hospitals:'🏥',
    visits:'🚗',leaves:'🏖',reports:'📄',frequency:'📊',products:'📦',settings:'⚙️','area-coverage':'◎'
  };
  const companyIcons:Record<string,string>={
    dashboard:'⌂',governorates:'▦',teams:'♙',coverage:'◔',data:'▤',reports:'▥',settings:'⚙'
  };
  if(user.role==='COMPANY_ADMIN'){
    const governorates:string[]=[...new Set<string>((companyAreas||[]).map((area:Any)=>
      String(area.city||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
    const cycleStart=companySettings?.cycleStart?.slice(0,10);
    const cycleEnd=companySettings?.cycleEnd?.slice(0,10);
    return <div className="company-legacy-shell">
      <aside className="company-sidebar">
        <div className="company-brand">
          <div className="company-logo">M</div>
          <div className="company-brand-text"><strong>Mandob</strong><span>Company Manager</span></div>
        </div>
        <nav className="sidebar-nav">{visibleMenu.map(([key,label])=>
          <button key={key} className={'nav-item '+(section===key?'active':'')} type="button"
            onClick={()=>navigateTo(key)}>
            <span className="nav-icon">{companyIcons[key]||'•'}</span><span>{label}</span>
          </button>)}</nav>
        <div className="sidebar-bottom">
          <button className={'nav-item '+(section==='settings'?'active':'')} type="button"
            onClick={()=>navigateTo('settings')}><span className="nav-icon">⚙</span><span>الإعدادات</span></button>
          <div className="manager-profile"><div className="manager-avatar">{managerInitials(user.name)}</div>
            <div className="company-manager-copy"><strong>{user.name}</strong><span>Company Manager</span></div>
            <button className="company-logout" type="button" onClick={onLogout}>خروج</button>
          </div>
        </div>
      </aside>
      <main className="company-main-content">
        <header className="company-topbar">
          <div><h1>{title}</h1><p>{section==='dashboard'?'نظرة عامة على أداء الشركة':
            section==='governorates'?'متابعة وإدارة أداء الشركة حسب المحافظة':
            section==='teams'?'إدارة الفرق ومدراء الفرق والمندوبين':
            section==='coverage'?'متابعة التغطية حسب الفريق والمنطقة':
            section==='data'?'الأطباء والصيدليات والمشافي والمناطق':
            section==='reports'?'تقارير الأداء والزيارات والتغطية':'إعدادات العمل الخاصة بالشركة'}</p></div>
          <div className="topbar-actions">
            <label className="governorate-filter"><span>المحافظة</span>
              <select value={companyGovernorate} onChange={e=>setCompanyGovernorate(e.target.value)}>
                <option value="all">كل المحافظات</option>
                {governorates.map(city=><option key={city} value={city}>{city}</option>)}
              </select></label>
            <div className="company-cycle-pill"><span>السايكل</span>
              <b>{cycleStart&&cycleEnd?cycleStart+' — '+cycleEnd:'غير محدد'}</b></div>
            <button className="notification-button" type="button" onClick={onRefresh} title="تحديث البيانات">↻</button>
          </div>
        </header>
        <div className="company-content">
          <Outlet context={{user,revision,refresh:onRefresh,navigateTo,onLogout,companyGovernorate}}/>
        </div>
      </main>
      <nav className="company-mobile-nav" aria-label="تنقل مدير الشركة">
        {[
          ['dashboard','⌂','الرئيسية'],['governorates','▦','المحافظات'],
          ['teams','♙','الفرق'],['reports','▥','التقارير']
        ].map(([key,icon,label])=><button key={key} type="button"
          className={section===key?'active':''} onClick={()=>navigateTo(key)}>
          <span>{icon}</span><small>{label}</small>
        </button>)}
      </nav>
    </div>;
  }
  if(user.role==='TEAM_MANAGER'){
    const countFor=(key:string)=>{
      if(key==='users')return managerDashboard?.reps;
      if(key==='visits')return managerDashboard?.visits;
      if(key==='reports')return Array.isArray(managerReports)?managerReports.length:undefined;
      if(key==='leaves')return Array.isArray(managerPendingLeaves)?managerPendingLeaves.length:managerDashboard?.pendingLeaves;
      return undefined;
    };
    const cycleStart=managerSettings?.cycleStart?.slice(0,10);
    const cycleEnd=managerSettings?.cycleEnd?.slice(0,10);
    const managerGovernorates=[...new Set((managerAreas||[]).map((area:Any)=>
      String(area.city||'').trim()).filter(Boolean))];
    const managerGovernorate=managerGovernorates.length?
      managerGovernorates.join('، '):'غير محددة';
    return <div className="layout manager-layout manager-legacy-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">✦</div>
          <div><h2>MedRep Manager</h2><p>إدارة فريق • {managerGovernorate}</p></div>
        </div>
        <div className="menu">{visibleMenu.map(([key,label])=><button key={key} type="button"
          className={section===key?'active':''} onClick={()=>navigateTo(key)}>
          <span>{managerIcons[key]||'•'} <b>{label}</b></span>
          {countFor(key)!==undefined&&<span className="count">{countFor(key)}</span>}
        </button>)}</div>
        <div className="manager-card">
          <div className="avatar">{managerInitials(user.name)}</div>
          <div className="manager-card-copy"><b>{user.name}</b><small>مدير فريق</small></div>
          <button className="manager-logout" type="button" onClick={onLogout}>خروج</button>
        </div>
      </aside>
      <main className="manager-main">
        <header className="topbar">
          <div><h1>{section==='dashboard'?'لوحة مدير الفريق':title}</h1>
            <p><b>المحافظة: {managerGovernorate}</b>{cycleStart&&cycleEnd?
              ' • دورة '+cycleStart+' — '+cycleEnd:' • متابعة أداء الفريق والزيارات'}</p></div>
          <div className="top-actions">
            <button className="filter-btn" type="button" onClick={()=>navigateTo('frequency')}>
              📅 <span>هذا الأسبوع</span></button>
            <button className="icon-btn" type="button" aria-label="طلبات الإجازة المعلقة"
              onClick={()=>navigateTo('leaves')} title="طلبات تحتاج قرارك">
              🔔 {managerPendingLeaves?.length?
                <span className="manager-notification-count">{managerPendingLeaves.length}</span>:null}
            </button>
            <button className="icon-btn" type="button" onClick={onRefresh}
              aria-label="تحديث البيانات" title="تحديث البيانات">↻</button>
          </div>
        </header>
        <div className="content"><Outlet context={{user,revision,refresh:onRefresh,navigateTo,onLogout,companyGovernorate}}/></div>
      </main>
      <nav className="mobile-nav" aria-label="التنقل الرئيسي لمدير الفريق">
        {[
          ['dashboard','▦','الرئيسية'],['users','👥','الفريق'],
          ['reports','📄','التقارير'],['frequency','📊','التحليلات']
        ].map(([key,icon,label])=><button key={key} type="button"
          className={section===key?'active':''} onClick={()=>navigateTo(key)}>
          <span>{icon}</span><small>{label}</small>
        </button>)}
      </nav>
    </div>;
  }
  const layoutClass=user.role==='REP'?'layout rep-layout':
    user.role==='TEAM_MANAGER'?'layout manager-layout':'layout';
  return <div className={layoutClass}>
    <aside className="sidebar"><div className="brand">
      <span className="brand-symbol">{user.role==='TEAM_MANAGER'?'✦':'M'}</span>
      <div><strong>{user.role==='TEAM_MANAGER'?'MedRep Manager':'Mandob'}</strong>
        <small>{user.role==='TEAM_MANAGER'?'إدارة فريق المندوبين':'Medical Representatives'}</small></div></div>
      <div className="side-label">القائمة الرئيسية</div>
      <nav>{visibleMenu.map(([key,label])=><button key={key} type="button" className={section===key?'active':''}
        onClick={()=>navigateTo(key)}>
        {user.role==='TEAM_MANAGER'&&<span className="manager-nav-icon" aria-hidden="true">{managerIcons[key]||'•'}</span>}
        <span>{label}</span>
      </button>)}</nav>
      <div className="side-footer">
        {user.role==='TEAM_MANAGER'&&<span className="manager-footer-avatar">
          {user.name.split(/\s+/).filter(Boolean).slice(0,2).map((x:string)=>x[0]).join('')||'م'}
        </span>}
        <div className="side-user-copy"><strong>{user.name}</strong><small>{labels[user.role]}</small></div>
        <button type="button" className="btn outline" onClick={onLogout}>تسجيل الخروج</button>
      </div>
    </aside>
    <main className="main">
      {user.role==='REP'?<header className="topbar rep-classic-topbar">
        <div className="rep-header-brand">
          <span className="rep-header-logo" aria-hidden="true">M</span>
          <span className="rep-header-copy"><strong>MedREP</strong>
            <small>{section==='dashboard'?'المساعد اليومي':title}</small></span>
        </div>
        <div className="rep-header-notifications">
          <button type="button" className="rep-header-bell" aria-label="عرض التنبيهات المهمة"
            aria-expanded={repAlertsOpen} onClick={()=>setRepAlertsOpen(v=>!v)}>🔔</button>
          {repAlertsOpen&&<div className="rep-header-alert-panel">
            <strong>تنبيهات مهمة</strong>
            <button type="button" onClick={()=>{setRepAlertsOpen(false);
              navigateTo('analysis-detail',{kind:'aDoctors'});}}>أطباء A غير المزارين</button>
            <button type="button" onClick={()=>{setRepAlertsOpen(false);
              navigateTo('analysis-detail',{kind:'coverage'});}}>تغطية المناطق</button>
          </div>}
        </div>
      </header>:<header className="topbar"><div>
        <span className="eyebrow">{user.role==='TEAM_MANAGER'?'لوحة مدير الفريق':'إدارة المندوبين الطبيين'}</span>
        <h1>{title}</h1></div><span className="avatar">{user.name.slice(0,1)}</span>
      </header>}
      <div className="page">
        <Outlet context={{user,revision,refresh:onRefresh,navigateTo,onLogout,companyGovernorate}}/>
      </div>
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

function RepLocationGate({children,onLogout}:{children:React.ReactNode,onLogout:()=>void}){
  const [status,setStatus]=useState<'checking'|'granted'|'denied'|'unavailable'>('checking');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    setStatus('checking');
    // Every entry/retry checks that the device can actually provide a fresh location.
    // This reading is discarded and never used to register a visit.
    void requestLocationPermission(navigator.geolocation).then(result=>{
      if(active)setStatus(result);
    });
    return ()=>{active=false;};
  },[retry]);
  useEffect(()=>{
    // Re-check when returning from phone/browser settings.
    const onVisible=()=>{
      if(document.visibilityState==='visible')setRetry(value=>value+1);
    };
    document.addEventListener('visibilitychange',onVisible);
    return ()=>document.removeEventListener('visibilitychange',onVisible);
  },[]);
  if(status==='granted')return <>{children}</>;
  return <div className="login-wrap"><div className="login-card">
    <span className="brand-symbol">M</span><h1>Mandob</h1>
    <h2>تفعيل الموقع مطلوب</h2>
    <p>لاستخدام حساب المندوب، فعّل خدمات الموقع واسمح للتطبيق بالوصول إليه.
      يُستخدم الموقع للتحقق من مكان نهاية الجولة عند حفظها.</p>
    {status==='checking'?
      <div className="loading" role="status">جارٍ التحقق من خدمات الموقع...</div>:
      <Notice kind="error">{status==='denied'?
        'صلاحية الموقع مرفوضة. اضغط إعادة المحاولة. إذا منع المتصفح الطلب مجددًا، اسمح بالموقع من إعدادات هذا الموقع في المتصفح.':
        'تعذّر الوصول إلى الموقع. تأكد من تشغيل خدمات الموقع والموقع الدقيق، ثم أعد المحاولة.'}</Notice>}
    <div className="form">
      <button type="button" className="btn primary large" disabled={status==='checking'}
        onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</button>
      <button type="button" className="btn outline" onClick={onLogout}>تسجيل الخروج</button>
    </div>
  </div></div>;
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
  const pages=<AuthenticatedRoutes user={user} revision={revision} onLogout={logout}
    onRefresh={()=>setRevision(value=>value+1)}/>;
  return user.role==='REP'?
    <RepLocationGate onLogout={logout}>{pages}</RepLocationGate>:pages;
}

export default function App(){
  return <BrowserRouter><RoutedApp/></BrowserRouter>;
}
function RepAreas({refresh,user,onBeginAreaTour,navigate}:Any){
  const {data:areas,error:areaError}=useData('/areas',refresh);
  const {data:coverage,error:coverageError}=useData('/analytics/area-coverage',refresh);
  const {data:workspace,error:workspaceError}=useData('/rep-workspace-summary',refresh);
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [entityType,setEntityType]=useState('DOCTOR');
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[selected,entityType]);
  const pageSize=100;
  const path=!selected?null:entityType==='DOCTOR'?
    '/reps/'+encodeURIComponent(user.id)+'/doctors':
    '/'+(entityType==='PHARMACY'?'pharmacies':'hospitals')+
      '?areaId='+encodeURIComponent(selected)+'&limit='+pageSize+'&offset='+page*pageSize;
  const {data:entities,error:entityError}=useData(path,refresh);
  const groupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const availableAreas=(areas||[]).filter((area:Any)=>
    String(area.name||'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const coverageFor=(id:string)=>(coverage?.areas||[]).find((row:Any)=>
    row.areaId===id&&row.groupKey===groupKey);
  const current=(areas||[]).find((area:Any)=>area.id===selected);
  const currentMetrics=current?coverageFor(current.id):null;
  const visibleEntities=(entities||[]).filter((item:Any)=>inArea(item,selected||''));
  const entityKey=entityType==='DOCTOR'?'doctors':
    entityType==='PHARMACY'?'pharmacies':'hospitals';
  const counts=workspace?.visitCounts?.[entityKey]||{};
  const lastDates=workspace?.lastVisitDates?.[entityKey]||{};
  const visitTargets=workspace?.visitTargets?.[entityKey]||{};
  const needsVisit=(item:Any)=>entityType==='HOSPITAL'?
    Number(counts[item.id]||0)<Number(item.target||1):!Number(counts[item.id]||0);
  const entityTitle=entityType==='DOCTOR'?'الأطباء':
    entityType==='PHARMACY'?'الصيدليات':'المشافي';
  const unvisitedLabel=entityType==='HOSPITAL'?'بحاجة زيارة':
    entityType==='PHARMACY'?'غير مزارة':'غير مزار';
  const gradeA=visibleEntities.filter((item:Any)=>item.grade==='A').length;
  const privateHospitals=visibleEntities.filter((item:Any)=>item.category==='خاص').length;
  const unvisited=workspace?visibleEntities.filter(needsVisit).length:null;
  return <div className="rep-medical-page rep-legacy-areas-page">
    <div className="rep-legacy-page-head">
      <h2>{current?'المنطقة: '+current.name:'المناطق'}</h2>
      <button type="button" className="rep-legacy-back"
        onClick={()=>current?setSelected(null):navigate('dashboard')}>
        ← {current?'العودة للمناطق':'الرجوع للرئيسية'}
      </button>
    </div>
    {!current&&<div className="rep-legacy-search-bar">
      <input aria-label="بحث عن منطقة" value={search}
        placeholder="ابحث عن منطقة"
        onChange={e=>setSearch(e.target.value)}/>
    </div>}
    {(areaError||coverageError||workspaceError)&&<Notice kind="error">
      {[areaError,coverageError,workspaceError].filter(Boolean).join('، ')}
    </Notice>}
    {!areas&&!areaError?<Empty text="جارٍ تحميل المناطق..."/>:
      !current&&(!areas?.length?<Empty text="ما في مناطق مسندة لحسابك"/>:
        !availableAreas.length?<Empty text="ما في مناطق تطابق البحث"/>:
        <div className="rep-area-grid">{availableAreas.map((area:Any)=>{
          const metrics=coverageFor(area.id);
          return <button type="button" className="rep-area-card"
            key={area.id} onClick={()=>{setSelected(area.id);setEntityType('DOCTOR');}}>
            <div className="rep-area-preview-head">
              <strong>📍 {area.name}</strong><strong>{metrics?metrics.coverage+'%':'—'}</strong>
            </div>
            <div className="meter"><span style={{width:(metrics?.coverage||0)+'%'}}/></div>
            <small>{metrics?metrics.doctors+' طبيب • '+metrics.unvisited+
              ' غير مزار • '+metrics.gradeA+' أطباء A':'لا توجد بيانات تغطية للمنطقة'}</small>
          </button>;
        })}</div>)}
    {current&&<>
      <div className="rep-hero rep-legacy-area-detail-hero">
        <p>تغطية المنطقة</p>
        <h2>{currentMetrics?currentMetrics.coverage+'%':'—'}</h2>
        <div className="meter"><span style={{width:(currentMetrics?.coverage||0)+'%'}}/></div>
        <small>{currentMetrics?currentMetrics.done+' / '+currentMetrics.target+
          ' زيارة للفريق':'لا توجد أهداف مسجلة لهذه المنطقة'}</small>
      </div>
      <div className="rep-area-tabs" role="group" aria-label="الجهات الطبية في المنطقة">
        {Object.entries(typeLabels).map(([value,label])=>
          <button key={value} type="button" className={'btn small'+
            (entityType===value?' primary':'')} aria-pressed={entityType===value}
            onClick={()=>setEntityType(value)}>{label}</button>)}
      </div>
      <div className="rep-medical-stats rep-legacy-stats-row">
        <div><strong>{entities?visibleEntities.length:'—'}</strong><small>{entityTitle}</small></div>
        <div><strong>{unvisited??'—'}</strong><small>{unvisitedLabel}</small></div>
        <div><strong>{entities?(entityType==='HOSPITAL'?privateHospitals:gradeA):'—'}</strong>
          <small>{entityType==='HOSPITAL'?'مشفى خاص':'فئة A'}</small></div>
      </div>
      {entityError&&<Notice kind="error">{entityError}</Notice>}
      {!entities&&!entityError?<Empty text="جارٍ تحميل الجهات..."/>:
        !visibleEntities.length?<Empty text="لا توجد جهات من هذا النوع ضمن المنطقة"/>:
        <div className="rep-medical-list">{visibleEntities.map((item:Any)=>{
          const done=Number(counts[item.id]||0);
          const target=Number(visitTargets[item.id]??item.target??0);
          return <div className="rep-medical-card" key={item.id}>
            <div className="rep-medical-card-head">
              <span className="rep-medical-mini-icon" aria-hidden="true">
                {entityType==='DOCTOR'?'👨‍⚕️':entityType==='PHARMACY'?'💊':'🏥'}
              </span>
              <span><strong>{item.name}</strong>
                <small>{item.specialty||item.kind||item.category||'—'} • {current?.name}</small></span>
              {item.grade&&<span className={'rep-grade rep-grade-'+item.grade}>{item.grade}</span>}
            </div>
            {workspace&&<div className="rep-legacy-cycle-visits">
              <div className="rep-legacy-visit-status">
                <span className={needsVisit(item)?'pending':'visited'}>
                  {needsVisit(item)?unvisitedLabel:'تمت الزيارة'}</span>
              </div>
              <div className="rep-legacy-cycle-last"><small>آخر زيارة بالسايكل:</small>
                <strong>{lastDates[item.id]||'ما تم الزيارة'}</strong>
              </div>
              <div className="rep-legacy-cycle-count"><small>زيارات السايكل:</small>
                <strong>{done} من {target}</strong>
              </div>
              {target>0&&<div className="rep-legacy-cycle-progress"
                role="progressbar" aria-label="نسبة زيارات السايكل"
                aria-valuemin={0} aria-valuemax={target}
                aria-valuenow={Math.min(done,target)}>
                <span style={{width:Math.min(100,Math.round(done/target*100))+'%'}}/>
              </div>}
            </div>}
          </div>;
        })}</div>}
      {entityType!=='DOCTOR'&&<div className="rep-medical-pagination">
        <button type="button" className="btn small outline"
          disabled={page===0} onClick={()=>setPage(x=>Math.max(0,x-1))}>السابقة</button>
        <span>الصفحة {page+1}</span>
        <button type="button" className="btn small outline"
          disabled={!entities||entities.length<pageSize}
          onClick={()=>setPage(x=>x+1)}>التالية</button>
      </div>}
      <button type="button" className="btn primary rep-area-round-action"
        onClick={()=>onBeginAreaTour(current.id,entityType)}>
        + جولة {entityTitle} من المنطقة
      </button>
    </>}
  </div>;
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
  const [selectedVisitId,setSelectedVisitId]=useState<string|null>(null);
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
  const selectedVisit=kind==='visits'?data.find((row:Any)=>row.id===selectedVisitId):null;
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
      {kind==='visits'?<><th>المندوب</th><th>النوع</th><th>التاريخ</th><th>الجهات</th><th>الموقع</th><th>التفاصيل</th></>:
        <><th>المندوب</th><th>نوع الإجازة</th><th>الفترة</th><th>الحالة</th><th>الإجراء</th></>}
      </tr></thead><tbody>{data.map((r:Any)=><tr key={r.id}>
        {kind==='visits'?<><td>{r.repName}</td><td>{typeLabels[r.type]||r.type}</td><td>{r.visitDate}</td>
          <td>{r.targets?.map((x:Any)=>x.name+
            (x.areaNameAtVisit?' — '+x.areaNameAtVisit:' — منطقة غير مسجلة')).join('، ')}</td>
          <td><a href={'https://www.google.com/maps?q='+r.location.latitude+','+r.location.longitude}
            target="_blank" rel="noopener noreferrer">فتح الموقع</a>{canReview&&<small>±{Math.round(r.location.accuracy)} م</small>}</td>
          <td><button type="button" className="btn small outline"
            onClick={()=>setSelectedVisitId(previous=>previous===r.id?null:r.id)}>
            {selectedVisitId===r.id?'إغلاق':'عرض'}
          </button></td></>:
          <><td>{r.rep?.name}</td><td>{r.type}</td><td>{r.fromDate} — {r.toDate}</td>
            <td><span className={'tag '+r.status}>{r.status}</span></td>
            <td>{canReview&&r.status==='PENDING'?<div className="button-group">
              <button type="button" className="btn small" disabled={reviewBusy!==null}
                onClick={()=>review(r.id,'APPROVED')}>موافقة</button>
              <button type="button" className="btn small danger" disabled={reviewBusy!==null}
                onClick={()=>review(r.id,'REJECTED')}>رفض</button>
            </div>:'—'}</td></>}
      </tr>)}</tbody></table></div>}
    {selectedVisit&&<div className="visit-detail-card">
      <div className="rep-entry-heading"><strong>تفاصيل الجولة — {selectedVisit.visitDate}</strong>
        <span className="rep-plan-badge">{typeLabels[selectedVisit.type]||selectedVisit.type}</span></div>
      <div className="visit-detail-grid">
        <div><small>المندوب</small><strong>{selectedVisit.repName}</strong></div>
        {canReview&&<>
          <div><small>دقة الموقع</small><strong>±{Math.round(selectedVisit.location.accuracy)} م</strong></div>
          <div><small>وقت التقاط الموقع</small><strong>{new Date(selectedVisit.location.capturedAt).toLocaleString('ar')}</strong></div>
        </>}
      </div>
      <h4>الجهات</h4>
      <div className="rep-report-entries">{selectedVisit.targets?.map((target:Any)=>
        <div className="rep-report-entry" key={target.id}>
          <strong>{target.name}</strong><small>{target.areaNameAtVisit||'منطقة غير مسجلة'}</small>
        </div>)}</div>
      <h4>الأصناف في الجولة</h4>
      {!selectedVisit.products?.length?<Empty text="لم تُسجل أصناف في هذه الجولة"/>:
        <div className="rep-product-breakdown">{selectedVisit.products.map((product:Any)=>
          <span key={product.id}>{product.name} • الكمية {product.quantity}</span>)}</div>}
      {selectedVisit.note&&<div className="visit-note-detail"><h4>ملاحظة الجولة</h4>
        <p>{selectedVisit.note}</p></div>}
      {canReview&&<div className="rep-report-actions"><a className="btn outline"
        href={'https://www.google.com/maps?q='+selectedVisit.location.latitude+','+selectedVisit.location.longitude}
        target="_blank" rel="noopener noreferrer">فتح موقع نهاية الجولة</a></div>}
    </div>}
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
function loadStoredTourFilters(repId:string,type:string){
  try{
    const raw=window.localStorage.getItem('mandob:tour-filters:'+repId+':'+type);
    return normalizeTourFilters(raw?JSON.parse(raw):null,type);
  }catch{
    // Browser privacy settings can disable localStorage.
    return normalizeTourFilters(null,type);
  }
}
function NewVisit({refresh,done,user,onSaved,initialAreaId=null,initialType=null}:Any){
  type TourStep='setup'|'targets'|'review';
  const maxTargets=100;
  const [step,setStep]=useState<TourStep>(initialAreaId?'targets':'setup');
  const [type,setType]=useState(initialType||'DOCTOR');
  const [storedFilters]=useState(()=>loadStoredTourFilters(user.id,initialType||'DOCTOR'));
  const [selectedAreaIds,setSelectedAreaIds]=useState<string[]>(
    initialAreaId?[initialAreaId]:[]);
  const [targetIds,setTargetIds]=useState<string[]>([]);
  const [areaByTarget,setAreaByTarget]=useState<Record<string,string>>({});
  // Product promotion is recorded once for the whole tour. Presence means
  // the product was promoted; the value is the total quantity distributed.
  const [visitProducts,setVisitProducts]=useState<Record<string,number>>({});
  const [visitNote,setVisitNote]=useState('');
  const [visitDate,setVisitDate]=useState(today());
  const [search,setSearch]=useState('');
  const [filterGrades,setFilterGrades]=useState<string[]>(storedFilters.grades);
  const [filterSpecialties,setFilterSpecialties]=useState<string[]>(storedFilters.specialties);
  const [filterCategories,setFilterCategories]=useState<string[]>(storedFilters.categories);
  const [unvisitedOnly,setUnvisitedOnly]=useState(storedFilters.unvisitedOnly);
  const [filterOpen,setFilterOpen]=useState(false);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[last,setLast]=useState('');
  const [loadRetry,setLoadRetry]=useState(0);
  const activeGps=useRef<{cancel:()=>void}|null>(null);
  const mounted=useRef(true);
  const retryDraft=useRef<{signature:string,body:Any}|null>(null);
  useEffect(()=>{
    try{
      window.localStorage.setItem('mandob:tour-filters:'+user.id+':'+type,
        JSON.stringify({grades:filterGrades,specialties:filterSpecialties,
          categories:filterCategories,unvisitedOnly}));
    }catch{
      // Filters still work within this tour when local storage is unavailable.
    }
  },[user.id,type,filterGrades,filterSpecialties,filterCategories,unvisitedOnly]);
  useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;
      activeGps.current?.cancel();
      activeGps.current=null;
    };
  },[]);
  const route=type==='DOCTOR'?'/reps/'+user.id+'/doctors':
    type==='PHARMACY'?'/pharmacies':'/hospitals';
  const {data:targets,error:loadError}=useData(route,refresh+':'+loadRetry);
  const {data:areas,error:areaError}=useData('/areas',refresh+':'+loadRetry);
  const {data:workspace,error:workspaceError}=useData(
    '/rep-workspace-summary',refresh+':'+loadRetry);
  const {data:overview,error:overviewError}=useData(
    '/analytics/rep-overview',refresh+':'+loadRetry);
  const areaGroupKey=user.teamId?'team:'+user.teamId:'rep:'+user.id;
  const areaCoverageRows=overview?.coverage?.areas||[];
  const areaStats=(areaId:string)=>areaCoverageRows.find((row:Any)=>
    row.groupKey===areaGroupKey&&row.areaId===areaId);
  const {data:plan,error:planError}=useData('/rep-plan',refresh+':'+loadRetry);
  const {data:specialtyOptions}=useData('/specialties',refresh+':'+loadRetry);
  const products=plan?.products||[];
  const steps:{id:TourStep,label:string}[]=[
    {id:'setup',label:'النوع والمناطق'},
    {id:'targets',label:'اختيار الجهات'},
    {id:'review',label:'إنهاء الجولة'}
  ];

  const chosenAreas=(areas||[]).filter((area:Any)=>selectedAreaIds.includes(area.id));
  const allowedTargets=targetsForAreas(targets||[],selectedAreaIds);
  const cycleKey=type==='DOCTOR'?'doctors':type==='PHARMACY'?'pharmacies':'hospitals';
  const cycleVisits=workspace?.visitCounts?.[cycleKey]||null;
  const cycleTargets=workspace?.visitTargets?.[cycleKey]||null;
  const cycleLastVisits=workspace?.lastVisitDates?.[cycleKey]||{};
  const filteredTargets=filterTourTargets(allowedTargets,{
    type,search,grades:filterGrades,specialties:filterSpecialties,
    categories:filterCategories,unvisitedOnly,
    visitCounts:cycleVisits,visitTargets:cycleTargets
  });
  const specialties=[...new Set<string>([
    ...(specialtyOptions||[]),
    ...allowedTargets.map((item:Any)=>String(item.specialty||'').trim())
  ].filter((value:string)=>Boolean(value)))].sort((a,b)=>a.localeCompare(b,'ar'));
  const offeredCategories=type==='PHARMACY'?
    ['مستقلة','نقابية','مستوصف','مشفى','حكومية']:
    ['حكومي','خاص','تخصصي','مركز طبي'];
  const categories=[...new Set<string>([...offeredCategories,
    ...allowedTargets.map((item:Any)=>{
      const value=type==='PHARMACY'?item.kind:item.category;
      return typeof value==='string'?value.trim():'';
    })])].filter(Boolean);
  const activeFilters=[
    ...filterGrades.map(value=>({kind:'grade',value,label:'تصنيف '+value})),
    ...filterSpecialties.map(value=>({kind:'specialty',value,label:value})),
    ...filterCategories.map(value=>({kind:'category',value,label:value})),
    ...(unvisitedOnly?[{kind:'status',value:'unvisited',
      label:type==='HOSPITAL'?'بحاجة زيارة':type==='PHARMACY'?'غير مزارة':'غير مزار'}]:[])
  ];
  const selectedTargets=allowedTargets.filter((item:Any)=>targetIds.includes(item.id));
  const matchingAreaIds=(item:Any)=>matchingTourAreas(item,selectedAreaIds);
  const resolvedArea=(item:Any)=>resolvedTourArea(item,selectedAreaIds,areaByTarget[item.id]);
  const selectionValid=targetIds.length>0&&targetIds.length<=maxTargets&&
    targetIds.length===selectedTargets.length&&
    selectedTargets.every((item:Any)=>Boolean(resolvedArea(item)));

  function resetFilters(){
    setFilterGrades([]);setFilterSpecialties([]);setFilterCategories([]);
    setUnvisitedOnly(false);setSearch('');
  }
  function toggleFilter(value:string,active:string[],setter:Any){
    setter((current:string[])=>current.includes(value)?
      current.filter(item=>item!==value):[...current,value]);
  }
  function removeFilter(kind:string,value:string){
    if(kind==='grade')setFilterGrades(current=>current.filter(item=>item!==value));
    if(kind==='specialty')setFilterSpecialties(current=>current.filter(item=>item!==value));
    if(kind==='category')setFilterCategories(current=>current.filter(item=>item!==value));
    if(kind==='status')setUnvisitedOnly(false);
  }

  function chooseType(next:string){
    if(next!==type){
      setType(next);setSelectedAreaIds([]);setTargetIds([]);setAreaByTarget({});
      setVisitProducts({});setVisitNote('');
      const stored=loadStoredTourFilters(user.id,next);
      setFilterGrades(stored.grades);setFilterSpecialties(stored.specialties);
      setFilterCategories(stored.categories);setUnvisitedOnly(stored.unvisitedOnly);
      setSearch('');setFilterOpen(false);retryDraft.current=null;
    }
    setError('');setLast('');setStep('setup');
  }
  function proceedToTargets(){
    if(!areas||areaError||!targets||loadError){
      setError('لازم تكتمل بيانات المناطق والجهات قبل المتابعة');return;
    }
    if(!selectedAreaIds.length){setError('اختر منطقة واحدة على الأقل');return;}
    setTargetIds(previous=>retainSelectedTargets(previous,allowedTargets));
    setAreaByTarget(previous=>{
      const next:Record<string,string>={};
      for(const item of allowedTargets){
        const areaId=resolvedTourArea(item,selectedAreaIds,previous[item.id]);
        if(areaId)next[item.id]=areaId;
      }
      return next;
    });
    setSearch('');setError('');setStep('targets');
  }
  function proceedToReview(){
    if(!selectionValid||loadError||areaError){
      setError('اختر جهة واحدة على الأقل، وإذا كانت الجهة مشتركة بين مناطق مختارة حدّد منطقة زيارتها');return;
    }
    setError('');setStep('review');
  }
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setLast('');
    try{
      if(!selectionValid||!chosenAreas.length||loadError||areaError)
        throw Error('اختيار الجهات أو منطقة زيارتها غير مكتمل');
      if(!visitDate||visitDate>today())throw Error('تاريخ الجولة غير صحيح أو في المستقبل');
      const orderedAreas=[...targetIds].sort().map(id=>{
        const item=selectedTargets.find((row:Any)=>row.id===id);
        return [id,item?resolvedArea(item):null];
      });
      if(orderedAreas.some(([,areaId])=>!areaId))
        throw Error('في جهة مشتركة بين عدة مناطق ولم يتم اختيار منطقة زيارتها');
      const orderedProducts=Object.entries(visitProducts)
        .sort(([a],[b])=>a.localeCompare(b))
        .map(([productId,quantity])=>({productId,quantity}));
      const note=visitNote.trim();
      const signature=JSON.stringify([type,visitDate,orderedAreas,orderedProducts,note]);
      let body:Any;
      if(retryDraft.current?.signature===signature)body=retryDraft.current.body;
      else{
        // Fetch the active server policy for every new round (not a Vite build-time constant).
        const policy=await api('/visit-location-policy');
        const maxAccuracyMeters=policy?.maxAccuracyMeters;
        if(typeof maxAccuracyMeters!=='number'||!Number.isFinite(maxAccuracyMeters)||maxAccuracyMeters<=0)
          throw Error('تعذّر قراءة إعدادات دقة الموقع من الخادم');
        if(!mounted.current)return;
        const gps=watchAccurateLocation(navigator.geolocation,{
          requiredAccuracy:maxAccuracyMeters,
          waitMs:GPS_WAIT_MS
        });
        activeGps.current=gps;
        let position:GeolocationPosition;
        try{position=await gps.promise;}
        finally{if(activeGps.current===gps)activeGps.current=null;}
        // Navigating away cancels the watch and must not submit a detached round.
        if(!mounted.current)return;
        body={clientVisitId:crypto.randomUUID(),type,visitDate,targetIds:[...targetIds],
          areaByTarget:Object.fromEntries(orderedAreas),products:orderedProducts,note,
          location:{latitude:position.coords.latitude,longitude:position.coords.longitude,
            accuracy:position.coords.accuracy,capturedAt:new Date(position.timestamp).toISOString()}};
        retryDraft.current={signature,body};
      }
      // Reuse the exact request after network errors to retain visit idempotency.
      const result=await post('/visits',body);
      setLast('تم حفظ الجولة رقم '+result.id+
        (result.duplicate?' (كانت محفوظة مسبقاً)':'')+' مع موقع نهاية الجولة');
      retryDraft.current=null;setTargetIds([]);setSelectedAreaIds([]);setAreaByTarget({});
      setVisitProducts({});setVisitNote('');setSearch('');setFilterOpen(false);
      setStep('setup');done();onSaved?.();
    }catch(err:Any){
      if(isGpsError(err))retryDraft.current=null;
      if(mounted.current)setError(err?.code===1?'لازم تمنح صلاحية الموقع لإنهاء الجولة':
        err?.message||'تعذر تحديد الموقع أو حفظ الجولة');
    }finally{
      if(mounted.current)setBusy(false);
    }
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
      {(areaError||loadError||overviewError)&&<div className="notice error" role="alert">
        {areaError&&<p>تعذّر تحميل المناطق: {areaError}</p>}
        {loadError&&<p>تعذّر تحميل الجهات: {loadError}</p>}
        {overviewError&&<p>تعذر تحميل إحصائيات المناطق: {overviewError}</p>}
        <button type="button" className="btn small outline"
          onClick={()=>setLoadRetry(value=>value+1)}>إعادة التحميل</button>
      </div>}
      {!areas&&!areaError?<Empty text="جارٍ تحميل المناطق..."/>:
        areas?.length===0?<Empty text="ما في مناطق مخصصة لك، اطلب من المدير إسناد مناطق"/>:
        <div className="rep-tour-area-list">{(areas||[]).map((area:Any)=>{
          const stats=areaStats(area.id);
          return <label className={'rep-tour-area rep-tour-area-legacy'+
            (selectedAreaIds.includes(area.id)?' active':'')} key={area.id}>
            <input type="checkbox" checked={selectedAreaIds.includes(area.id)}
              disabled={busy||Boolean(areaError||loadError)}
              onChange={e=>{
                setSelectedAreaIds(previous=>e.target.checked?
                  [...previous,area.id]:previous.filter(id=>id!==area.id));
                setError('');
              }}/>
            <span className="rep-tour-area-summary">
              <span className="rep-tour-area-top">
                <strong>{area.name}</strong>
                <span className="rep-tour-area-badge">{stats?stats.coverage+'%':
                  overview?'0%':'—'}</span>
              </span>
              <small>{stats?
                stats.doctors+' طبيب • '+stats.unvisited+' غير مزار • '+stats.gradeA+' أطباء A':
                overview?'0 طبيب • 0 غير مزار • 0 أطباء A':
                'جارٍ تحميل إحصائيات المنطقة'}</small>
            </span>
          </label>;
        })}</div>}
      <div className="rep-tour-sticky-actions">
        <span><strong>{selectedAreaIds.length} مناطق</strong>
          <small>{selectedAreaIds.length?
            selectedAreaIds.reduce((sum,id)=>sum+Number(areaStats(id)?.doctors||0),0)+
              ' طبيب • '+selectedAreaIds.reduce((sum,id)=>sum+Number(areaStats(id)?.unvisited||0),0)+
              ' غير مزار':
            'اختر مناطق الجولة أولاً'}</small></span>
        <button type="button" className="btn primary" onClick={proceedToTargets}
          disabled={busy||!areas||!targets||Boolean(areaError||loadError)||
            selectedAreaIds.length===0}>التالي</button>
      </div>
    </>}

    {step==='targets'&&<>
      <h3>اختيار الجهات المزارة</h3>
      <p className="muted">المناطق: {chosenAreas.map((area:Any)=>area.name).join('، ')}</p>
      <div className="rep-tour-search-filter">
        <label className="field">بحث بالاسم أو الاختصاص
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="ابحث ضمن المناطق المختارة"/>
        </label>
        <div className="rep-legacy-filter-toolbar">
          <button type="button" className="rep-filter-toggle" disabled={busy}
            onClick={()=>setFilterOpen(true)}>
            ⚙️ الفلاتر {activeFilters.length?'('+activeFilters.length+')':''}
          </button>
          {Boolean(activeFilters.length||search)&&<button type="button"
            className="rep-filter-clear" disabled={busy} onClick={resetFilters}>
            ↻ إعادة الضبط
          </button>}
        </div>
        {activeFilters.length>0&&<div className="rep-active-filters">
          {activeFilters.map(filter=><button type="button"
            key={filter.kind+':'+filter.value} disabled={busy}
            onClick={()=>removeFilter(filter.kind,filter.value)}>
            {filter.label} ×
          </button>)}
        </div>}
      </div>
      {(loadError||areaError||workspaceError)&&<div className="notice error" role="alert">
        {workspaceError&&<p>تعذّر تحميل حالة الزيارات بالسايكل: {workspaceError}</p>}
        تعذّر تحديث قائمة الجهات
        <button type="button" className="btn small outline"
          onClick={()=>setLoadRetry(value=>value+1)}>إعادة التحميل</button>
      </div>}
      {!targets&&!loadError?<Empty text="جارٍ تحميل الجهات..."/>:
        !filteredTargets.length?<div className="rep-tour-no-filter-results">
          <Empty text="لا توجد جهات مطابقة ضمن المناطق المختارة والفلاتر المحددة"/>
          {Boolean(activeFilters.length||search)&&<button type="button"
            className="btn small outline" onClick={resetFilters}>
            مسح الفلاتر وعرض جميع الجهات ضمن المناطق
          </button>}
        </div>:
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
              <span className="rep-tour-target-label"><strong>{item.name}</strong>
                <small>{[item.specialty||item.kind||item.category,item.grade?
                  'تصنيف '+item.grade:''].filter(Boolean).join(' • ')}</small>
                {workspace&&<>
                  <small className="rep-tour-target-visit-status">
                    {type==='HOSPITAL'?
                      Number(cycleVisits?.[item.id]||0)<
                        Number(cycleTargets?.[item.id]??item.target??1)?
                        'بحاجة زيارة':'تم استكمال زيارات السايكل':
                      Number(cycleVisits?.[item.id]||0)>0?'تمت الزيارة':'غير مزار'}
                  </small>
                  <small className="rep-tour-target-last-visit">
                    آخر زيارة بالسايكل: <strong>{cycleLastVisits[item.id]||'ما تم الزيارة'}</strong>
                  </small>
                  <small>زيارات السايكل: {Number(cycleVisits?.[item.id]||0)} من
                    {' '}{Number(cycleTargets?.[item.id]??item.target??0)}
                  </small>
                </>}
              </span>
            </label>
            {chosen&&possible.length>1&&<label className="field rep-tour-ambiguous-area">
              الجهة موجودة بأكثر من منطقة مختارة؛ حدد منطقة الزيارة الفعلية
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
          disabled={busy} onClick={()=>{setTargetIds([]);setAreaByTarget({});}}>
          إلغاء التحديد
        </button>}
        <button type="button" className="btn primary" onClick={proceedToReview}
          disabled={busy||!selectionValid||Boolean(loadError||areaError)}>
          التالي: مراجعة الجولة
        </button>
      </div>
      {filterOpen&&<div className="rep-filter-layer" role="presentation">
        <button type="button" className="rep-filter-overlay" aria-label="إغلاق الفلاتر"
          onClick={()=>setFilterOpen(false)}/>
        <div className="rep-filter-sheet rep-tour-filter-sheet" role="dialog"
          aria-modal="true" aria-label={'فلترة '+typeLabels[type]}>
          <div className="rep-filter-sheet-head">
            <strong>فلترة {typeLabels[type]} الجولة</strong>
            <button type="button" onClick={()=>setFilterOpen(false)}
              aria-label="إغلاق">✕</button>
          </div>
          {type!=='HOSPITAL'&&<div className="rep-filter-section">
            <strong>التصنيف</strong>
            <div className="rep-grade-chips" role="group" aria-label="التصنيفات">
              <button type="button" aria-pressed={filterGrades.length===0}
                className={filterGrades.length===0?'active':''}
                onClick={()=>setFilterGrades([])}>الكل</button>
              {['A','B','C'].map(value=><button key={value} type="button"
                aria-pressed={filterGrades.includes(value)}
                className={filterGrades.includes(value)?'active':''}
                onClick={()=>toggleFilter(value,filterGrades,setFilterGrades)}>
                {value}
              </button>)}
            </div>
          </div>}
          {type!=='DOCTOR'&&<div className="rep-filter-section">
            <strong>{type==='PHARMACY'?'التبعية':'نوع المنشأة'}</strong>
            <div className="rep-legacy-category-options">
              <button type="button" aria-pressed={filterCategories.length===0}
                className={filterCategories.length===0?'active':''}
                onClick={()=>setFilterCategories([])}>الكل</button>
              {categories.map(value=><button key={value} type="button"
                aria-pressed={filterCategories.includes(value)}
                className={filterCategories.includes(value)?'active':''}
                onClick={()=>toggleFilter(value,filterCategories,setFilterCategories)}>
                {value}
              </button>)}
            </div>
          </div>}
          {type!=='PHARMACY'&&<div className="rep-filter-section">
            <strong>الاختصاص</strong>
            <div className="rep-legacy-category-options">
              <button type="button" aria-pressed={filterSpecialties.length===0}
                className={filterSpecialties.length===0?'active':''}
                onClick={()=>setFilterSpecialties([])}>كل الاختصاصات</button>
            </div>
            {!specialties.length?<small className="muted">لا توجد اختصاصات في المناطق المختارة</small>:
              <div className="rep-tour-specialties">
                {specialties.map(value=><label className="rep-legacy-check" key={value}>
                  <input type="checkbox" checked={filterSpecialties.includes(value)}
                    onChange={()=>toggleFilter(value,filterSpecialties,setFilterSpecialties)}/>
                  <span>{value}</span>
                </label>)}
              </div>}
          </div>}
          <div className="rep-filter-section">
            <strong>حالة الزيارة</strong>
            <label className="rep-legacy-check">
              <input type="checkbox" checked={unvisitedOnly} disabled={!workspace}
                onChange={e=>setUnvisitedOnly(e.target.checked)}/>
              <span>{type==='HOSPITAL'?'بحاجة زيارة':
                type==='PHARMACY'?'غير مزارة':'غير مزار'}</span>
            </label>
            {!workspace&&<small className="muted">
              {workspaceError?'تعذر تحميل الزيارات، أعد المحاولة.':
                'جارٍ تحميل زيارات السايكل الحالي...'}
            </small>}
          </div>
          <div className="rep-filter-sheet-actions">
            <button className="btn outline" type="button" onClick={resetFilters}>
              مسح الكل
            </button>
            <button className="btn primary" type="button"
              onClick={()=>setFilterOpen(false)}>
              عرض النتائج ({filteredTargets.length})
            </button>
          </div>
        </div>
      </div>}
    </>}

    {step==='review'&&<>
      <h3>مراجعة الجولة وإنهاؤها</h3>
      <div className="tour-summary">
        <p><strong>النوع:</strong> {typeLabels[type]}</p>
        <p><strong>المناطق ({chosenAreas.length}):</strong> {chosenAreas.map((a:Any)=>a.name).join('، ')}</p>
        <p><strong>الجهات ({selectedTargets.length}):</strong></p>
        <ul>{selectedTargets.map((item:Any)=><li key={item.id}>
          {item.name} — {chosenAreas.find((area:Any)=>area.id===resolvedArea(item))?.name||
            'لم تُحدّد المنطقة'}
        </li>)}</ul>
      </div>

      <div className="tour-products tour-products-global">
        <strong>الأصناف المروّج لها ضمن الجولة</strong>
        <small className="muted">حدد الصنف مرة واحدة، وسجل إجمالي الكمية التي وزعتها خلال الجولة كلها.</small>
        {planError?<Notice kind="error">{planError}</Notice>:
          !plan?<small className="muted">جارٍ تحميل الأصناف...</small>:
          products.length===0?<small className="muted">لا يوجد أصناف مسندة إليك</small>:
          <div className="tour-product-rows">{products.map((product:Any)=>{
            const checked=visitProducts[product.id]!==undefined;
            return <div className={'tour-product-row'+(checked?' active':'')} key={product.id}>
              <label className="tour-product-chip">
                <input type="checkbox" checked={checked} disabled={busy}
                  onChange={event=>setVisitProducts(previous=>{
                    const next={...previous};
                    if(event.target.checked)next[product.id]=0;
                    else delete next[product.id];
                    return next;
                  })}/>
                <span>{product.name}</span>
              </label>
              {checked&&<label className="tour-product-quantity">الكمية الموزعة
                <input type="number" min="0" max="1000000" step="1"
                  value={visitProducts[product.id]}
                  disabled={busy}
                  onChange={event=>setVisitProducts(previous=>({
                    ...previous,[product.id]:Math.max(0,Math.min(1000000,
                      Number.parseInt(event.target.value||'0',10)||0))
                  }))}/>
              </label>}
            </div>;
          })}</div>}
      </div>

      <form className="form" onSubmit={save}>
        <label className="field">تاريخ الجولة المختار
          <input type="date" value={visitDate} max={today()}
            onChange={e=>setVisitDate(e.target.value)} required disabled={busy}/>
        </label>
        <label className="field">ملاحظة الجولة (اختيارية)
          <textarea rows={4} maxLength={2000} value={visitNote}
            onChange={e=>setVisitNote(e.target.value)}
            disabled={busy} placeholder="اكتب ملاحظة عن الجولة..."/>
          <small className="muted">تبقى الملاحظة محفوظة مع تفاصيل هذه الجولة ({visitNote.length} / 2000).</small>
        </label>
        <div className="button-group tour-actions">
          <button type="button" className="btn outline" disabled={busy}
            onClick={()=>back('targets')}>رجوع للجهات</button>
          <button type="submit" className="btn primary" disabled={busy||!selectionValid}>
            {busy?'جارٍ إنهاء الجولة...':'إنهاء الجولة'}
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
const productPriorityLabels:Record<string,string>={
  PRIMARY:'أولوية أولى',SECONDARY:'أولوية ثانية',SUPPORT:'داعم'};
function Products({refresh,done}:Any){
  const {data,error}=useData('/products',refresh);
  const [editingId,setEditingId]=useState('');
  const editing=(data||[]).find((product:Any)=>product.id===editingId);
  const specialtiesFrom=(input:string)=>[...new Set(input.split(/[,،]/)
    .map(value=>value.trim()).filter(Boolean))];
  return <><Section title="المنتجات الطبية وأولوياتها">
    {error&&<Notice kind="error">{error}</Notice>}
    {!data?<Empty text="جارٍ تحميل المنتجات..."/>:!data.length?<Empty/>:
      <div className="table-wrap"><table><thead><tr>
        <th>المنتج</th><th>المادة الفعالة</th><th>الأولوية</th>
        <th>الاختصاصات المستهدفة</th><th>الحالة</th><th>إجراء</th>
      </tr></thead><tbody>{data.map((p:Any)=><tr key={p.id}>
        <td>{p.name}</td><td>{p.activeIngredient||'—'}</td>
        <td><span className={'rep-priority-badge '+(p.priority||'SUPPORT')}>
          {productPriorityLabels[p.priority]||'داعم'}</span></td>
        <td>{p.targetSpecialties?.join(' • ')||'—'}</td>
        <td>{p.active?'نشط':'غير نشط'}</td>
        <td><button className="btn small" type="button" onClick={()=>setEditingId(p.id)}>
          تعديل الأولوية</button></td>
      </tr>)}</tbody></table></div>}
  </Section>
  {editing&&<Section title={'تعديل أولوية الصنف: '+editing.name}>
    <div key={editing.id}><Form onSave={async(fd:FormData)=>{
      await patch('/products/'+encodeURIComponent(editing.id),{
        priority:val(fd,'priority'),
        targetSpecialties:specialtiesFrom(val(fd,'targetSpecialties'))});
      setEditingId('');done();
    }}>
      <label className="field">أولوية الصنف
        <select name="priority" defaultValue={editing.priority||'SUPPORT'}>
          {Object.entries(productPriorityLabels).map(([code,label])=>
            <option key={code} value={code}>{label}</option>)}</select>
      </label>
      <label className="field">الاختصاصات المستهدفة
        <input name="targetSpecialties" defaultValue={(editing.targetSpecialties||[]).join('، ')}
          placeholder="مثال: قلبية، داخلية، أوعية"/>
      </label>
    </Form></div>
    <button className="btn outline" type="button" onClick={()=>setEditingId('')}>إلغاء</button>
  </Section>}
  <Section title="إضافة منتج">
    <Form onSave={async(fd:FormData)=>{
      await post('/products',{name:val(fd,'name'),
        activeIngredient:val(fd,'activeIngredient')||null,
        priority:val(fd,'priority')||'SUPPORT',
        targetSpecialties:specialtiesFrom(val(fd,'targetSpecialties'))});
      done();
    }}>
      <div className="form-grid">
        <TextInput name="name" label="اسم المنتج"/>
        <TextInput name="activeIngredient" label="المادة الفعالة" required={false}/>
        <label className="field">الأولوية
          <select name="priority" defaultValue="SUPPORT">
            {Object.entries(productPriorityLabels).map(([code,label])=>
              <option key={code} value={code}>{label}</option>)}</select>
        </label>
        <TextInput name="targetSpecialties" label="الاختصاصات المستهدفة (مفصولة بفاصلة)"
          placeholder="قلبية، داخلية، أوعية" required={false}/>
      </div>
    </Form>
  </Section></>;
}
function Teams({refresh,done}:Any){
  const {data,error}=useData('/teams',refresh);
  const {data:products, error:productError}=useData('/products',refresh);
  const {data:specialtyOptions,error:specialtyError}=useData('/specialties',refresh);
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
    {specialtyError&&<Notice kind="error">تعذر تحميل قائمة الاختصاصات: {specialtyError}</Notice>}
    {editing&&<Section title={'تعديل الفريق: '+editing.name}>
      <Notice>التعديل يخص اسم الفريق واختصاصاته ومنتجاته فقط، ولا يغير المندوبين أو الزيارات السابقة.</Notice>
      <div key={editing.id}>
        <Form onSave={async(fd:FormData)=>{
          if(!products||productError)throw Error('لا يمكن حفظ الفريق قبل تحميل المنتجات بنجاح');
          await patch('/teams/'+editing.id,{
            name:val(fd,'name'),
            specialties:selectedSpecialties(fd,'specialties'),
            productIds:fd.getAll('productIds')
          });
          setEditId(null);done();
        }}>
          <div className="form-grid">
            <TextInput name="name" label="اسم الفريق" defaultValue={editing.name}/>
            <SpecialtyMultiPicker key={editing.id} name="specialties"
              label="اختصاصات الفريق" options={specialtyOptions||[]}
              initial={editing.specialties?.map((x:Any)=>x.specialty)||[]}/>
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
          specialties:selectedSpecialties(fd,'specialties'),
          productIds:fd.getAll('productIds')
        });
        done();
      }}>
        <div className="form-grid">
          <TextInput name="name" label="اسم الفريق"/>
          <SpecialtyMultiPicker name="specialties"
            label="اختصاصات الفريق" options={specialtyOptions||[]}/>
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
function RepPreferences({teams,products,specialtyOptions=[],initialTeam='',initialMode='TEAM',initialSpecialties=[],initialProductIds=[],isRep=true}:Any){
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
      {mode==='CUSTOM'&&<SpecialtyMultiPicker name="customSpecialties"
        label="اختصاصات المندوب المخصصة" options={specialtyOptions}
        initial={initialSpecialties}/>} 
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
const customSpecValues=(fd:FormData)=>selectedSpecialties(fd,'customSpecialties');
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
    {data:areas}=useData('/areas',refresh),{data:products}=useData('/products',refresh),
    {data:specialtyOptions}=useData('/specialties',refresh);
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
            specialtyOptions={specialtyOptions||[]}
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
        <RepPreferences teams={teams} products={products}
          specialtyOptions={specialtyOptions||[]} isRep={newRole==='REP'}/>
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
  const {data:specialties}=useData(
    kind==='doctors'||kind==='hospitals'?'/specialties':null,refresh);
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
  return <>
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
            <SpecialtyInput options={specialties||[]} defaultValue={editing.specialty}/>
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
            <SpecialtyInput options={specialties||[]} defaultValue={editing.specialty}/>
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
    {(kind==='doctors'||kind==='hospitals')&&<SpecialtyInput
      options={specialties||[]} required={kind==='doctors'}/>}
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
  COMPANY_ADMIN:[['dashboard','الرئيسية'],['governorates','المحافظات'],['teams','الفرق والمندوبون'],
    ['coverage','التغطية'],['data','البيانات'],['reports','التقارير'],['settings','الإعدادات'],
    ['users','المندوبون'],['products','المنتجات'],['areas','المناطق'],['doctors','الأطباء'],
    ['pharmacies','الصيدليات'],['hospitals','المشافي'],['visits','الجولات'],['leaves','الإجازات'],
    ['frequency','الإحصائيات'],['area-coverage','تغطية المناطق']],
  TEAM_MANAGER:[['dashboard','لوحة التحكم'],['users','الفريق'],['teams','الفرق'],
    ['doctors','الأطباء'],['pharmacies','الصيدليات'],['hospitals','المشافي'],['areas','المناطق'],
    ['visits','الجولات'],['reports','التقارير'],['leaves','طلبات الإجازة'],
    ['frequency','التحليلات'],['products','المنتجات'],['settings','الإعدادات'],
    ['area-coverage','تغطية المناطق']],
  REP:[['dashboard','الرئيسية'],['analytics','التحليل'],['analysis-detail','تفاصيل التحليل'],
    ['reports','التقارير'],['profile','حسابي'],['doctors','الأطباء'],['pharmacies','الصيدليات'],
    ['hospitals','المشافي'],['areas','المناطق'],['plan-products','الخطة والأصناف'],
    ['rep-settings','الإعدادات'],
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
