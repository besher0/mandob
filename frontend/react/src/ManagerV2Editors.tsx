import React,{useEffect,useRef,useState} from 'react';
import s from './ManagerDashboardV2.module.css';
import './manager-v2-editors.css';

type Row=Record<string,any>;
const toggle=(items:string[],id:string)=>items.includes(id)?
  items.filter(value=>value!==id):[...items,id];
function Dialog({title,children,onClose}:{
  title:string;children:React.ReactNode;onClose:()=>void
}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;
    if(!dialog)return;
    const root=document.documentElement;
    const previousRootOverflow=root.style.overflow;
    const previousBodyOverflow=document.body.style.overflow;
    dialog.showModal();
    root.style.overflow='hidden';
    document.body.style.overflow='hidden';
    return ()=>{
      dialog.close();
      root.style.overflow=previousRootOverflow;
      document.body.style.overflow=previousBodyOverflow;
    };
  },[]);
  return <dialog ref={ref} dir="rtl" className={`${s.dialog} ${s.editorDialog} manager-v2-editor-dialog`}
    aria-label={title} onCancel={event=>{event.preventDefault();onClose()}}>
    <div className={`${s.sectionHead} manager-v2-editor-head`}><h3>{title}</h3>
      <button type="button" aria-label="إغلاق" onClick={onClose}>×</button></div>
    <div className="manager-v2-editor-scroll">{children}</div>
  </dialog>;
}
function Choices({title,items,chosen,onChange,disabled=false}:{
  title:string;items:{id:string;name:string}[];chosen:string[];
  onChange:(items:string[])=>void;disabled?:boolean
}){
  return <fieldset className={`${s.editorOptions} manager-v2-editor-options`}><legend>{title}</legend>
    {items.length?items.map(item=><label key={item.id}>
      <input type="checkbox" checked={chosen.includes(item.id)} disabled={disabled}
        onChange={()=>onChange(toggle(chosen,item.id))}/>
      <span>{item.name}</span></label>):<p>لا توجد خيارات متاحة ضمن هذا الفريق.</p>}
  </fieldset>;
}
const itemizeSpecialties=(values:any[])=>values.map(item=>String(item.specialty||item.name||item));
export function ManagerV2RepEditor({rep,team,areas,specialties,onSave,onClose}:{
  rep?:Row|null;team:Row|null;areas:Row[];specialties:string[];
  onSave:(payload:Row)=>Promise<void>;onClose:()=>void
}){
  const editing=Boolean(rep);
  const teamSpecialties=itemizeSpecialties(team?.specialties||[]);
  const [name,setName]=useState(rep?.name||'');
  const [username,setUsername]=useState(rep?.username||'');
  const [password,setPassword]=useState('');
  const [daily,setDaily]=useState(String(rep?.dailyTarget??8));
  const [annual,setAnnual]=useState(String(rep?.annualLeaveBalance??12));
  const [custom,setCustom]=useState(rep?.specialtyMode==='CUSTOM');
  const [selectedSpecialties,setSelectedSpecialties]=useState<string[]>(
    itemizeSpecialties(rep?.repSpecialties||[]));
  const [areaIds,setAreaIds]=useState<string[]>(
    (rep?.repAreas||[]).map((item:Row)=>item.areaId));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef(false);
  const selection=teamSpecialties.length?teamSpecialties:
    [...new Set(specialties)];
  const teamProducts=(team?.products||[]).map((item:Row)=>({
    id:item.productId||item.product?.id,name:item.product?.name||item.name||'—'
  })).filter((item:Row)=>Boolean(item.id));
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{
      if(!team?.id)throw Error('اختر الفريق أولاً من صفحة الفرق.');
      const payload:Row={name,dailyTarget:Number(daily),areaIds,
        specialtyMode:custom?'CUSTOM':'TEAM',
        customSpecialties:custom?selectedSpecialties:[]};
      if(editing)payload.annualLeaveBalance=Number(annual);
      else Object.assign(payload,{username,password});
      await onSave(payload);
    }catch(e:any){setError(e?.message||'تعذر الحفظ');}
    finally{pending.current=false;setBusy(false);}
  }
  return <Dialog title={editing?'تعديل المندوب':'إضافة مندوب جديد'} onClose={onClose}>
    <form className="manager-v2-editor-form" onSubmit={submit}>
      <div className={`${s.repFormGrid} manager-v2-editor-grid`}>
        <label className={s.editorField}>اسم المندوب<input required maxLength={120} value={name}
          onChange={e=>setName(e.target.value)}/></label>
        <label className={s.editorField}>اسم المستخدم<input required dir="ltr" autoComplete="off"
          readOnly={editing} value={username}
          onChange={e=>setUsername(e.target.value)}/></label>
        {!editing&&<label className={s.editorField}>كلمة المرور<input type="password" required
          minLength={12} maxLength={72} autoComplete="new-password"
          value={password} onChange={e=>setPassword(e.target.value)}/>
          <small>12 حرفاً على الأقل حسب سياسة النظام الحالي.</small></label>}
        <label className={s.editorField}>الفريق<select aria-label="الفريق" value={team?.id||''} required disabled>
          <option value={team?.id||''}>{team?.name||'لا يوجد فريق محدد'}</option>
        </select></label>
        <label className={s.editorField}>اختصاصات المندوب<select value={custom?'custom':'team'}
          onChange={e=>setCustom(e.target.value==='custom')}>
          <option value="team">استخدام اختصاصات الفريق</option>
          <option value="custom">اختصاصات مخصصة للمندوب</option>
        </select></label>
        <label className={s.editorField}>الهدف اليومي للزيارات<input type="number" required min={1} max={100}
          value={daily} onChange={e=>setDaily(e.target.value)}/></label>
        {editing&&<label className={s.editorField}>الرصيد السنوي للإجازة<input type="number" required
          min={0} max={365} value={annual} onChange={e=>setAnnual(e.target.value)}/></label>}
      </div>
      {custom&&<Choices title="الاختصاصات المخصصة"
        items={selection.map(value=>({id:value,name:value}))}
        chosen={selectedSpecialties} onChange={setSelectedSpecialties}/>}
      {!teamSpecialties.length&&<p className="manager-v2-editor-note">
        حدد اختصاصات الفريق من «تعديل الفريق» أولاً.</p>}
      <Choices title="الأصناف الخاصة بالمندوب (موروثة من الفريق)"
        items={teamProducts} chosen={teamProducts.map((p:Row)=>p.id)}
        onChange={()=>{}} disabled/>
      <p className="manager-v2-editor-note">الأصناف موروثة من الفريق في قاعدة بيانات
        Mandob الحالية. لتغييرها استخدم «تعديل الفريق».</p>
      <Choices title="المناطق" items={areas.map(a=>({id:a.id,name:a.name}))}
        chosen={areaIds} onChange={setAreaIds}/>
      {editing&&<p className="manager-v2-editor-note">
        تبقى الجولات القديمة محفوظة بمناطقها وفريقها الأصلي عند تعديل التكليف.</p>}
      {error&&<p className="manager-v2-editor-error" role="alert">{error}</p>}
      <div className={`${s.dialogFooter} manager-v2-editor-footer`}>
        <button className={`${s.btn} manager-v2-editor-primary`} type="submit"
          disabled={busy||!team}>{busy?'جارٍ الحفظ…':'حفظ المندوب'}</button>
        <button className={`${s.btn} ${s.secondary}`} type="button" onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </form>
  </Dialog>;
}
export function ManagerV2TeamEditor({team,products,specialties,onSave,onClose}:{
  team?:Row|null;products:Row[];specialties:string[];
  onSave:(payload:Row)=>Promise<void>;onClose:()=>void
}){
  const [name,setName]=useState(team?.name||'');
  const [specialtyIds,setSpecialtyIds]=useState<string[]>(
    itemizeSpecialties(team?.specialties||[]));
  const [productIds,setProductIds]=useState<string[]>(
    (team?.products||[]).map((r:Row)=>r.productId));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false);
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{await onSave({name,specialties:specialtyIds,productIds});}
    catch(e:any){setError(e?.message||'تعذر الحفظ');}
    finally{pending.current=false;setBusy(false);}
  }
  return <Dialog title={team?'تعديل الفريق':'إضافة فريق'} onClose={onClose}>
    <form className="manager-v2-editor-form" onSubmit={submit}>
      <p className="manager-v2-editor-note">
        المحافظة تُستمد من مناطق المندوبين المسندة للفريق؛ قاعدة البيانات الحالية
        لا تخزّن محافظة مستقلة للفريق.</p>
      <div className={`${s.repFormGrid} manager-v2-editor-grid`}><label className={s.editorField}>اسم الفريق
        <input required maxLength={120} value={name}
          onChange={e=>setName(e.target.value)}/></label></div>
      <Choices title="الاختصاصات" items={specialties.map(value=>({
        id:value,name:value
      }))} chosen={specialtyIds} onChange={setSpecialtyIds}/>
      <Choices title="الأصناف" items={products.filter(p=>p.active).map(p=>({
        id:p.id,name:p.name
      }))} chosen={productIds} onChange={setProductIds}/>
      <p className="manager-v2-editor-note">
        تغيير الاختصاصات والأصناف لا ينقل الزيارات التاريخية بأثر رجعي.</p>
      {error&&<p className="manager-v2-editor-error" role="alert">{error}</p>}
      <div className={`${s.dialogFooter} manager-v2-editor-footer`}>
        <button className={`${s.btn} manager-v2-editor-primary`} type="submit"
          disabled={busy}>{busy?'جارٍ الحفظ…':'حفظ الفريق'}</button>
        <button className={`${s.btn} ${s.secondary}`} type="button" onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </form>
  </Dialog>;
}
export function ManagerV2TeamMembers({team,reps,onRep,onAdd,onClose}:{
  team:Row;reps:Row[];onRep:(id:string)=>void;onAdd:()=>void;onClose:()=>void
}){
  return <Dialog title="إدارة مندوبين الفريق" onClose={onClose}>
    <p className="manager-v2-editor-note">أعضاء الفريق الحاليون. بسبب اعتماد
      قاعدة البيانات على فريق واحد لكل مندوب، نقل الأعضاء بين الفرق يحتاج إدارة
      الشركة؛ لذلك لا نعرض مربعات حفظ تؤدي إلى نقل وهمي.</p>
    <div className="manager-v2-member-list">
      {reps.length?reps.map(rep=><div className="manager-v2-member" key={rep.id}>
        <label><input type="checkbox" checked disabled
          aria-label={'عضو ضمن الفريق: '+rep.name}/>
          <span><strong>{rep.name}</strong>
            <small>{(rep.repAreas||[]).map((link:Row)=>link.area?.name)
              .filter(Boolean).join('، ')||'لا توجد مناطق مسندة'}</small>
            <small>مرتبط بالفريق الحالي</small></span></label>
        <button type="button" onClick={()=>onRep(rep.id)}>التفاصيل والتعديل</button>
      </div>):<p>لا يوجد مندوبون مسندون إلى {team.name}.</p>}
    </div>
    <div className={`${s.dialogFooter} manager-v2-editor-footer`}>
      <button className={`${s.btn} manager-v2-editor-primary`} type="button" onClick={onAdd}>
        + إضافة مندوب</button>
      <button className={`${s.btn} ${s.secondary}`} type="button" onClick={onClose}>إلغاء</button>
    </div>
  </Dialog>;
}

