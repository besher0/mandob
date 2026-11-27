'use strict';
const {prisma,HttpError,companyId,requireRole,safeInt}=require('./auth');
const {checkedInput}=require('./request-validation');

const MANAGERS=['COMPANY_ADMIN','TEAM_MANAGER'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UNITS=1000000;
function id(value){
  if(typeof value!=='string'||!UUID.test(value))throw new HttpError(400,'المعرّف غير صالح');
  return value;
}
function units(value){return safeInt(value,'quantity',1,MAX_UNITS);}
const holder=(type,holderId)=>({holderType:type,holderId});

// All debits and credits are part of the caller's serializable transaction.
// A conditional debit prevents overdrafts even under simultaneous visits/transfers.
async function move(tx,{companyId:c,productId,from,to,quantity,actorId,movementType,visitId}){
  if(!Number.isInteger(quantity)||quantity<=0||quantity>MAX_UNITS)
    throw new HttpError(400,'كمية الصنف غير صالحة');
  if(from){
    const debit=await tx.sampleStock.updateMany({where:{companyId:c,productId,
      ...holder(from.type,from.id),quantity:{gte:quantity}},
    data:{quantity:{decrement:quantity}}});
    if(debit.count!==1)throw new HttpError(409,'رصيد الصنف غير كافٍ لهذه العملية');
  }
  if(to){
    await tx.sampleStock.upsert({
      where:{sampleStockHolder:{companyId:c,productId,...holder(to.type,to.id)}},
      create:{companyId:c,productId,...holder(to.type,to.id),quantity},
      update:{quantity:{increment:quantity}}
    });
  }
  const movement=await tx.sampleMovement.create({data:{companyId:c,productId,movementType,
    sourceType:from?.type||null,sourceId:from?.id||null,
    targetType:to?.type||null,targetId:to?.id||null,quantity,actorId,
    visitId:visitId||null}});
  await tx.auditLog.create({data:{companyId:c,actorId,action:'CREATE',
    entity:'SAMPLE_MOVEMENT',entityId:movement.id}});
  return movement;
}
async function productInCompany(tx,c,productId){
  const product=await tx.product.findFirst({where:{id:productId,companyId:c,active:true},
    select:{id:true}});
  if(!product)throw new HttpError(404,'الصنف غير موجود أو غير فعال في الشركة');
}
function registerSampleStockRoutes(route){
  route('get','/api/sample-stock',async(req,res)=>{
    requireRole(req.user,['COMPANY_ADMIN','TEAM_MANAGER','REP']);
    const c=companyId(req.user),role=req.user.role;
    const managerTeamIds=role==='TEAM_MANAGER'?
      (await prisma.managerTeamAssignment.findMany({where:{managerId:req.user.id,
        team:{companyId:c}},select:{teamId:true}})).map(item=>item.teamId):[];
    const teams=role==='COMPANY_ADMIN'?await prisma.team.findMany({where:{companyId:c},
      select:{id:true,name:true},orderBy:{name:'asc'}}):role==='TEAM_MANAGER'?
      await prisma.team.findMany({where:{companyId:c,id:{in:managerTeamIds}},
        select:{id:true,name:true},orderBy:{name:'asc'}}):[];
    const reps=role==='REP'?[]:await prisma.user.findMany({
      where:{companyId:c,role:'REP',...(role==='TEAM_MANAGER'?{
        teamId:{in:managerTeamIds}}:{})},
      select:{id:true,name:true,teamId:true,active:true},orderBy:{name:'asc'}});
    const repIds=role==='TEAM_MANAGER'?reps.map(rep=>rep.id):[];
    const stockWhere=role==='COMPANY_ADMIN'?{companyId:c}:
      role==='TEAM_MANAGER'?{companyId:c,OR:[
        {holderType:'TEAM',holderId:{in:managerTeamIds}},
        {holderType:'REP',holderId:{in:repIds}}
      ]}:{companyId:c,holderType:'REP',holderId:req.user.id};
    const [products,balances]=await Promise.all([
      prisma.product.findMany({where:{companyId:c},
        select:{id:true,name:true,active:true},orderBy:{name:'asc'}}),
      prisma.sampleStock.findMany({where:stockWhere,
        select:{productId:true,holderType:true,holderId:true,quantity:true}})
    ]);
    res.json({companyId:c,products,teams,reps,balances});
  });

  route('post','/api/sample-stock/receive',async(req,res)=>{
    requireRole(req.user,['COMPANY_ADMIN']);
    checkedInput(req.body,['productId','quantity']);
    const c=companyId(req.user),productId=id(req.body?.productId),quantity=units(req.body?.quantity);
    const movement=await prisma.$transaction(async tx=>{
      await productInCompany(tx,c,productId);
      return move(tx,{companyId:c,productId,to:{type:'COMPANY',id:c},quantity,
        actorId:req.user.id,movementType:'RECEIVE'});
    },{isolationLevel:'Serializable',maxWait:10000,timeout:20000});
    res.status(201).json({movementId:movement.id});
  });

  route('post','/api/sample-stock/to-team',async(req,res)=>{
    requireRole(req.user,['COMPANY_ADMIN']);
    checkedInput(req.body,['productId','teamId','quantity']);
    const c=companyId(req.user),productId=id(req.body?.productId);
    const teamId=id(req.body?.teamId),quantity=units(req.body?.quantity);
    const movement=await prisma.$transaction(async tx=>{
      await productInCompany(tx,c,productId);
      const team=await tx.team.findFirst({where:{id:teamId,companyId:c,
        products:{some:{productId}},managerAssignments:{some:{manager:{active:true}}}},
        select:{id:true}});
      if(!team)throw new HttpError(403,'الفريق بلا مدير فعال أو الصنف غير مسند لهذا الفريق');
      return move(tx,{companyId:c,productId,from:{type:'COMPANY',id:c},
        to:{type:'TEAM',id:teamId},quantity,actorId:req.user.id,
        movementType:'DISTRIBUTE_TO_TEAM'});
    },{isolationLevel:'Serializable',maxWait:10000,timeout:20000});
    res.status(201).json({movementId:movement.id});
  });

  route('post','/api/sample-stock/to-rep',async(req,res)=>{
    requireRole(req.user,['TEAM_MANAGER']);
    checkedInput(req.body,['productId','teamId','repId','quantity']);
    const c=companyId(req.user),productId=id(req.body?.productId),teamId=id(req.body?.teamId);
    const repId=id(req.body?.repId),quantity=units(req.body?.quantity);
    const movement=await prisma.$transaction(async tx=>{
      await productInCompany(tx,c,productId);
      const team=await tx.managerTeamAssignment.findFirst({where:{managerId:req.user.id,
        teamId,team:{companyId:c,products:{some:{productId}}}},select:{teamId:true}});
      if(!team)throw new HttpError(403,'لا يمكنك توزيع هذا الصنف من الفريق المحدد');
      const rep=await tx.user.findFirst({where:{id:repId,companyId:c,
        role:'REP',teamId,active:true},select:{id:true}});
      if(!rep)throw new HttpError(403,'المندوب غير فعال أو لا يتبع الفريق المحدد');
      return move(tx,{companyId:c,productId,from:{type:'TEAM',id:teamId},
        to:{type:'REP',id:repId},quantity,actorId:req.user.id,
        movementType:'DISTRIBUTE_TO_REP'});
    },{isolationLevel:'Serializable',maxWait:10000,timeout:20000});
    res.status(201).json({movementId:movement.id});
  });
}
module.exports={registerSampleStockRoutes,move};
