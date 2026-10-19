let doctors = [
  {name:'د. سامر العلي',spec:'قلبية',area:'الحمدانية',grade:'A',last:'12/07/2026',done:2,target:4,status:'غير مزار'},
  {name:'د. رانيا حمدان',spec:'داخلية',area:'الفرقان',grade:'B',last:'15/07/2026',done:3,target:4,status:'مزار'},
  {name:'د. تيم حسن',spec:'قلبية',area:'الموكامبو',grade:'A',last:'—',done:0,target:4,status:'غير مزار'},
  {name:'د. ليلى فارس',spec:'غدد',area:'الأعظمية',grade:'C',last:'10/07/2026',done:1,target:2,status:'مزار'},
  {name:'د. زياد ناصر',spec:'أوعية',area:'الحمدانية',grade:'A',last:'05/07/2026',done:1,target:4,status:'غير مزار'}
];
const currentUser = JSON.parse(localStorage.getItem('currentUser'));

let currentRepAreas = currentUser?.areas
  ? currentUser.areas
      .split(/[,،]/)
      .map(a => a.trim())
      .filter(Boolean)
  : [];
  async function loadCurrentRepAreas() {
  if (!currentUser || !currentUser.id) return;

  try {
    const response = await fetch('/api/me');
    if (!response.ok) { window.location.href = 'login.html'; return; }
    const profile = await response.json();
    const rep = profile.user;

    if (!rep) {
      console.warn('Current rep not found in backend');
      return;
    }

    currentRepAreas = rep.areas
  ? rep.areas
      .split(/[,،]/)
      .map(a => a.trim())
      .filter(Boolean)
  : [];
     areas = currentRepAreas.map(areaName => {
  const oldArea = areas.find(a => a.name === areaName);

  return oldArea || {
    name: areaName,
    coverage: 0,
    doctors: 0,
    unvisited: 0,
    a: 0
  };
});

    currentUser.areas = rep.areas || '';
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    console.log('UPDATED REP AREAS:', currentRepAreas);
    renderAreaList();
renderRoundAreas();
await loadRepHospitalsFromBackend();

  } catch (error) {
    console.error('Error loading current rep areas:', error);
  }
}

  console.log('AREAS FROM LOGIN:', currentUser?.areas);
console.log('AREAS AFTER SPLIT:', currentRepAreas);
let areas = [
  {name:'الحمدانية',coverage:72,doctors:24,unvisited:6,a:7},
  {name:'السكري', coverage:0, doctors:0, unvisited:0, a:0},
  {name:'الفرقان',coverage:48,doctors:18,unvisited:9,a:5},
  {name:'الموكامبو',coverage:81,doctors:22,unvisited:3,a:6},
  {name:'الأعظمية',coverage:63,doctors:16,unvisited:5,a:3},
  {name:'الجميلية',coverage:54,doctors:14,unvisited:7,a:2},
  {name:'السريان',coverage:77,doctors:20,unvisited:4,a:4},
  {name:'صلاح الدين',coverage:41,doctors:17,unvisited:10,a:5},
  {name:'حلب الجديدة',coverage:69,doctors:21,unvisited:6,a:4}
];
loadCurrentRepAreas();
const pharmacies = [
  {name:'صيدلية الشهباء',category:'A',type:'مستقلة',area:'الحمدانية',last:'14/07/2026',status:'مزارة'},
  {name:'صيدلية ابن سينا',category:'A',type:'سلسلة',area:'الفرقان',last:'—',status:'غير مزارة'},
  {name:'صيدلية الحياة',category:'B',type:'مستقلة',area:'الموكامبو',last:'09/07/2026',status:'مزارة'},
  {name:'صيدلية الأمل',category:'C',type:'مستقلة',area:'الأعظمية',last:'—',status:'غير مزارة'},
  {name:'صيدلية الرازي',category:'B',type:'سلسلة',area:'حلب الجديدة',last:'12/07/2026',status:'مزارة'}
];
const hospitals = [];
let currentScreen='home';
let currentAreaName = null;
let roundType='أطباء';
let selectedAreas=new Set();
let selectedDoctors=new Set();
let selectedTargetIds = new Map();

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  currentScreen=id;
  localStorage.setItem('currentScreen', id);
  if (id === 'visit-history') {
  loadVisitHistory();
}
if (id === 'leave-request') {
  loadMyLeaveRequests();
  loadLeaveBalance();
}
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.screen===id));
  document.getElementById('topSubtitle').textContent = document.querySelector('#'+id+' h2')?.textContent || 'المساعد اليومي';
  const fab=document.getElementById('globalTourFab');
  if(fab){
    const hidden=['round-type','round-targets','round-finish'].includes(id);
    fab.style.display=hidden?'none':'block';
    if(id==='doctors'){
      fab.textContent='＋ جولة أطباء';
      fab.onclick=()=>startContextRound('أطباء');
    }else if(id==='pharmacies'){
      fab.textContent='＋ جولة صيدليات';
      fab.onclick=()=>startContextRound('صيدليات');
    }else if(id==='hospitals'){
      fab.textContent='＋ جولة مشافي';
      fab.onclick=()=>startContextRound('مشافي');
    }else if(id==='area-detail'){
      fab.textContent='＋ جولة المنطقة';
      fab.onclick=openRoundFromArea;
    }else{
      fab.textContent='＋ ابدأ جولة';
      fab.onclick=()=>showScreen('round-type');
    }
  }
  const activeScreen=document.getElementById(id);
  if(activeScreen) activeScreen.scrollTop=0;
  window.scrollTo(0,0);
}
function navTo(id,btn){showScreen(id)}
function toast(msg){alert(msg)}

function doctorCard(d,check=false){
  return `<div class="list-card ${check?'check-card':''}">
    ${check?`<input type="checkbox" onchange="toggleDoctor('${d.name}', this.checked, ${d.id})">`:''}

    <div>
      <div class="row">
        <strong>${d.name}</strong>
        <span class="badge ${d.grade.toLowerCase()}">${d.grade}</span>
      </div>

      <div class="meta">${d.spec} • ${d.area}</div>

      <div class="row" style="margin-top:10px">
        <div class="meta">آخر زيارة: ${d.last}</div>
        <span class="badge ${d.status==='غير مزار'?'red':'green'}">${d.status}</span>
      </div>

      <div class="meta" style="margin-top:8px">
        زيارات السايكل: ${d.done} من ${d.target}
      </div>

      <div class="progress">
        <span style="width:${Math.min(100,(d.done/d.target)*100)}%"></span>
      </div>
    </div>
  </div>`
}
function renderDoctorList(filteredDoctors = doctors) {
  const visibleDoctors = filteredDoctors.filter(d =>
    currentRepAreas.includes(d.area)
  );

  document.getElementById('doctorList').innerHTML =
    visibleDoctors.map(d => doctorCard(d)).join('');
}

renderDoctorList();

function pharmacyCard(x) {
  return `
    <div class="list-card">

      <div class="row">
        <div>
          <strong>${x.name}</strong>
          <div class="meta">${x.type} • ${x.area}</div>
        </div>

        <span class="badge ${x.category.toLowerCase()}">
          ${x.category}
        </span>
      </div>

      <div class="row" style="margin-top:10px">
        <span class="meta">
          آخر زيارة: ${x.last}
        </span>

        <span class="badge ${x.status === 'غير مزارة' ? 'red' : 'green'}">
          ${x.status}
        </span>
      </div>

      <div class="row" style="margin-top:8px">
        <span class="meta">
          زيارات السايكل: <strong>${x.done} من ${x.target}</strong>
        </span>
      </div>

    </div>
  `;
}

function hospitalCard(x) {
  return `
    <div class="list-card">

      <div class="row">
        <div>
          <strong>${x.name}</strong>
          <div class="meta">${x.category} • ${x.area}</div>
        </div>

        <span class="badge blue">
          ${x.specialty}
        </span>
      </div>

      <div class="row" style="margin-top:10px">
        <span class="meta">
          آخر زيارة: ${x.last}
        </span>

        <span class="badge ${x.status === 'بحاجة زيارة' ? 'red' : 'green'}">
          ${x.status}
        </span>
      </div>

      <div class="row" style="margin-top:10px">
        <span class="meta">
          زيارات السايكل: ${x.done || 0} من ${x.target || 0}
        </span>
      </div>

    </div>
  `;
}

function renderEntityLists(){
  document.getElementById('pharmacyList').innerHTML = pharmacies.map(pharmacyCard).join('');
  document.getElementById('hospitalList').innerHTML = hospitals
    .filter(h => currentRepAreas.includes(h.area))
    .map(hospitalCard)
    .join('');
}function filterEntities(type,q){q=q.trim();if(type==='pharmacy')document.getElementById('pharmacyList').innerHTML=pharmacies.filter(x=>(x.name+x.area+x.type+x.category).includes(q)).map(pharmacyCard).join('');else document.getElementById('hospitalList').innerHTML=hospitals.filter(x=>(x.name+x.area+x.category+x.specialty).includes(q)).map(hospitalCard).join('')}
function startContextRound(type){roundType=type;document.querySelectorAll('#round-type .action-card').forEach(x=>{x.style.outline=x.textContent.includes(type)?'2px solid var(--primary)':'none'});showScreen('round-type')}
renderEntityLists();

