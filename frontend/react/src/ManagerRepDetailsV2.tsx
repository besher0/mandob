import {Fragment,useState} from 'react';
import s from './ManagerDashboardV2.module.css';

type Named={id:string;name:string};
export type ManagerRepTarget={
  key:string;id:string;type:string;name:string;repId:string;repName:string;
  teamId:string;teamName:string;classCode:string;specialtyId:string|null;
  specialties:string[];areas:Named[];requiredVisits:number;completedVisits:number;
  remainingVisits:number;coverage:number;lastVisit:string|null;
  progressStatus:'UNVISITED'|'INCOMPLETE'|'COMPLETE';
};
type Model={
  cycle:{start:string;end:string};teamName:string;
  totals:{completedVisits:number;requiredVisits:number;coverage:number};
  doctorProgress:{uniqueDoctors:number;assignments:number;
    unvisited:number;incomplete:number;complete:number};
  doctorTargets:ManagerRepTarget[];otherTargets:ManagerRepTarget[];
};
type Rep={id:string;name:string;username?:string;annualLeaveBalance?:number;
  repAreas?:{areaId:string;area?:Named|null}[]};
type Visit={id:string;date:string;type:string;note?:string|null;
  targets:{id:string;name:string;area:string}[]};
type LeaveBalance={year:number;allocatedDays:number;remainingDays:number;
  carriedDays:number;adjustmentDays:number;accountingMode?:string};
type Detail={visits?:Visit[];periodStart?:string|null;periodEnd?:string|null;
  leaveBalance?:LeaveBalance};
