// Produce a side-by-side browser comparison against the actual mandob-v2
// feature branch UI. Uses blank API fixtures: this compares layout and controls,
// not production data or end-to-end business behavior.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const v2root=process.env.V2_REFERENCE_WEB;
if(!v2root)throw Error('V2_REFERENCE_WEB must point to the cloned v2 apps/web folder');
const output=path.resolve(root,'..','..','visual-v2-side-by-side');
const targetOrigin='http://127.0.0.1:5174',refOrigin='http://127.0.0.1:5175';
const pairs={
  SUPER_ADMIN:[['companies','platform']],
  COMPANY_ADMIN:[['dashboard','company-dashboard'],['teams','company-teams'],
    ['data','company-catalog'],['settings','company-cycles']],
  TEAM_MANAGER:[['dashboard','manager-dashboard'],['teams','manager-teams'],
    ['users','manager-reps'],['areas','manager-areas'],['doctors','manager-targets'],
    ['pharmacies','manager-targets'],['hospitals','manager-targets'],
    ['visits','manager-visits'],['reports','manager-reports'],['leaves','manager-leaves']],
  REP:[['dashboard','dashboard'],['areas','areas'],['doctors','doctors'],
    ['pharmacies','pharmacies'],['hospitals','hospitals'],['new-visit','round'],
    ['visits','history'],['analytics','analytics'],['reports','reports'],
    ['plan-products','plan'],['profile','account'],['leaves','leaves'],
    ['new-leave','leaves']]
};
const targetSlug={SUPER_ADMIN:'super-admin',COMPANY_ADMIN:'company',TEAM_MANAGER:'manager',REP:'rep'};
const refSlug={SUPER_ADMIN:'super-admin',COMPANY_ADMIN:'company',TEAM_MANAGER:'manager',REP:'rep'};
const refRole={SUPER_ADMIN:'SUPER_ADMIN',COMPANY_ADMIN:'NATIONAL_MANAGER',
  TEAM_MANAGER:'TEAM_MANAGER',REP:'REP'};
const permissions={
  SUPER_ADMIN:['system.manage'],
  COMPANY_ADMIN:['organizations.view','teams.manage','areas.manage','cycles.configure',
    'targets.view','reports.view_team','visits.view_team','areas.view','teams.view'],
  TEAM_MANAGER:['teams.view','analytics.view_team','visits.view_team','targets.view',
    'products.view','areas.view','users.view','reports.view_team','leaves.approve_team',
    'teams.create_own','targets.manage','areas.manage_own','visits.view_own',
    'reports.view_own','leaves.view_own'],
  REP:['analytics.view_own','targets.view','rounds.create','visits.create',
    'visits.view_own','reports.view_own','leaves.view_own','notifications.view_own']
};
const targetUser=role=>({id:'11111111-1111-4111-8111-111111111111',
  name:'مستخدم المطابقة',username:'visual-fixture',role,
  companyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  teamId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});