function calculateAreaStats(doctors, repAreas) {
  return repAreas.map(areaName => {
    const areaDoctors = doctors.filter(
      doctor => doctor.area === areaName
    );

    const doctorsCount = areaDoctors.length;

    const unvisitedCount = areaDoctors.filter(
      doctor => doctor.status === 'غير مزار'
    ).length;

    const aCount = areaDoctors.filter(
      doctor => doctor.grade === 'A'
    ).length;

    const totalTarget = areaDoctors.reduce(
      (sum, doctor) => sum + Number(doctor.target || 0),
      0
    );

    const totalDone = areaDoctors.reduce(
      (sum, doctor) =>
        sum +
        Math.min(
          Number(doctor.done || 0),
          Number(doctor.target || 0)
        ),
      0
    );

    const coverage =
      totalTarget > 0
        ? Math.round((totalDone / totalTarget) * 100)
        : 0;

    return {
      name: areaName,
      doctors: doctorsCount,
      unvisited: unvisitedCount,
      a: aCount,
      coverage
    };
  });
}

function renderWorkspaceAreaStats(areas) {
  const totalEl =
    document.getElementById('workspaceAreasTotal');

  const coverageEl =
    document.getElementById('workspaceAreasCoverage');

  const totalAreas = areas.length;

  const totalDoctors = areas.reduce(
    (sum, area) => sum + Number(area.doctors || 0),
    0
  );

  const weightedCoverage =
    totalDoctors > 0
      ? Math.round(
          areas.reduce(
            (sum, area) =>
              sum +
              Number(area.coverage || 0) *
              Number(area.doctors || 0),
            0
          ) / totalDoctors
        )
      : 0;

  if (totalEl) {
    totalEl.textContent = totalAreas;
  }

  if (coverageEl) {
    coverageEl.textContent = `${weightedCoverage}%`;
  }
}

function renderAreaList() {
document.getElementById('areaList').innerHTML=areas
  .filter(a => currentRepAreas.includes(a.name))
  .map(a=>`
<div class="list-card" onclick="openArea('${a.name}')" style="cursor:pointer">
  <div class="row"><strong>${a.name}</strong><span class="badge ${a.coverage<50?'red':'green'}">${a.coverage}%</span></div>
  <div class="meta" style="margin-top:7px">${a.doctors} طبيب • ${a.unvisited} غير مزار • ${a.a} أطباء A</div>
  <div class="progress"><span style="width:${a.coverage}%"></span></div>
</div>`).join('');
}
renderAreaList();

function openArea(name) {
  const area = areas.find(
    item => item.name === name
  );

  if (!area) return;
  currentAreaName = name;
localStorage.setItem('currentAreaName', name);
  localStorage.setItem('currentAreaName', name);

  const areaDoctors = doctors.filter(
    doctor => doctor.area === name
  );

  document.getElementById('areaTitle').textContent =
    name;

  document.getElementById('areaDetailCoverage').textContent =
    `${area.coverage}%`;

  document.getElementById('areaDetailCoverageBar').style.width =
    `${area.coverage}%`;

    document.getElementById('areaDetailDoctorsCount').textContent =
  area.doctors;

document.getElementById('areaDetailUnvisitedCount').textContent =
  area.unvisited;

document.getElementById('areaDetailACount').textContent =
  area.a;

  document.getElementById('areaEntityList').innerHTML =
    areaDoctors
      .map(doctor => doctorCard(doctor))
      .join('');

  showScreen('area-detail');
}

function showAreaTab(button, type) {
  if (!currentAreaName) return;

  document
    .querySelectorAll('#area-detail .tab')
    .forEach(tab => tab.classList.remove('active'));

  button.classList.add('active');

  let filteredItems = [];
  let cards = [];

  let primaryCount = 0;
  let secondaryCount = 0;
  let thirdCount = 0;

  let primaryLabel = '';
  let secondaryLabel = '';
  let thirdLabel = '';

  if (type === 'doctors') {
    filteredItems = doctors.filter(
      d => d.area === currentAreaName
    );

    cards = filteredItems.map(d => doctorCard(d));

    primaryCount = filteredItems.length;

    secondaryCount = filteredItems.filter(
      d => d.status === 'غير مزار'
    ).length;

    thirdCount = filteredItems.filter(
      d => d.grade === 'A'
    ).length;

    primaryLabel = 'طبيب';
    secondaryLabel = 'غير مزار';
    thirdLabel = 'A';
  }

  if (type === 'pharmacies') {
    filteredItems = pharmacies.filter(
      p => p.area === currentAreaName
    );

    cards = filteredItems.map(p => pharmacyCard(p));

    primaryCount = filteredItems.length;

    secondaryCount = filteredItems.filter(
      p => p.status === 'غير مزارة'
    ).length;

    thirdCount = filteredItems.filter(
      p => p.category === 'A'
    ).length;

    primaryLabel = 'صيدلية';
    secondaryLabel = 'غير مزارة';
    thirdLabel = 'A';
  }

  if (type === 'hospitals') {
    filteredItems = hospitals.filter(
      h => h.area === currentAreaName
    );

    cards = filteredItems.map(h => hospitalCard(h));

    primaryCount = filteredItems.length;

    secondaryCount = filteredItems.filter(
      h => h.status === 'بحاجة زيارة'
    ).length;

    thirdCount = filteredItems.filter(
      h => h.category === 'خاص'
    ).length;

    primaryLabel = 'مشفى';
    secondaryLabel = 'بحاجة زيارة';
    thirdLabel = 'خاص';
  }

  document.getElementById('areaEntityList').innerHTML =
    cards.join('');

  document.getElementById('areaDetailDoctorsCount').textContent =
    primaryCount;

  document.getElementById('areaDetailUnvisitedCount').textContent =
    secondaryCount;

  document.getElementById('areaDetailACount').textContent =
    thirdCount;

  document.getElementById('areaDetailPrimaryLabel').textContent =
    primaryLabel;

  document.getElementById('areaDetailSecondaryLabel').textContent =
    secondaryLabel;

  document.getElementById('areaDetailThirdLabel').textContent =
    thirdLabel;
}

function selectRoundType(el,type){
  document.querySelectorAll('#round-type .action-card').forEach(x=>x.style.outline='none');
  el.style.outline='2px solid var(--primary)';
  roundType=type;
}
function renderRoundAreas() {
document.getElementById('roundAreas').innerHTML=areas
  .filter(a => currentRepAreas.includes(a.name))
  .map(a => `
<label class="list-card check-card">
  <input type="checkbox" onchange="toggleArea('${a.name}',this.checked)">
  <div style="flex:1">
    <div class="row"><strong>${a.name}</strong><span class="badge">${a.coverage}%</span></div>
    <div class="meta">${a.doctors} طبيب • ${a.unvisited} غير مزار • ${a.a} أطباء A</div>
  </div>
</label>`).join('');
}
renderRoundAreas();
function toggleArea(name,checked){
  checked?selectedAreas.add(name):selectedAreas.delete(name);
  document.getElementById('areaCount').textContent=selectedAreas.size+' مناطق';
  const total=areas.filter(a=>selectedAreas.has(a.name)).reduce((s,a)=>s+a.doctors,0);
  const unv=areas.filter(a=>selectedAreas.has(a.name)).reduce((s,a)=>s+a.unvisited,0);
  document.getElementById('areaSummary').textContent=selectedAreas.size?`${total} طبيب • ${unv} غير مزار`:'اختر مناطق الجولة';
}
function goSelectTargets(){
  if(!selectedAreas.size){toast('اختر منطقة واحدة على الأقل');return}
  let items=[], title='اختيار الأطباء', countLabel='أطباء';
  if(roundType==='صيدليات'){
    title='اختيار الصيدليات'; countLabel='صيدليات';
    items=pharmacies.filter(x=>selectedAreas.has(x.area));
    document.getElementById('roundDoctorList').innerHTML=(items.length?items:pharmacies).map(x=>`<label class="list-card check-card"><input type="checkbox" onchange="toggleDoctor('${x.name}',this.checked)"><div style="flex:1"><div class="row"><strong>${x.name}</strong><span class="badge ${x.category.toLowerCase()}">${x.category}</span></div><div class="meta">${x.type} • ${x.area} • آخر زيارة: ${x.last}</div></div></label>`).join('');
  }else if(roundType==='مشافي'){
    title='اختيار المشافي'; countLabel='مشافي';
    items=hospitals.filter(x=>selectedAreas.has(x.area));
    document.getElementById('roundDoctorList').innerHTML=(items.length?items:hospitals).map(x=>`<label class="list-card check-card"><input type="checkbox" onchange="toggleDoctor('${x.name}',this.checked)"><div style="flex:1"><div class="row"><strong>${x.name}</strong><span class="badge blue">${x.category}</span></div><div class="meta">${x.specialty} • ${x.area} • آخر زيارة: ${x.last}</div></div></label>`).join('');
  }else{
    const filtered=doctors.filter(d=>selectedAreas.has(d.area));
    document.getElementById('roundDoctorList').innerHTML=(filtered.length?filtered:doctors).map(d=>doctorCard(d,true)).join('');
  }
  document.querySelector('#round-targets h2').textContent=title;
  document.getElementById('doctorCount').textContent='0 '+countLabel;
  selectedDoctors.clear();
  showScreen('round-targets');
}
function toggleDoctor(name, checked, id = null){
  if (checked) {
    selectedDoctors.add(name);

    if (id !== null && id !== undefined) {
      selectedTargetIds.set(name, Number(id));
    }
  } else {
    selectedDoctors.delete(name);
    selectedTargetIds.delete(name);
  }

  const countLabel =
    roundType === 'صيدليات' ? 'صيدليات' :
    roundType === 'مشافي' ? 'مشافي' :
    'أطباء';

  document.getElementById('doctorCount').textContent =
    selectedDoctors.size + ' ' + countLabel;
}

