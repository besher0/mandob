import type {ReactNode} from 'react';

// Shared presentation used by the six REP analytics routes. Visual markup and
// dimensions follow mandob-v2/main apps/web/src/features/rep/Analytics.tsx,
// TargetList.tsx and app/globals.css; data remains owned by the current backend.
export type ReferenceKpi={label:string;value:string|number};

export function RefAnalysisHead({title,onBack}:{title:string;onBack:()=>void}){
  return <div className="page-head ref-analysis-page-head">
    <h2>{title}</h2>
    <button type="button" className="back" onClick={onBack}>رجوع ←</button>
  </div>;
}

export function RefAnalysisKpis({items}:{items:ReferenceKpi[]}){
  return <div className="stats-row ref-analysis-stats">
    {items.map(item=><div className="mini" key={item.label}>
      <strong>{item.value}</strong><span>{item.label}</span>
    </div>)}
  </div>;
}

type DoctorRow={
  id:string;name:string;grade?:string;area?:string;
  done:number;target:number;coverage?:number;last?:string
};
export function RefDoctorAnalysisCard({row}:{row:DoctorRow}){
  const completed=row.target>0&&row.done>=row.target;
  const status=row.done===0?'غير مزار':completed?'مكتمل':'ناقص';
  const percentage=row.target>0?Math.max(0,Math.min(100,Math.round(row.done/row.target*100))):0;
  return <article className="list-card ref-analysis-list-card ref-analysis-doctor">
    <div className="row">
      <strong>{row.name}</strong>
      <span className={'badge ref-analysis-badge ref-grade-'+String(row.grade||'C').toLowerCase()}>
        {row.grade||'—'}
      </span>
    </div>
    <div className="meta">{row.area||'منطقة غير محددة'}</div>
    <div className="row card-detail">
      <div className="meta">آخر زيارة ضمن الفترة: {row.last||'—'}</div>
      <span className={'badge ref-analysis-badge '+(row.done===0?'red':completed?'green':'amber')}>
        {status}
      </span>
    </div>
    <div className="meta">زيارات الفترة: {row.done} من {row.target}</div>
    <progress max={100} value={percentage} aria-label={'تقدم زيارات '+row.name}/>
  </article>;
}

export function RefDistribution({total,completed,behind,unvisited}:{
  total:number;completed:number;behind:number;unvisited:number
}){
  const entries:[string,number][]=[
    ['مكتمل',completed],['ناقص زيارة أو أكثر',behind],['غير مزار',unvisited]
  ];
  return <div className="list-card ref-analysis-list-card ref-distribution">
    <div className="row">
      <strong>توزيع الالتزام</strong>
      <span className="badge ref-analysis-badge">{total} طبيب</span>
    </div>
    {entries.map(([label,count])=><div className="analysis-distribution" key={label}>
      <div className="row"><span>{label}</span><strong>{count}</strong></div>
      <progress aria-label={label} value={count} max={total||1}/>
    </div>)}
  </div>;
}

type AreaRow={areaId:string;areaName:string;doctors:number;unvisited:number;
 coverage:number;done:number;target:number;aCount?:number};
export function RefAreaAnalysisCard({row}:{row:AreaRow}){
  const coverage=Math.max(0,Math.min(100,Number(row.coverage)||0));
  return <article className="list-card ref-analysis-list-card ref-analysis-area">
    <div className="row">
      <strong>{row.areaName}</strong>
      <span className={'badge ref-analysis-badge '+(coverage<50?'red':'green')}>
        {coverage}%
      </span>
    </div>
    <p className="meta">{row.doctors} طبيب • {row.unvisited} غير مزار
      {row.aCount!==undefined?' • '+row.aCount+' أطباء A':''}
    </p>
    <progress max={100} value={coverage} aria-label={'تغطية '+row.areaName}/>
    <div className="meta">{row.done} من {row.target} زيارة</div>
  </article>;
}

type ProductRow={id:string;name:string;promotions:number;quantity:number;
 assigned?:boolean;lastPromotedAt?:string|null;target?:number|null;guidance?:string|null};
export function RefProductAnalysisCard({item,onClick}:{
  item:ProductRow;onClick:()=>void
}){
  return <button type="button" className="list-card ref-analysis-list-card ref-analysis-product"
    onClick={onClick} aria-label={'عرض تفاصيل الصنف '+item.name}>
    <div className="row">
      <div><strong>{item.name}</strong>
        {item.guidance&&<div className="meta">{item.guidance}</div>}
      </div>
      <span className="badge ref-analysis-badge">{item.promotions} مرة</span>
    </div>
    <p className="meta">الكمية الموزعة: {item.quantity}
      {item.target!=null?' • المستهدف: '+item.target:''}
    </p>
    {!item.assigned&&<p className="meta">صنف تم ترويجه سابقاً وغير مسند حالياً</p>}
    <div className="meta">آخر ترويج: {item.lastPromotedAt||'لا يوجد بعد'} • اضغط للتفاصيل</div>
  </button>;
}

export function RefCyclesTable({rows}:{rows:{
  label:string;current:number;previous:number;unit?:string
}[]}){
  return <div className="analysis-table-wrap">
    <table className="analysis-table">
      <thead><tr><th>المؤشر</th><th>الحالي</th><th>السابق</th><th>التغير</th></tr></thead>
      <tbody>{rows.map(row=>{
        const difference=row.current-row.previous;
        return <tr key={row.label}>
          <td>{row.label}</td><td>{row.current}{row.unit||''}</td>
          <td>{row.previous}{row.unit||''}</td>
          <td className={difference===0?'':difference>0?'delta-up':'delta-down'}>
            <bdi>{difference>0?'+':''}{difference}{row.unit||''}</bdi>
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function RefAnalysisEmpty({children}:{children:ReactNode}){
  return <p className="empty ref-analysis-empty">{children}</p>;
}
