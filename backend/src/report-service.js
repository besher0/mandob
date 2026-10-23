'use strict';
const ExcelJS=require('exceljs');
const {prisma,HttpError,asDate,visitScope,companyId}=require('./auth');

function checkedWindow(query){
  const from=asDate(query?.from);
  const to=asDate(query?.to);
  if(to<from)throw new HttpError(400,'تاريخ النهاية يسبق البداية');
  if(to.getTime()-from.getTime()>366*86400000)
    throw new HttpError(400,'المدة القصوى للتقرير 366 يوماً');
  return {from,to};
}
function safeCell(value){
  const text=String(value??'');
  // Prevent spreadsheet formula injection when rendering user-controlled labels.
  return /^[\s]*[=+\-@]/.test(text)?"'"+text:text;
}
async function visitReport(user,query){
  if(!['COMPANY_ADMIN','TEAM_MANAGER'].includes(user.role))
    throw new HttpError(403,'التقارير التفصيلية للمدير فقط');
  const company=companyId(user),{from,to}=checkedWindow(query);
  const where={...visitScope(user),visitDate:{gte:from,lte:to}};
  const records=await prisma.visit.findMany({
    where,orderBy:[{visitDate:'desc'},{createdAt:'desc'},{id:'desc'}],
    take:5001,
    select:{id:true,type:true,visitDate:true,createdAt:true,teamIdAtVisit:true,
      repId:true,rep:{select:{name:true}},
      latitude:true,longitude:true,locationAccuracy:true,
      targets:{select:{doctor:{select:{name:true}},pharmacy:{select:{name:true}},
        hospital:{select:{name:true}}}}}
  });
  if(records.length>5000)throw new HttpError(413,'عدد الجولات كبير، قلّل فترة التقرير');
  const teamIds=[...new Set(records.map(x=>x.teamIdAtVisit).filter(Boolean))];
  const teams=teamIds.length?await prisma.team.findMany({
    where:{companyId:company,id:{in:teamIds}},select:{id:true,name:true}
  }):[];
  const teamNames=new Map(teams.map(t=>[t.id,t.name]));
  const rows=records.map(v=>({
    id:v.id,date:v.visitDate.toISOString().slice(0,10),
    type:v.type,repId:v.repId,repName:v.rep.name,
    teamIdAtVisit:v.teamIdAtVisit,teamName:v.teamIdAtVisit?
      teamNames.get(v.teamIdAtVisit)||'فريق سابق':'بدون فريق',
    targets:v.targets.map(t=>t.doctor?.name||t.pharmacy?.name||t.hospital?.name).filter(Boolean),
    latitude:v.latitude,longitude:v.longitude,accuracy:v.locationAccuracy
  }));
  const byRep=new Map(),byTeam=new Map();
  const byType={DOCTOR:0,PHARMACY:0,HOSPITAL:0};
  for(const row of rows){
    byType[row.type]++;
    const rep=byRep.get(row.repId)||{repId:row.repId,name:row.repName,total:0,DOCTOR:0,PHARMACY:0,HOSPITAL:0};
    rep.total++;rep[row.type]++;byRep.set(row.repId,rep);
    const key=row.teamIdAtVisit||'__SOLO__';
    const team=byTeam.get(key)||{teamId:row.teamIdAtVisit,name:row.teamName,total:0,
      DOCTOR:0,PHARMACY:0,HOSPITAL:0};
    team.total++;team[row.type]++;byTeam.set(key,team);
  }
  return {
    from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10),
    total:rows.length,byType,
    byRepresentative:[...byRep.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)),
    byTeam:[...byTeam.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)),
    rows
  };
}
async function exportVisitsXlsx(report){
  const wb=new ExcelJS.Workbook();
  wb.creator='Mandob';
  const sheet=wb.addWorksheet('Visits');
  sheet.columns=[
    {header:'Date',key:'date',width:15},
    {header:'Representative',key:'repName',width:28},
    {header:'Team at visit',key:'teamName',width:28},
    {header:'Visit type',key:'type',width:15},
    {header:'Targets',key:'targets',width:45},
    {header:'Latitude',key:'latitude',width:16},
    {header:'Longitude',key:'longitude',width:16},
    {header:'Accuracy (m)',key:'accuracy',width:16}
  ];
  sheet.getRow(1).font={bold:true};
  for(const r of report.rows)sheet.addRow({
    date:r.date,repName:safeCell(r.repName),teamName:safeCell(r.teamName),
    type:r.type,targets:safeCell(r.targets.join('، ')),
    latitude:r.latitude,longitude:r.longitude,accuracy:r.accuracy
  });
  return wb.xlsx.writeBuffer();
}
async function exportFrequencyXlsx(report){
  const wb=new ExcelJS.Workbook();wb.creator='Mandob';
  const ws=wb.addWorksheet('Frequency');
  ws.columns=[
    {header:'Team',key:'team',width:30},
    {header:'Doctor',key:'doctor',width:35},
    {header:'Areas',key:'areas',width:40},
    {header:'Classification',key:'grade',width:18},
    {header:'Completed visits',key:'done',width:22},
    {header:'Target visits',key:'target',width:20},
    {header:'Coverage (%)',key:'coverage',width:20}
  ];ws.getRow(1).font={bold:true};
  for(const item of report.items)ws.addRow({
    team:safeCell(item.teamName),doctor:safeCell(item.name),
    areas:safeCell(item.area),grade:item.grade,done:item.done,
    target:item.target,coverage:item.coverage
  });
  return wb.xlsx.writeBuffer();
}
async function medicalDirectoryExport(companyId,kind,includeArchived=false){
  const titles={doctors:'Doctors',pharmacies:'Pharmacies',hospitals:'Hospitals'};
  if(!Object.hasOwn(titles,kind))throw new HttpError(400,'نوع الجهات الطبية غير صالح');
  const where={companyId,...(includeArchived?{}:{active:true})};
  const entries=kind==='doctors'?await prisma.doctor.findMany({
    where,include:{area:{select:{name:true}},
      doctorAreas:{select:{area:{select:{name:true}}}}},
    orderBy:{name:'asc'},take:5001
  }):kind==='pharmacies'?await prisma.pharmacy.findMany({
    where,include:{area:{select:{name:true}}},orderBy:{name:'asc'},take:5001
  }):await prisma.hospital.findMany({
    where,include:{area:{select:{name:true}}},orderBy:{name:'asc'},take:5001
  });
  if(entries.length>5000)throw new HttpError(413,'عدد السجلات كبير جداً للتصدير');
  const wb=new ExcelJS.Workbook();wb.creator='Mandob';
  const sheet=wb.addWorksheet(titles[kind]);
  sheet.columns=[
    {header:'Name',key:'name',width:38},{header:'Areas',key:'areas',width:45},
    {header:'Specialty / category',key:'specialty',width:34},
    {header:'Grade',key:'grade',width:12},
    {header:'Target',key:'target',width:12},
    {header:'Status',key:'status',width:14}
  ];sheet.getRow(1).font={bold:true};
  for(const item of entries){
    const areas=kind==='doctors'?
      [...new Set([item.area.name,...item.doctorAreas.map(x=>x.area.name)])].join('، '):
      item.area.name;
    sheet.addRow({
      name:safeCell(item.name),areas:safeCell(areas),
      specialty:safeCell(item.specialty||item.kind||item.category||''),
      grade:item.grade||'',target:item.target||'',
      status:item.active?'Active':'Archived'
    });
  }
  return wb.xlsx.writeBuffer();
}
module.exports={visitReport,exportVisitsXlsx,exportFrequencyXlsx,medicalDirectoryExport,checkedWindow};