function openRoundFromArea(){
  selectedAreas.clear(); selectedAreas.add(document.getElementById('areaTitle').textContent);
  goSelectTargets();
}
function getSelectedVisitDate() {
  const input = document.getElementById('visitDate');
  return input ? input.value : '';
}
async function finishRound(){
  if(!selectedDoctors.size){
    toast('لا توجد جهات محددة');
    return;
  }

  const names = [...selectedDoctors];
  const targetIds = names
  .map(name => selectedTargetIds.get(name))
  .filter(id => Number.isInteger(id));
  const visitDate = getSelectedVisitDate();

if (!visitDate) {
  toast('يرجى تحديد تاريخ الزيارة');
  return;
}

const today = new Date().toISOString().split('T')[0];

if (visitDate > today) {
  toast('لا يمكن تسجيل زيارة بتاريخ مستقبلي');
  return;
}

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  const label =
    roundType === 'أطباء' ? 'جولة أطباء' :
    roundType === 'صيدليات' ? 'جولة صيدليات' :
    'جولة مشافي';

  try {
    const response = await fetch('/api/visits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
  rep_id: currentUser?.id,
  type: roundType,
  areas: [...selectedAreas].join('، '),
  targets: names.join('، '),
target_ids: targetIds,
visit_date: visitDate
})
    });

    if(!response.ok){
      toast('حدث خطأ أثناء حفظ الجولة');
      return;
    }

    const item = `
      <div class="activity-card">
        <div class="activity-head">
          <div>
            <strong>${label}</strong>
          </div>
        </div>
        <div class="meta">
          ${names.join('، ')}
        </div>
      </div>
    `;

    
    toast('تم تسجيل الجولة بنجاح');
    await loadDoctorsFromBackend();

    selectedAreas.clear();
    selectedDoctors.clear();

    document.getElementById('areaCount').textContent = '0 مناطق';
    document.getElementById('doctorCount').textContent = '0 جهات';

    showScreen('visit-history');

  } catch(error) {
    console.error(error);
    toast('تعذر الاتصال بالسيرفر');
  }
}

let analysisType = 'frequency';
let analysisGrade = 'all';

let analysisDoctors = [];