/** Company account creation uses the same dialog, fields and choice cards as the team editor. */
export function CompanyV2UserEditor({teams,areas,products,specialties,loading,loadError,onSave,onClose}:{
  teams:Row[];areas:Row[];products:Row[];specialties:string[];
  loading:boolean;loadError:string;onSave:(payload:Row)=>Promise<void>;onClose:()=>void
}){
  const [role,setRole]=useState('REP'),[name,setName]=useState(''),[username,setUsername]=useState('');
  const [password,setPassword]=useState(''),[teamId,setTeamId]=useState('');
  const [teamIds,setTeamIds]=useState<string[]>([]),[areaIds,setAreaIds]=useState<string[]>([]);
  const [custom,setCustom]=useState(false),[selectedSpecialties,setSelectedSpecialties]=useState<string[]>([]);
  const [extra,setExtra]=useState(''),[productIds,setProductIds]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false);
  const team=teams.find(item=>item.id===teamId);
  const inherited=(team?.products||[]).map((item:Row)=>({
    id:item.productId||item.product?.id,name:item.product?.name||item.name||'—'
  })).filter((item:Row)=>Boolean(item.id));
  const options=[...new Set(itemizeSpecialties(specialties))];
  const activeProducts=products.filter(p=>p.active).map(p=>({id:p.id,name:p.name}));
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending.current||loading||loadError)return;
    pending.current=true;setBusy(true);setError('');
    try{
      const payload:Row={name:name.trim(),username:username.trim(),password,role,areaIds};
      if(role==='TEAM_MANAGER')payload.teamIds=teamIds;
      else Object.assign(payload,{teamId:teamId||null,specialtyMode:custom?'CUSTOM':'TEAM',
        customSpecialties:custom?[...new Set([...selectedSpecialties,...extra.split(/[,،]/).map(x=>x.trim()).filter(Boolean)])]:[],
        customProductIds:teamId?[]:productIds});
      await onSave(payload);
    }catch(e:any){setError(e?.message||'تعذر الحفظ');}
    finally{pending.current=false;setBusy(false);}
  }
  return <Dialog title="إضافة مستخدم جديد" onClose={onClose}>
    <form className="manager-v2-editor-form company-v2-user-create" onSubmit={submit}>
      <div className={`${s.repFormGrid} manager-v2-editor-grid`}>
        <label className={s.editorField}>الاسم<input required maxLength={120} value={name}
          onChange={e=>setName(e.target.value)}/></label>
        <label className={s.editorField}>اسم المستخدم<input required maxLength={150} dir="ltr" autoComplete="off"
          value={username} onChange={e=>setUsername(e.target.value)}/></label>
        <label className={s.editorField}>كلمة المرور<input type="password" required minLength={12}
          maxLength={72} autoComplete="new-password" value={password}
          onChange={e=>setPassword(e.target.value)}/><small>12 حرفاً على الأقل</small></label>
        <label className={s.editorField}>الدور<select value={role} onChange={e=>setRole(e.target.value)}>
          <option value="REP">مندوب</option><option value="TEAM_MANAGER">مدير فريق</option>
        </select></label>
        {role==='REP'&&<>
          <label className={s.editorField}>الفريق<select value={teamId} onChange={e=>setTeamId(e.target.value)}>
            <option value="">بدون فريق</option>{teams.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className={s.editorField}>اختصاصات المندوب<select value={custom?'custom':'team'}
            onChange={e=>setCustom(e.target.value==='custom')}>
            <option value="team">استخدام اختصاصات الفريق</option>
            <option value="custom">اختصاصات مخصصة للمندوب</option>
          </select></label>
        </>}
      </div>
      {role==='TEAM_MANAGER'?<Choices title="الفرق المسؤولة من المدير" items={teams.map(t=>({id:t.id,name:t.name}))}
        chosen={teamIds} onChange={setTeamIds}/>:<>
        {custom&&<>
          <Choices title="الاختصاصات المخصصة" items={options.map(value=>({id:value,name:value}))}
            chosen={selectedSpecialties} onChange={setSelectedSpecialties}/>
          <label className={s.editorField}>إضافة اختصاص جديد (اختياري)<input value={extra}
            onChange={e=>setExtra(e.target.value)} placeholder="افصل الاختصاصات بفاصلة"/></label>
        </>}
        {teamId?<Choices title="الأصناف الخاصة بالمندوب (موروثة من الفريق)" items={inherited}
          chosen={inherited.map((p:Row)=>p.id)} onChange={()=>{}} disabled/>:
          <Choices title="أصناف المندوب بدون فريق" items={activeProducts} chosen={productIds} onChange={setProductIds}/>}
      </>}
      <Choices title="المناطق" items={areas.map(item=>({id:item.id,name:item.name}))}
        chosen={areaIds} onChange={setAreaIds}/>
      {loading&&!loadError&&<p role="status">جارٍ تحميل البيانات...</p>}
      {(error||loadError)&&<p className="manager-v2-editor-error" role="alert">{error||loadError}</p>}
      <div className={`${s.dialogFooter} manager-v2-editor-footer`}>
        <button className={`${s.btn} manager-v2-editor-primary`} type="submit"
          disabled={busy||loading||Boolean(loadError)}>{busy?'جارٍ الحفظ…':'حفظ المستخدم'}</button>
        <button className={`${s.btn} ${s.secondary}`} type="button" onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </form>
  </Dialog>;
}