const kindNames:Record<string,string>={DOCTOR:'أطباء',PHARMACY:'صيدليات',HOSPITAL:'مشافي'};
function Empty({children='لا توجد بيانات ضمن نطاق فريقك.'}:{children?:string}){
  return <p className={s.empty}>{children}</p>;
}
function Table({headers,children}:{headers:string[];children:React.ReactNode}){
  return <div className={`${s.card} ${s.tableCard}`}>
    <table className={s.table}><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
    <tbody>{children}</tbody></table>
  </div>;
}
// Ported from mandob-v2 TargetProgressTables. Local state replaces the
// independent Next.js view-state service; the grouping and controls are the
// same, scoped to the currently selected representative.
function GroupedTargetsTable({items,headers,renderRow}:{
  items:ManagerRepTarget[];headers:string[];
  renderRow:(item:ManagerRepTarget)=>React.ReactNode
}){
  const [order,setOrder]=useState<string[]>([]);
  const [hidden,setHidden]=useState<string[]>([]);
  const [folded,setFolded]=useState<string[]>([]);
  const keyOf=(item:ManagerRepTarget)=>item.type==='DOCTOR'?
    item.specialtyId??'no-specialty':item.type;
  const groups=[...new Map(items.map(item=>[
    keyOf(item),item.type==='DOCTOR'?item.specialties[0]??'بلا اختصاص':
      kindNames[item.type]??item.type
  ] as [string,string])).entries()].sort((a,b)=>{
    const ai=order.indexOf(a[0]),bi=order.indexOf(b[0]);
    return (ai<0?Infinity:ai)-(bi<0?Infinity:bi)||a[1].localeCompare(b[1],'ar');
  });
  const move=(id:string,next:number)=>{
    const ids=groups.map(([key])=>key);
    ids.splice(ids.indexOf(id),1);ids.splice(next,0,id);setOrder(ids);
  };
  return <>
    <details className={s.specialtyFilters}>
      <summary>اختيار المجموعات وترتيبها</summary>
      <div className={s.editorActions}>
        <button className={s.btn} type="button" onClick={()=>setHidden([])}>إظهار الكل</button>
        <button className={s.btn} type="button" onClick={()=>setOrder([])}>ترتيب أبجدي</button>
        <button className={s.btn} type="button" onClick={()=>setFolded([])}>فتح الكل</button>
        <button className={s.btn} type="button" onClick={()=>
          setFolded(groups.map(([id])=>id))}>طي الكل</button>
      </div>
      <div className={s.specialtyChoices}>
        {groups.map(([id,name],index)=><div className={s.specialtyChoice} key={id}>
          <label className={s.bulkSelection}>
            <input type="checkbox" checked={!hidden.includes(id)}
              onChange={event=>setHidden(previous=>event.target.checked?
                previous.filter(key=>key!==id):[...previous,id])}/>
            {name}
          </label>
          <label className={s.specialtyPosition}>الترتيب
            <select aria-label={`ترتيب ${name}`} value={index}
              onChange={event=>move(id,Number(event.target.value))}>
              {groups.map((_,i)=><option key={i} value={i}>{i+1}</option>)}
            </select>
          </label>
        </div>)}
      </div>
    </details>
    <Table headers={headers}>
      {groups.filter(([id])=>!hidden.includes(id)).map(([id,name])=>{
        const rows=items.filter(item=>keyOf(item)===id);
        return <Fragment key={id}>
          <tr className={s.specialtyHeading}>
            <th colSpan={headers.length} scope="rowgroup">
              <button className={s.specialtyToggle} type="button"
                aria-expanded={!folded.includes(id)}
                aria-label={`${folded.includes(id)?'فتح':'طي'} ${name}`}
                onClick={()=>setFolded(previous=>previous.includes(id)?
                  previous.filter(key=>key!==id):[...previous,id])}>
                <svg width="18" height="18" viewBox="0 0 24" fill="none"
                  stroke="currentColor" strokeWidth="2" aria-hidden="true"
                  style={{transform:folded.includes(id)?'rotate(90deg)':undefined}}>
                  <path d="m6 9 6 6 6-6"/>
                </svg>{name}<span className={s.badge}>{rows.length}</span>
              </button>
            </th>
          </tr>
          {!folded.includes(id)&&rows.map(renderRow)}
        </Fragment>;
      })}
    </Table>
    {groups.length>0&&groups.every(([id])=>hidden.includes(id))&&
      <Empty>اختر مجموعة لعرض بياناتها.</Empty>}
  </>;
}
export export function DoctorCycleDetails({items,model,scope='rep'}:{
  items:ManagerRepTarget[];model:Model;scope?:'rep'|'team'
}){
  const [status,setStatus]=useState('ALL');
  const summary=model.doctorProgress;
  const rows=items.filter(t=>status==='ALL'||t.progressStatus===status);
  return <section className={s.cyclePanel}>
    <div className={s.detailSectionHeading}>
      <h3>متابعة أطباء السايكل</h3>
      <span className={s.badge}>{model.cycle.start} — {model.cycle.end}</span>
    </div>
    <p className={s.muted}>{summary.uniqueDoctors} طبيب فريد • {summary.assignments}
      {' '}تكليف {scope==='team'?'على مستوى الفريق. زيارات مندوبي الفريق تُحتسب ضمن هدف الفريق.':
        'مندوب / فريق. زيارة زميل لا تسدّ نقص تكليف آخر.'}</p>
    <div className={s.progressFilters} role="group"
      aria-label="فلتر إنجاز زيارات الأطباء">
      {([
        ['ALL','الكل',summary.assignments],
        ['UNVISITED','غير مزار',summary.unvisited],
        ['INCOMPLETE','ناقص التكرار',summary.incomplete],
        ['COMPLETE','مكتمل التكرار',summary.complete]
      ] as const).map(([key,label,count])=>
        <button className={`${s.progressFilter} ${status===key?s.progressFilterActive:''}`}
          type="button" key={key} aria-pressed={status===key}
          onClick={()=>setStatus(key)}>
          <span>{label}</span><strong>{count}</strong>
        </button>)}
    </div>
    {rows.length?<GroupedTargetsTable items={rows}
      headers={['الطبيب','التصنيف','المنطقة','المندوب / الفريق',
        'المطلوب','المنفّذ','المتبقي','آخر زيارة']}
      renderRow={t=><tr key={t.key}>
        <td>{t.name}</td><td>{t.classCode}</td>
        <td>{t.areas.map(a=>a.name).join('، ')||'—'}</td>
        <td>{t.repName}<p className={s.muted}>{t.teamName}</p></td>
        <td>{t.requiredVisits}</td><td>{t.completedVisits}</td>
        <td>{t.remainingVisits}</td><td><bdi>{t.lastVisit||'—'}</bdi></td>
      </tr>}/>:<Empty>لا توجد تكليفات أطباء ضمن هذا الفلتر.</Empty>}
  </section>;
}
function Targets({items}:{items:ManagerRepTarget[]}){
  return items.length?<GroupedTargetsTable items={items}
    headers={['الجهة','الاختصاص','التصنيف','المنطقة','المندوب / الفريق',
      'الزيارات','التغطية']}
    renderRow={t=><tr key={t.key}>
      <td><strong>{t.name}</strong></td>
      <td>{t.specialties.join('، ')||'—'}</td>
      <td><span className={s.badge}>{t.classCode}</span></td>
      <td>{t.areas.map(a=>a.name).join('، ')||'—'}</td>
      <td>{t.repName}<p className={s.muted}>{t.teamName}</p></td>
      <td>{t.completedVisits} من {t.requiredVisits}</td>
      <td>{t.coverage}%<progress max={100} value={t.coverage}/></td>
    </tr>}/>:<Empty/>;
}
function Rounds({items,repName,onOpen}:{
  items:Visit[];repName:string;onOpen:(visit:Visit)=>void
}){
  return items.length?<Table headers={['المندوب','نوع الجولة','المنطقة',
    'عدد الزيارات','التاريخ','التفاصيل']}>
    {items.map(visit=><tr key={visit.id}>
      <td>{repName}</td><td>{kindNames[visit.type]||visit.type}</td>
      <td>{[...new Set(visit.targets.map(t=>t.area).filter(n=>n&&n!=='—'))]
        .join('، ')||'—'}</td>
      <td>{visit.targets.length}</td><td><bdi>{visit.date}</bdi></td>
      <td><button className={s.btn} type="button"
        onClick={()=>onOpen(visit)}>عرض التفاصيل</button></td>
    </tr>)}
  </Table>:<Empty>لا توجد جولات مسجلة ضمن نطاق فريقك.</Empty>;
}
export function ManagerRepDetailsV2({rep,targets,detail,onBack,
  backLabel,onEdit,onManageAreas}:{
  rep:Rep;targets?:Model|null;detail?:Detail|null;
  onBack:()=>void;backLabel:string;onEdit:()=>void;onManageAreas:()=>void
}){
  const [round,setRound]=useState<Visit|null>(null);
  const areas=rep.repAreas||[];
  return <div className={`${s.dashboardScope} manager-rep-v2-source`} dir="rtl">
    <button className={`${s.btn} ${s.secondary} manager-rep-v2-back`}
      type="button" onClick={onBack}>← {backLabel}</button>
    <div className={`${s.detailIdentity} manager-rep-v2-identity`}>
      <h2>{rep.name}</h2>
      <p className={s.muted}>{targets?.teamName||'—'}</p>
      <button className={`${s.btn} ${s.secondary} manager-rep-v2-edit`}
        type="button" onClick={onEdit}>تعديل المندوب</button>
    </div>
    <div className={`${s.kpis} manager-rep-v2-kpis`}>
      {([
        [targets?.totals.completedVisits??'—','الزيارات'],
        [targets?.totals.coverage===undefined?'—':targets.totals.coverage+'%','التغطية'],
        [targets?.totals.requiredVisits??'—','الزيارات المطلوبة']
      ] as const).map(([value,label])=>
        <div className={`${s.card} ${s.kpi}`} key={label}>
          <strong>{value}</strong><span>{label}</span>
        </div>)}
    </div>
    <section className={`${s.card} manager-rep-v2-leave`}>
      <div className="manager-rep-v2-leave-heading">
        <h3>رصيد إجازات المندوب{detail?.leaveBalance?.year?
          ' — '+detail.leaveBalance.year:''}</h3>
        <button className={`${s.btn} ${s.secondary}`}
          type="button" onClick={onEdit}>تعديل الرصيد</button>
      </div>
      <p className="manager-rep-v2-leave-annual">
        الاستحقاق السنوي بالأيام:
        <strong>{detail?.leaveBalance?.allocatedDays??
          rep.annualLeaveBalance??'—'}</strong>
      </p>
      <p className="manager-rep-v2-leave-breakdown">
        <span>الرصيد المتبقي: <strong>{detail?.leaveBalance?.remainingDays??'—'}</strong> يوم</span>
        <span>المرحّل: <strong>{detail?.leaveBalance?.carriedDays??'—'}</strong></span>
        <span>التسويات: <strong>{detail?.leaveBalance?.adjustmentDays??'—'}</strong></span>
      </p>
    </section>
    {/* Mandob retains its operational area assignment controls beyond V2. */}
    <section className={`${s.card} manager-rep-v2-areas`}>
      <div className={s.detailSectionHeading}>
        <h3>المناطق المسندة</h3>
        <button className={`${s.btn} ${s.secondary}`} type="button"
          onClick={onManageAreas}>+ إضافة / إزالة منطقة</button>
      </div>
      {areas.length?<div className="manager-chip-row">
        {areas.map(link=><span key={link.areaId}>{link.area?.name||'—'}</span>)}
      </div>:<Empty>لا توجد مناطق مسندة لهذا المندوب.</Empty>}
    </section>
    {!targets?<Empty>جارٍ تحميل متابعة السايكل...</Empty>:<>
      <DoctorCycleDetails items={targets.doctorTargets} model={targets}/>
      <section className={`${s.repOtherTargets} manager-rep-v2-other-targets`}
        aria-label="باقي الجهات المرتبطة ضمن فرقك">
        <div className={s.detailSectionHeading}>
          <h3>باقي الجهات المرتبطة ضمن فرقك</h3>
          <span className={s.badge}>{targets.otherTargets.length} جهة</span>
        </div>
        <Targets items={targets.otherTargets}/>
      </section>
    </>}
    <div className={s.detailSectionHeading}>
      <h3>الجولات</h3>
      <span className={s.muted}>آخر 100 جولة كحد أقصى ضمن السايكل</span>
    </div>
    {detail?<Rounds items={detail.visits||[]} repName={rep.name}
      onOpen={setRound}/>:<Empty>جارٍ تحميل الجولات...</Empty>}
    {round&&<div className="modal-backdrop show manager-inline-modal">
      <div className="modal" role="dialog" aria-modal="true"
        aria-label="تفاصيل الجولة">
        <div className="modal-head"><h3>تفاصيل الجولة — {round.date}</h3>
          <button className="close-btn" type="button"
            aria-label="إغلاق" onClick={()=>setRound(null)}>✕</button>
        </div>
        <p>{kindNames[round.type]||round.type} • {round.targets.length} جهة</p>
        <div className="manager-detail-list">
          {round.targets.map(t=><div key={t.id}><strong>{t.name}</strong>
            <small>{t.area||'—'}</small></div>)}
        </div>
        {round.note&&<p>ملاحظة: {round.note}</p>}
        <button className={s.btn} type="button"
          onClick={()=>setRound(null)}>إغلاق</button>
      </div>
    </div>}
  </div>;
}