async function loadFrequencyAnalysis() {
  try {
    if (!currentUser?.id) {
      throw new Error('Current user not found');
    }

    const area =
      document.getElementById('analysisArea')?.value || 'all';

    const grade =
      analysisGrade || 'all';

    const params = new URLSearchParams({
      rep_id: currentUser.id,
      area,
      grade
    });

    const response = await fetch(
      `/api/analytics/frequency?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error('Failed to load frequency analysis');
    }

    const data = await response.json();

    analysisDoctors = Array.isArray(data.doctors)
      ? data.doctors
      : [];

    return data;

  } catch (error) {
    console.error('Frequency analysis load error:', error);

    analysisDoctors = [];

    return {
      summary: {
        total: 0,
        complete: 0,
        behind: 0,
        unvisited: 0,
        compliance: 0
      },
      doctors: []
    };
  }
}

function openAnalysis(type){
  analysisType = type;
  const titles = {
    frequency:'تحليل Frequency',
    unvisited:'الأطباء غير المزارين',
    coverage:'تغطية المناطق',
    aDoctors:'أطباء A',
    products:'أداء الأصناف',
    cycles:'مقارنة السايكلات'
  };
  document.getElementById('analysisTitle').textContent = titles[type];
  showScreen('analysis-detail');
  renderAnalysis();
}

function setAnalysisGrade(grade,btn){
  analysisGrade = grade;
  document.querySelectorAll('.analysis-grade').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  renderAnalysis();
}

function resetAnalysisFilters(){
  document.getElementById('analysisPeriod').value='cycle';
  document.getElementById('analysisArea').value='all';
  analysisGrade='all';
  document.querySelectorAll('.analysis-grade').forEach(x=>x.classList.toggle('active',x.dataset.grade==='all'));
  renderAnalysis();
}

function filteredAnalysisDoctors(){
  return analysisDoctors;
}

function kpi(label,value){
  return `<div class="mini"><strong>${value}</strong><span>${label}</span></div>`;
}

function doctorAnalysisCard(d){
  const pct=Math.round((d.done/d.target)*100);
  const state=d.done===0?'غير مزار':(d.done>=d.target?'مكتمل':'ناقص');
  const cls=state==='مكتمل'?'green':(state==='غير مزار'?'red':'b');
  return `<div class="list-card">
    <div class="row"><div><strong>${d.name}</strong><div class="meta">${d.spec} • ${d.area}</div></div><span class="badge ${d.grade.toLowerCase()}">${d.grade}</span></div>
    <div class="row" style="margin-top:10px"><span class="meta">الزيارات: ${d.done} من ${d.target}</span><span class="badge ${cls}">${state}</span></div>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <div class="meta" style="margin-top:7px">آخر زيارة: ${d.last}</div>
  </div>`;
}
async function loadVisitHistory() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));

   if (!currentUser || !currentUser.id) {
  console.error('لا يوجد مندوب مسجل دخول');
  return;
}

    const response = await fetch('/api/visits');

    if (!response.ok) {
      throw new Error('فشل تحميل الزيارات');
    }

    const allVisits = await response.json();

    const myVisits = allVisits.filter(
  visit => Number(visit.rep_id) === Number(currentUser.id)
);

    const list = document.getElementById('visitHistoryList');

    if (!list) return;

    if (!myVisits.length) {
      list.innerHTML = `
        <div class="activity-card">
          <div class="meta">لا توجد زيارات مسجلة حتى الآن</div>
        </div>
      `;
      return;
    }

    list.innerHTML = myVisits.map(visit => {

      const typeLabel =
        visit.type === 'أطباء' ? 'جولة أطباء' :
        visit.type === 'صيدليات' ? 'جولة صيدليات' :
        visit.type === 'مشافي' ? 'جولة مشافي' :
        visit.type;

      return `
        <div class="activity-card">

          <div class="activity-head">
            <div>
              <strong>${typeLabel}</strong>
            </div>

            <small>
              ${visit.visit_date || '—'}
            </small>
          </div>

          <div class="meta">
            <div>📍 ${visit.areas || '—'}</div>
            <div style="margin-top:6px">
              ${visit.targets || '—'}
            </div>
          </div>

        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Error loading visit history:', error);
  }
}
function filterVisitHistory(type, button) {
  const cards = document.querySelectorAll('#visitHistoryList .activity-card');

  cards.forEach(card => {
    if (type === 'all') {
      card.style.display = '';
      return;
    }

    const title = card.querySelector('strong')?.textContent || '';

    if (title.includes(type)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });

  document
    .querySelectorAll('#visit-history .tab')
    .forEach(tab => tab.classList.remove('active'));

  button.classList.add('active');
}

async function renderAnalysis(){
  const data=filteredAnalysisDoctors();
  const kpis=document.getElementById('analysisKpis');
  const content=document.getElementById('analysisContent');

  if (analysisType === 'frequency') {

  const result = await loadFrequencyAnalysis();

  const data = result.doctors || [];
  const summary = result.summary || {};

  const kpis = document.getElementById('analysisKpis');
  const content = document.getElementById('analysisContent');

  kpis.innerHTML =
    kpi('الالتزام', (summary.compliance || 0) + '%') +
    kpi('مكتمل', summary.complete || 0) +
    kpi('ناقص', summary.behind || 0);

  const total = summary.total || 0;

  const completePct = total
    ? Math.round((summary.complete / total) * 100)
    : 0;

  const behindPct = total
    ? Math.round((summary.behind / total) * 100)
    : 0;

  const unvisitedPct = total
    ? Math.round((summary.unvisited / total) * 100)
    : 0;

  content.innerHTML = `
    <div class="list-card">
      <div class="row">
        <strong>توزيع الالتزام</strong>
        <span class="badge">${total} طبيب</span>
      </div>

      <div style="margin-top:14px">
        <div class="row">
          <span>مكتمل</span>
          <strong>${summary.complete || 0}</strong>
        </div>
        <div class="progress">
          <span style="width:${completePct}%"></span>
        </div>
      </div>

      <div style="margin-top:14px">
        <div class="row">
          <span>ناقص زيارة أو أكثر</span>
          <strong>${summary.behind || 0}</strong>
        </div>
        <div class="progress">
          <span style="width:${behindPct}%"></span>
        </div>
      </div>

      <div style="margin-top:14px">
        <div class="row">
          <span>غير مزار</span>
          <strong>${summary.unvisited || 0}</strong>
        </div>
        <div class="progress">
          <span style="width:${unvisitedPct}%"></span>
        </div>
      </div>
    </div>

    ${data.map(doctorAnalysisCard).join('')}
  `;

  return;
}

  if(analysisType==='unvisited'){
    const rows=data.filter(d=>d.done===0 || d.done<d.target);
    const aCount=rows.filter(d=>d.grade==='A').length;
    kpis.innerHTML=kpi('بحاجة زيارة',rows.length)+kpi('منهم A',aCount)+kpi('المناطق',new Set(rows.map(d=>d.area)).size);
    content.innerHTML=rows.length?`
      <div class="notice"><div class="dot" style="background:var(--danger)"></div><div><strong>الأولوية لأطباء A</strong><p>ابدأ بالمناطق التي تحتوي أعلى عدد من أطباء A غير المكتملين.</p></div></div>
      ${rows.map(doctorAnalysisCard).join('')}`:`<div class="empty-state">لا يوجد أطباء غير مزارين ضمن الفلاتر الحالية.</div>`;
  }

  if(analysisType==='coverage'){
    const a = areas.filter(x => document.getElementById('analysisArea').value==='all' || x.name===document.getElementById('analysisArea').value);
    const avg=a.length?Math.round(a.reduce((s,x)=>s+x.coverage,0)/a.length):0;
    kpis.innerHTML=kpi('متوسط التغطية',avg+'%')+kpi('أقل من 50%',a.filter(x=>x.coverage<50).length)+kpi('أكثر من 70%',a.filter(x=>x.coverage>=70).length);
    content.innerHTML=a.sort((x,y)=>x.coverage-y.coverage).map(x=>`
      <div class="list-card">
        <div class="row"><strong>${x.name}</strong><span class="badge ${x.coverage<50?'red':'green'}">${x.coverage}%</span></div>
        <div class="meta">${x.doctors} طبيب • ${x.unvisited} غير مزار • ${x.a} أطباء A</div>
        <div class="progress"><span style="width:${x.coverage}%;${x.coverage<50?'background:#D94E4E':''}"></span></div>
      </div>`).join('');
  }

  if(analysisType==='aDoctors'){
    const rows=data.filter(d=>d.grade==='A');
    const complete=rows.filter(d=>d.done>=d.target).length;
    const unvisited=rows.filter(d=>d.done===0).length;
    kpis.innerHTML=kpi('إجمالي A',rows.length)+kpi('مكتمل',complete)+kpi('غير مزار',unvisited);
    content.innerHTML=rows.map(doctorAnalysisCard).join('') || `<div class="empty-state">لا توجد نتائج ضمن الفلاتر المحددة.</div>`;
  }

  if(analysisType==='products'){
    const products=[
      {name:'Unixaban',count:38,target:50,specialties:'قلبية • داخلية • أوعية'},
      {name:'Rosuva',count:31,target:42,specialties:'قلبية • داخلية'},
      {name:'Noveldo',count:19,target:30,specialties:'غدد • داخلية'}
    ];
    const total=products.reduce((s,p)=>s+p.count,0);
    kpis.innerHTML=kpi('إجمالي الترويجات',total)+kpi('الأعلى','Unixaban')+kpi('أصناف فعالة',products.length);
    content.innerHTML=products.map(p=>`
      <div class="list-card">
        <div class="row"><div><strong>${p.name}</strong><div class="meta">${p.specialties}</div></div><span class="badge">${p.count} مرة</span></div>
        <div class="row" style="margin-top:10px"><span class="meta">المستهدف ${p.target}</span><strong>${Math.round(p.count/p.target*100)}%</strong></div>
        <div class="progress"><span style="width:${p.count/p.target*100}%"></span></div>
      </div>`).join('');
  }

  if(analysisType==='cycles'){
    const rows=[
      {label:'تغطية السايكل',now:'68%',old:'61%',delta:'+7%'},
      {label:'التزام Frequency',now:'74%',old:'69%',delta:'+5%'},
      {label:'الأطباء غير المزارين',now:'31',old:'39',delta:'-8'},
      {label:'زيارات أطباء A',now:'82',old:'71',delta:'+11'}
    ];
    kpis.innerHTML=kpi('تحسن التغطية','+7%')+kpi('زيارات A','+11')+kpi('غير مزار','-8');
    content.innerHTML=`<table class="analysis-table">
      <thead><tr><th>المؤشر</th><th>الحالي</th><th>السابق</th><th>التغير</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${r.label}</td><td><strong>${r.now}</strong></td><td>${r.old}</td><td class="${r.delta.startsWith('+')||r.delta.startsWith('-8')?'delta-up':'delta-down'}">${r.delta}</td></tr>`).join('')}</tbody>
    </table>
    <div class="company-note" style="margin-top:12px">السايكل الحالي أفضل من السابق، لكن ما زال هناك ضعف في تغطية الفرقان وصلاح الدين.</div>`;
  }
}


function openRoundFinish(){
  if(!selectedDoctors.size){toast('اختر جهة واحدة على الأقل');return}
  const label=roundType==='أطباء'?'أطباء':roundType==='صيدليات'?'صيدليات':'مشافي';
  document.getElementById('roundFinishCount').textContent=selectedDoctors.size+' '+label;
  document.getElementById('roundFinishSummary').textContent=`${selectedAreas.size} مناطق • ${selectedDoctors.size} ${label} • ${roundType}`;
  document.querySelector('#round-finish .section-title h3').textContent=label+' المختارون';
  let html='';
  if(roundType==='أطباء') html=doctors.filter(x=>selectedDoctors.has(x.name)).map(x=>doctorCard(x)).join('');
  else if(roundType==='صيدليات') html=pharmacies.filter(x=>selectedDoctors.has(x.name)).map(pharmacyCard).join('');
  else html=hospitals.filter(x=>selectedDoctors.has(x.name)).map(hospitalCard).join('');
  document.getElementById('roundFinishDoctors').innerHTML=html;
  const visitDateInput = document.getElementById('visitDate');

if (visitDateInput) {
  const today = new Date();
  const localToday =
    today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  visitDateInput.value = localToday;
  visitDateInput.max = localToday;
}
  showScreen('round-finish');
}

function saveAndSendReport(){
  const item=`<div class="activity-card"><div class="activity-head"><div><strong>تقرير أسبوعي جديد</strong><div class="meta">12–18 تموز 2026 • محفوظ الآن</div></div><span class="badge green">مرسل للمدير</span></div><div class="meta" style="margin-top:8px">63 زيارة • تغطية 68%</div><button class="secondary" style="width:100%;margin-top:10px">عرض التقرير</button></div>`;
  document.getElementById('reportSavedStatus').style.display='block';
  document.getElementById('latestReportCard').outerHTML=item;
  document.getElementById('reportHistoryList').insertAdjacentHTML('afterbegin',item);
  toast('تم حفظ التقرير وإرساله إلى مدير حلب');
}
async function submitLeave() {
  const from = document.getElementById('leaveFrom').value;
  const to = document.getElementById('leaveTo').value;
  const type = document.getElementById('leaveType').value;

  const reasonElement = document.getElementById('leaveReason');
  const reason = reasonElement ? reasonElement.value : '';

  if (!from || !to) {
    toast('حدد تاريخ البداية والنهاية');
    return;
  }

  if (to < from) {
    toast('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  if (!currentUser || !currentUser.id) {
    toast('تعذر تحديد بيانات المندوب');
    return;
  }

  try {
    const response = await fetch('/api/leaves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        rep_id: currentUser.id,
        leave_type: type,
        from_date: from,
        to_date: to,
        reason: reason
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      toast(data.error || 'حدث خطأ أثناء إرسال الطلب');
      return;
    }

    toast('تم إرسال طلب الإجازة إلى المدير');

    document.getElementById('leaveFrom').value = '';
    document.getElementById('leaveTo').value = '';

    if (reasonElement) {
      reasonElement.value = '';
    }

  } catch (error) {
    console.error('Error sending leave request:', error);
    toast('تعذر الاتصال بالسيرفر');
  }
}
async function loadMyLeaveRequests() {
  const list = document.getElementById('leaveHistoryList');
  if (!list) return;

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  if (!currentUser || !currentUser.id) {
    list.innerHTML = '<p>تعذر تحديد بيانات المندوب</p>';
    return;
  }

  try {
    const response = await fetch('/api/leaves');
    const leaves = await response.json();

    const myLeaves = leaves.filter(
  leave => Number(leave.rep_id) === Number(currentUser.id)
);

    if (!myLeaves.length) {
      list.innerHTML = '<p class="meta">لا توجد طلبات إجازة سابقة</p>';
      return;
    }

    list.innerHTML = myLeaves.map(leave => {

      const statusText =
        leave.status === 'approved' ? 'مقبولة' :
        leave.status === 'rejected' ? 'مرفوضة' :
        'قيد المراجعة';

      return `
        <div class="activity-card">
          <div class="activity-head">
            <div>
              <strong>${leave.leave_type}</strong>
              <div class="meta">
                ${leave.from_date} إلى ${leave.to_date}
              </div>
            </div>

            <span>${statusText}</span>
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error(error);
    list.innerHTML = '<p>تعذر تحميل طلبات الإجازة</p>';
  }
}
async function loadLeaveBalance() {
  const balanceEl = document.getElementById('leaveBalance');

  if (!balanceEl) return;

  const currentUser = JSON.parse(localStorage.getItem('currentUser'));

  if (!currentUser || !currentUser.id) {
    balanceEl.textContent = 'تعذر حساب الرصيد';
    return;
  }

  try {
    const response = await fetch('/api/leaves');
    const leaves = await response.json();

    const approvedAnnualLeaves = leaves.filter(leave =>
  Number(leave.rep_id) === Number(currentUser.id) &&
  leave.status === 'approved' &&
  leave.leave_type === 'سنوية'
);

    const usedDays = approvedAnnualLeaves.reduce((total, leave) => {
      const from = new Date(leave.from_date);
      const to = new Date(leave.to_date);

      const diff =
        Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1;

      return total + Math.max(diff, 0);
    }, 0);

    const annualBalance = 12;
    const remaining = Math.max(annualBalance - usedDays, 0);

    balanceEl.textContent = `${remaining} أيام متبقية`;

  } catch (error) {
    console.error('Error loading leave balance:', error);
    balanceEl.textContent = 'تعذر حساب الرصيد';
  }
}

