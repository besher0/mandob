'use strict';
// Sales data is company-owned and deliberately separate from medical REP visits.
const {prisma,HttpError,requireRole,companyId,asDate,requireString,safeInt,hashPassword}=require('./auth');
const {checkedInput}=require('./request-validation');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES=['PENDING','APPROVED','REJECTED'];
const OFFER_TYPES=['NONE','BONUS','DISCOUNT'];
const nowDamascus=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Damascus',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function id(value,label='المعرّف'){
  if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,label+' غير صالح');
  return value;
}
function company(user,mode='read'){
  requireRole(user,mode==='manage'?['COMPANY_ADMIN']:['COMPANY_ADMIN','SALES_MANAGER']);
  return companyId(user);
}
function ownSales(user){return user.role==='SALES_MANAGER'?{authorId:user.id}:{};}
function note(value=''){
  if(typeof value!=='string'||value.length>2000)throw new HttpError(400,'الملاحظات غير صالحة');
  return value.trim();
}
function date(value){
  const d=asDate(value);
  if(value>nowDamascus())throw new HttpError(400,'التاريخ لا يمكن أن يكون في المستقبل');
  return d;
}
function optPage(query){
  const page=safeInt(query?.page??1,'page',1,100000);
  return {page,skip:(page-1)*30,take:30};
}
function filterDates(query){
  const where={};
  if(query?.from!==undefined)where.gte=asDate(query.from);
  if(query?.to!==undefined)where.lte=asDate(query.to);
  if(where.gte&&where.lte&&where.gte>where.lte)throw new HttpError(400,'نطاق التواريخ غير صحيح');
  return Object.keys(where).length?where:null;
}
function moneyCents(value,label,maxWhole=10000000000n){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))
    throw new HttpError(400,label+' غير صالح');
  const [whole,decimal='']=value.split('.');
  const cents=BigInt(whole)*100n+BigInt((decimal+'00').slice(0,2));
  if(cents>maxWhole*100n)throw new HttpError(400,label+' كبير جداً');
  return cents;
}
function centsText(cents){
  return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
}
function priceItems(items){
  if(!Array.isArray(items)||items.length<1||items.length>100)
    throw new HttpError(400,'اختر صنفاً واحداً على الأقل وبحد أقصى 100 صنف');
  const seen=new Set();
  return items.map(row=>{
    checkedInput(row,['productId','quantity','unitPrice','offerType','bonusQuantity','discountPercent']);
    const productId=id(row.productId,'الصنف');
    if(seen.has(productId))throw new HttpError(400,'الصنف مكرر في الطلب');
    seen.add(productId);
    const quantity=safeInt(row.quantity,'الكمية',1,1000000);
    const bonusQuantity=safeInt(row.bonusQuantity??0,'البونص',0,1000000);
    const offerType=row.offerType||'NONE';
    if(!OFFER_TYPES.includes(offerType))throw new HttpError(400,'نوع العرض غير صالح');
    const price=moneyCents(row.unitPrice,'السعر');
    if(price<=0n)throw new HttpError(400,'السعر يجب أن يكون أكبر من صفر');
    const discountCents=moneyCents(row.discountPercent??'0','الحسم',100n);
    if(discountCents>10000n)throw new HttpError(400,'الحسم لا يتجاوز 100%');
    if((offerType!=='BONUS'&&bonusQuantity!==0)||
       (offerType==='BONUS'&&bonusQuantity===0)||
       (offerType!=='DISCOUNT'&&discountCents!==0n)||
       (offerType==='DISCOUNT'&&discountCents===0n))
      throw new HttpError(400,'العرض لا يطابق نوعه');
    // Discount is rounded to the nearest cent once per saved line, in integer arithmetic.
    const lineCents=(price*BigInt(quantity)*(10000n-discountCents)+5000n)/10000n;
    return {productId,quantity,unitPrice:centsText(price),offerType,bonusQuantity,
      discountPercent:centsText(discountCents),total:centsText(lineCents),lineCents};
  });
}
async function target(tx,c,provinceId,targetType,targetId){
  if(!['PHARMACY','HOSPITAL'].includes(targetType))throw new HttpError(400,'نوع الجهة غير صالح');
  id(targetId,'الجهة');id(provinceId,'المحافظة');
  const model=targetType==='PHARMACY'?tx.pharmacy:tx.hospital;
  const row=await model.findFirst({where:{id:targetId,companyId:c,active:true,
    area:{companyId:c,provinceId}},select:{id:true,name:true}});
  if(!row)throw new HttpError(400,'الجهة غير نشطة أو ليست ضمن المحافظة المحددة');
  return targetType==='PHARMACY'?{pharmacyId:targetId,hospitalId:null}:
    {hospitalId:targetId,pharmacyId:null};
}
function sameTarget(row,p){
  return row.provinceId===p.provinceId&&row.pharmacyId===(p.targetType==='PHARMACY'?p.targetId:null)&&
    row.hospitalId===(p.targetType==='HOSPITAL'?p.targetId:null);
}
function sameVisitPayload(row,p,visitDate,notes){
  return sameTarget(row,p)&&row.visitDate.getTime()===visitDate.getTime()&&row.notes===notes;
}
function sameOrderPayload(row,p,priced,orderDate,notes,agentId,visitId){
  if(!sameTarget(row,p)||row.agentId!==agentId||row.visitId!==visitId||
    row.orderDate.getTime()!==orderDate.getTime()||row.notes!==notes||
    row.currency!=='SYP'||row.items.length!==priced.length)return false;
  const incoming=new Map(priced.map(item=>[item.productId,item]));
  return row.items.every(item=>{
    const request=incoming.get(item.productId);
    return request&&request.quantity===item.quantity&&
      request.offerType===item.offerType&&request.bonusQuantity===item.bonusQuantity&&
      moneyCents(String(item.unitPrice),'price')===moneyCents(request.unitPrice,'price')&&
      moneyCents(String(item.discountPercent),'discount')===moneyCents(request.discountPercent,'discount')&&
      moneyCents(String(item.total),'total',100000000000000n)===request.lineCents;
  });
}
async function audit(tx,user,action,entity,entityId){
  await tx.auditLog.create({data:{companyId:user.companyId,actorId:user.id,action,entity,entityId}});
}
const optionsInclude={};
function registerSalesRoutes(app,wrap){
  const route=(method,path,handler)=>app[method](path,wrap(handler));
  route('get','/api/sales/accounts',async(req,res)=>{
    const c=company(req.user,'manage');
    const accounts=await prisma.user.findMany({where:{companyId:c,role:'SALES_MANAGER'},
      select:{id:true,name:true,username:true,active:true,createdAt:true},
      orderBy:{name:'asc'},take:500});
    res.json(accounts);
  });
  route('post','/api/sales/accounts',async(req,res)=>{
    const c=company(req.user,'manage');
    checkedInput(req.body,['name','username','password']);
    const name=requireString(req.body.name,'اسم مدير المبيعات',120);
    const username=requireString(req.body.username,'اسم الدخول',80);
    if(!/^[A-Za-z0-9._-]{3,80}$/.test(username))
      throw new HttpError(400,'اسم الدخول يجب أن يكون بأحرف إنكليزية وأرقام');
    const passwordHash=hashPassword(req.body.password);
    const account=await prisma.$transaction(async tx=>{
      const user=await tx.user.create({data:{companyId:c,name,username,
        passwordHash,role:'SALES_MANAGER'},select:{id:true,name:true,username:true}});
      await audit(tx,req.user,'CREATE','SALES_MANAGER',user.id);
      return user;
    },{maxWait:10000,timeout:20000});
    res.status(201).json(account);
  });
  route('patch','/api/sales/accounts/:id',async(req,res)=>{
    const c=company(req.user,'manage'),accountId=id(req.params.id,'مدير المبيعات');
    checkedInput(req.body,['active','password']);
    const data={};
    if(req.body.active!==undefined){
      if(typeof req.body.active!=='boolean')throw new HttpError(400,'حالة الحساب غير صالحة');
      data.active=req.body.active;
    }
    if(req.body.password!==undefined)data.passwordHash=hashPassword(req.body.password);
    const account=await prisma.$transaction(async tx=>{
      const changed=await tx.user.updateMany({where:{id:accountId,companyId:c,role:'SALES_MANAGER'},
        data});
      if(!changed.count)throw new HttpError(404,'حساب مدير المبيعات غير موجود');
      if(data.passwordHash||data.active===false)
        await tx.authSession.deleteMany({where:{userId:accountId}});
      await audit(tx,req.user,'UPDATE','SALES_MANAGER',accountId);
      return tx.user.findUnique({where:{id:accountId},select:{
        id:true,name:true,username:true,active:true
      }});
    },{maxWait:10000,timeout:20000});
    res.json(account);
  });
  route('get','/api/sales/options',async(req,res)=>{
    const c=company(req.user);
    const provinceId=req.query.provinceId? id(req.query.provinceId,'المحافظة'):null;
    const [provinces,products,agents,pharmacies,hospitals]=await Promise.all([
      prisma.province.findMany({where:{companyId:c},select:{id:true,name:true},orderBy:{name:'asc'}}),
      prisma.product.findMany({where:{companyId:c,active:true},select:{id:true,name:true},orderBy:{name:'asc'}}),
      prisma.salesAgent.findMany({where:{companyId:c,active:true,...(provinceId?{provinceId}:{})},
        select:{id:true,name:true,provinceId:true},orderBy:{name:'asc'}}),
      prisma.pharmacy.findMany({where:{companyId:c,active:true,...(provinceId?{area:{provinceId}}:{})},
        select:{id:true,name:true,area:{select:{provinceId:true}}},orderBy:{name:'asc'},take:5000}),
      prisma.hospital.findMany({where:{companyId:c,active:true,...(provinceId?{area:{provinceId}}:{})},
        select:{id:true,name:true,area:{select:{provinceId:true}}},orderBy:{name:'asc'},take:5000})
    ]);
    res.json({provinces,products,agents,targets:[
      ...pharmacies.filter(x=>x.area?.provinceId).map(x=>({id:x.id,name:x.name,type:'PHARMACY',provinceId:x.area.provinceId})),
      ...hospitals.filter(x=>x.area?.provinceId).map(x=>({id:x.id,name:x.name,type:'HOSPITAL',provinceId:x.area.provinceId}))
    ]});
  });
  route('get','/api/sales/agents',async(req,res)=>{
    const c=company(req.user);
    res.json(await prisma.salesAgent.findMany({where:{companyId:c},
      include:{province:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'},take:500}));
  });
  route('post','/api/sales/agents',async(req,res)=>{
    const c=company(req.user,'manage');checkedInput(req.body,['provinceId','name']);
    const provinceId=id(req.body.provinceId,'المحافظة'),name=requireString(req.body.name,'الوكيل',120);
    const province=await prisma.province.findFirst({where:{id:provinceId,companyId:c},select:{id:true}});
    if(!province)throw new HttpError(400,'المحافظة غير متاحة');
    const result=await prisma.$transaction(async tx=>{
      const row=await tx.salesAgent.create({data:{companyId:c,provinceId,name}});
      await audit(tx,req.user,'CREATE','SALES_AGENT',row.id);
      return row;
    });
    res.status(201).json(result);
  });
  route('patch','/api/sales/agents/:id',async(req,res)=>{
    const c=company(req.user,'manage'),agentId=id(req.params.id,'الوكيل');
    checkedInput(req.body,['active']);
    if(typeof req.body?.active!=='boolean')throw new HttpError(400,'حالة الوكيل غير صحيحة');
    const row=await prisma.$transaction(async tx=>{
      const changed=await tx.salesAgent.updateMany({where:{id:agentId,companyId:c},data:{active:req.body.active}});
      if(!changed.count)throw new HttpError(404,'الوكيل غير موجود');
      await audit(tx,req.user,'UPDATE','SALES_AGENT',agentId);
      return tx.salesAgent.findUnique({where:{id:agentId}});
    });
    res.json(row);
  });
  route('get','/api/sales/visits',async(req,res)=>{
    const c=company(req.user),page=optPage(req.query),dates=filterDates(req.query);
    const where={companyId:c,...ownSales(req.user),...(dates?{visitDate:dates}:{})};
    if(req.query.provinceId)where.provinceId=id(req.query.provinceId,'المحافظة');
    const [items,total]=await Promise.all([
      prisma.salesVisit.findMany({where,include:{province:{select:{name:true}},
        pharmacy:{select:{name:true}},hospital:{select:{name:true}},author:{select:{name:true}}},
        orderBy:[{createdAt:'desc'},{id:'desc'}],skip:page.skip,take:page.take}),
      prisma.salesVisit.count({where})
    ]);
    res.json({items,total,page:page.page});
  });
  route('get','/api/sales/orders',async(req,res)=>{
    const c=company(req.user),page=optPage(req.query),dates=filterDates(req.query);
    const where={companyId:c,...ownSales(req.user),...(dates?{orderDate:dates}:{})};
    if(req.query.provinceId)where.provinceId=id(req.query.provinceId,'المحافظة');
    if(req.query.status && req.query.status!=='ALL'){
      if(!STATUSES.includes(req.query.status))throw new HttpError(400,'حالة الطلب غير صالحة');
      where.status=req.query.status;
    }
    const [items,total]=await Promise.all([
      prisma.salesOrder.findMany({where,include:{province:{select:{name:true}},
        pharmacy:{select:{name:true}},hospital:{select:{name:true}},
        agent:{select:{name:true}},author:{select:{name:true}},reviewer:{select:{name:true}},
        items:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:page.skip,take:page.take}),
      prisma.salesOrder.count({where})
    ]);
    res.json({items,total,page:page.page});
  });
  route('get','/api/sales/summary',async(req,res)=>{
    const c=company(req.user),dates=filterDates(req.query);
    const where={companyId:c,...ownSales(req.user),...(dates?{orderDate:dates}:{})};
    if(req.query.provinceId)where.provinceId=id(req.query.provinceId,'المحافظة');
    const [groups,visits]=await Promise.all([
      prisma.salesOrder.groupBy({by:['status'],where,
        _count:{_all:true},_sum:{total:true}}),
      prisma.salesVisit.count({where:{companyId:c,...ownSales(req.user),
        ...(where.provinceId?{provinceId:where.provinceId}:{}),
        ...(dates?{visitDate:dates}:{})}})
    ]);
    const counts={PENDING:0,APPROVED:0,REJECTED:0};
    const sums={PENDING:'0.00',APPROVED:'0.00',REJECTED:'0.00'};
    for(const row of groups){counts[row.status]=row._count._all;sums[row.status]=String(row._sum.total||'0.00');}
    res.json({counts,sums,visits,currency:'SYP'});
  });
  route('post','/api/sales/visits',async(req,res)=>{
    const c=company(req.user),p=req.body||{};
    checkedInput(p,['clientRef','provinceId','targetType','targetId','date','notes']);
    const clientRef=id(p.clientRef,'مفتاح الطلب'),visitDate=date(p.date),notes=note(p.notes);
    const existing=await prisma.salesVisit.findUnique({where:{authorId_clientRef:{authorId:req.user.id,clientRef}}});
    if(existing){
      if(!sameVisitPayload(existing,p,visitDate,notes))
        throw new HttpError(409,'مفتاح الزيارة مستخدم لبيانات مختلفة');
      return res.json(existing);
    }
    try{
      const value=await prisma.$transaction(async tx=>{
        const fields=await target(tx,c,p.provinceId,p.targetType,p.targetId);
        const row=await tx.salesVisit.create({data:{companyId:c,authorId:req.user.id,
          provinceId:p.provinceId,clientRef,visitDate,notes,...fields}});
        await audit(tx,req.user,'CREATE','SALES_VISIT',row.id);
        return row;
      },{maxWait:10000,timeout:20000});
      return res.status(201).json(value);
    }catch(error){
      if(error.code==='P2002'){
        const replay=await prisma.salesVisit.findUnique({where:{authorId_clientRef:{authorId:req.user.id,clientRef}}});
        if(replay&&sameVisitPayload(replay,p,visitDate,notes))return res.json(replay);
        throw new HttpError(409,'مفتاح الزيارة مستخدم لبيانات مختلفة');
      }
      throw error;
    }
  });
  route('post','/api/sales/orders',async(req,res)=>{
    const c=company(req.user),p=req.body||{};
    checkedInput(p,['clientRef','provinceId','targetType','targetId','agentId','visitId',
      'date','notes','currency','items']);
    const clientRef=id(p.clientRef,'مفتاح الطلب'),orderDate=date(p.date),notes=note(p.notes);
    if(p.currency!=='SYP')throw new HttpError(400,'العملة المدعومة حالياً هي الليرة السورية');
    const agentId=id(p.agentId,'الوكيل'),visitId=p.visitId?id(p.visitId,'الزيارة'):null;
    const priced=priceItems(p.items);
    const existing=await prisma.salesOrder.findUnique({where:{authorId_clientRef:{authorId:req.user.id,clientRef}},
      include:{items:true}});
    if(existing){
      if(!sameOrderPayload(existing,p,priced,orderDate,notes,agentId,visitId))
        throw new HttpError(409,'مفتاح الطلب مستخدم لبيانات مختلفة');
      return res.json(existing);
    }
    try{
      const value=await prisma.$transaction(async tx=>{
        const fields=await target(tx,c,p.provinceId,p.targetType,p.targetId);
      const agent=await tx.salesAgent.findFirst({where:{id:agentId,companyId:c,
        provinceId:p.provinceId,active:true},select:{id:true}});
      if(!agent)throw new HttpError(400,'الوكيل غير متاح في المحافظة');
      if(visitId){
        const visit=await tx.salesVisit.findFirst({where:{id:visitId,companyId:c,
          provinceId:p.provinceId,authorId:req.user.id,...fields},select:{id:true}});
        if(!visit)throw new HttpError(400,'الزيارة المرتبطة غير صالحة');
      }
      const products=await tx.product.findMany({where:{companyId:c,active:true,
        id:{in:priced.map(item=>item.productId)}},select:{id:true,name:true}});
      if(products.length!==priced.length)throw new HttpError(400,'بعض الأصناف غير متاحة للشركة');
      const names=new Map(products.map(item=>[item.id,item.name]));
      const total=priced.reduce((sum,item)=>sum+item.lineCents,0n);
      const order=await tx.salesOrder.create({data:{
        companyId:c,authorId:req.user.id,provinceId:p.provinceId,agentId,visitId,
        clientRef,orderDate,notes,currency:'SYP',total:centsText(total),...fields,
        items:{create:priced.map(({lineCents,...item})=>({
          ...item,productName:names.get(item.productId)
        }))}
      }});
      await audit(tx,req.user,'CREATE','SALES_ORDER',order.id);
      return order;
    },{maxWait:10000,timeout:20000});
      return res.status(201).json(value);
    }catch(error){
      if(error.code==='P2002'){
        const replay=await prisma.salesOrder.findUnique({where:{authorId_clientRef:{authorId:req.user.id,clientRef}},
          include:{items:true}});
        if(replay&&sameOrderPayload(replay,p,priced,orderDate,notes,agentId,visitId))return res.json(replay);
        throw new HttpError(409,'مفتاح الطلب مستخدم لبيانات مختلفة');
      }
      throw error;
    }
  });
  route('patch','/api/sales/orders/:id/review',async(req,res)=>{
    const c=company(req.user,'manage'),orderId=id(req.params.id,'الطلب');
    checkedInput(req.body,['status','note']);
    const status=req.body?.status,reviewNote=note(req.body?.note);
    if(!['APPROVED','REJECTED'].includes(status))throw new HttpError(400,'قرار المراجعة غير صالح');
    if(status==='REJECTED'&&!reviewNote)throw new HttpError(400,'سبب الرفض مطلوب');
    const value=await prisma.$transaction(async tx=>{
      const result=await tx.salesOrder.updateMany({where:{id:orderId,companyId:c,status:'PENDING'},
        data:{status,reviewerId:req.user.id,reviewNote,reviewedAt:new Date()}});
      if(!result.count){
        const old=await tx.salesOrder.findFirst({where:{id:orderId,companyId:c},select:{status:true}});
        if(!old)throw new HttpError(404,'الطلب غير موجود');
        throw new HttpError(409,'الطلب تمت مراجعته مسبقاً');
      }
      await audit(tx,req.user,'UPDATE','SALES_ORDER',orderId);
      return tx.salesOrder.findUnique({where:{id:orderId},include:{items:true}});
    });
    res.json(value);
  });
}
module.exports={registerSalesRoutes,priceItems,centsText,date};
