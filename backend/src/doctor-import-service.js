'use strict';
const ExcelJS=require('exceljs');
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const {prisma,HttpError,requireString}=require('./auth');

const MAX_ROWS=200;
const normalize=name=>name.trim().replace(/\s+/g,' ').toLocaleLowerCase();
function cellString(raw){
  if(raw===null||raw===undefined)return '';
  if(typeof raw==='object'){
    if(Array.isArray(raw.richText))return raw.richText.map(x=>x.text||'').join('').trim();
    if(Object.prototype.hasOwnProperty.call(raw,'result'))return cellString(raw.result);
    if(Object.prototype.hasOwnProperty.call(raw,'text'))return String(raw.text||'').trim();
    return '';
  }
  return String(raw).trim();
}
function cleanRow(r){
  if(!r||typeof r!=='object'||Array.isArray(r))throw new HttpError(400,'سطر غير صالح');
  const row=Number(r.row);
  if(!Number.isInteger(row)||row<2||row>1000000)throw new HttpError(400,'رقم السطر غير صالح');
  const name=requireString(r.name,'اسم الطبيب');
  const areaName=requireString(r.areaName,'اسم المنطقة',120);
  const specialty=requireString(r.specialty,'اختصاص الطبيب',120);
  const grade=String(r.grade||'C').trim().toUpperCase();
  if(!['A','B','C'].includes(grade))throw new HttpError(400,'تصنيف الطبيب غير صالح');
  const city=r.city?requireString(r.city,'المدينة',120):null;
  return {row,name,areaName,specialty,grade,city};
}
async function parseXlsx(buffer){
  if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>5*1024*1024)
    throw new HttpError(400,'ملف Excel غير صالح أو كبير جداً');
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer)}catch(_err){throw new HttpError(400,'تعذر قراءة ملف XLSX');}
  const sheet=workbook.worksheets[0];
  if(!sheet)throw new HttpError(400,'ملف Excel لا يحتوي جدولاً');
  const labels={};
  sheet.getRow(1).eachCell((cell,n)=>{
    labels[cellString(cell.value).toLowerCase().replace(/\s+/g,' ').trim()]=n;
  });
  for(const k of ['name','doctor geo name','specailist']){
    if(!labels[k]&&!(k==='specailist'&&labels.specialist))
      throw new HttpError(400,'عمود مفقود في Excel: '+k);
  }
  const raw=[];
  if(sheet.rowCount>10000)throw new HttpError(400,'عدد الصفوف كبير جداً');
  for(let index=2;index<=sheet.rowCount;index++){
    const row=sheet.getRow(index);
    const get=(keys)=>{for(const k of keys){const col=labels[k.toLowerCase()];if(col)return cellString(row.getCell(col).value)}return ''};
    const name=get(['Name']),areaName=get(['Doctor geo name']),specialty=get(['Specailist','Specialist']);
    const rawGrade=get(['classification']),city=get(['City']);
    if(![name,areaName,specialty,city,rawGrade].some(Boolean))continue;
    const rawRow={row:index,name,areaName,specialty,grade:rawGrade||'C',city};
    try{raw.push({...cleanRow(rawRow),status:'valid'})}
    catch(e){if(!(e instanceof HttpError))throw e;
      raw.push({...rawRow,status:'invalid',error:e.message})}
    if(raw.length>MAX_ROWS)throw new HttpError(400,
      'يسمح باستيراد '+MAX_ROWS+' طبيب في الملف الواحد');
  }
  if(!raw.length)throw new HttpError(400,'ملف Excel لا يحتوي أطباء');
  return raw;
}
async function previewDoctors(companyId,buffer){
  const rows=await parseXlsx(buffer);
  const names=[...new Set(rows.filter(x=>x.status==='valid').map(r=>r.name))];
  const existing=names.length?await prisma.doctor.findMany({
    where:{companyId,name:{in:names,mode:'insensitive'}},
    select:{id:true,name:true,areaId:true,area:{select:{name:true}},
      doctorAreas:{select:{area:{select:{name:true}}}}}
  }):[];
  const byName=new Map();
  for(const d of existing){
    const key=normalize(d.name);
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push({type:'existing',id:d.id,name:d.name,
      areas:[...new Set([d.area.name,...d.doctorAreas.map(x=>x.area.name)])]});
  }
  const priorRows=new Map();
  for(const row of rows){
    row.candidates=[];
    if(row.status!=='valid')continue;
    const key=normalize(row.name);
    row.candidates=[
      ...(byName.get(key)||[]),
      ...(priorRows.get(key)||[])
    ];
    row.status=row.candidates.length?'review':'new';
    if(!priorRows.has(key))priorRows.set(key,[]);
    priorRows.get(key).push({type:'file',sourceRow:row.row,name:row.name,areas:[row.areaName]});
  }
  return {rows,total:rows.length,newCount:rows.filter(r=>r.status==='new').length,
    reviewCount:rows.filter(r=>r.status==='review').length,
    invalidCount:rows.filter(r=>r.status==='invalid').length};
}
async function commitDoctors(user,input){
  if(!input||typeof input!=='object'||!Array.isArray(input.rows)||
    !input.rows.length||input.rows.length>MAX_ROWS)throw new HttpError(400,'قائمة الاستيراد غير صحيحة');
  const companyId=user.companyId;
  const rows=input.rows.map(r=>{
    const row=cleanRow(r),action=r.action;
    if(!['create','same','different','skip'].includes(action))
      throw new HttpError(400,'يلزم تحديد القرار لكل سطر');
    return {...row,action,doctorId:r.doctorId,sourceRow:r.sourceRow};
  });
  if(new Set(rows.map(r=>r.row)).size!==rows.length)
    throw new HttpError(400,'أرقام الصفوف مكررة');
  rows.sort((a,b)=>a.row-b.row);
  const clientImportId=input.clientImportId;
  if(typeof clientImportId!=='string'||!UUID.test(clientImportId))
    throw new HttpError(400,'معرّف عملية الاستيراد غير صحيح');
  const contentHash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  async function replay(){
    const saved=await prisma.doctorImportBatch.findUnique({where:{id:clientImportId}});
    if(!saved)return null;
    if(saved.companyId!==companyId||saved.contentHash!==contentHash)
      throw new HttpError(409,'معرّف الاستيراد مستخدم لبيانات أخرى');
    return {...saved.result,duplicate:true};
  }
  const already=await replay();
  if(already)return already;
  try{return await prisma.$transaction(async tx=>{
    const results=[],resolvedRows=new Map();
    let created=0,linked=0,skipped=0;
    for(const row of rows){
      const doctors=await tx.doctor.findMany({
        where:{companyId,name:{equals:row.name,mode:'insensitive'}},
        select:{id:true,name:true}
      });
      const matched=doctors.some(d=>normalize(d.name)===normalize(row.name));
      if(row.action==='skip'){skipped++;results.push({row:row.row,status:'skipped'});continue;}
      if(row.action==='create'&&matched)
        throw new HttpError(409,'اسم الطبيب أصبح موجوداً؛ راجع خيارات التكرار مجدداً');
      if(row.action==='different'&&!matched)
        throw new HttpError(409,'تغيرت بيانات التكرار؛ راجع الملف مجدداً');
      const area=await tx.area.upsert({
        where:{companyId_name:{companyId,name:row.areaName}},update:{},
        create:{companyId,name:row.areaName,city:row.city}
      });
      if(row.action==='same'){
        let doctorId=null;
        if(row.doctorId!==undefined){
          const d=doctors.find(x=>x.id===row.doctorId);
          if(!d)throw new HttpError(409,'الطبيب المحدد لم يعد متاحاً لهذا الاسم');
          doctorId=d.id;
        }else if(Number.isInteger(row.sourceRow)){
          const d=resolvedRows.get(row.sourceRow);
          if(!d||d.key!==normalize(row.name))
            throw new HttpError(400,'المرجع المختار من Excel غير صالح');
          doctorId=d.id;
        }else throw new HttpError(400,'حدّد الطبيب الذي تريد ربط المنطقة به');
        // Old records may have a primary Doctor.areaId without a join row:
        // preserve the primary membership before adding a secondary one.
        const primary=await tx.doctor.findUnique({where:{id:doctorId},select:{areaId:true}});
        await tx.doctorArea.upsert({
          where:{doctorId_areaId:{doctorId,areaId:primary.areaId}},
          create:{doctorId,areaId:primary.areaId},update:{}
        });
        const exists=await tx.doctorArea.findUnique({
          where:{doctorId_areaId:{doctorId,areaId:area.id}}
        });
        if(exists){resolvedRows.set(row.row,{id:doctorId,key:normalize(row.name)});
          skipped++;results.push({row:row.row,status:'skipped',doctorId});continue;}
        await tx.doctorArea.create({data:{doctorId,areaId:area.id}});
        await tx.auditLog.create({data:{companyId,actorId:user.id,
          action:'LINK_AREA',entity:'DOCTOR',entityId:doctorId}});
        resolvedRows.set(row.row,{id:doctorId,key:normalize(row.name)});
        linked++;results.push({row:row.row,status:'linked',doctorId});
        continue;
      }
      const doctor=await tx.doctor.create({data:{companyId,areaId:area.id,
        name:row.name,specialty:row.specialty,grade:row.grade,city:row.city,
        doctorAreas:{create:{areaId:area.id}}}});
      resolvedRows.set(row.row,{id:doctor.id,key:normalize(row.name)});
      await tx.auditLog.create({data:{companyId,actorId:user.id,
        action:'CREATE',entity:'DOCTOR',entityId:doctor.id}});
      created++;results.push({row:row.row,status:'created',doctorId:doctor.id});
    }
    const result={success:true,total:rows.length,created,linked,skipped,results};
    await tx.doctorImportBatch.create({data:{
      id:clientImportId,companyId,contentHash,result
    }});
    return result;
  },{isolationLevel:'Serializable',timeout:30000,maxWait:10000});
  }catch(err){
    if(err.code==='P2002'){
      const saved=await replay();
      if(saved)return saved;
    }
    throw err;
  }
}
module.exports={previewDoctors,commitDoctors,parseXlsx};