async function loadDoctorsFromBackend() {
  try {
    console.log('عم حاول اتصل بالباك...');

    // 1. جلب أطباء المندوب المستهدفين فقط
    const response = await fetch(
      `/api/reps/${currentUser.id}/doctors`
    );

    if (!response.ok) {
      throw new Error('فشل تحميل أطباء المندوب');
    }

    const data = await response.json();

    console.log(
      'أطباء المندوب القادمين من الباك:',
      data
    );

    // 2. جلب Frequency الحقيقي للمندوب
    const frequencyResponse = await fetch(
      `/api/analytics/frequency?rep_id=${currentUser.id}`
    );

    if (!frequencyResponse.ok) {
      throw new Error('فشل تحميل Frequency');
    }

    const frequencyData =
      await frequencyResponse.json();

    const frequencyDoctors =
      Array.isArray(frequencyData.doctors)
        ? frequencyData.doctors
        : [];

    // 3. ربط بيانات Frequency بالطبيب باستخدام ID
    const frequencyMap = new Map(
      frequencyDoctors.map(doctor => [
        Number(doctor.id),
        doctor
      ])
    );

    doctors = data.map(doctor => {
      const frequency =
        frequencyMap.get(Number(doctor.id));

      const done =
        Number(frequency?.done || 0);

      const target =
        Number(frequency?.target || 0);

      const last =
        frequency?.last || '—';

      let status = 'غير مزار';

      if (done > 0) {
        status =
          done >= target
            ? 'مكتمل'
            : 'مزار';
      }

      return {
        ...doctor,

        done,
        target,
        last,

        progress:
          Number(frequency?.progress || 0),

        frequencyStatus:
          frequency?.status || 'غير مزار',

        status
      };
    });

areas = calculateAreaStats(
  doctors,
  currentRepAreas
);

renderWorkspaceAreaStats(areas);

    // إعادة رسم المناطق
    renderAreaList();
    renderRoundAreas();

    // إعادة رسم الأطباء
    document.getElementById('doctorList').innerHTML =
      doctors.map(d => doctorCard(d)).join('');


document.getElementById('doctorTotalCount').textContent =
  doctors.length;

document.getElementById('doctorUnvisitedCount').textContent =
  doctors.filter(d => d.status === 'غير مزار').length;

document.getElementById('doctorACount').textContent =
  doctors.filter(d => d.grade === 'A').length;

  const totalTarget = doctors.reduce(
  (sum, d) => sum + Number(d.target || 0),
  0
);

const totalDone = doctors.reduce(
  (sum, d) => sum + Math.min(
    Number(d.done || 0),
    Number(d.target || 0)
  ),
  0
);

const remainingVisits = Math.max(
  0,
  totalTarget - totalDone
);

const remainingVisitsEl =
  document.getElementById('homeRemainingVisits');

if (remainingVisitsEl) {
  remainingVisitsEl.textContent = remainingVisits;
}

const cycleCoverage = totalTarget > 0
  ? Math.round((totalDone / totalTarget) * 100)
  : 0;

const homeCoverageEl =
  document.getElementById('homeCycleCoverage');

const planCoverageEl =
  document.getElementById('currentCycleCoverage');

if (homeCoverageEl) {
  homeCoverageEl.textContent = `${cycleCoverage}%`;
}

if (planCoverageEl) {
  planCoverageEl.textContent = `${cycleCoverage}%`;
}

const unvisitedADoctors = doctors.filter(d =>
  d.grade === 'A' &&
  d.status === 'غير مزار'
);

const unvisitedACount =
  unvisitedADoctors.length;

const unvisitedAAreas = [
  ...new Set(
    unvisitedADoctors
      .map(d => d.area)
      .filter(Boolean)
  )
];

const homeUnvisitedAEl =
  document.getElementById('homeUnvisitedADoctorsCount');

const homeUnvisitedAreasEl =
  document.getElementById('homeUnvisitedADoctorsAreas');

const analyticsUnvisitedAEl =
  document.getElementById('analyticsUnvisitedACount');

if (homeUnvisitedAEl) {
  homeUnvisitedAEl.textContent =
    `${unvisitedACount} أطباء A غير مزارين`;
}

if (homeUnvisitedAreasEl) {
  homeUnvisitedAreasEl.textContent =
    unvisitedAAreas.length
      ? `موزعون على ${unvisitedAAreas.join('، ')}.`
      : 'لا يوجد أطباء A غير مزارين حالياً.';
}

if (analyticsUnvisitedAEl) {
  analyticsUnvisitedAEl.textContent =
    unvisitedACount;
}

const areaStats = {};

doctors.forEach(d => {
  if (!d.area) return;

  if (!areaStats[d.area]) {
    areaStats[d.area] = {
      done: 0,
      target: 0
    };
  }

  areaStats[d.area].done += Math.min(
    Number(d.done || 0),
    Number(d.target || 0)
  );

  areaStats[d.area].target +=
    Number(d.target || 0);
});

const lowCoverageAreas = Object.entries(areaStats)
  .map(([area, stats]) => {
    const coverage = stats.target > 0
      ? Math.round((stats.done / stats.target) * 100)
      : 0;

    return {
      area,
      coverage
    };
  })
  .filter(item => item.coverage < 50);

const lowCoverageCountEl =
  document.getElementById('homeLowCoverageAreasCount');

const lowCoverageTextEl =
  document.getElementById('homeLowCoverageAreasText');

if (lowCoverageCountEl) {
  lowCoverageCountEl.textContent =
    `${lowCoverageAreas.length} مناطق بحاجة تغطية`;
}

if (lowCoverageTextEl) {
  lowCoverageTextEl.textContent =
    lowCoverageAreas.length
      ? `${lowCoverageAreas.map(x => x.area).join('، ')} — التغطية أقل من 50% خلال السايكل الحالي.`
      : 'لا توجد مناطق بتغطية أقل من 50% حالياً.';
}

restoreDoctorFilters();

      const workspaceDoctorsTotal =
  document.getElementById('workspaceDoctorsTotal');

const workspaceDoctorsUnvisited =
  document.getElementById('workspaceDoctorsUnvisited');

if (workspaceDoctorsTotal) {
  workspaceDoctorsTotal.textContent = doctors.length;
}

if (workspaceDoctorsUnvisited) {
  workspaceDoctorsUnvisited.textContent =
    doctors.filter(d => d.status === 'غير مزار').length;
}

  } catch (error) {
    console.error('مشكلة بالربط مع الباك:', error);
    alert('في مشكلة بالربط مع Backend');
  }
}

loadDoctorsFromBackend();
async function loadRepPharmaciesFromBackend() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));

    if (!currentUser) {
      window.location.href = 'login.html';
      return;
    }

    const repAreas = currentRepAreas;
    console.log('REP AREAS FOR PHARMACIES:', repAreas);

    const response = await fetch('/api/pharmacies');
    const data = await response.json();
console.log('ALL PHARMACIES FROM BACKEND:', data);

    const filteredPharmacies = data.filter(p =>
      repAreas.includes(p.area)
    );
console.log('FILTERED PHARMACIES:', filteredPharmacies);

    pharmacies.length = 0;

    filteredPharmacies.forEach(p => {
  pharmacies.push({
    id: p.id,
    name: p.name,
    area: p.area,
    target: Number(p.target || 0),
    done: Number(p.done || 0),
    category: p.category || 'A',

type: p.type || 'مستقلة',
    last: p.last || 'لم تتم زيارتها بعد',
    status: p.status || 'غير مزارة'
  });
});

    renderEntityLists();
    restorePharmacyFilters();

    const totalPharmacies = pharmacies.length;

const unvisitedPharmacies = pharmacies.filter(
  p => p.status === 'غير مزارة'
).length;

const categoryAPharmacies = pharmacies.filter(
  p => p.category === 'A'
).length;

const totalEl =
  document.getElementById('pharmaciesTotalCount');

const unvisitedEl =
  document.getElementById('pharmaciesUnvisitedCount');

