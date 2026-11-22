import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAllMedicalPages,medicalPageUrl,MEDICAL_PAGE_SIZE} from '../src/medicalPages.mjs';
import {readFileSync} from 'node:fs';

test('medical URL preserves authorized search and area filters and overrides old paging',()=>{
  assert.equal(medicalPageUrl('/doctors?areaId=area-1&search=قلبية&limit=12&offset=999',500,500),
    '/doctors?areaId=area-1&search=%D9%82%D9%84%D8%A8%D9%8A%D8%A9&limit=500&offset=500');
  assert.throws(()=>medicalPageUrl('/doctors',501,0));
  assert.throws(()=>medicalPageUrl('/doctors',500,-1));
});

test('medical directories do not silently lose records after rows 500 or 1000',async()=>{
  const all=Array.from({length:1201},(_,i)=>({id:'doctor-'+i,name:'Doctor '+i}));
  const requested=[];
  const loaded=await fetchAllMedicalPages(async url=>{
    const u=new URL('http://example.test'+url),offset=Number(u.searchParams.get('offset'));
    requested.push(offset);
    return all.slice(offset,offset+MEDICAL_PAGE_SIZE);
  },'/doctors?grade=A');
  assert.equal(loaded.length,1201);
  assert.equal(loaded[1200].id,'doctor-1200');
  assert.deepEqual(requested,[0,500,1000]);
});

test('exact page boundary fetches the next empty page',async()=>{
  const all=Array.from({length:1000},(_,i)=>({id:'item-'+i}));
  const calls=[];
  const loaded=await fetchAllMedicalPages(async url=>{
    const offset=Number(new URL('http://test'+url).searchParams.get('offset'));
    calls.push(offset);
    return all.slice(offset,offset+500);
  },'/pharmacies?areaId=abc');
  assert.equal(loaded.length,1000);
  assert.deepEqual(calls,[0,500,1000]);
});

test('failed subsequent page rejects rather than displaying an incomplete list',async()=>{
  await assert.rejects(()=>fetchAllMedicalPages(async url=>{
    const offset=Number(new URL('http://test'+url).searchParams.get('offset'));
    if(offset===500)throw new Error('Connection interrupted');
    return Array.from({length:500},(_,i)=>({id:'d-'+i}));
  },'/hospitals'),/Connection interrupted/);
});

test('duplicate rows and record limits fail visibly rather than undercounting',async()=>{
  await assert.rejects(()=>fetchAllMedicalPages(async url=>{
    const offset=Number(new URL('http://test'+url).searchParams.get('offset'));
    return offset?[{id:'doctor-0'}]:[{id:'doctor-0'},{id:'doctor-1'}];
  },'/doctors',{pageSize:2,maxRecords:4}),/تغيّرت قائمة الجهات/);
  await assert.rejects(()=>fetchAllMedicalPages(async()=>[
    {id:'x1'},{id:'x2'}
  ],'/doctors',{pageSize:2,maxRecords:4}),/يتجاوز حد العرض الآمن/);
});

test('all affected REP/company surfaces call the complete loader',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/function useCompleteMedicalDirectory/);
  assert.match(app,/fetchAllMedicalPages\(pagePath=>api\(pagePath,\{signal:controller\.signal\}\),path\)/);
  const rep=app.slice(app.indexOf('function RepMedicalDirectory('),app.indexOf('function TeamManagerPageHead('));
  assert.match(rep,/useCompleteMedicalDirectory\('\/'\+kind\+'\?'\+params\.toString\(\),refresh\)/);
  const company=app.slice(app.indexOf('function CompanyDataPage('),app.indexOf('function companyPrintReport('));
  assert.match(company,/tab==='doctors'\|\|tab==='areas'/);
  assert.match(company,/useCompleteMedicalDirectory/);
  const areas=app.slice(app.indexOf('function RepAreas('),app.indexOf('function Records('));
  assert.match(areas,/useCompleteMedicalDirectory\(path,refresh\)/);
  assert.match(areas,/allVisibleEntities\.slice\(page\*pageSize,\(page\+1\)\*pageSize\)/);
});
