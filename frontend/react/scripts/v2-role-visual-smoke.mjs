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
        grade:'A',area:'المدينة',done:2,target:6,coverage:33},
      {id:'fixture-unvisited-doctor',teamId:user('REP').teamId,name:'د. عمر',
        grade:'B',area:'المدينة',done:0,target:2,coverage:0}
    ],cycleStart:'2026-11-01',cycleEnd:'2026-11-30',
    periodStart:'2026-11-01',periodEnd:'2026-11-30'},
    coverage:{areas:[{areaId:'fixture-area',groupKey:'team:'+user('REP').teamId,
      areaName:'المدينة',doctors:2,unvisited:1,done:2,target:8,coverage:25}],
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
            await page.route('**/api/manager/assigned-teams',route=>route.fulfill({
              status:200,contentType:'application/json',
              body:JSON.stringify({teams:[{
                id:'fixture-team',name:'فريق المدينة',province:{name:'دمشق'},
                coverage:52,users:[],specialties:[],products:[]
              }],activeTeamId:'fixture-team'})
            }));
          }
          if(role==='COMPANY_ADMIN'&&section==='teams'){
            // Legacy Team does NOT have a province field. This fixture must
            // match the real API to exercise multi-city location fallback.
            const fakeTeam={id:'fixture-company-team',name:'فريق دمشق'};
            const fakeManager={id:'fixture-manager',name:'مدير الاختبار',
              role:'TEAM_MANAGER',teamId:fakeTeam.id,managedTeams:[{teamId:fakeTeam.id}]};
            const otherManager={id:'fixture-manager-b',name:'المدير البديل',
              role:'TEAM_MANAGER',teamId:null,managedTeams:[]};
            const areas=[
              {id:'fixture-city-north',name:'منطقة الشمال',city:'حلب'},
              {id:'fixture-city-south',name:'منطقة الجنوب',city:'دمشق'}
            ];
            const fakeRep={id:'fixture-rep-1',name:'مندوب المدينتين',
              role:'REP',active:true,teamId:fakeTeam.id,
              repAreas:areas.map(area=>({areaId:area.id,area}))};
            const routes={
              '**/api/teams':[fakeTeam],
              '**/api/users':[fakeManager,otherManager,fakeRep],
              '**/api/areas':areas
            };
            await page.route('**/api/teams/fixture-company-team/manager',
              route=>route.fulfill({status:200,contentType:'application/json',
                body:JSON.stringify({teamId:fakeTeam.id,managerId:otherManager.id,
                  previousManagerIds:[fakeManager.id]})}));
            for(const [pattern,data] of Object.entries(routes))
              await page.route(pattern,route=>route.fulfill({
                status:200,contentType:'application/json',body:JSON.stringify(data)}));
          }
          await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
          await page.waitForTimeout(role==='REP'?450:220);
          const shell=role==='REP'?'.rep-layout':role==='TEAM_MANAGER'?
            '.manager-legacy-shell':role==='COMPANY_ADMIN'?
            '.company-legacy-shell':'.admin-v2-shell';
          const match=await page.locator(shell).count();
          if(!match)throw Error('Role shell not rendered');
          const measures=await page.locator(shell).first().evaluate(el=>{
            const sidebar=el.querySelector('.sidebar,.company-sidebar');
            const header=el.querySelector('.topbar,.company-topbar');
            const style=n=>n?getComputedStyle(n):null;
            const rect=n=>n?Math.round(n.getBoundingClientRect().width):null;
            const heading=el.querySelector('.rep-desktop-page-heading h1');
            const content=el.querySelector('.main > .page');
            return {background:style(el)?.backgroundColor,
              foreground:style(el)?.color,fontFamily:style(el)?.fontFamily,
              sidebarBackground:style(sidebar)?.backgroundColor,
              sidebarWidth:rect(sidebar),headerBackground:style(header)?.backgroundColor,
              headerPadding:style(header)?.padding,
              titleSize:style(heading)?.fontSize,
              contentMaxWidth:style(content)?.maxWidth,
              headerHeight:header?Math.round(header.getBoundingClientRect().height):null};
          });
          Object.assign(current,measures);
          // Original pre-parity REP visual structure is the release gate.
          // Do not force the later mandob-v2 color/spacing overrides.
          if(role==='REP'&&section==='dashboard'){
            if(await page.locator('.rep-hub-grid .rep-hub-card').count()<4)
              throw Error('Original representative workspace cards are missing');
            if(await page.locator('.rep-alerts .rep-alert').count()<1)
              throw Error('Original representative alerts are missing');
            if(await page.locator('.rep-desktop-page-heading').count())
              throw Error('Later representative desktop heading was not removed');
          }
          if(role==='REP'&&viewportName==='mobile'){
            const nav=page.locator('.rep-bottom-nav button');
            const labels=await nav.allTextContents();
            const icons=await page.locator('.rep-bottom-nav img.rep-nav-icon').count();
            const alertBell=page.locator('.rep-header-bell');
            const fab=page.locator('.rep-tour-fab');
            const navExpected=['الرئيسية','التحليل','التقارير','حسابي'];
            const navCorrect=labels.length===4&&
              navExpected.every((label,i)=>labels[i].trim()===label);
            const fabCorrect=section==='new-visit'?(await fab.count())===0:
              (await fab.isVisible());
            const bellCorrect=await alertBell.isVisible();
            if(!navCorrect||icons!==4||!fabCorrect||!bellCorrect){
              chromeFailures.push({role,section,labels,icons,fabCorrect,bellCorrect});
            }
          }
          await page.screenshot({path:path.join(output,
            viewportName+'-'+role.toLowerCase()+'-'+section+'.png'),fullPage:false});
          if(viewportName==='desktop'){
            if(role!=='REP'&&(measures.sidebarWidth!==270||measures.sidebarBackground!=='rgb(255, 255, 255)'))
              shellFailures.push({role,section,measures});
          }
          // Actions below exercise controls on the real rendered page, with
          // mocked API responses; they are not a production permission audit.
          if(role==='REP'&&['doctors','pharmacies','hospitals'].includes(section)){
            const cards=page.locator('.rep-medical-list .rep-medical-card');
            if(await cards.count()!==1)
              throw Error('Original REP medical cards with nonempty fixture did not render');
            const rowText=await cards.first().innerText();
            if(!rowText.includes('آخر زيارة')||!rowText.includes('زيارات السايكل'))
              throw Error('Original medical visit details are missing');
            detailInteractions.push({role,section,viewport:viewportName,action:'original medical cards'});
          }
          if(role==='REP'&&section==='doctors'){
            await page.locator('.rep-filter-toggle').click();
            await page.locator('.rep-filter-sheet[role="dialog"]').waitFor();
            await page.keyboard.press('Shift+Tab');
            const trapped=await page.evaluate(()=>
              Boolean(document.activeElement?.closest('.rep-filter-sheet')));
            if(!trapped)throw Error('Representative sheet did not trap Shift+Tab');
            await page.keyboard.press('Escape');
            if(await page.locator('.rep-filter-sheet').count())
              throw Error('Representative filter sheet did not close with Escape');
            const triggerFocused=await page.evaluate(()=>
              Boolean(document.activeElement?.classList.contains('rep-filter-toggle')));
            if(!triggerFocused)throw Error('Representative filter did not restore opener focus');
            detailInteractions.push({role,section,viewport:viewportName,action:'filter Escape'});
          }
          if(role==='REP'&&section==='dashboard'){
            const doctorAlert=page.locator('.rep-alerts button.rep-alert').filter({
              hasText:'أطباء A غير مزارين'
            });
            if(await doctorAlert.count()!==1)
              throw Error('A-doctor home alert is not an accessible button');
            await doctorAlert.click();
            await page.waitForURL('**/rep/analysis-detail?kind=aDoctors',{timeout:5000});
            await page.locator('.ref-analysis-page-head h2').waitFor({state:'visible',timeout:5000});
            const analysisHeading=await page.locator('.ref-analysis-page-head h2').innerText();
            if(analysisHeading.trim()!=='أطباء A')
              throw Error('A-doctor home alert opened the wrong analysis: '+analysisHeading);
            if(await page.getByText('أطباء A للفريق').count())
              throw Error('A-doctor analysis must not show team scope');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'A-doctor home alert navigates to personal analysis'});
          }
          if(role==='REP'&&section==='areas'){
            const area=page.locator('.rep-area-grid .rep-area-card');
            if(await area.count()!==1)
              throw Error('Original REP area card fixture did not render');
            await area.first().click();
            if(!await page.locator('.rep-legacy-area-detail-hero').isVisible())
              throw Error('Original REP area details were not restored');
            detailInteractions.push({role,section,viewport:viewportName,action:'original area detail'});
          }
          if(role==='REP'&&section==='analytics'){
            if(await page.locator('.rep-analytics-hero .rep-hero-metrics>div').count()!==4)
              throw Error('Original representative analysis counters are missing');
            detailInteractions.push({role,section,viewport:viewportName,action:'personal and team KPI layout'});
          }
          if(role==='REP'&&section==='analysis-detail'){
            const kinds=[
              ['frequency','.ref-distribution','.ref-analysis-doctor'],
              ['unvisited','.ref-analysis-doctor','.ref-analysis-doctor'],
              ['coverage','.ref-analysis-area','.ref-analysis-area'],
              ['aDoctors','.ref-analysis-doctor','.ref-analysis-doctor'],
              ['products','.ref-analysis-product','.ref-analysis-product'],
              ['cycles','.analysis-table','.analysis-table-wrap']
            ];
            for(const [kind,selector,cardSelector] of kinds){
              await page.goto(origin+'/rep/analysis-detail?kind='+kind,{
                waitUntil:'domcontentloaded',timeout:20000
              });
              await page.locator('.rep-analysis-v2-ref '+selector).first().waitFor({
                state:'visible',timeout:7000
              });
              const kpis=page.locator('.rep-analysis-v2-ref .ref-analysis-stats .mini');
              if(await kpis.count()!==3)
                throw Error(kind+' has incorrect v2 KPI card count');
              const card=page.locator('.rep-analysis-v2-ref '+cardSelector).first();
              const appearance=await card.evaluate(element=>{
                const c=getComputedStyle(element);
                return {radius:c.borderRadius,background:c.backgroundColor};
              });
              if(appearance.radius!==(kind==='cycles'?'18px':'20px')||
                  appearance.background!=='rgb(255, 255, 255)')
                throw Error(kind+' card differs from reference style: '+JSON.stringify(appearance));
              if(await page.locator('.ref-analysis-page-head').count()!==1)
                throw Error(kind+' is missing reference page header');
              if(kind==='aDoctors'&&await page.getByText('أطباء A للفريق').count())
                throw Error('A-doctor tab exposes team scope');
              await page.screenshot({path:path.join(output,
                viewportName+'-rep-analysis-'+kind+'.png'),fullPage:false});
              detailInteractions.push({role,section:kind,viewport:viewportName,
                action:'reference card and KPI layout'});
            }
          }
          if(role==='REP'&&section==='reports'){
            if(await page.locator('.rep-report-tabs.rep-legacy-tabs button').count()!==3)
              throw Error('Original report tabs were not restored');
            if(await page.locator('.rep-legacy-range input[type="date"]').count()!==2)
              throw Error('Original report date range was not restored');
            if(!await page.locator('.rep-legacy-report-preview').isVisible())
              throw Error('Original report preview was not restored');
            await page.goto(url+'?view=history',{waitUntil:'domcontentloaded'});
            await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').first().waitFor();
            if(await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').count()!==2)
              throw Error('Representative history first cursor page did not render');
            await page.getByRole('button',{name:'عرض تقارير أقدم'}).click();
            await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').nth(2).waitFor();
            await page.goto(url,{waitUntil:'domcontentloaded'});
            await page.locator('.rep-report-tabs.rep-legacy-tabs').waitFor();
            detailInteractions.push({role,section,viewport:viewportName,
              action:'original report controls with cursor-paginated history'});
          }
          if(role==='TEAM_MANAGER'&&section==='doctors'){
            const grade=page.locator('.manager-toolbar select[aria-label="التصنيف"]');
            if(await grade.count()!==1)throw Error('Manager class filter is missing');
            await grade.selectOption('A');
            if(await page.locator('.manager-active-filters button').count()!==1)
              throw Error('Manager active filter chip is missing');
            await page.locator('.manager-reset-filters').click();
            if(await grade.inputValue()!=='')
              throw Error('Manager reset failed to clear class filter');
            detailInteractions.push({role,section,viewport:viewportName,action:'grade filter/reset'});
          }
          if(role==='TEAM_MANAGER'&&section==='teams'){
            const columns=(await page.locator('.manager-v2-team-table th').allTextContents())
              .map(value=>value.trim());
            const expected=['الفريق','المحافظة','المندوبون','التغطية','الإجراءات'];
            if(expected.some((heading,i)=>columns[i]!==heading)||
              await page.locator('.manager-v2-team-table tbody tr').count()!==1)
              throw Error('Manager v2 teams table did not render nonempty row');
            await page.locator('.manager-v2-team-table tbody tr button').first().click();
            await page.getByRole('dialog',{name:'تعديل الفريق'}).waitFor();
            await page.keyboard.press('Escape');
            if(await page.getByRole('dialog',{name:'تعديل الفريق'}).count())
              throw Error('Manager v2 team edit dialog did not close');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'nonempty team table/edit'});
            await page.locator('.manager-page-head .page-actions button').first().click();
            await page.getByRole('dialog',{name:'إضافة فريق جديد'}).waitFor();
            await page.keyboard.press('Shift+Tab');
            if(!await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))))
              throw Error('Team dialog focus escaped');
            await page.keyboard.press('Escape');
            if(await page.getByRole('dialog',{name:'إضافة فريق جديد'}).count())
              throw Error('Manager teams modal did not close with Escape');
            detailInteractions.push({role,section,viewport:viewportName,action:'teams modal Escape'});
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