const categoryAEl =
  document.getElementById('pharmaciesACount');

if (totalEl) {
  totalEl.textContent = totalPharmacies;
}

if (unvisitedEl) {
  unvisitedEl.textContent = unvisitedPharmacies;
}

if (categoryAEl) {
  categoryAEl.textContent = categoryAPharmacies;
}

const workspacePharmaciesTotal =
  document.getElementById('workspacePharmaciesTotal');

const workspacePharmaciesUnvisited =
  document.getElementById('workspacePharmaciesUnvisited');

if (workspacePharmaciesTotal) {
  workspacePharmaciesTotal.textContent = pharmacies.length;
}

if (workspacePharmaciesUnvisited) {
  workspacePharmaciesUnvisited.textContent =
    pharmacies.filter(p => p.status === 'غير مزارة').length;
}

  } catch (error) {
    console.error('خطأ بتحميل الصيدليات:', error);
  }
}

async function loadRepHospitalsFromBackend() {
  try {
    const response = await fetch(
      '/api/hospitals'
    );

    if (!response.ok) {
      throw new Error('Failed to load hospitals');
    }

    const data = await response.json();

    // فقط المشافي الموجودة ضمن مناطق المندوب
    const filteredHospitals = data.filter(h =>
      currentRepAreas.includes(h.area)
    );

    hospitals.length = 0;

    filteredHospitals.forEach(h => {
      hospitals.push({
        id: h.id,
        name: h.name,
        category: h.category || 'خاص',
        area: h.area,
        specialty: h.specialty || 'عام',
        last: h.last || 'لم تتم زيارته بعد',
        status: h.status || 'بحاجة زيارة',
        done: Number(h.done || 0),
        target: Number(h.target || 0)
      });
    });

    console.log('Rep hospitals:', hospitals);

    renderEntityLists();

    const totalHospitals = hospitals.length;

const needsVisitHospitals = hospitals.filter(
  h => h.status === 'بحاجة زيارة'
).length;

const privateHospitals = hospitals.filter(
  h => h.category === 'خاص'
).length;

const totalEl =
  document.getElementById('hospitalsTotalCount');

const needsVisitEl =
  document.getElementById('hospitalsNeedsVisitCount');

const privateEl =
  document.getElementById('hospitalsPrivateCount');

if (totalEl) {
  totalEl.textContent = totalHospitals;
}

if (needsVisitEl) {
  needsVisitEl.textContent = needsVisitHospitals;
}

if (privateEl) {
  privateEl.textContent = privateHospitals;
}

const workspaceHospitalsTotal =
  document.getElementById('workspaceHospitalsTotal');

const workspaceHospitalsNeedsVisit =
  document.getElementById('workspaceHospitalsNeedsVisit');

if (workspaceHospitalsTotal) {
  workspaceHospitalsTotal.textContent = totalHospitals;
}

if (workspaceHospitalsNeedsVisit) {
  workspaceHospitalsNeedsVisit.textContent = needsVisitHospitals;
}

  } catch (error) {
    console.error('Error loading rep hospitals:', error);
  }
  
}

loadRepPharmaciesFromBackend();

let doctorFilterMode = 'doctors';

function openDoctorFilters(mode = 'doctors') {
  doctorFilterMode = mode;
  buildDoctorSpecialtyFilters();

  const sheet = document.getElementById('doctorFilterSheet');

  if (sheet) {
    sheet.classList.add('open');
  }
}

function closeDoctorFilters() {
  const sheet = document.getElementById('doctorFilterSheet');

  if (sheet) {
    sheet.classList.remove('open');
  }
}

const savedDoctorGrades = JSON.parse(
  localStorage.getItem('doctorFilterGrades') || '[]'
);

const selectedDoctorGrades = new Set(savedDoctorGrades);

document.addEventListener('click', function (event) {
  const button = event.target.closest('.filter-option[data-grade]');
  if (!button) return;

  const grade = button.dataset.grade;

  if (selectedDoctorGrades.has(grade)) {
    selectedDoctorGrades.delete(grade);
    button.classList.remove('selected');
  } else {
    selectedDoctorGrades.add(grade);
    button.classList.add('selected');
  }
  localStorage.setItem(
  'doctorFilterGrades',
  JSON.stringify([...selectedDoctorGrades])
);
});

const savedDoctorSpecialties = JSON.parse(
  localStorage.getItem('doctorFilterSpecialties') || '[]'
);

const selectedDoctorSpecialties = new Set(savedDoctorSpecialties);

function buildDoctorSpecialtyFilters() {
  const container = document.getElementById('specialtyFilterList');
  if (!container) return;

  const specialties = [...new Set(
    doctors
      .map(d => d.spec)
      .filter(Boolean)
      .map(s => s.trim())
  )].sort();

  container.innerHTML = specialties.map(spec => `
  <label class="filter-check">
    <input
      type="checkbox"
      value="${spec}"
      ${selectedDoctorSpecialties.has(spec) ? 'checked' : ''}
      onchange="toggleDoctorSpecialty('${spec.replace(/'/g, "\\'")}', this.checked)"
    >
    <span>${spec}</span>
  </label>
`).join('');
}

function toggleDoctorSpecialty(spec, checked) {
  if (checked) {
    selectedDoctorSpecialties.add(spec);
  } else {
    selectedDoctorSpecialties.delete(spec);
  }

  localStorage.setItem(
    'doctorFilterSpecialties',
    JSON.stringify([...selectedDoctorSpecialties])
  );
}

function saveUnvisitedFilter() {
  const checkbox = document.getElementById('filterUnvisited');

  localStorage.setItem(
    'doctorFilterUnvisited',
    checkbox?.checked ? 'true' : 'false'
  );
}

