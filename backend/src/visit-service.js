'use strict';
const {prisma,HttpError,companyId,asDate,validateLocation}=require('./auth');
const {sameVisit}=require('./domain');
const {doctorTargetWhere}=require('./doctor-access');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES={DOCTOR:{model:'doctor',field:'doctorId'},PHARMACY:{model:'pharmacy',field:'pharmacyId'},
  HOSPITAL:{model:'hospital',field:'hospitalId'}};
const include={
  rep:{select:{id:true,name:true,teamId:true}},
  targets:{include:{
    doctor:{select:{id:true,name:true}},pharmacy:{select:{id:true,name:true}},
    hospital:{select:{id:true,name:true}},areaAtVisit:{select:{id:true,name:true}}
  }},
  products:{select:{productId:true,quantity:true,product:{select:{id:true,name:true}}}}
};
function dateString(date){return date.toISOString().slice(0,10);}
function listVisit(v){return {
  id:v.id,repId:v.repId,repName:v.rep?.name,teamIdAtVisit:v.teamIdAtVisit,
  type:v.type,visitDate:dateString(v.visitDate),createdAt:v.createdAt,
  location:{latitude:v.latitude,longitude:v.longitude,accuracy:v.locationAccuracy,
    capturedAt:v.locationCapturedAt},
  targets:v.targets.map(t=>({
    id:t.doctorId||t.pharmacyId||t.hospitalId,
    name:t.doctor?.name||t.pharmacy?.name||t.hospital?.name,
    areaIdAtVisit:t.areaIdAtVisit,areaNameAtVisit:t.areaAtVisit?.name||null
  })),
  products:(v.products||[]).map(link=>({
    id:link.productId,name:link.product?.name||null,quantity:link.quantity
  }))
};}
async function submitVisit(user,input){
  if(user.role!=='REP')throw new HttpError(403,'لا يمكن تسجيل الجولة إلا من حساب مندوب');
  const company=companyId(user);
  const type=input?.type;
  if(!Object.hasOwn(TYPES,type))throw new HttpError(400,'نوع الجولة غير صحيح');
  const raw=input?.targetIds;
  if(!Array.isArray(raw)||raw.length===0||raw.length>100||
    raw.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(raw).size!==raw.length)
    throw new HttpError(400,'قائمة الجهات تحتوي عناصر غير صحيحة أو مكررة');
  const visitDate=asDate(input?.visitDate);
  if(visitDate.getTime()>Date.now())throw new HttpError(400,'لا يمكن تسجيل جولة بتاريخ مستقبلي');
  if(typeof input?.clientVisitId!=='string'||!UUID.test(input.clientVisitId))
    throw new HttpError(400,'معرّف الجولة غير صحيح');

  const areaByTarget=input?.areaByTarget;
  if(areaByTarget!==undefined){
    if(!areaByTarget||typeof areaByTarget!=='object'||Array.isArray(areaByTarget)||
      Object.keys(areaByTarget).length!==raw.length||
      Object.keys(areaByTarget).some(id=>!raw.includes(id)||typeof areaByTarget[id]!=='string'||
        !UUID.test(areaByTarget[id])))
      throw new HttpError(400,'لازم تحدد منطقة صحيحة لكل جهة ضمن الجولة');
  }

  const products=input?.products??[];
  if(!Array.isArray(products)||products.length>100||
    products.some(item=>!item||typeof item!=='object'||Array.isArray(item)||
      typeof item.productId!=='string'||!UUID.test(item.productId)||
      !Number.isInteger(item.quantity)||item.quantity<0||item.quantity>1000000)||
    new Set(products.map(item=>item.productId)).size!==products.length)
    throw new HttpError(400,'بيانات الأصناف أو الكميات غير صحيحة');

  const owner={companyId:company,repId:user.id};
  async function previous(){
    const old=await prisma.visit.findUnique({where:{clientVisitId:input.clientVisitId},include});
    if(!old)return null;
    if(old.companyId!==owner.companyId||old.repId!==owner.repId||!sameVisit(old,input))
      throw new HttpError(409,'رقم الجولة مستخدم لبيانات مختلفة');
    return {id:old.id,duplicate:true};
  }
  const existing=await previous();
  if(existing)return existing;

  const loc=validateLocation(input?.location);
  const {model,field}=TYPES[type];
  try{
    const result=await prisma.$transaction(async(tx)=>{
      const rep=await tx.user.findFirst({
        where:{id:user.id,companyId:company,role:'REP',active:true},
        select:{id:true,role:true,companyId:true,active:true,teamId:true,specialtyMode:true,
          repSpecialties:{select:{specialty:true}},repProducts:{select:{productId:true}},
          team:{select:{id:true,companyId:true,specialties:{select:{specialty:true}},
            products:{select:{productId:true}}}}}
      });
      if(!rep)throw new HttpError(403,'حساب المندوب غير نشط أو لم يعد تابعاً للشركة');
      if(rep.teamId){
        const team=await tx.team.findFirst({where:{id:rep.teamId,companyId:company},select:{id:true}});
        if(!team)throw new HttpError(403,'فريق المندوب لا يتبع شركته');
      }

      const promotedProductIds=products.map(item=>item.productId);
      if(promotedProductIds.length){
        const assignedProductIds=new Set((rep.teamId?rep.team?.products:rep.repProducts||[])
          .map(link=>link.productId));
        if(promotedProductIds.some(id=>!assignedProductIds.has(id)))
          throw new HttpError(403,'يوجد صنف غير مسند للمندوب');
        const activeProducts=await tx.product.count({
          where:{companyId:company,active:true,id:{in:promotedProductIds}}
        });
        if(activeProducts!==promotedProductIds.length)
          throw new HttpError(403,'يوجد صنف غير فعال أو لا يتبع الشركة');
      }

      const repAreaAccess={companyId:company,
        repAreas:{some:{repId:user.id,rep:{companyId:company,role:'REP',active:true}}}};
      const locationAccess=type==='DOCTOR'?
        {OR:[{area:repAreaAccess},{doctorAreas:{some:{area:repAreaAccess}}}]}:{area:repAreaAccess};
      const doctorScope=type==='DOCTOR'?doctorTargetWhere(rep,company):null;
      if(type==='DOCTOR'&&!doctorScope)
        throw new HttpError(403,'لا توجد اختصاصات أطباء مسموحة للمندوب');
      const candidates=await tx[model].findMany({
        where:type==='DOCTOR'?{...doctorScope,id:{in:raw}}:
          {companyId:company,id:{in:raw},active:true,...locationAccess},
        select:type==='DOCTOR'?{id:true,areaId:true,doctorAreas:{select:{areaId:true}}}:
          {id:true,areaId:true}
      });
      if(candidates.length!==raw.length)throw new HttpError(403,type==='DOCTOR'?
        'الطبيب غير مسموح للمندوب ضمن مناطقه واختصاصاته':
        'جهة ليست ضمن مناطق المندوب أو الشركة');

      const assignments=await tx.repArea.findMany({
        where:{repId:user.id,area:{companyId:company}},select:{areaId:true}
      });
      const permittedAreas=new Set(assignments.map(a=>a.areaId));
      const areaForTarget=new Map();
      for(const target of candidates){
        const linkedAreas=new Set([target.areaId,
          ...(type==='DOCTOR'?target.doctorAreas.map(a=>a.areaId):[])]);
        const possible=[...linkedAreas].filter(id=>permittedAreas.has(id));
        const explicitlyChosen=areaByTarget?.[target.id];
        if(explicitlyChosen&&(!permittedAreas.has(explicitlyChosen)||!linkedAreas.has(explicitlyChosen)))
          throw new HttpError(403,'المنطقة المختارة للجهة ليست ضمن مناطق المندوب');
        if(!explicitlyChosen&&possible.length!==1)
          throw new HttpError(400,'الجهة مرتبطة بأكثر من منطقة؛ حدد منطقة الزيارة');
        areaForTarget.set(target.id,explicitlyChosen||possible[0]);
      }

      const created=await tx.visit.create({
        data:{...owner,teamIdAtVisit:rep.teamId,clientVisitId:input.clientVisitId,type,visitDate,
          latitude:loc.latitude,longitude:loc.longitude,locationAccuracy:loc.accuracy,
          locationCapturedAt:loc.capturedAt,
          targets:{create:raw.map(id=>({[field]:id,areaIdAtVisit:areaForTarget.get(id)}))},
          ...(products.length?{products:{create:products.map(item=>({
            productId:item.productId,quantity:item.quantity
          }))}}:{})
        },include
      });
      await tx.auditLog.create({data:{companyId:company,actorId:user.id,action:'CREATE',
        entity:'VISIT',entityId:created.id}});
      return created;
    },{isolationLevel:'Serializable',maxWait:10000,timeout:20000});
    return listVisit(result);
  }catch(err){
    if(err.code==='P2002'){
      const found=await previous();
      if(found)return found;
    }
    if(err.code==='P2034')throw new HttpError(409,'تغيرت بيانات الفريق أثناء حفظ الجولة، أعد المحاولة');
    throw err;
  }
}
module.exports={submitVisit,listVisit,include};
