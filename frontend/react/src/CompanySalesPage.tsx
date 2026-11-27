import React,{useEffect,useState} from 'react';
import './company-sales.css';

type Row=Record<string,any>;
type Choice={id:string,name:string,provinceId?:string,type?:string};
type SalesOptions={provinces:Choice[],products:Choice[],agents:Choice[],targets:Choice[]};
type SalesPageData={items:Row[],total:number,page:number};
type Summary={counts:Record<string,number>,sums:Record<string,string>,visits:number,currency:string};
const blankItem=()=>({productId:'',quantity:1,unitPrice:'',offerType:'NONE',bonusQuantity:0,discountPercent:'0'});
const draftOrder=()=>({clientRef:crypto.randomUUID(),provinceId:'',targetType:'PHARMACY',
  targetId:'',agentId:'',visitId:'',date:todayValue(),
  notes:'',items:[blankItem()]});
const emptyOptions:SalesOptions={provinces:[],products:[],agents:[],targets:[]};
async function salesApi(path:string,method='GET',payload?:unknown){
  let response:Response;
  try{response=await fetch('/api/sales'+path,{credentials:'include',method,
    ...(payload===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})});}
  catch{throw new Error('تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.');}
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'تعذّر تنفيذ العملية');
  return body;
}
const fmt=(value:unknown)=>Number(value||0).toLocaleString('ar-SY',{maximumFractionDigits:2});
const statuses:Record<string,string>={PENDING:'بانتظار المراجعة',APPROVED:'مقبول',REJECTED:'مرفوض'};
const todayValue=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function CompanySalesPage({refresh,onSaved,managerMode=false}: {refresh:number,onSaved:()=>void,managerMode?:boolean}){
  const [tab,setTab]=useState('overview');
  const [options,setOptions]=useState<SalesOptions>(emptyOptions);
  const [agents,setAgents]=useState<Row[]>([]);
  const [accounts,setAccounts]=useState<Row[]>([]);
  const [orders,setOrders]=useState<SalesPageData|null>(null);
  const [visits,setVisits]=useState<SalesPageData|null>(null);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [province,setProvince]=useState('');
  const [status,setStatus]=useState('ALL');
  const [from,setFrom]=useState(''),[to,setTo]=useState('');
  const [page,setPage]=useState(1);
  const [reload,setReload]=useState(0);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [agentName,setAgentName]=useState(''),[agentProvince,setAgentProvince]=useState('');
  const [accountName,setAccountName]=useState(''),[accountUsername,setAccountUsername]=useState(''),[accountPassword,setAccountPassword]=useState('');
  const [resetPasswords,setResetPasswords]=useState<Record<string,string>>({});
  const [order,setOrder]=useState(draftOrder);
  const [visit,setVisit]=useState(()=>({clientRef:crypto.randomUUID(),provinceId:'',targetType:'PHARMACY',
    targetId:'',date:todayValue(),notes:''}));
  const [reviewing,setReviewing]=useState<string|null>(null);
  const [reviewNote,setReviewNote]=useState('');
  useEffect(()=>{let alive=true;setLoading(true);setError('');
    const filter=new URLSearchParams({page:String(page)});
    if(province)filter.set('provinceId',province);
    if(from)filter.set('from',from);
    if(to)filter.set('to',to);
    const query=filter.toString();
    const orderQuery=new URLSearchParams(filter);
    if(status!=='ALL')orderQuery.set('status',status);
    Promise.all([
      salesApi('/options'),salesApi('/agents'),salesApi('/orders?'+orderQuery.toString()),
      salesApi('/visits?'+query),salesApi('/summary?'+query),
      managerMode?Promise.resolve([]):salesApi('/accounts')
    ]).then(([nextOptions,nextAgents,nextOrders,nextVisits,nextSummary,nextAccounts])=>{
      if(!alive)return;
      setOptions(nextOptions);setAgents(nextAgents);setOrders(nextOrders);
      setVisits(nextVisits);setSummary(nextSummary);setAccounts(nextAccounts);
    }).catch(e=>{if(alive)setError(e.message);})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[refresh,reload,province,status,page,from,to,managerMode]);
  const targets=(provinceId:string,targetType:string)=>
    options.targets.filter(x=>x.provinceId===provinceId&&x.type===targetType);
  const agentsInProvince=(provinceId:string)=>
    options.agents.filter(x=>x.provinceId===provinceId);
  async function save(action:()=>Promise<unknown>,done:()=>void){
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await action();done();setMessage('تم الحفظ بنجاح');setReload(x=>x+1);onSaved();}
    catch(e:any){setError(e.message||'فشل الحفظ. يمكنك المحاولة مجدداً بنفس النموذج.');}
    finally{setBusy(false);}
  }
  const onAccount=(e:React.FormEvent)=>{e.preventDefault();
    save(()=>salesApi('/accounts','POST',{name:accountName,username:accountUsername,password:accountPassword}),
      ()=>{setAccountName('');setAccountUsername('');setAccountPassword('');});
  };
  const onAgent=(e:React.FormEvent)=>{e.preventDefault();
    save(()=>salesApi('/agents','POST',{name:agentName,provinceId:agentProvince}),
      ()=>setAgentName(''));};
  const onVisit=(e:React.FormEvent)=>{e.preventDefault();
    save(()=>salesApi('/visits','POST',visit),
      ()=>setVisit(p=>({...p,clientRef:crypto.randomUUID(),targetId:'',notes:''})));};
  const onOrder=(e:React.FormEvent)=>{e.preventDefault();
    save(()=>salesApi('/orders','POST',{...order,currency:'SYP',
      items:order.items.map(item=>({...item,quantity:Number(item.quantity),
        bonusQuantity:Number(item.bonusQuantity),discountPercent:String(item.discountPercent),
        unitPrice:String(item.unitPrice)}))}),
      ()=>setOrder(p=>({...p,clientRef:crypto.randomUUID(),notes:'',items:[blankItem()]})));};
  const onReview=(id:string,decision:string)=>save(
    ()=>salesApi('/orders/'+encodeURIComponent(id)+'/review','PATCH',{
      status:decision,note:reviewNote}),()=>{setReviewing(null);setReviewNote('');});
  const choices=[{id:'overview',title:'نظرة عامة'},{id:'orders',title:'الطلبات'},
    {id:'visits',title:'زيارات المبيعات'},
    ...managerMode?[]:[{id:'agents',title:'الوكلاء'},{id:'accounts',title:'مدراء المبيعات'}]];
  return <div className="company-sales-page" dir="rtl">
    <div className="company-sales-head">
      <div><h2>المبيعات</h2><p>{managerMode?'سجّل طلبات المبيعات وزياراتك، وتابع قرارات مدير الشركة':
        'إدارة الطلبات والزيارات والوكلاء وحسابات مدراء المبيعات حسب المحافظة — منفصلة عن جولات المندوبين الطبية'}</p></div>
      <button type="button" className="outline-button" onClick={()=>setReload(x=>x+1)} disabled={busy}>↻ تحديث</button>
    </div>
    <div className="company-sales-filters">
      <label>المحافظة<select value={province} onChange={e=>{setProvince(e.target.value);setPage(1);}}>
        <option value="">كل المحافظات</option>{options.provinces.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <label>حالة الطلب<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
        <option value="ALL">كل الحالات</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}
      </select></label>
      <label>من تاريخ<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label>
      <label>إلى تاريخ<input type="date" min={from||undefined} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label>
      <button type="button" className="outline-button" onClick={()=>{setProvince('');setStatus('ALL');setFrom('');setTo('');setPage(1);}}>مسح الفلاتر</button>
    </div>
    <div className="company-sales-tabs" role="group" aria-label="أقسام المبيعات">
      {choices.map(x=><button type="button" key={x.id} aria-pressed={tab===x.id} className={tab===x.id?'active':''} onClick={()=>setTab(x.id)}>{x.title}</button>)}
    </div>
    {loading&&<p className="company-sales-info">جارٍ تحميل بيانات المبيعات...</p>}
    {error&&<p role="alert" className="company-sales-error">{error}</p>}
    {message&&<p role="status" className="company-sales-success">{message}</p>}
    {tab==='overview'&&<section className="company-sales-panel">
      <h3>ملخص المبيعات <small>(بالليرة السورية)</small></h3>
      {summary?<div className="company-sales-stats">
        <article><span>طلبات بانتظار المراجعة</span><strong>{summary.counts.PENDING||0}</strong><small>{fmt(summary.sums.PENDING)} ل.س</small></article>
        <article><span>طلبات مقبولة</span><strong>{summary.counts.APPROVED||0}</strong><small>{fmt(summary.sums.APPROVED)} ل.س</small></article>
        <article><span>طلبات مرفوضة</span><strong>{summary.counts.REJECTED||0}</strong><small>{fmt(summary.sums.REJECTED)} ل.س</small></article>
        <article><span>زيارات المبيعات</span><strong>{summary.visits}</strong><small>لا تدخل في تغطية الجولات</small></article>
      </div>:!loading&&<p>لا تتوفر إحصائيات بعد.</p>}
      <p className="company-sales-info">تُحسب القيمة عند إنشاء الطلب، ولا يمكن تعديل صنف أو سعر الطلب بعد تسجيله. المراجعة تنقل الطلب من «معلق» إلى «مقبول» أو «مرفوض» مرة واحدة.</p>
    </section>}
    {tab==='accounts'&&!managerMode&&<section className="company-sales-panel">
      <h3>حسابات مدراء المبيعات</h3>
      <p className="company-sales-info">مدير المبيعات يستطيع تسجيل زياراته وطلباته ومتابعتها فقط، ولا يمكنه مراجعة الطلبات أو فتح واجهات الأطباء والمندوبين.</p>
      <form className="company-sales-inline-form" onSubmit={onAccount}>
        <label>اسم المدير<input required maxLength={120} value={accountName} onChange={e=>setAccountName(e.target.value)}/></label>
        <label>اسم الدخول<input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._-]{3,80}"
          value={accountUsername} onChange={e=>setAccountUsername(e.target.value)}/></label>
        <label>كلمة المرور<input required type="password" minLength={12} autoComplete="new-password"
          value={accountPassword} onChange={e=>setAccountPassword(e.target.value)}/></label>
        <button type="submit" className="primary-button" disabled={busy}>إنشاء حساب مدير مبيعات</button>
      </form>
      <div className="table-wrap"><table className="v2-table"><thead><tr>
        <th>الاسم</th><th>اسم الدخول</th><th>الحالة</th><th>إدارة الحساب</th></tr></thead>
      <tbody>{accounts.map(x=><tr key={x.id}>
        <td>{x.name}</td><td><bdi>{x.username}</bdi></td>
        <td>{x.active?'نشط':'موقوف'}</td>
        <td><div className="company-sales-account-actions">
          <button type="button" className="outline-button" disabled={busy}
            onClick={()=>save(()=>salesApi('/accounts/'+x.id,'PATCH',{active:!x.active}),()=>{})}>
            {x.active?'إيقاف الحساب':'تفعيل الحساب'}</button>
          <label>كلمة مرور جديدة
            <input type="password" autoComplete="new-password" minLength={12} maxLength={256}
              value={resetPasswords[x.id]||''} onChange={e=>setResetPasswords(p=>({...p,[x.id]:e.target.value}))}/>
          </label>
          <button type="button" className="outline-button"
            disabled={busy||(resetPasswords[x.id]||'').length<12}
            onClick={()=>save(()=>salesApi('/accounts/'+x.id,'PATCH',{password:resetPasswords[x.id]}),
              ()=>setResetPasswords(p=>({...p,[x.id]:''})))}>
            إعادة تعيين كلمة المرور</button>
        </div></td>
      </tr>)}</tbody></table></div>
      {!accounts.length&&!loading&&<p>ما في حسابات مدراء مبيعات حالياً.</p>}
    </section>}
    {tab==='agents'&&!managerMode&&<section className="company-sales-panel">
      <h3>إدارة الوكلاء</h3>
      <form className="company-sales-inline-form" onSubmit={onAgent}>
        <label>المحافظة<select required value={agentProvince} onChange={e=>setAgentProvince(e.target.value)}>
          <option value="">اختر المحافظة</option>{options.provinces.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label>اسم الوكيل<input required maxLength={120} value={agentName} onChange={e=>setAgentName(e.target.value)} placeholder="اسم الوكيل"/></label>
        <button type="submit" className="primary-button" disabled={busy}>إضافة وكيل</button>
      </form>
      <div className="table-wrap"><table className="v2-table"><thead><tr><th>الوكيل</th><th>المحافظة</th><th>الحالة</th><th>إجراء</th></tr></thead>
        <tbody>{agents.map(x=><tr key={x.id}><td>{x.name}</td><td>{x.province?.name||'—'}</td><td>{x.active?'نشط':'موقوف'}</td>
        <td><button type="button" className="outline-button" disabled={busy} onClick={()=>save(()=>salesApi('/agents/'+x.id,'PATCH',{active:!x.active}),()=>{})}>{x.active?'إيقاف':'تفعيل'}</button></td></tr>)}</tbody>
      </table></div>
      {!agents.length&&!loading&&<p>لا يوجد وكلاء بعد.</p>}
    </section>}
    {tab==='visits'&&<section className="company-sales-panel">
      <h3>تسجيل زيارة مبيعات</h3>
      <form className="company-sales-form" onSubmit={onVisit}>
        <div className="company-sales-form-grid">
          <label>المحافظة<select value={visit.provinceId} required onChange={e=>setVisit(v=>({...v,provinceId:e.target.value,targetId:''}))}>
            <option value="">اختر المحافظة</option>{options.provinces.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>نوع الجهة<select value={visit.targetType} onChange={e=>setVisit(v=>({...v,targetType:e.target.value,targetId:''}))}>
            <option value="PHARMACY">صيدلية</option><option value="HOSPITAL">مشفى</option>
          </select></label>
          <label>الجهة<select required value={visit.targetId} onChange={e=>setVisit(v=>({...v,targetId:e.target.value}))}>
            <option value="">اختر الجهة</option>{targets(visit.provinceId,visit.targetType).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>تاريخ الزيارة<input type="date" required max={todayValue()} value={visit.date} onChange={e=>setVisit(v=>({...v,date:e.target.value}))}/></label>
        </div>
        <label>ملاحظات<textarea value={visit.notes} maxLength={2000} onChange={e=>setVisit(v=>({...v,notes:e.target.value}))}/></label>
        <button type="submit" className="primary-button" disabled={busy||!visit.targetId}>{busy?'جارٍ الحفظ...':'حفظ زيارة المبيعات'}</button>
      </form>
      <h3>سجل الزيارات</h3>
      <div className="table-wrap"><table className="v2-table"><thead><tr><th>التاريخ</th><th>المحافظة</th><th>الجهة</th><th>الملاحظات</th></tr></thead>
        <tbody>{(visits?.items||[]).map(x=><tr key={x.id}><td>{String(x.visitDate).slice(0,10)}</td><td>{x.province?.name}</td>
        <td>{x.pharmacy?.name||x.hospital?.name}</td><td>{x.notes||'—'}</td></tr>)}</tbody></table></div>
      {!visits?.items.length&&!loading&&<p>لا توجد زيارات ضمن الفلاتر.</p>}
      <div className="company-sales-pagination">
        <button type="button" className="outline-button" disabled={page===1} onClick={()=>setPage(x=>Math.max(1,x-1))}>السابق</button>
        <span>الصفحة {page} • {visits?.total||0} زيارة</span>
        <button type="button" className="outline-button" disabled={!visits||page*30>=visits.total} onClick={()=>setPage(x=>x+1)}>التالي</button>
      </div>
    </section>}
    {tab==='orders'&&<><section className="company-sales-panel">
      <h3>إنشاء طلب مبيعات</h3>
      <form className="company-sales-form" onSubmit={onOrder}>
        <div className="company-sales-form-grid">
          <label>المحافظة<select required value={order.provinceId} onChange={e=>setOrder(v=>({...v,provinceId:e.target.value,agentId:'',targetId:'',visitId:''}))}>
            <option value="">اختر المحافظة</option>{options.provinces.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>نوع الجهة<select value={order.targetType} onChange={e=>setOrder(v=>({...v,targetType:e.target.value,targetId:'',visitId:''}))}>
            <option value="PHARMACY">صيدلية</option><option value="HOSPITAL">مشفى</option>
          </select></label>
          <label>الجهة<select required value={order.targetId} onChange={e=>setOrder(v=>({...v,targetId:e.target.value,visitId:''}))}>
            <option value="">اختر الجهة</option>{targets(order.provinceId,order.targetType).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>الوكيل<select required value={order.agentId} onChange={e=>setOrder(v=>({...v,agentId:e.target.value}))}>
            <option value="">اختر الوكيل</option>{agentsInProvince(order.provinceId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>تاريخ الطلب<input type="date" required max={todayValue()} value={order.date} onChange={e=>setOrder(v=>({...v,date:e.target.value}))}/></label>
          <label>ربط زيارة مبيعات (اختياري)<select value={order.visitId}
            onChange={e=>setOrder(v=>({...v,visitId:e.target.value}))}>
            <option value="">بدون زيارة مرتبطة</option>
            {(visits?.items||[]).filter(v=>v.provinceId===order.provinceId&&
              v.pharmacyId===(order.targetType==='PHARMACY'?order.targetId:null)&&
              v.hospitalId===(order.targetType==='HOSPITAL'?order.targetId:null))
              .map(v=><option key={v.id} value={v.id}>{String(v.visitDate).slice(0,10)} — {v.notes||'زيارة مبيعات'}</option>)}
          </select></label>
        </div>
        <h4>أصناف الطلب</h4>
        {order.items.map((item,i)=><div className="company-sales-item" key={i}>
          <label>الصنف<select required value={item.productId} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,productId:e.target.value}:x)}))}>
            <option value="">اختر الصنف</option>{options.products.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
          <label>الكمية<input type="number" required min={1} max={1000000} value={item.quantity} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,quantity:Number(e.target.value)}:x)}))}/></label>
          <label>السعر للوحدة (ل.س)<input type="number" required step=".01" min=".01" value={item.unitPrice} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,unitPrice:e.target.value}:x)}))}/></label>
          <label>العرض<select value={item.offerType} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,offerType:e.target.value,bonusQuantity:0,discountPercent:'0'}:x)}))}>
            <option value="NONE">بدون عرض</option><option value="BONUS">بونص</option><option value="DISCOUNT">حسم</option>
          </select></label>
          {item.offerType==='BONUS'&&<label>كمية البونص<input type="number" required min="1" value={item.bonusQuantity} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,bonusQuantity:Number(e.target.value)}:x)}))}/></label>}
          {item.offerType==='DISCOUNT'&&<label>الحسم %<input type="number" required min=".01" max="100" step=".01" value={item.discountPercent} onChange={e=>setOrder(v=>({...v,items:v.items.map((x,j)=>i===j?{...x,discountPercent:e.target.value}:x)}))}/></label>}
          <button type="button" className="outline-button" disabled={order.items.length===1} onClick={()=>setOrder(v=>({...v,items:v.items.filter((_,j)=>j!==i)}))}>حذف الصنف</button>
        </div>)}
        <button type="button" className="outline-button" disabled={order.items.length>=100} onClick={()=>setOrder(v=>({...v,items:[...v.items,blankItem()]}))}>+ إضافة صنف</button>
        <label>ملاحظات<textarea value={order.notes} maxLength={2000} onChange={e=>setOrder(v=>({...v,notes:e.target.value}))}/></label>
        <button type="submit" className="primary-button" disabled={busy||!order.agentId||!order.targetId}>{busy?'جارٍ الحفظ...':'حفظ الطلب'}</button>
      </form>
    </section>
    <section className="company-sales-panel">
      <h3>سجل الطلبات</h3>
      <div className="table-wrap"><table className="v2-table"><thead><tr><th>التاريخ</th><th>الجهة</th><th>المحافظة</th><th>الوكيل</th><th>الإجمالي (ل.س)</th><th>الحالة</th><th>المراجعة</th></tr></thead>
        <tbody>{(orders?.items||[]).map(x=><tr key={x.id}>
          <td>{String(x.orderDate).slice(0,10)}</td><td>{x.pharmacy?.name||x.hospital?.name}</td>
          <td>{x.province?.name}</td><td>{x.agent?.name}</td>
          <td>{fmt(x.total)}
            <details className="company-sales-order-details"><summary>تفاصيل الأصناف</summary>
              {(x.items||[]).map((item:Row)=><div key={item.id}>
                <strong>{item.productName}</strong> — {item.quantity} × {fmt(item.unitPrice)} ل.س
                {item.offerType==='BONUS'?' • بونص '+item.bonusQuantity:
                 item.offerType==='DISCOUNT'?' • حسم '+item.discountPercent+'%':''}
                {' • الإجمالي '+fmt(item.total)+' ل.س'}
              </div>)}
            </details>
          </td>
          <td>{statuses[x.status]||x.status}</td>
          <td>{x.status==='PENDING'&&!managerMode?<button type="button" className="outline-button" onClick={()=>{setReviewing(x.id);setReviewNote('');}}>مراجعة</button>:
            <span>{x.reviewer?.name||'—'}{x.reviewNote?' — '+x.reviewNote:''}</span>}</td>
        </tr>)}</tbody></table></div>
      {!orders?.items.length&&!loading&&<p>لا توجد طلبات ضمن الفلاتر.</p>}
      <div className="company-sales-pagination">
        <button type="button" className="outline-button" disabled={page===1} onClick={()=>setPage(x=>Math.max(1,x-1))}>السابق</button>
        <span>الصفحة {page} • {orders?.total||0} طلب</span>
        <button type="button" className="outline-button" disabled={!orders||page*30>=orders.total} onClick={()=>setPage(x=>x+1)}>التالي</button>
      </div>
    </section></>}
    {reviewing&&<div className="company-sales-review-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setReviewing(null);}}>
      <div className="company-sales-review-modal" role="dialog" aria-modal="true" aria-label="مراجعة الطلب">
        <h3>مراجعة طلب المبيعات</h3><label>ملاحظة القرار<textarea maxLength={2000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="سبب الرفض إلزامي"/></label>
        <div className="company-sales-actions">
          <button type="button" className="primary-button" disabled={busy} onClick={()=>onReview(reviewing,'APPROVED')}>موافقة</button>
          <button type="button" className="outline-button" disabled={busy||!reviewNote.trim()} onClick={()=>onReview(reviewing,'REJECTED')}>رفض</button>
          <button type="button" className="outline-button" onClick={()=>setReviewing(null)}>إلغاء</button>
        </div>
      </div>
    </div>}
  </div>;
}