function applyDoctorFilters() {
  let filtered = [...doctors];

  // التصنيف A / B / C
  if (selectedDoctorGrades.size > 0) {
    filtered = filtered.filter(d => {
      const grade = String(d.grade || '').trim().toUpperCase();

      return [...selectedDoctorGrades].some(
        selected => selected.toUpperCase() === grade
      );
    });
  }

  // الاختصاص - يسمح باختيار عدة اختصاصات
  if (selectedDoctorSpecialties.size > 0) {
    filtered = filtered.filter(d => {
      const spec = String(d.spec || '').trim();

      return [...selectedDoctorSpecialties].some(
        selected => selected.trim() === spec
      );
    });
  }

  // غير مزار
  const unvisitedOnly =
    document.getElementById('filterUnvisited')?.checked;

  if (unvisitedOnly) {
    filtered = filtered.filter(d =>
      String(d.status || '').trim() === 'غير مزار'
    );
  }

  // صفحة الأطباء
  if (doctorFilterMode === 'doctors') {
    renderDoctorList(filtered);
  }

  // صفحة اختيار أطباء الجولة
  if (doctorFilterMode === 'round') {
    const roundList = document.getElementById('roundDoctorList');

    if (roundList) {
      roundList.innerHTML = filtered
        .map(d => doctorCard(d, true))
        .join('');
    }
  }
updateDoctorFilterUI();
  closeDoctorFilters();
}
function restoreDoctorFilters() {
  document
    .querySelectorAll('.filter-option[data-grade]')
    .forEach(button => {
      if (selectedDoctorGrades.has(button.dataset.grade)) {
        button.classList.add('selected');
      }
    });

  buildDoctorSpecialtyFilters();
const savedUnvisited =
  localStorage.getItem('doctorFilterUnvisited') === 'true';

const unvisitedCheckbox =
  document.getElementById('filterUnvisited');

if (unvisitedCheckbox) {
  unvisitedCheckbox.checked = savedUnvisited;
}
  applyDoctorFilters();
}
function updateDoctorFilterUI() {
  let count = 0;

  count += selectedDoctorGrades.size;
  count += selectedDoctorSpecialties.size;

  const unvisited =
    document.getElementById('filterUnvisited')?.checked;

  if (unvisited) count += 1;

  const isRound = doctorFilterMode === 'round';

const countEl = document.getElementById(
  isRound ? 'roundDoctorFilterCount' : 'doctorFilterCount'
);

const resetBtn = document.getElementById(
  isRound ? 'roundDoctorFilterReset' : 'doctorFilterReset'
);

  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  if (resetBtn) {
    resetBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  const chipsContainer = document.getElementById(
  isRound ? 'activeRoundDoctorFilters' : 'activeDoctorFilters'
);

if (chipsContainer) {
  const chips = [];

  selectedDoctorGrades.forEach(grade => {
    chips.push(`
      <button class="chip active-filter-chip" onclick="removeDoctorGradeFilter('${grade}')">
        ${grade} ×
      </button>
    `);
  });

  selectedDoctorSpecialties.forEach(spec => {
    chips.push(`
      <button class="chip active-filter-chip" onclick="removeDoctorSpecialtyFilter('${spec.replace(/'/g, "\\'")}')">
        ${spec} ×
      </button>
    `);
  });

  if (unvisited) {
    chips.push(`
      <button class="chip active-filter-chip" onclick="removeUnvisitedDoctorFilter()">
        غير مزار ×
      </button>
    `);
  }

  chipsContainer.innerHTML = chips.join('');
}
}

function removeDoctorGradeFilter(grade) {
  selectedDoctorGrades.delete(grade);

  localStorage.setItem(
    'doctorFilterGrades',
    JSON.stringify([...selectedDoctorGrades])
  );

  document
    .querySelectorAll('.filter-option[data-grade]')
    .forEach(button => {
      if (button.dataset.grade === grade) {
        button.classList.remove('selected');
      }
    });

  applyDoctorFilters();
}


function removeDoctorSpecialtyFilter(spec) {
  selectedDoctorSpecialties.delete(spec);

  localStorage.setItem(
    'doctorFilterSpecialties',
    JSON.stringify([...selectedDoctorSpecialties])
  );

  buildDoctorSpecialtyFilters();

  applyDoctorFilters();
}


function removeUnvisitedDoctorFilter() {
  const checkbox = document.getElementById('filterUnvisited');

  if (checkbox) {
    checkbox.checked = false;
  }

  localStorage.setItem(
    'doctorFilterUnvisited',
    'false'
  );

  applyDoctorFilters();
}

window.removeDoctorGradeFilter = removeDoctorGradeFilter;
window.removeDoctorSpecialtyFilter = removeDoctorSpecialtyFilter;
window.removeUnvisitedDoctorFilter = removeUnvisitedDoctorFilter;

function clearDoctorFilters() {
  selectedDoctorGrades.clear();
  selectedDoctorSpecialties.clear();

  document
    .querySelectorAll('.filter-option[data-grade]')
    .forEach(button => {
      button.classList.remove('selected');
    });

  const unvisitedCheckbox =
    document.getElementById('filterUnvisited');

  if (unvisitedCheckbox) {
    unvisitedCheckbox.checked = false;
  }

  document
    .querySelectorAll('#specialtyFilterList input[type="checkbox"]')
    .forEach(input => {
      input.checked = false;
    });

  if (doctorFilterMode === 'doctors') {
    renderDoctorList(doctors);
  }

  if (doctorFilterMode === 'round') {
    const roundList = document.getElementById('roundDoctorList');

    if (roundList) {
      roundList.innerHTML = doctors
        .map(d => doctorCard(d, true))
        .join('');
    }
  }
updateDoctorFilterUI();
  closeDoctorFilters();
}

function openPharmacyFilters() {
  const sheet = document.getElementById('pharmacyFilterSheet');

  if (sheet) {
    sheet.classList.add('open');
  }
}

function closePharmacyFilters() {
  const sheet = document.getElementById('pharmacyFilterSheet');

  if (sheet) {
    sheet.classList.remove('open');
  }
}
function openHospitalFilters() {
  buildHospitalSpecialtyFilters();
  const sheet = document.getElementById('hospitalFilterSheet');

  if (sheet) {
    sheet.classList.add('open');
  }
}

function closeHospitalFilters() {
  const sheet = document.getElementById('hospitalFilterSheet');

  if (sheet) {
    sheet.classList.remove('open');
  }
}
const savedHospitalCategories = JSON.parse(
  localStorage.getItem('hospitalFilterCategories') || '[]'
);

const selectedHospitalCategories =
  new Set(savedHospitalCategories);

const savedHospitalSpecialties = JSON.parse(
  localStorage.getItem('hospitalFilterSpecialties') || '[]'
);

const selectedHospitalSpecialties =
  new Set(savedHospitalSpecialties);

function buildHospitalSpecialtyFilters() {
  const container = document.getElementById('hospitalSpecialtyFilterList');
  if (!container) return;

  const specialties = [...new Set(
    hospitals
      .map(h => h.specialty)
      .filter(Boolean)
      .map(s => s.trim())
  )].sort();

  container.innerHTML = specialties.map(spec => `
    <label class="filter-check">
      <input
        type="checkbox"
        value="${spec}"
        onchange="toggleHospitalSpecialty('${spec.replace(/'/g, "\\'")}', this.checked)"
      >
      <span>${spec}</span>
    </label>
  `).join('');
}

function toggleHospitalSpecialty(spec, checked) {
  if (checked) {
    selectedHospitalSpecialties.add(spec);
  } else {
    selectedHospitalSpecialties.delete(spec);
  }
  localStorage.setItem(
  'hospitalFilterSpecialties',
  JSON.stringify([...selectedHospitalSpecialties])
);
}
function applyHospitalFilters() {
  const needsVisitOnly =
    document.getElementById('hospitalNeedsVisitFilter')?.checked;

  const filtered = hospitals.filter(x => {

    const categoryMatch =
      selectedHospitalCategories.size === 0 ||
      selectedHospitalCategories.has(x.category);

    const specialtyMatch =
      selectedHospitalSpecialties.size === 0 ||
      selectedHospitalSpecialties.has(x.specialty);

    const statusMatch =
      !needsVisitOnly ||
      x.status === 'بحاجة زيارة';

    return categoryMatch && specialtyMatch && statusMatch;
  });

  document.getElementById('hospitalList').innerHTML =
    filtered.map(hospitalCard).join('');
updateHospitalFilterUI();
  closeHospitalFilters();
}
function restoreHospitalFilters() {
  document
    .querySelectorAll('.hospital-category-option[data-category]')
    .forEach(button => {
      if (selectedHospitalCategories.has(button.dataset.category)) {
        button.classList.add('selected');
      }
    });

  buildHospitalSpecialtyFilters();

  document
    .querySelectorAll('#hospitalSpecialtyFilterList input[type="checkbox"]')
    .forEach(input => {
      input.checked = selectedHospitalSpecialties.has(input.value);
    });

  const savedNeedsVisit =
    localStorage.getItem('hospitalFilterNeedsVisit') === 'true';

  const needsVisitCheckbox =
    document.getElementById('hospitalNeedsVisitFilter');

  if (needsVisitCheckbox) {
    needsVisitCheckbox.checked = savedNeedsVisit;
  }

  applyHospitalFilters();
}

function updateHospitalFilterUI() {
  const needsVisit =
    document.getElementById('hospitalNeedsVisitFilter')?.checked;

  const count =
    selectedHospitalCategories.size +
    selectedHospitalSpecialties.size +
    (needsVisit ? 1 : 0);

  const countEl =
    document.getElementById('hospitalFilterCount');

  const resetBtn =
    document.getElementById('hospitalFilterReset');

  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  if (resetBtn) {
    resetBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  const chipsContainer =
    document.getElementById('activeHospitalFilters');

  if (chipsContainer) {
    const chips = [];

    selectedHospitalCategories.forEach(category => {
      chips.push(`
        <button
          type="button"
          class="chip active-filter-chip"
          onclick="removeHospitalCategoryFilter('${category}')"
        >
          ${category} ×
        </button>
      `);
    });

    selectedHospitalSpecialties.forEach(spec => {
      chips.push(`
        <button
          type="button"
          class="chip active-filter-chip"
          onclick="removeHospitalSpecialtyFilter('${spec.replace(/'/g, "\\'")}')"
        >
          ${spec} ×
        </button>
      `);
    });

    if (needsVisit) {
      chips.push(`
        <button
          type="button"
          class="chip active-filter-chip"
          onclick="removeHospitalNeedsVisitFilter()"
        >
          بحاجة زيارة ×
        </button>
      `);
    }

    chipsContainer.innerHTML = chips.join('');
  }
}
function removeHospitalCategoryFilter(category) {
  selectedHospitalCategories.delete(category);

  document
    .querySelectorAll('.hospital-category-option[data-category]')
    .forEach(button => {
      if (button.dataset.category === category) {
        button.classList.remove('selected');
      }
    });

  applyHospitalFilters();
}


function removeHospitalSpecialtyFilter(spec) {
  selectedHospitalSpecialties.delete(spec);

  document
    .querySelectorAll('#hospitalSpecialtyFilterList input[type="checkbox"]')
    .forEach(input => {
      if (input.value === spec) {
        input.checked = false;
      }
    });

  applyHospitalFilters();
}

function saveHospitalNeedsVisitFilter() {
  const checkbox =
    document.getElementById('hospitalNeedsVisitFilter');

  localStorage.setItem(
    'hospitalFilterNeedsVisit',
    checkbox?.checked ? 'true' : 'false'
  );
}

function removeHospitalNeedsVisitFilter() {
  const checkbox =
    document.getElementById('hospitalNeedsVisitFilter');

  if (checkbox) {
    checkbox.checked = false;
  }

  applyHospitalFilters();
}


function clearHospitalFilters() {
  selectedHospitalCategories.clear();
  selectedHospitalSpecialties.clear();

  document
    .querySelectorAll('.hospital-category-option[data-category]')
    .forEach(button => {
      button.classList.remove('selected');
    });

  document
    .querySelectorAll('#hospitalSpecialtyFilterList input[type="checkbox"]')
    .forEach(input => {
      input.checked = false;
    });

  const needsVisit =
    document.getElementById('hospitalNeedsVisitFilter');

  if (needsVisit) {
    needsVisit.checked = false;
  }

  document.getElementById('hospitalList').innerHTML =
    hospitals.map(hospitalCard).join('');

  updateHospitalFilterUI();
  closeHospitalFilters();
}

document.addEventListener('click', function (event) {
  const button = event.target.closest(
    '.hospital-category-option[data-category]'
  );

  if (!button) return;

  const category = button.dataset.category;

  if (selectedHospitalCategories.has(category)) {
    selectedHospitalCategories.delete(category);
    button.classList.remove('selected');
  } else {
    selectedHospitalCategories.add(category);
    button.classList.add('selected');
  }
  localStorage.setItem(
  'hospitalFilterCategories',
  JSON.stringify([...selectedHospitalCategories])
);
});

function applyPharmacyFilters() {
  const unvisitedOnly =
    document.getElementById('pharmacyFilterUnvisited')?.checked;

  const filtered = pharmacies.filter(x => {

    const categoryMatch =
      selectedPharmacyCategories.size === 0 ||
      selectedPharmacyCategories.has(x.category);

    const typeMatch =
      selectedPharmacyTypes.size === 0 ||
      selectedPharmacyTypes.has(x.type);

    const unvisitedMatch =
      !unvisitedOnly ||
      x.status === 'غير مزارة';

    return categoryMatch && typeMatch && unvisitedMatch;
  });

  document.getElementById('pharmacyList').innerHTML =
    filtered.map(pharmacyCard).join('');
updatePharmacyFilterUI();
  closePharmacyFilters();
}
function restorePharmacyFilters() {
  document
    .querySelectorAll('.pharmacy-filter-option[data-category]')
    .forEach(button => {
      if (selectedPharmacyCategories.has(button.dataset.category)) {
        button.classList.add('selected');
      }
    });

  document
    .querySelectorAll('.pharmacy-type-filter')
    .forEach(input => {
      input.checked = selectedPharmacyTypes.has(input.value);
    });

  const savedUnvisited =
    localStorage.getItem('pharmacyFilterUnvisited') === 'true';

  const unvisitedCheckbox =
    document.getElementById('pharmacyFilterUnvisited');

  if (unvisitedCheckbox) {
    unvisitedCheckbox.checked = savedUnvisited;
  }

  applyPharmacyFilters();
}

function updatePharmacyFilterUI() {
  const unvisited =
    document.getElementById('pharmacyFilterUnvisited')?.checked;

  const count =
    selectedPharmacyCategories.size +
    selectedPharmacyTypes.size +
    (unvisited ? 1 : 0);

  const countEl =
    document.getElementById('pharmacyFilterCount');

  const resetBtn =
    document.getElementById('pharmacyFilterReset');

  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  if (resetBtn) {
    resetBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  const chipsContainer =
  document.getElementById('activePharmacyFilters');

if (chipsContainer) {
  const chips = [];

  selectedPharmacyCategories.forEach(category => {
    chips.push(`
      <button
        type="button"
        class="chip active-filter-chip"
        onclick="removePharmacyCategoryFilter('${category}')"
      >
        ${category} ×
      </button>
    `);
  });

  selectedPharmacyTypes.forEach(type => {
    chips.push(`
      <button
        type="button"
        class="chip active-filter-chip"
        onclick="removePharmacyTypeFilter('${type}')"
      >
        ${type} ×
      </button>
    `);
  });

  if (unvisited) {
    chips.push(`
      <button
        type="button"
        class="chip active-filter-chip"
        onclick="removePharmacyUnvisitedFilter()"
      >
        غير مزارة ×
      </button>
    `);
  }

  chipsContainer.innerHTML = chips.join('');
}
}
function removePharmacyCategoryFilter(category) {
  selectedPharmacyCategories.delete(category);

  document
    .querySelectorAll('.pharmacy-filter-option[data-category]')
    .forEach(button => {
      if (button.dataset.category === category) {
        button.classList.remove('selected');
      }
    });

  applyPharmacyFilters();
}

function removePharmacyTypeFilter(type) {
  selectedPharmacyTypes.delete(type);

  document
    .querySelectorAll('.pharmacy-type-filter')
    .forEach(input => {
      if (input.value === type) {
        input.checked = false;
      }
    });

  applyPharmacyFilters();
}

function savePharmacyUnvisitedFilter() {
  const checkbox =
    document.getElementById('pharmacyFilterUnvisited');

  localStorage.setItem(
    'pharmacyFilterUnvisited',
    checkbox?.checked ? 'true' : 'false'
  );
}

function removePharmacyUnvisitedFilter() {
  const checkbox =
    document.getElementById('pharmacyFilterUnvisited');

  if (checkbox) {
    checkbox.checked = false;
  }

  applyPharmacyFilters();
}

function clearPharmacyFilters() {
  selectedPharmacyCategories.clear();
  selectedPharmacyTypes.clear();

  document
    .querySelectorAll('.pharmacy-filter-option[data-category]')
    .forEach(button => {
      button.classList.remove('selected');
    });

  document
    .querySelectorAll('.pharmacy-type-filter')
    .forEach(input => {
      input.checked = false;
    });

  const unvisited =
    document.getElementById('pharmacyFilterUnvisited');

  if (unvisited) {
    unvisited.checked = false;
  }

  document.getElementById('pharmacyList').innerHTML =
    pharmacies.map(pharmacyCard).join('');

  updatePharmacyFilterUI();
  closePharmacyFilters();
}

const savedPharmacyCategories = JSON.parse(
  localStorage.getItem('pharmacyFilterCategories') || '[]'
);

const selectedPharmacyCategories = new Set(savedPharmacyCategories);
const savedPharmacyTypes = JSON.parse(
  localStorage.getItem('pharmacyFilterTypes') || '[]'
);

const selectedPharmacyTypes = new Set(savedPharmacyTypes);

document.addEventListener('click', function (event) {
  const button = event.target.closest('.pharmacy-filter-option[data-category]');
  if (!button) return;

  const category = button.dataset.category;

  if (selectedPharmacyCategories.has(category)) {
    selectedPharmacyCategories.delete(category);
    button.classList.remove('selected');
  } else {
    selectedPharmacyCategories.add(category);
    button.classList.add('selected');
  }
  localStorage.setItem(
  'pharmacyFilterCategories',
  JSON.stringify([...selectedPharmacyCategories])
);
});
document.addEventListener('change', function (event) {
  if (!event.target.classList.contains('pharmacy-type-filter')) return;

  const type = event.target.value;

  if (event.target.checked) {
    selectedPharmacyTypes.add(type);
  } else {
    selectedPharmacyTypes.delete(type);
  }
  localStorage.setItem(
  'pharmacyFilterTypes',
  JSON.stringify([...selectedPharmacyTypes])
);
});
async function loadRepCycleInfo() {
  try {
    console.log('بدأ تحميل معلومات السايكل');
    const response = await fetch(
      '/api/cycle-settings'
    );

    const data = await response.json();
console.log('بيانات السايكل:', data);

    const startDate = new Date(
      data.cycle_start_date + 'T00:00:00'
    );

    const endDate = new Date(
      data.cycle_end_date + 'T00:00:00'
    );

    const monthNames = [
      'كانون الثاني',
      'شباط',
      'آذار',
      'نيسان',
      'أيار',
      'حزيران',
      'تموز',
      'آب',
      'أيلول',
      'تشرين الأول',
      'تشرين الثاني',
      'كانون الأول'
    ];

    const startMonth = monthNames[startDate.getMonth()];
    const endMonth = monthNames[endDate.getMonth()];

    const cycleName =
      startMonth === endMonth
        ? `${startMonth} ${endDate.getFullYear()}`
        : `${startMonth} — ${endMonth}`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffTime = endDate - today;

    const remainingDays = Math.max(
      0,
      Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    );

    const cycleNameEl =
      document.getElementById('currentCycleName');

    const remainingEl =
      document.getElementById('currentCycleRemaining');
      const homeRemainingEl =
  document.getElementById('homeCycleRemaining');

  const homeCoverageEl =
  document.getElementById('homeCycleCoverage');

      console.log('عنصر اسم السايكل:', cycleNameEl);
console.log('عنصر الأيام المتبقية:', remainingEl);

    if (cycleNameEl) {
      cycleNameEl.textContent = cycleName;
    }

    if (remainingEl) {
      remainingEl.textContent =
        `${remainingDays} أيام`;
    }
    if (homeRemainingEl) {
  homeRemainingEl.textContent =
    `${remainingDays} أيام`;
}

  } catch (error) {
    console.error(
      'خطأ بتحميل معلومات السايكل:',
      error
    );
  }
}

async function loadWeeklyVisitsCount() {
  try {
    const response = await fetch(
  `/api/weekly-visits-count?rep_id=${encodeURIComponent(currentUser.id)}`
);

    const data = await response.json();

    const el = document.getElementById('homeWeeklyVisits');

    if (el) {
      el.textContent = `${data.count || 0} / 60`;
    }

  } catch (error) {
    console.error('خطأ بتحميل زيارات الأسبوع:', error);
  }
}

document.addEventListener('DOMContentLoaded', async function () {

  const savedScreen = localStorage.getItem('currentScreen');
  const savedAreaName = localStorage.getItem('currentAreaName');

  restoreHospitalFilters();

  await loadCurrentRepAreas();
  await loadDoctorsFromBackend();

  if (savedScreen === 'area-detail' && savedAreaName) {
    openArea(savedAreaName);
  } else if (savedScreen) {
    showScreen(savedScreen);
  }

  loadRepCycleInfo();
  loadWeeklyVisitsCount();

});