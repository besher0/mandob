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
  if(p==='/api/rep-workspace-summary')return {
    doctors:{total:0,unvisited:0,unvisitedA:0,coverage:0,remainingVisits:0,gradeA:0,
      unvisitedAAreas:[]},
    pharmacies:{total:0,unvisited:0,coverage:0},
    hospitals:{total:0,needsVisit:0,coverage:0}
  };
  if(p==='/api/rep-plan')return {products:[],dailyTarget:8,targetACoverage:80,
    managerInstructions:''};
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
            return {background:style(el)?.backgroundColor,
              sidebarBackground:style(sidebar)?.backgroundColor,
              sidebarWidth:rect(sidebar),headerBackground:style(header)?.backgroundColor,
              headerHeight:header?Math.round(header.getBoundingClientRect().height):null};
          });
          Object.assign(current,measures);
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
          // Actions below exercise controls on the real rendered page, with
          // mocked API responses; they are not a production permission audit.
          if(role==='REP'&&section==='doctors'){
            await page.locator('.rep-filter-toggle').click();
            await page.locator('.rep-filter-sheet[role="dialog"]').waitFor();
            await page.keyboard.press('Escape');
            if(await page.locator('.rep-filter-sheet').count())
              throw Error('Representative filter sheet did not close with Escape');
            detailInteractions.push({role,section,viewport:viewportName,action:'filter Escape'});
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
            await page.locator('.manager-page-head .page-actions button').first().click();
            await page.getByRole('dialog',{name:'إضافة فريق جديد'}).waitFor();
            await page.keyboard.press('Escape');
            if(await page.getByRole('dialog',{name:'إضافة فريق جديد'}).count())
              throw Error('Manager teams modal did not close with Escape');
            detailInteractions.push({role,section,viewport:viewportName,action:'teams modal Escape'});
          }
          if(role==='COMPANY_ADMIN'&&section==='settings'){
            await page.locator('input[name="cycleStart"]').fill('2026-12-10');
            await page.locator('input[name="cycleEnd"]').fill('2026-11-01');
            await page.locator('button[form="company-settings-form"]').click();
            const error=page.getByRole('alert').filter({hasText:'تاريخ بداية السايكل'});
            await error.waitFor();
            detailInteractions.push({role,section,viewport:viewportName,action:'cycle invalid-date error'});
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