const referenceUser=role=>({
  id:'11111111-1111-4111-8111-111111111111',name:'مستخدم المطابقة',
  username:'visual-fixture',organizationId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  roles:[refRole[role]],permissions:permissions[role]
});
const refData=(url,role)=>{
  const p=new URL(url).pathname;
  const user=referenceUser(role);
  if(p==='/api/v1/auth/refresh'||p==='/api/v1/auth/login')
    return {accessToken:'fixture-token',refreshToken:'fixture-token',user};
  if(p==='/api/v1/auth/me')return user;
  if(p==='/api/v1/manager/workspace')return {teams:[],reps:[],rounds:[],
    summary:{reps:0,visitsToday:0,coverage:0,pendingLeaves:0}};
  if(p==='/api/v1/rep/dashboard')return {rep:{name:user.name,teams:[]},
    cycleProgress:{coveragePercent:0,completedTargets:0},
    weeklySummary:{completedVisits:0},overdueDoctors:{total:0}};
  if(p==='/api/v1/rep/workspace')return {summary:{doctors:{total:0,unvisited:0},
    pharmacies:{total:0,unvisited:0},hospitals:{total:0,unvisited:0}},
    cycle:{remainingDays:0},products:[],areas:[],plan:{}};
  if(p==='/api/v1/company/setup')return {teams:[],managers:[],reps:[],
    provinces:[],specialties:[],products:[],repCount:0};
  if(p==='/api/v1/company/access')return {roles:[],permissions:[],staff:[]};
  if(p==='/api/v1/platform/companies')return {items:[]};
  return {items:[],teams:[],areas:[],reps:[],cycles:[],provinces:[]};
};
const targetData=(url,role)=>{
  const p=new URL(url).pathname;
  if(p==='/api/me')return {user:targetUser(role)};
  if(p==='/api/dashboard')return {reps:0,doctors:0,pharmacies:0,
    hospitals:0,visits:0,pendingLeaves:0,reports:0};
  if(p==='/api/manager/assigned-teams')return {teams:[],activeTeamId:null};
  if(p==='/api/settings'||p==='/api/cycle-settings')return {
    cycleStart:'2026-11-01',cycleEnd:'2026-11-30',
    workingDays:[0,1,2,3,4,6],frequencyA:6,frequencyB:2,frequencyC:1};
  if(p==='/api/analytics/rep-overview')return {
    frequency:{items:[]},coverage:{areas:[],teamTotals:[]}};
  if(p==='/api/analytics/frequency')return {items:[],personalItems:[]};
  if(p==='/api/analytics/area-coverage')return {areas:[],teamTotals:[]};
  if(p==='/api/rep-workspace-summary')return {
    doctors:{total:0,unvisited:0,unvisitedA:0,gradeA:0,coverage:0,
      unvisitedAAreas:[],remainingVisits:0},
    pharmacies:{total:0,unvisited:0},hospitals:{total:0,needsVisit:0}};
  if(p==='/api/rep-plan')return {products:[],dailyTarget:8,managerInstructions:''};
  if(p==='/api/weekly-visits-count')return {count:0};
  if(p==='/api/manager/team-weekly-activity')return {start:'2026-11-16',
    days:[],perRep:[],lastByRep:[]};
  return [];
};
async function wait(origin){
  for(let i=0;i<80;i++){
    try{if((await fetch(origin)).ok)return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw Error(origin+' not ready');
}
const start=(directory,port)=>spawn('npm',
  ['run','dev','--','--host','127.0.0.1','--port',String(port),'--strictPort'],
  {cwd:directory,env:{...process.env,BROWSER:'none'},stdio:'ignore'});
const targetServer=start(root,5174),refServer=start(v2root,5175);
let browser;
const results=[];
try{
  await fs.mkdir(output,{recursive:true});
  await Promise.all([wait(targetOrigin),wait(refOrigin)]);
  browser=await chromium.launch({headless:true});
  const html=['<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">',
    '<title>Mandob and mandob-v2 comparison</title>',
    '<style>body{font:14px Tahoma,Arial;background:#f3f7f8;color:#173b38;padding:20px}',
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:26px}',
    'img{width:100%;border:1px solid #dbe7e2;background:#fff}',
    'h2{margin-top:32px}.ref{font-weight:700}</style>',
    '<h1>واجهة mandob مقابل مرجع mandob-v2</h1>',
    '<p>صور متصفح ببيانات اصطناعية؛ لا تثبت التطابق النهائي أو سلامة بيانات الإنتاج.</p>'];
  for(const [device,viewport] of [
    ['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]
  ]){
    for(const [role,matching] of Object.entries(pairs)){
      const makeContext=async(reference)=>{
        const ctx=await browser.newContext({
          viewport,deviceScaleFactor:1,locale:'ar',
          geolocation:{latitude:33.52,longitude:36.29},permissions:['geolocation']});
        if(reference)await ctx.addInitScript(()=>{
          sessionStorage.setItem('mandob_v2_refresh','fixture-token');
        });
        await ctx.route(reference?'**/api/v1/**':'**/api/**',async route=>{
          const response=reference?refData(route.request().url(),role):
            targetData(route.request().url(),role);
          await route.fulfill({status:200,contentType:'application/json',
            body:JSON.stringify(response)});
        });
        return ctx;
      };
      const targetCtx=await makeContext(false),refCtx=await makeContext(true);
      const target=await targetCtx.newPage(),reference=await refCtx.newPage();
      html.push('<h2>'+device+' / '+role+'</h2>');
      for(const [oldPage,newPage] of matching){
        const id=device+'-'+role.toLowerCase()+'-'+oldPage;
        const current={device,role,targetPage:oldPage,referencePage:newPage};
        try{
          await Promise.all([
            target.goto(targetOrigin+'/'+targetSlug[role]+'/'+oldPage,{waitUntil:'domcontentloaded'}),
            reference.goto(refOrigin+'/'+refSlug[role]+'/'+newPage,{waitUntil:'domcontentloaded'})
          ]);
          await Promise.all([
            target.waitForTimeout(role==='REP'?400:220),
            reference.waitForTimeout(220)
          ]);
          // The v2 manager uses one medical-target screen with a type selector,
          // while Mandob has separate doctor/pharmacy/hospital URLs.
          if(role==='TEAM_MANAGER'&&(oldPage==='pharmacies'||oldPage==='hospitals')){
            await reference.locator('.v2-filter-bar select').first()
              .selectOption(oldPage==='pharmacies'?'PHARMACY':'HOSPITAL');
            await reference.waitForTimeout(120);
          }
          const targetShell=role==='SUPER_ADMIN'?'.admin-v2-shell':
            role==='COMPANY_ADMIN'?'.company-legacy-shell':
            role==='TEAM_MANAGER'?'.manager-legacy-shell':'.rep-layout';
          if(!await target.locator(targetShell).count())throw Error('Target shell absent');
          if(!await reference.locator('.v2-shell').count())throw Error('Reference v2 shell absent');
          await Promise.all([
            target.screenshot({path:path.join(output,id+'-mandob.png')}),
            reference.screenshot({path:path.join(output,id+'-v2.png')})
          ]);
          // Paired browser-computed style samples. The actual glyph font may
          // be a fallback if a declared web font is not loaded.
          const computed=async(page)=>{
            return page.evaluate(()=>{
              const props=['fontFamily','fontSize','fontWeight','lineHeight',
                'color','backgroundColor','borderRadius','borderColor',
                'padding','boxShadow'];
              const find=(selectors)=>selectors.map(s=>
                document.querySelector(s)).find(Boolean);
              const capture=(selectors)=>{
                const el=find(selectors);
                if(!el)return null;
                const style=getComputedStyle(el);
                return Object.fromEntries(props.map(p=>[p,style[p]]));
              };
              return {
                body:capture(['body']),
                shell:capture(['.v2-shell','.rep-layout','.manager-legacy-shell',
                  '.company-legacy-shell','.admin-v2-shell']),
                header:capture(['.rep-classic-topbar','.company-topbar','.manager-topbar',
                  '.v2-topbar','header']),
                sidebar:capture(['.v2-sidebar','.manager-legacy-sidebar',
                  '.company-sidebar','aside']),
                heading:capture(['.v2-content h1','.rep-home h2','.manager-legacy-page h2',
                  '.company-legacy-shell h2','h1','h2']),
                card:capture(['.rep-v2-report-panel','.rep-directory-v2-panel',
                  '.rep-analytics-hero','.section','.manager-v2-teams-panel',
                  '.company-v2-data-panel','.settings-card','.card']),
                primaryButton:capture(['.v2-content .btn.primary','.btn.primary',
                  '.primary-button','button[type="submit"]']),
                input:capture(['input[type="text"]','input:not([type])','input[type="date"]']),
                counts:{buttons:document.querySelectorAll('button').length,
                  textInputs:document.querySelectorAll('input,select,textarea').length,
                  dialogs:document.querySelectorAll('[role="dialog"]').length}
              };
            });
          };
          const [mandobStyles,v2Styles]=await Promise.all([
            computed(target),computed(reference)
          ]);
          current.styles={mandob:mandobStyles,v2:v2Styles};
          current.targetUrl=target.url();current.referenceUrl=reference.url();
          html.push('<h3>'+oldPage+' ↔ '+newPage+'</h3><div class="pair">',
            '<div><p class="ref">mandob</p><img src="'+id+'-mandob.png"></div>',
            '<div><p class="ref">mandob-v2</p><img src="'+id+'-v2.png"></div></div>');
        }catch(e){current.error=String(e?.message||e);}
        results.push(current);
      }
      await targetCtx.close();await refCtx.close();
    }
  }
  html.push('</html>');
  await fs.writeFile(path.join(output,'index.html'),html.join(''));
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log('Reference comparison pairs:',results.length);
  console.log('Failed pairs:',results.filter(x=>x.error).length);
  if(results.some(x=>x.error))throw Error('Some reference comparisons failed: '+
    JSON.stringify(results.filter(x=>x.error).slice(0,6)));
}finally{
  if(browser)await browser.close();
  targetServer.kill('SIGTERM');refServer.kill('SIGTERM');
}
