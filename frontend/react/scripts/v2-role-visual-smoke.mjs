// Capture actual Chromium renderings for all four roles at desktop and mobile
// widths. Mock API data is for layout smoke checks only, not production UAT
// or proof of pixel-level parity with mandob-v2.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const output=path.resolve(root,'..','..','visual-v2-role-evidence');
const origin='http://127.0.0.1:5174';
const pages={
  SUPER_ADMIN:['companies'],
  COMPANY_ADMIN:['dashboard','governorates','teams','coverage','data','reports','settings',
    'users','products','areas','doctors','pharmacies','hospitals','visits','leaves','frequency','area-coverage'],
  TEAM_MANAGER:['dashboard','users','teams','doctors','pharmacies','hospitals','areas',
    'visits','reports','leaves','frequency','products','settings','area-coverage'],
  REP:['dashboard','analytics','analysis-detail','reports','profile','doctors',
    'pharmacies','hospitals','areas','plan-products','rep-settings','new-visit',
    'visits','new-leave','leaves','frequency','area-coverage']
};
const prefixes={SUPER_ADMIN:'super-admin',COMPANY_ADMIN:'company',TEAM_MANAGER:'manager',REP:'rep'};
const user=(role)=>({
  id:'11111111-1111-4111-8111-111111111111',
  companyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  teamId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name:'مستخدم اختبار المطابقة',username:'visual-fixture',active:true,role
});
const fixtures=(url,role)=>{
  const p=new URL(url).pathname;
  if(p==='/api/me'||p==='/api/login')return {user:user(role)};
  if(p==='/api/manager/assigned-teams')return {teams:[],activeTeamId:null};
  if(role==='REP'&&p==='/api/areas')return [{id:'fixture-area',name:'المدينة'}];
  // Non-empty medical rows exercise the v2 table layout and overflow path.
  if(role==='REP'&&p==='/api/doctors')return [
    {id:'fixture-doctor',name:'د. ليلى محمد',grade:'A',specialty:'قلبية',
      target:6,area:{id:'fixture-area',name:'المدينة'}}
  ];
  if(role==='REP'&&p==='/api/pharmacies')return [
    {id:'fixture-pharmacy',name:'صيدلية المدينة',grade:'B',kind:'مستقلة',
      target:2,area:{id:'fixture-area',name:'المدينة'}}
  ];
  if(role==='REP'&&p==='/api/hospitals')return [
    {id:'fixture-hospital',name:'مشفى المدينة',category:'خاص',
      target:1,area:{id:'fixture-area',name:'المدينة'}}
  ];
  if(role==='REP'&&p==='/api/reps/'+user('REP').id+'/doctors')return [
    {id:'fixture-doctor',name:'د. ليلى محمد',grade:'A',specialty:'قلبية',
      area:{id:'fixture-area',name:'المدينة'},doctorAreas:[]}
  ];
  if(p==='/api/rep-workspace-summary')return {
    doctors:{total:2,unvisited:1,unvisitedA:0,coverage:25,remainingVisits:6,gradeA:1,
      unvisitedAAreas:[]},
    visitCounts:{doctors:{'fixture-doctor':2}},
    visitTargets:{doctors:{'fixture-doctor':6}},
    lastVisitDates:{doctors:{'fixture-doctor':'2026-11-22'}},
    pharmacies:{total:0,unvisited:0,coverage:0},
    hospitals:{total:0,needsVisit:0,coverage:0}
  };
  if(p==='/api/rep-plan')return {products:[],dailyTarget:8,targetACoverage:80,
    managerInstructions:''};
  if(p==='/api/rep-report')return {
    from:'2026-11-21',to:'2026-11-22',tours:1,totalTargets:2,
    byType:{DOCTOR:1,PHARMACY:1,HOSPITAL:0},averagePerWorkingDay:1,
    workingDays:2,cycleCoverage:25
  };
  if(role==='REP'&&p==='/api/rep-reports'){
    const query=new URL(url).searchParams;
    if(query.get('paginated')==='true'){
      const id='33333333-3333-4333-8333-333333333333';
      const oldId='44444444-4444-4444-8444-444444444444';
      const saved=(id,label)=>({id,from:'2026-11-01',to:'2026-11-03',
        totalTargets:2,tours:1,repName:label,createdAt:'2026-11-03T12:00:00Z'});
      if(query.has('cursor'))return {items:[saved(oldId,'تقرير أقدم')],nextCursor:null};
      return {items:[saved(id,'تقرير أول'),saved('55555555-5555-4555-8555-555555555555','تقرير ثان')],
        nextCursor:id};
    }
    return [];
  }
  if(p==='/api/analytics/rep-overview')return {
    frequency:{items:[
      {id:'fixture-doctor',teamId:user('REP').teamId,name:'د. ليلى محمد',
        grade:'A',specialty:'قلبية',area:'المدينة',done:2,target:6,coverage:33},
      {id:'fixture-unvisited-doctor',teamId:user('REP').teamId,name:'د. عمر',
        grade:'B',specialty:'داخلية',area:'المدينة',done:0,target:2,coverage:0}
    ],cycleStart:'2026-11-01',cycleEnd:'2026-11-30',
    periodStart:'2026-11-01',periodEnd:'2026-11-30'},
    coverage:{areas:[{areaId:'fixture-area',groupKey:'team:'+user('REP').teamId,
      areaName:'المدينة',doctors:2,gradeA:1,unvisited:1,done:2,target:8,coverage:25}],
      teamTotals:[]}
  };
  if(role==='REP'&&p==='/api/analytics/product-performance')return {
    cycleStart:'2026-11-01',cycleEnd:'2026-11-30',
    periodStart:'2026-11-01',periodEnd:'2026-11-30',
    totalPromotions:2,totalQuantity:8,items:[
      {id:'fixture-product',name:'صنف أساسي',promotions:2,quantity:8,
        assigned:true,lastPromotedAt:'2026-11-22'}
    ]
  };
  if(role==='REP'&&p==='/api/analytics/product-performance/fixture-product')return {
    id:'fixture-product',name:'صنف أساسي',promotions:2,quantity:8,
    rows:[{visitId:'fixture-visit',visitDate:'2026-11-22',quantity:8,
      locationAccuracy:8,type:'DOCTOR',targets:[{name:'د. ليلى',areaName:'المدينة'}]}]
  };
  if(role==='REP'&&p==='/api/analytics/cycles')return {
    items:[
      {startDate:'2026-11-01',endDate:'2026-11-30',current:true,
        visits:3,targets:5,uniqueDoctors:2,areas:1,productPromotions:2,quantity:8},
      {startDate:'2026-10-01',endDate:'2026-10-31',current:false,
        visits:2,targets:4,uniqueDoctors:1,areas:1,productPromotions:1,quantity:4}
    ]
  };
  if(p==='/api/weekly-visits-count')return {count:0};
  if(p==='/api/dashboard')return {reps:0,doctors:0,pharmacies:0,hospitals:0,visits:0,
    pendingLeaves:0,reports:0};
  if(p==='/api/settings'||p==='/api/cycle-settings')return {
    cycleStart:'2026-11-01',cycleEnd:'2026-11-30',
    workingDays:[0,1,2,3,4,6],frequencyA:6,frequencyB:2,frequencyC:1
  };
  if(p==='/api/analytics/area-coverage')return {areas:[],teamTotals:[]};
  if(p==='/api/analytics/frequency')return {
    items:[],personalItems:[],cycleStart:'2026-11-01',cycleEnd:'2026-11-30'
  };
  if(p==='/api/manager/team-weekly-activity')return {
    start:'2026-11-16',days:[],perRep:[],lastByRep:[]
  };
  return [];
};
async function waitForVite(){
  for(let tries=0;tries<80;tries++){
    try{if((await fetch(origin)).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error('Local Vite server was not ready');
}
const server=spawn('npm',['run','dev','--','--host','127.0.0.1','--port','5174','--strictPort'],{
  cwd:root,stdio:'ignore',env:{...process.env,BROWSER:'none'}
});
let browser;
const captures=[];
const shellFailures=[];
const chromeFailures=[];
const detailInteractions=[];
try{
  await fs.mkdir(output,{recursive:true});
  await waitForVite();
  browser=await chromium.launch({headless:true});
  for(const [viewportName,viewport] of [
    ['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]
  ]){
    for(const [role,entries] of Object.entries(pages)){
      const context=await browser.newContext({
        viewport,deviceScaleFactor:1,geolocation:{latitude:33.52,longitude:36.29},
        permissions:['geolocation'],locale:'ar'
      });
      await context.route('**/api/**',async route=>{
        await route.fulfill({status:200,contentType:'application/json',
          body:JSON.stringify(fixtures(route.request().url(),role))});
      });
      const page=await context.newPage();
      const pageErrors=[];
      page.on('pageerror',e=>pageErrors.push(String(e.message)));
      for(const section of entries){
        const url=origin+'/'+prefixes[role]+'/'+section;
        const current={role,section,viewport:viewportName,url,pageErrors:[]};
        try{
          // Realistic scoped team fixture: table and edit modal, no API writes.
          if(role==='TEAM_MANAGER'&&section==='teams'){
            const cards=page.locator('.manager-v2-team-card');
            if(await cards.count()!==1)
              throw Error('Manager v2 teams cards did not render nonempty team');
            const card=cards.first();
            const copy=await card.innerText();
            for(const label of ['الاختصاصات','الأصناف','المندوبون','التغطية']){
              if(!copy.includes(label))
                throw Error('Manager v2 team card omitted: '+label);
            }
            await card.getByRole('button',{name:'تعديل الفريق'}).click();
            await page.getByRole('dialog',{name:'تعديل الفريق'}).waitFor();
            await page.keyboard.press('Escape');
            if(await page.getByRole('dialog',{name:'تعديل الفريق'}).count())
              throw Error('Manager v2 team edit dialog did not close');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'nonempty team cards/edit'});
            // V2 hides "create team" when this role has no teams.create_own
            // permission; the current Backend reserves creation for company admins.
            if(await page.getByRole('button',{name:'+ إضافة فريق'}).count())
              throw Error('Manager cannot create a new team in this permission model');
            detailInteractions.push({role,section,viewport:viewportName,action:'manager create-team permission'});
          }
          if(role==='COMPANY_ADMIN'&&section==='teams'){
            const headings=(await page.locator('.company-v2-team-table th').allTextContents())
              .map(value=>value.trim());
            const expected=['الفريق','المحافظة','المدير الحالي','المندوبون','تغيير المدير'];
            if(expected.some((value,i)=>headings[i]!==value)||
               await page.locator('.company-v2-team-table tbody tr').count()!==1)
              throw Error('Company v2 team table failed nonempty fixture');
            const filter=page.locator('.teams-toolbar select');
            await filter.selectOption('حلب');
            if(await page.locator('.company-v2-team-table tbody tr').count()!==1)
              throw Error('Multi-city team disappeared from its first city filter');
            await filter.selectOption('دمشق');
            if(await page.locator('.company-v2-team-table tbody tr').count()!==1)
              throw Error('Multi-city team disappeared from its second city filter');
            const location=await page.locator('.company-v2-team-table tbody tr td').nth(1).innerText();
            if(!location.includes('دمشق')||!location.includes('حلب'))
              throw Error('Company team city column omitted assigned member locations');
            await filter.selectOption('all');
            const controls=page.locator('.company-v2-team-table .company-v2-row-actions');
            const save=controls.getByRole('button',{name:'حفظ'});
            if(!await save.isDisabled())
              throw Error('Company manager Save must require choosing a manager');
            await controls.getByRole('combobox',{name:'تغيير مدير فريق دمشق'})
              .selectOption('fixture-manager-b');
            const request=page.waitForRequest(req=>
              req.url().endsWith('/api/teams/fixture-company-team/manager')&&
              req.method()==='PATCH');
            await save.click();
            const payload=(await request).postDataJSON();
            if(payload.managerId!=='fixture-manager-b'||
               JSON.stringify(payload.expectedManagerIds)!=='["fixture-manager"]')
              throw Error('Company manager assignment lost expected manager snapshot');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'v2 inline manager replacement with optimistic concurrency'});
          }
          if(role==='COMPANY_ADMIN'&&section==='settings'){
            await page.locator('input[name="cycleStart"]').fill('2026-12-10');
            await page.locator('input[name="cycleEnd"]').fill('2026-11-01');
            await page.locator('button[form="company-settings-form"]').click();
            const error=page.getByRole('alert').filter({hasText:'تاريخ بداية السايكل'});
            await error.waitFor();
            const links=page.locator('.company-cycle-quick-nav a');
            if(await links.count()!==4)
              throw Error('Company cycle navigation is incomplete');
            const validTargets=await links.evaluateAll(items=>items.every(link=>
              Boolean(document.getElementById(link.getAttribute('href').slice(1)))));
            if(!validTargets)throw Error('Company cycle nav contains an invalid target');
            detailInteractions.push({role,section,viewport:viewportName,action:'cycle validation and section links'});
          }
          if(role==='COMPANY_ADMIN'&&section==='data'){
            const input=page.locator('.data-toolbar .data-search input');
            await input.fill('اختبار');
            if(!await page.locator('.company-data-reset').isVisible())
              throw Error('Company data reset is missing');
            await page.locator('.company-data-reset').click();
            if(await input.inputValue()!=='')
              throw Error('Company data reset did not clear search');
            await page.locator('.company-data-head-actions .primary-button').click();
            await page.getByRole('dialog',{name:'إضافة طبيب'}).waitFor();
            await page.keyboard.press('Escape');
            if(await page.getByRole('dialog',{name:'إضافة طبيب'}).count())
              throw Error('Company create modal did not close with Escape');
            detailInteractions.push({role,section,viewport:viewportName,action:'data filter/reset/modal Escape'});
          }
          if(role==='SUPER_ADMIN'&&section==='companies'){
            const steps=await page.locator('.admin-v2-form-step').count();
            if(steps!==2)throw Error('Safe two-stage company creation UI missing');
            detailInteractions.push({role,section,viewport:viewportName,action:'company creation form'});
          }
        }catch(e){current.error=String(e?.message||e);}
        if(role==='TEAM_MANAGER'&&section==='teams')
          await page.unroute('**/api/manager/assigned-teams');
        if(role==='COMPANY_ADMIN'&&section==='teams'){
          await page.unroute('**/api/teams');
          await page.unroute('**/api/users');
          await page.unroute('**/api/areas');
          await page.unroute('**/api/teams/fixture-company-team/manager');
        }
        current.pageErrors=pageErrors.splice(0);
        captures.push(current);
      }
      await context.close();
    }
  }
  const results={reference:'mandob-v2 feature/mandob-full-role-ui-parity',
    note:'Layout smoke checks with fixtures; not screenshot-diff or production proof.',
    captures,shellFailures,chromeFailures,detailInteractions};
  await fs.writeFile(path.join(output,'role-captures.json'),JSON.stringify(results,null,2));
  console.log('Screenshots:',captures.filter(c=>!c.error).length,'of',captures.length);
  console.log('Shell failures:',shellFailures.length);
  console.log('Representative mobile navigation failures:',chromeFailures.length);
  console.log('Page errors:',captures.filter(c=>c.error).length);
  console.log('Detailed interaction checks:',detailInteractions.length);
  if(chromeFailures.length)throw Error('Representative mobile navigation differs from v2: '+
    JSON.stringify(chromeFailures.slice(0,5)));
  if(shellFailures.length)throw Error('Reference sidebar shell metrics differ: '+
    JSON.stringify(shellFailures.slice(0,5)));
  if(captures.some(c=>c.error))throw Error('Some role screens did not render: '+
    JSON.stringify(captures.filter(c=>c.error).slice(0,5)));
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
