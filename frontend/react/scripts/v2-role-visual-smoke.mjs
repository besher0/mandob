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
  if(p==='/api/rep-workspace-summary')return {
    doctors:{total:0,unvisited:0,unvisitedA:0,coverage:0,remainingVisits:0,gradeA:0,
      unvisitedAAreas:[]},
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
    frequency:{items:[],cycleStart:'2026-11-01',cycleEnd:'2026-11-30'},
    coverage:{areas:[],teamTotals:[]}
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
          // Reference tokens from mandob-v2's .v2-shell.rep-layout:
          // detect actual CSS cascade regressions, not just successful screenshots.
          if(role==='REP'){
            const expected={background:'rgb(246, 248, 247)',
              foreground:'rgb(23, 33, 28)',headerPadding:'13px 16px',
              contentMaxWidth:viewportName==='desktop'?'1050px':'540px'};
            const mismatches=Object.entries(expected).filter(([key,value])=>
              measures[key]!==value);
            if(mismatches.length) shellFailures.push({role,section,viewportName,
              reason:'REP v2 reference tokens',mismatches,measures});
            if(viewportName==='desktop'&&measures.titleSize&&measures.titleSize!=='19px'){
              shellFailures.push({role,section,viewportName,
                reason:'REP v2 heading size',measures});
            }
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
            if(measures.sidebarWidth!==270||measures.sidebarBackground!=='rgb(255, 255, 255)')
              shellFailures.push({role,section,measures});
          }
          if(role==='REP'&&viewportName==='desktop'&&section==='dashboard'){
            const nav=page.locator('.rep-layout .sidebar nav');
            const labels=(await nav.locator('button > span:last-child').allTextContents())
              .map(value=>value.trim());
            const expected=['الرئيسية','الخطة والأصناف','مناطقي','الأطباء',
              'الصيدليات','المشافي','جولة جديدة','سجل الزيارات','التحليل',
              'التقارير','الإجازات','الإشعارات','حسابي'];
            if(labels.length!==expected.length||
              expected.some((label,index)=>labels[index]!==label))
              throw Error('REP desktop sidebar differs from V2: '+JSON.stringify(labels));
            await nav.getByRole('button',{name:'الأطباء',exact:true}).click();
            await page.waitForURL('**/rep/doctors');
            await nav.getByRole('button',{name:'الإشعارات',exact:true}).click();
            await page.locator('.rep-header-alert-panel').waitFor({state:'visible'});
            await nav.getByRole('button',{name:'الإشعارات',exact:true}).click();
            await page.locator('.rep-header-alert-panel').waitFor({state:'hidden'});
            await nav.getByRole('button',{name:'الرئيسية',exact:true}).click();
            await page.waitForURL('**/rep/dashboard');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'full 13-link V2 desktop sidebar, real routes and alerts'});
          }
          // Actions below exercise controls on the real rendered page, with
          // mocked API responses; they are not a production permission audit.
          if(role==='REP'&&['doctors','pharmacies','hospitals'].includes(section)){
            const expectedHeaders=['الاسم','التصنيف','المنطقة','الزيارات','آخر زيارة','الحالة'];
            const headers=(await page.locator('.rep-directory-table th').allTextContents())
              .map(value=>value.trim());
            const rows=await page.locator('.rep-directory-table tbody tr').count();
            if(headers.length!==6||expectedHeaders.some((label,i)=>headers[i]!==label)||rows!==1)
              throw Error('v2 directory table columns or nonempty fixture rows differ: '+
                JSON.stringify({headers,rows}));
            if(await page.locator('.rep-legacy-directory > .rep-legacy-page-head, '+
              '.rep-legacy-directory > .rep-legacy-entity-hero, '+
              '.rep-legacy-directory > .rep-legacy-stats-row').count())
              throw Error('Representative medical page duplicates v2 table with old promotional/KPI panels');
            if(await page.locator('.rep-legacy-directory > .rep-directory-v2-panel').count()!==1)
              throw Error('Representative directory must expose one v2 panel');
            detailInteractions.push({role,section,viewport:viewportName,
              action:'single v2 medical directory and populated six-column table'});
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
          if(role==='REP'&&section==='areas'){
            const area=page.locator('.rep-v2-area-card');
            if(await area.count()!==1)throw Error('v2 area card fixture did not render');
            const actions=area.locator('.v2-inline-controls button');
            if(await actions.count()!==2)throw Error('v2 area lacks direct tour and details actions');
            await actions.first().click();
            await page.waitForURL('**/rep/new-visit*',{timeout:5000});
            detailInteractions.push({role,section,viewport:viewportName,action:'direct area tour'});
          }
          if(role==='REP'&&section==='analytics'){
            if(await page.locator('.rep-analytics-hero .rep-hero-metrics>div').count()!==4)
              throw Error('Representative analytic KPI panel is incomplete');
            const background=await page.locator('.rep-analytics-hero').evaluate(
              element=>getComputedStyle(element).backgroundColor);
            if(background!=='rgb(255, 255, 255)')
              throw Error('Representative analytics hero is not the v2 white card');
            const columns=await page.locator('.rep-analytics-hero .rep-hero-metrics').evaluate(
              element=>getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
            const expectedColumns=viewportName==='desktop'?4:1;
            if(columns!==expectedColumns)
              throw Error('Representative analytics expected '+expectedColumns+' KPI columns, got '+columns);
            detailInteractions.push({role,section,viewport:viewportName,action:'white KPI layout'});
          }
          if(role==='REP'&&section==='reports'){
            const panel=page.locator('.rep-v2-report-panel');
            if(!await panel.isVisible())
              throw Error('Representative report panel not visible');
            if(!await page.locator('.rep-v2-saved-report-panel').isVisible())
              throw Error('Representative V2 saved-report section is not a card');
            if(viewportName==='mobile'){
              const [filters,actions]=await Promise.all([
                panel.locator('.rep-v2-report-filters').evaluate(el=>
                  getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length),
                panel.locator('.rep-v2-report-actions').evaluate(el=>
                  getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)
              ]);
              if(filters!==2||actions!==2)
                throw Error('Mobile V2 report period and actions must be two columns');
            }
            const period=panel.locator('.rep-v2-report-filters select[aria-label="الفترة"]');
            if(await period.count()!==1)
              throw Error('Representative V2 period selector is missing');
            const print=panel.getByRole('button',{name:'طباعة / حفظ PDF'});
            if(!await print.isDisabled())
              throw Error('Printing should require a successful report preview');
            await period.selectOption('custom');
            if(await panel.locator('.rep-v2-report-filters input[type="date"]').count()!==2)
              throw Error('Custom period must show start and end dates');
            await period.selectOption('weekly');
            if(await panel.locator('.rep-v2-report-filters input[type="date"]').count()!==1)
              throw Error('Weekly period should use just the end date');
            await panel.getByRole('button',{name:'عرض التقرير'}).click();
            await panel.locator('.rep-report-preview').waitFor();
            if(await print.isDisabled())
              throw Error('Print button should be enabled after a valid preview');
            const reportText=await panel.innerText();
            if(/\b(undefined|NaN|null)\b/.test(reportText))
              throw Error('Representative report preview exposed an undefined metric');
            const reportComputed=await panel.evaluate(el=>{
              const css=selector=>getComputedStyle(el.querySelector(selector));
              const card=getComputedStyle(el),heading=css('h2');
              const input=css('.rep-v2-report-filters select');
              const button=css('.rep-v2-report-actions .btn');
              return {
                cardPadding:card.padding,cardRadius:card.borderRadius,
                cardBorder:card.borderTopColor,
                headingSize:heading.fontSize,headingWeight:heading.fontWeight,
                headingColor:heading.color,
                inputSize:input.fontSize,inputWeight:input.fontWeight,
                inputColor:input.color,inputPadding:input.padding,
                inputBorder:input.borderTopColor,
                buttonRadius:button.borderRadius,buttonPadding:button.padding
              };
            });
            const expectedComputed={
              cardPadding:viewportName==='mobile'?'14px':'24px',
              cardRadius:'16px',cardBorder:'rgb(226, 232, 228)',
              headingSize:'18px',headingWeight:'700',headingColor:'rgb(34, 59, 45)',
              inputSize:'12px',inputWeight:'400',inputColor:'rgb(28, 56, 48)',
              inputPadding:'8px 11px',inputBorder:'rgb(204, 220, 212)',
              buttonRadius:'9px',buttonPadding:'9px 16px'
            };
            const styleFailures=Object.entries(expectedComputed).filter(([key,value])=>
              reportComputed[key]!==value);
            if(styleFailures.length)
              throw Error('Measured V2 report CSS mismatch: '+
                JSON.stringify({styleFailures,reportComputed}));
            // History must keep the v2 report page intact while using the
            // real app's newly paginated list. No full-snapshot bulk fetches.
            await page.goto(url+'?view=history',{waitUntil:'domcontentloaded'});
            await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').first().waitFor();
            if(await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').count()!==2)
              throw Error('Representative history first cursor page did not render');
            await page.getByRole('button',{name:'عرض تقارير أقدم'}).click();
            await page.locator('.rep-legacy-report-history .rep-legacy-activity-card').nth(2).waitFor();
            if(await page.getByRole('button',{name:'عرض تقارير أقدم'}).count()!==0)
              throw Error('Representative history did not detect the last cursor page');
            await page.goto(url,{waitUntil:'domcontentloaded'});
            await page.locator('.rep-v2-report-panel').waitFor();
            detailInteractions.push({role,section,viewport:viewportName,
              action:'v2 report controls and cursor-paginated history'});
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
