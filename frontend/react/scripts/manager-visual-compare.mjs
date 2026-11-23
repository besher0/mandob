// Playwright evidence for the actual legacy HTML and active React manager shell.
// Run from frontend/react with Playwright installed. Uses API fixtures only;
// screenshots and CSS measurements are evidence, not production UAT.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const frontend=path.resolve(root,'..');
const legacySource=path.resolve(frontend,'..','rep',' manager','team manege','index+_ؤ.html');
const temp=path.join(frontend,'public','__manager-legacy-visual.html');
const output=path.resolve(frontend,'..','..','visual-manager-evidence');
const host='http://127.0.0.1:5173';
const manager={id:'11111111-1111-4111-8111-111111111111',name:'مدير التجربة',
  username:'manager-fixture',companyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  teamId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'TEAM_MANAGER'};
const team={id:manager.teamId,name:'فريق الشمال — A',specialties:[],products:[]};
const area={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'منطقة التجربة'};
const rep={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'مندوب التجربة',
  username:'rep-fixture',role:'REP',teamId:team.id,active:true,dailyTarget:8,
  annualLeaveBalance:12,repAreas:[{areaId:area.id,area}],
  repSpecialties:[],repProducts:[]};
const pages=[
  ['dashboard','dashboard'],['team','users'],['teams','teams'],['doctors','doctors'],
  ['pharmacies','pharmacies'],['hospitals','hospitals'],['areas','areas'],
  ['tours','visits'],['reports','reports'],['leaves','leaves'],
  ['analytics','frequency'],['products','products'],['settings','settings']
];
const json=(route)=>{
  const path=new URL(route).pathname.replace(/^\/api\//,'');
  if(path==='me'||path==='login')return {user:manager};
  if(path==='manager/assigned-teams')return {teams:[team],activeTeamId:team.id};
  if(path==='dashboard')return {reps:1,visits:0,reports:0,pendingLeaves:0};
  if(path==='users'||path==='team/reps')return [rep];
  if(path==='areas')return [area];
  if(path==='teams')return [team];
  if(path==='settings'||path==='cycle-settings')return {
    cycleStart:'2026-11-01',cycleEnd:'2026-11-30',workingDays:[0,1,2,3,4,6],
    frequencyA:4,frequencyB:2,frequencyC:1,annualLeaveBalance:12};
  if(path.startsWith('analytics/frequency'))return {items:[],personalItems:[],
    cycleStart:'2026-11-01',cycleEnd:'2026-11-30'};
  if(path.startsWith('analytics/area-coverage'))return {areas:[],teamTotals:[]};
  if(path.startsWith('manager/team-weekly-activity'))return {
    start:'2026-11-14',days:[],perRep:[],lastByRep:[]};
  if(path.startsWith('manager/visit-distribution'))return {
    from:'2026-11-01',to:'2026-11-20',byRep:[],byType:{DOCTOR:0,PHARMACY:0,HOSPITAL:0}};
  if(path.startsWith('reports/visits'))return {rows:[],summary:{}};
  if(path.startsWith('rep-reports'))return [];
  if(path.startsWith('manager/reps/')&&path.endsWith('/v2-targets'))return {
    cycle:{start:'2026-11-01',end:'2026-11-30'},
    teamName:team.name,
    totals:{completedVisits:2,requiredVisits:8,coverage:25},
    doctorProgress:{uniqueDoctors:1,assignments:1,unvisited:0,incomplete:1,complete:0},
    doctorTargets:[{
      key:'DOCTOR:fixture-doctor',id:'fixture-doctor',type:'DOCTOR',name:'د. تجربة',
      repId:rep.id,repName:rep.name,teamId:team.id,teamName:team.name,
      classCode:'A',specialtyId:'قلبية',specialties:['قلبية'],areas:[area],
      requiredVisits:6,completedVisits:2,remainingVisits:4,lastVisit:'2026-11-22',
      coverage:33,progressStatus:'INCOMPLETE'
    }],
    otherTargets:[{
      key:'PHARMACY:fixture-pharmacy',id:'fixture-pharmacy',type:'PHARMACY',
      name:'صيدلية التجربة',repId:rep.id,repName:rep.name,teamId:team.id,
      teamName:team.name,classCode:'B',specialtyId:'صيدلية',
      specialties:['صيدلية'],areas:[area],
      requiredVisits:2,completedVisits:0,remainingVisits:2,lastVisit:null,
      coverage:0,progressStatus:'UNVISITED'
    }]
  };
  if(path.startsWith('manager/reps/'))return {rep,visits:[
    {id:'fixture-tour',type:'DOCTOR',date:'2026-11-22',note:'زيارة اختبار',
      targets:[{id:'fixture-target',name:'د. تجربة',area:area.name}]}
  ]};
  return [];
};
const wait=async()=>{
  for(let i=0;i<80;i++){
    try{if((await fetch(host)).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('Vite server did not become ready');
};
const geom=async(page,selector)=>page.locator(selector).first().evaluate(node=>{
  const b=node.getBoundingClientRect(),style=getComputedStyle(node);
  return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),
    height:Math.round(b.height),background:style.backgroundColor,
    radius:style.borderRadius,display:style.display};
}).catch(()=>null);

await fs.mkdir(output,{recursive:true});
let html;
try{html=await fs.readFile(legacySource);}catch{
  // The original page remains in the historic baseline commit, not HEAD.
  html=execFileSync('git',['show',
    '69eca28685788dc574ccc340e2285624d568ea56:frontend/rep/ manager/team manege/index+_ؤ.html'
  ],{cwd:path.resolve(frontend,'..','..')});
}
await fs.writeFile(temp,html);
const vite=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5173','--strictPort'],{
  cwd:frontend,stdio:'ignore',env:{...process.env,BROWSER:'none'}
});
let browser;
const summary=[];
const controls=[];
try{
  await wait();
  browser=await chromium.launch({headless:true});
  for(const [width,height,name] of [[1440,900,'desktop'],[390,844,'mobile']]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    await context.route('**/api/**',async route=>{
      await route.fulfill({status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(json(route.request().url()))});
    });
    const legacy=await context.newPage();
    await legacy.goto(host+'/__manager-legacy-visual.html',{waitUntil:'domcontentloaded'});
    await legacy.waitForTimeout(650);
    const modern=await context.newPage();
    await modern.goto(host+'/manager/dashboard',{waitUntil:'domcontentloaded'});
    await modern.waitForTimeout(1000);
    // Regression for manager dashboard representative status and detail drilldown.
    // Measure real Chromium geometry at desktop/mobile using a live table row.
    const status=modern.locator('[class*="repStatusActive"]').first();
    await status.waitFor({state:'visible',timeout:12000});
    const statusCell=status.locator('xpath=..');
    const statusBounds=await status.boundingBox();
    const cellBounds=await statusCell.boundingBox();
    const statusStyle=await status.evaluate(el=>({
      display:getComputedStyle(el).display,whiteSpace:getComputedStyle(el).whiteSpace
    }));
    if(!statusBounds||!cellBounds||statusBounds.width<45||
       statusBounds.x<cellBounds.x-1||
       statusBounds.x+statusBounds.width>cellBounds.x+cellBounds.width+1||
       statusStyle.display!=='inline-flex'||statusStyle.whiteSpace!=='nowrap')
      throw Error('Manager dashboard representative status badge overflows or is misaligned');
    const detailButton=modern.getByRole('button',{name:'عرض التفاصيل'}).first();
    await detailButton.click();
    await modern.waitForURL(url=>{
      const target=new URL(url);
      return target.pathname==='/manager/users'&&
        target.searchParams.get('repId')===rep.id&&
        target.searchParams.get('from')==='dashboard';
    },{timeout:12000});
    await modern.locator('.manager-rep-v2-identity').waitFor({state:'visible'});
    await modern.locator('.manager-rep-v2-kpis').waitFor({state:'visible'});
    await modern.getByRole('heading',{name:'متابعة أطباء السايكل'}).waitFor();
    await modern.getByRole('heading',{name:'باقي الجهات المرتبطة ضمن فرقك'}).waitFor();
    await modern.getByRole('heading',{name:'الجولات',exact:true}).waitFor();
    await modern.getByRole('heading',{name:'المناطق المسندة'}).waitFor();
    await modern.getByRole('button',{name:/إضافة \/ إزالة منطقة/}).click();
    const areaDialog=modern.getByRole('dialog',{name:'توزيع مناطق المندوب'});
    await areaDialog.waitFor({state:'visible'});
    if(!await areaDialog.locator('input[name="areaId"]').first().isChecked())
      throw Error('Assigned representative area was not preserved in the editor');
    await areaDialog.locator('.close-btn').click();
    await modern.getByRole('button',{name:/العودة للوحة التحكم/}).click();
    await modern.waitForURL(url=>new URL(url).pathname==='/manager/dashboard',
      {timeout:12000});
    controls.push({device:name,page:'dashboard-detail',statusAligned:true,
      opensRep:rep.id,returnsTo:'dashboard'});
    const metrics={device:name,viewport:{width,height},
      old:{sidebar:await geom(legacy,'.sidebar'),header:await geom(legacy,'.topbar'),
        content:await geom(legacy,'.content'),hero:await geom(legacy,'.hero'),
        kpis:await geom(legacy,'.kpis')},
      new:{sidebar:await geom(modern,'.manager-legacy-shell .sidebar'),
        header:await geom(modern,'.manager-legacy-shell .topbar'),
        content:await geom(modern,'.manager-legacy-shell .content'),
        hero:await geom(modern,'.manager-dashboard-legacy .hero'),
        kpis:await geom(modern,'.manager-dashboard-legacy .kpis')}
    };
    for(const part of ['sidebar','header','content','hero','kpis']){
      const old=metrics.old[part],neu=metrics.new[part];
      if(!old||!neu)continue;
      metrics[part+'Delta']={x:neu.x-old.x,y:neu.y-old.y,
        width:neu.width-old.width,height:neu.height-old.height};
    }
    summary.push(metrics);
    for(const [oldTab,newTab] of pages){
      try{
        await legacy.evaluate(id=>window.openPage(id),oldTab);
        await legacy.waitForTimeout(140);
      }catch{}
      await modern.goto(host+'/manager/'+newTab,{waitUntil:'domcontentloaded'});
      await modern.waitForTimeout(250);
      await legacy.screenshot({path:path.join(output,name+'-old-'+oldTab+'.png'),fullPage:true});
      await modern.screenshot({path:path.join(output,name+'-new-'+oldTab+'.png'),fullPage:true});
      const visibleControls=async(p,selector)=>p.locator(selector).evaluateAll(nodes=>
        [...new Set(nodes.filter(node=>{
          const style=getComputedStyle(node),rect=node.getBoundingClientRect();
          return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
        }).map(node=>(node.textContent||node.getAttribute('aria-label')||'')
          .replace(/\s+/g,' ').trim()).filter(Boolean))]);
      const oldControls=await visibleControls(legacy,'#'+oldTab+' button');
      const newControls=await visibleControls(modern,'.manager-legacy-shell .content button');
      controls.push({device:name,page:oldTab,oldControls,newControls,
        absentFromNew:oldControls.filter(label=>!newControls.includes(label)),
        onlyInNew:newControls.filter(label=>!oldControls.includes(label))});
    }
    await context.close();
  }
  await fs.writeFile(path.join(output,'layout-comparison.json'),JSON.stringify(summary,null,2));
  await fs.writeFile(path.join(output,'visible-controls.json'),JSON.stringify(controls,null,2));
  const compareHtml=['<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">',
    '<title>Mandob - Visual comparison</title><style>',
    'body{font:14px Arial,sans-serif;margin:20px;background:#f2f5f4;color:#16352c}',
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:26px}',
    'img{width:100%;height:auto;border:1px solid #d4dfda;background:#fff}',
    'h2{margin-top:36px}h3{margin-bottom:8px}</style>',
    '<h1>مقارنة فعلية: واجهة مدير الفريق القديمة والجديدة</h1>',
    '<p>صور متصفح Chromium ببيانات اختبار. لا تثبت مطابقة كل حالات الإنتاج.</p>'];
  for(const device of ['desktop','mobile']){
    compareHtml.push('<h2>'+device+'</h2>');
    for(const [oldTab] of pages){
      compareHtml.push('<h3>'+oldTab+'</h3><div class="pair"><div><b>القديم</b><img src="'+
        device+'-old-'+oldTab+'.png"></div><div><b>الجديد</b><img src="'+
        device+'-new-'+oldTab+'.png"></div></div>');
    }
  }
  compareHtml.push('</html>');
  await fs.writeFile(path.join(output,'index.html'),compareHtml.join(''));
  for(const item of summary){
    console.log(item.device,JSON.stringify(Object.fromEntries(
      Object.entries(item).filter(([key])=>key.endsWith('Delta')))));
  }
  console.log('Saved actual Chromium screenshots for all 13 legacy manager tabs at desktop and mobile viewport sizes.');
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  await fs.rm(temp,{force:true});
}
