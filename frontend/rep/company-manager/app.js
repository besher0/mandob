/* ========================================
   Page Configuration
======================================== */

const pages = {
  dashboard: {
    title: 'الرئيسية',
    subtitle: 'نظرة عامة على أداء الشركة'
  },

  governorates: {
    title: 'المحافظات',
    subtitle: 'متابعة وإدارة أداء الشركة حسب المحافظة'
  },

  'governorate-details': {
  title: 'تفاصيل المحافظة',
  subtitle: 'متابعة أداء المحافظة والفرق والمندوبين'
},

  teams: {
    title: 'الفرق والمندوبون',
    subtitle: 'إدارة الفرق ومدراء الفرق والمندوبين'
  },

  'team-details': {
  title: 'تفاصيل الفريق',
  subtitle: 'متابعة أداء الفريق والمندوبين'
},

  coverage: {
    title: 'التغطية',
    subtitle: 'متابعة التغطية حسب المحافظة والفريق والمنطقة'
  },

  data: {
    title: 'البيانات',
    subtitle: 'الأطباء والصيدليات والمشافي والمناطق'
  },

  reports: {
    title: 'التقارير',
    subtitle: 'تقارير الأداء والزيارات والتغطية'
  },

  settings: {
    title: 'الإعدادات',
    subtitle: 'إعدادات العمل الخاصة بالشركة'
  }
};


/* ========================================
   Page Navigation
======================================== */

function openPage(pageId) {
  if (!pages[pageId]) return;

  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.classList.remove('active');
  });

  const targetPage = document.getElementById(pageId);

  if (targetPage) {
    targetPage.classList.add('active');
  }

  const targetNav = document.querySelector(
    `.nav-item[data-page="${pageId}"]`
  );

  if (targetNav) {
    targetNav.classList.add('active');
  }

  document.getElementById('pageTitle').textContent =
    pages[pageId].title;

  document.getElementById('pageSubtitle').textContent =
    pages[pageId].subtitle;
}


document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => {
    openPage(item.dataset.page);
  });
});


document.querySelectorAll('[data-go]').forEach(button => {
  button.addEventListener('click', () => {
    openPage(button.dataset.go);
  });
});


/* ========================================
   Governorate Filter
======================================== */

const governorateFilter =
  document.getElementById('globalGovernorateFilter');


function filterGovernorates(value) {
  document.querySelectorAll('.governorate-card').forEach(card => {

    const governorate =
      card.dataset.governorate;

    const shouldShow =
      value === 'all' ||
      governorate === value;

    card.style.display =
      shouldShow ? '' : 'none';
  });
}


governorateFilter?.addEventListener('change', event => {
  filterGovernorates(event.target.value);
});


/* ========================================
   Open Governorate
======================================== */

document.querySelectorAll(
  '[data-open-governorate]'
).forEach(button => {

  button.addEventListener('click', event => {

    event.stopPropagation();

    const governorate =
      button.dataset.openGovernorate;

    openGovernorate(governorate);
  });

});


const governoratesData = {
  aleppo: {
    name: 'حلب',
    icon: 'ح',
    coverage: 82,
    visits: 126,
    reps: 18,
    attention: 2,
    areas: 12,

    teams: [
      {
        name: 'RX1',
        manager: 'أحمد محمد',
        reps: 5,
        coverage: 88
      },
      {
        name: 'RX2',
        manager: 'محمد خالد',
        reps: 5,
        coverage: 79
      },
      {
        name: 'RX3',
        manager: 'سامر علي',
        reps: 4,
        coverage: 84
      },
      {
        name: 'RX4',
        manager: null,
        reps: 4,
        coverage: 73
      }
    ],

    areaPerformance: [
      { name: 'الحمدانية', coverage: 91 },
      { name: 'الفرقان', coverage: 84 },
      { name: 'حلب الجديدة', coverage: 76 },
      { name: 'الجميلية', coverage: 69 }
    ],

    representatives: [
      {
        name: 'محمد أحمد',
        username: 'm.ahmad',
        team: 'RX1',
        coverage: 94
      },
      {
        name: 'عمر خالد',
        username: 'o.khaled',
        team: 'RX1',
        coverage: 87
      },
      {
        name: 'أحمد علي',
        username: 'a.ali',
        team: 'RX2',
        coverage: 73
      },
      {
        name: 'سامر حسن',
        username: 's.hassan',
        team: 'RX4',
        coverage: 58
      }
    ]
  },


  damascus: {
    name: 'دمشق',
    icon: 'د',
    coverage: 74,
    visits: 94,
    reps: 14,
    attention: 3,
    areas: 9,

    teams: [
      {
        name: 'RX1',
        manager: 'مازن أحمد',
        reps: 5,
        coverage: 81
      },
      {
        name: 'RX2',
        manager: 'رامي حسن',
        reps: 5,
        coverage: 74
      },
      {
        name: 'RX3',
        manager: 'خالد عمر',
        reps: 4,
        coverage: 67
      }
    ],

    areaPerformance: [
      { name: 'المزة', coverage: 82 },
      { name: 'المالكي', coverage: 78 },
      { name: 'الميدان', coverage: 71 },
      { name: 'برزة', coverage: 64 }
    ],

    representatives: [
      {
        name: 'رامي محمد',
        username: 'r.mohammad',
        team: 'RX1',
        coverage: 86
      },
      {
        name: 'فراس علي',
        username: 'f.ali',
        team: 'RX2',
        coverage: 76
      },
      {
        name: 'كنان أحمد',
        username: 'k.ahmad',
        team: 'RX3',
        coverage: 65
      }
    ]
  },


  homs: {
    name: 'حمص',
    icon: 'ح',
    coverage: 61,
    visits: 64,
    reps: 10,
    attention: 1,
    areas: 7,

    teams: [
      {
        name: 'RX1',
        manager: 'علي محمد',
        reps: 5,
        coverage: 66
      },
      {
        name: 'RX2',
        manager: null,
        reps: 5,
        coverage: 56
      }
    ],

    areaPerformance: [
      { name: 'الحمرا', coverage: 69 },
      { name: 'الإنشاءات', coverage: 63 },
      { name: 'عكرمة', coverage: 59 },
      { name: 'الوعر', coverage: 52 }
    ],

    representatives: [
      {
        name: 'محمد حسن',
        username: 'm.hassan',
        team: 'RX1',
        coverage: 72
      },
      {
        name: 'أحمد خالد',
        username: 'a.khaled',
        team: 'RX1',
        coverage: 63
      },
      {
        name: 'عمر علي',
        username: 'o.ali',
        team: 'RX2',
        coverage: 49
      }
    ]
  }
};


function openGovernorate(governorateId) {
  const data =
    governoratesData[governorateId];

  if (!data) return;

  document.getElementById(
    'detailsGovernorateName'
  ).textContent = data.name;

  document.getElementById(
    'detailsGovernorateIcon'
  ).textContent = data.icon;

  document.getElementById(
    'detailsGovernorateSummary'
  ).textContent =
    `${data.teams.length} فرق • ${data.reps} مندوب • ${data.areas} منطقة`;

  document.getElementById(
    'detailsCoverage'
  ).textContent =
    `${data.coverage}%`;

  document.getElementById(
    'detailsCoverageProgress'
  ).style.width =
    `${data.coverage}%`;

  document.getElementById(
    'detailsVisits'
  ).textContent =
    data.visits;

  document.getElementById(
    'detailsReps'
  ).textContent =
    data.reps;

  document.getElementById(
    'detailsAttention'
  ).textContent =
    data.attention;


  renderGovernorateTeams(data.teams);
  renderGovernorateAreas(data.areaPerformance);
  renderGovernorateReps(data.representatives);

  openPage('governorate-details');
}


function renderGovernorateTeams(teams) {
  const container =
    document.getElementById('detailsTeamList');

  container.innerHTML = teams.map(team => `
    <div class="details-team-row">

      <div class="details-team-main">

        <div class="team-avatar">
          ${team.name.replace('RX', 'R')}
        </div>

        <div>
          <strong>${team.name}</strong>
          <span>${team.reps} مندوب</span>
        </div>

      </div>


      <div class="details-team-manager">

        <span>مدير الفريق</span>

        <strong>
          ${
            team.manager ||
            '<span style="color: var(--danger);">غير معيّن</span>'
          }
        </strong>

      </div>


      <div class="details-team-coverage">

        <strong>${team.coverage}%</strong>
        <span>تغطية</span>

      </div>

    </div>
  `).join('');
}


function renderGovernorateAreas(areas) {
  const container =
    document.getElementById('detailsAreaList');

  container.innerHTML = areas.map(area => `
    <div class="area-performance-item">

      <div class="area-performance-head">

        <strong>
          ${area.name}
        </strong>

        <span>
          ${area.coverage}%
        </span>

      </div>

      <div class="progress-track">

        <div
          class="progress-value"
          style="width: ${area.coverage}%;"
        ></div>

      </div>

    </div>
  `).join('');
}


function renderGovernorateReps(reps) {
  const container =
    document.getElementById('detailsRepList');

  container.innerHTML = reps.map(rep => {

    let statusClass = 'good';
    let statusText = 'جيد';

    if (rep.coverage < 60) {
      statusClass = 'low';
      statusText = 'بحاجة للمتابعة';
    }
    else if (rep.coverage < 75) {
      statusClass = 'warning';
      statusText = 'متوسط';
    }

    return `
      <div class="simple-table-row">

        <div class="rep-table-user">

          <div class="rep-table-avatar">
            ${rep.name.charAt(0)}
          </div>

          <div>
            <strong>${rep.name}</strong>
            <span>${rep.username}</span>
          </div>

        </div>

        <span>
          ${rep.team}
        </span>

        <strong>
          ${rep.coverage}%
        </strong>

        <span class="rep-status ${statusClass}">
          ${statusText}
        </span>

      </div>
    `;

  }).join('');
}


/* ========================================
   Governorate Card Click
======================================== */

document.querySelectorAll(
  '.governorate-card'
).forEach(card => {

  card.addEventListener('click', event => {

    if (event.target.closest('button')) {
      return;
    }

    openGovernorate(
      card.dataset.governorate
    );
  });

});

/* ========================================
   Governorates Search
======================================== */

const governorateSearch =
  document.getElementById('governorateSearch');


governorateSearch?.addEventListener('input', event => {

  const query =
    event.target.value
      .trim()
      .toLowerCase();

  document.querySelectorAll(
    '.governorate-list-card'
  ).forEach(card => {

    const name =
      card.dataset.governorateName
        .toLowerCase();

    card.style.display =
      name.includes(query)
        ? ''
        : 'none';
  });

});


/* ========================================
   Back To Governorates
======================================== */

document.getElementById(
  'backToGovernorates'
)?.addEventListener('click', () => {

  openPage('governorates');

});

/* ========================================
   Data Tabs
======================================== */

const dataTabs =
  document.querySelectorAll('.data-tab');

const dataPanels =
  document.querySelectorAll('.data-panel');

const addDataButton =
  document.getElementById('addDataButton');


const dataButtonLabels = {
  doctors: '+ إضافة طبيب',
  pharmacies: '+ إضافة صيدلية',
  hospitals: '+ إضافة مشفى',
  areas: '+ إضافة منطقة'
};


dataTabs.forEach(tab => {

  tab.addEventListener('click', () => {

    const selectedTab =
      tab.dataset.dataTab;


    dataTabs.forEach(item => {
      item.classList.remove('active');
    });

    tab.classList.add('active');


    dataPanels.forEach(panel => {

      panel.classList.toggle(
        'active',
        panel.dataset.dataPanel === selectedTab
      );

    });


    if (addDataButton) {
      addDataButton.textContent =
        dataButtonLabels[selectedTab];
    }

  });

});

/* ========================================
   Add Governorate
======================================== */

const addGovernorateButton =
  document.getElementById('addGovernorateButton');

const addGovernorateModal =
  document.getElementById('addGovernorateModal');

const closeGovernorateModal =
  document.getElementById('closeGovernorateModal');

const cancelGovernorateModal =
  document.getElementById('cancelGovernorateModal');

const governorateModalBackdrop =
  document.getElementById('governorateModalBackdrop');

const saveGovernorateButton =
  document.getElementById('saveGovernorateButton');

const newGovernorateName =
  document.getElementById('newGovernorateName');

const governorateNameError =
  document.getElementById('governorateNameError');


function openAddGovernorateModal() {

  addGovernorateModal?.classList.add('active');

  if (newGovernorateName) {
    newGovernorateName.value = '';
    newGovernorateName.focus();
  }

  if (governorateNameError) {
    governorateNameError.textContent = '';
  }
}


function closeAddGovernorateModal() {

  addGovernorateModal?.classList.remove('active');

}


function updateGovernoratesCount() {

  const count =
    document.querySelectorAll(
      '.governorates-list .governorate-list-card'
    ).length;

  const countElement =
    document.querySelector(
      '.governorates-count strong'
    );

  if (countElement) {
    countElement.textContent = count;
  }
}


function addGovernorate() {

  const name =
    newGovernorateName?.value.trim();

  if (!name) {

    if (governorateNameError) {
      governorateNameError.textContent =
        'اكتب اسم المحافظة أولاً';
    }

    return;
  }


  const existingGovernorates =
    [...document.querySelectorAll(
      '.governorate-list-card'
    )];

  const alreadyExists =
    existingGovernorates.some(card =>
      card.dataset.governorateName === name
    );


  if (alreadyExists) {

    if (governorateNameError) {
      governorateNameError.textContent =
        'هذه المحافظة موجودة مسبقاً';
    }

    return;
  }


  const list =
    document.querySelector('.governorates-list');

  if (!list) return;


  const card =
    document.createElement('article');

  card.className =
    'governorate-list-card';

  card.dataset.governorateName =
    name;


  card.innerHTML = `

    <div class="governorate-list-main">

      <div class="governorate-icon large">
        ${name.charAt(0)}
      </div>

      <div>
        <h3>${name}</h3>

        <span>
          0 فرق • 0 مندوب • 0 مناطق
        </span>
      </div>

    </div>


    <div class="governorate-list-metric">
      <span>التغطية</span>
      <strong>0%</strong>
    </div>


    <div class="governorate-list-metric">
      <span>زيارات الأسبوع</span>
      <strong>0</strong>
    </div>


    <div class="governorate-list-metric">
      <span>بحاجة للمتابعة</span>
      <strong>0</strong>
    </div>


    <div class="governorate-list-progress">

      <div class="progress-track">
        <div
          class="progress-value"
          style="width: 0%;"
        ></div>
      </div>

    </div>


    <button
      class="outline-button"
      type="button"
    >
      عرض التفاصيل
    </button>

  `;


  list.appendChild(card);

  updateGovernoratesCount();

  closeAddGovernorateModal();
}


addGovernorateButton?.addEventListener(
  'click',
  openAddGovernorateModal
);

closeGovernorateModal?.addEventListener(
  'click',
  closeAddGovernorateModal
);

cancelGovernorateModal?.addEventListener(
  'click',
  closeAddGovernorateModal
);

governorateModalBackdrop?.addEventListener(
  'click',
  closeAddGovernorateModal
);

saveGovernorateButton?.addEventListener(
  'click',
  addGovernorate
);

newGovernorateName?.addEventListener(
  'keydown',
  event => {

    if (event.key === 'Enter') {
      addGovernorate();
    }

  }
);

/* ========================================
   Add Team Manager
======================================== */

const addTeamManagerButton =
  document.getElementById('addTeamManagerButton');

const addTeamManagerModal =
  document.getElementById('addTeamManagerModal');

const closeTeamManagerModal =
  document.getElementById('closeTeamManagerModal');

const cancelTeamManagerModal =
  document.getElementById('cancelTeamManagerModal');

const teamManagerModalBackdrop =
  document.getElementById('teamManagerModalBackdrop');

const saveTeamManagerButton =
  document.getElementById('saveTeamManagerButton');

const teamManagerName =
  document.getElementById('teamManagerName');

const teamManagerUsername =
  document.getElementById('teamManagerUsername');

const teamManagerPassword =
  document.getElementById('teamManagerPassword');

const teamManagerGovernorate =
  document.getElementById('teamManagerGovernorate');

const teamManagerTeam =
  document.getElementById('teamManagerTeam');

const teamManagerFormError =
  document.getElementById('teamManagerFormError');


const teamsByGovernorate = {

  aleppo: [
    'RX1',
    'RX2',
    'RX3',
    'RX4'
  ],

  damascus: [
    'RX1',
    'RX2',
    'RX3'
  ],

  homs: [
    'RX1',
    'RX2'
  ]

};


function openTeamManagerModal() {

  addTeamManagerModal?.classList.add('active');

  if (teamManagerName) teamManagerName.value = '';
  if (teamManagerUsername) teamManagerUsername.value = '';
  if (teamManagerPassword) teamManagerPassword.value = '';

  if (teamManagerGovernorate) {
    teamManagerGovernorate.value = '';
  }

  if (teamManagerTeam) {
    teamManagerTeam.innerHTML =
      '<option value="">اختر المحافظة أولاً</option>';

    teamManagerTeam.disabled = true;
  }

  if (teamManagerFormError) {
    teamManagerFormError.textContent = '';
  }

  teamManagerName?.focus();
}


function closeTeamManagerForm() {
  addTeamManagerModal?.classList.remove('active');
}


teamManagerGovernorate?.addEventListener(
  'change',
  () => {

    const governorate =
      teamManagerGovernorate.value;

    const teams =
      teamsByGovernorate[governorate] || [];


    teamManagerTeam.innerHTML =
      '<option value="">اختر الفريق</option>';


    teams.forEach(team => {

      const option =
        document.createElement('option');

      option.value = team;
      option.textContent = team;

      teamManagerTeam.appendChild(option);

    });


    teamManagerTeam.disabled =
      teams.length === 0;

  }
);


function saveTeamManager() {

  const name =
    teamManagerName?.value.trim();

  const username =
    teamManagerUsername?.value.trim();

  const password =
    teamManagerPassword?.value.trim();

  const governorate =
    teamManagerGovernorate?.value;

  const team =
    teamManagerTeam?.value;


  if (
    !name ||
    !username ||
    !password ||
    !governorate ||
    !team
  ) {

    teamManagerFormError.textContent =
      'يرجى تعبئة جميع الحقول';

    return;
  }


  const group =
    document.querySelector(
      `.governorate-team-group[data-team-governorate="${governorate}"]`
    );

  if (!group) {

    teamManagerFormError.textContent =
      'لم يتم العثور على المحافظة';

    return;
  }


  const cards =
    [...group.querySelectorAll('.company-team-card')];


  const teamCard =
    cards.find(card => {

      const title =
        card.querySelector(
          '.company-team-head h4'
        );

      return title?.textContent.trim() === team;

    });


  if (!teamCard) {

    teamManagerFormError.textContent =
      'لم يتم العثور على الفريق';

    return;
  }


  const managerBlock =
    teamCard.querySelector(
      '.team-manager-block'
    );


  if (managerBlock) {

    managerBlock.classList.remove('missing');

    managerBlock.innerHTML = `
      <span>مدير الفريق</span>
      <strong>${name}</strong>
    `;

  }


  const actionButton =
    teamCard.querySelector(
      '.team-card-footer button'
    );


  if (actionButton) {
    actionButton.textContent = 'عرض الفريق';
  }


  closeTeamManagerForm();

}


addTeamManagerButton?.addEventListener(
  'click',
  openTeamManagerModal
);

closeTeamManagerModal?.addEventListener(
  'click',
  closeTeamManagerForm
);

cancelTeamManagerModal?.addEventListener(
  'click',
  closeTeamManagerForm
);

teamManagerModalBackdrop?.addEventListener(
  'click',
  closeTeamManagerForm
);

saveTeamManagerButton?.addEventListener(
  'click',
  saveTeamManager
);

/* ========================================
   Team Details
======================================== */

const teamDemoData = {

  aleppo: {

    RX1: {
      manager: 'أحمد محمد',
      coverage: 88,
      visits: 46,
      attention: 0,

      specialties: [
        'قلبية',
        'داخلية',
        'عصبية',
        'غدد',
        'أوعية'
      ],

      reps: [
        {
          name: 'محمد علي',
          areas: 'الحمدانية، حلب الجديدة',
          coverage: 92
        },
        {
          name: 'رامي خالد',
          areas: 'الفرقان',
          coverage: 88
        },
        {
          name: 'سامر أحمد',
          areas: 'الموكامبو',
          coverage: 85
        },
        {
          name: 'عمر حسن',
          areas: 'الجميلية',
          coverage: 90
        },
        {
          name: 'مازن علي',
          areas: 'الحمدانية',
          coverage: 84
        }
      ]
    },

    RX2: {
      manager: 'محمد خالد',
      coverage: 79,
      visits: 41,
      attention: 1,

      specialties: [
        'قلبية',
        'داخلية',
        'غدد'
      ],

      reps: [
        {
          name: 'أحمد حسن',
          areas: 'الحمدانية',
          coverage: 86
        },
        {
          name: 'خالد علي',
          areas: 'الفرقان',
          coverage: 81
        },
        {
          name: 'رامي أحمد',
          areas: 'حلب الجديدة',
          coverage: 78
        },
        {
          name: 'علي محمد',
          areas: 'الجميلية',
          coverage: 76
        },
        {
          name: 'سامر خالد',
          areas: 'الموكامبو',
          coverage: 74
        }
      ]
    }

  },


  damascus: {

    RX1: {
      manager: 'مازن أحمد',
      coverage: 81,
      visits: 38,
      attention: 1,

      specialties: [
        'قلبية',
        'داخلية',
        'عصبية'
      ],

      reps: [
        {
          name: 'أحمد سامر',
          areas: 'المزة',
          coverage: 86
        },
        {
          name: 'محمد عمر',
          areas: 'برزة',
          coverage: 82
        },
        {
          name: 'رامي حسن',
          areas: 'المهاجرين',
          coverage: 79
        },
        {
          name: 'علي خالد',
          areas: 'المزة',
          coverage: 80
        },
        {
          name: 'سامر محمد',
          areas: 'برزة',
          coverage: 78
        }
      ]
    }

  },


  homs: {

    RX1: {
      manager: 'علي محمد',
      coverage: 66,
      visits: 29,
      attention: 2,

      specialties: [
        'داخلية',
        'قلبية'
      ],

      reps: [
        {
          name: 'أحمد خالد',
          areas: 'الوعر',
          coverage: 70
        },
        {
          name: 'محمد حسن',
          areas: 'الحمرا',
          coverage: 68
        },
        {
          name: 'رامي علي',
          areas: 'عكرمة',
          coverage: 65
        },
        {
          name: 'سامر عمر',
          areas: 'الوعر',
          coverage: 64
        },
        {
          name: 'خالد أحمد',
          areas: 'الحمرا',
          coverage: 63
        }
      ]
    }

  }

};


function openTeamDetails(card) {

  const group =
    card.closest('.governorate-team-group');

  if (!group) return;


  const governorate =
    group.dataset.teamGovernorate;

  const governorateName =
    group.querySelector(
      '.team-group-heading h3'
    )?.textContent.trim() || '';


  const teamName =
    card.querySelector(
      '.company-team-head h4'
    )?.textContent.trim();


  if (!teamName) return;


  const manager =
    card.querySelector(
      '.team-manager-block strong'
    )?.textContent.trim() || 'غير معيّن';


  const coverageText =
    card.querySelector(
      '.team-card-footer strong'
    )?.textContent.trim() || '0%';

  const coverage =
    parseInt(coverageText) || 0;


  const repText =
    card.querySelector(
      '.company-team-head span'
    )?.textContent || '0';

  const repCount =
    parseInt(repText) || 0;


  const demo =
    teamDemoData[governorate]?.[teamName];


  document.getElementById(
    'teamDetailsGovernorate'
  ).textContent = governorateName;


  document.getElementById(
    'teamDetailsName'
  ).textContent = teamName;


  document.getElementById(
    'teamDetailsAvatar'
  ).textContent =
    teamName.replace('RX', 'R');


  document.getElementById(
    'teamDetailsManager'
  ).textContent =
    `مدير الفريق: ${manager}`;


  document.getElementById(
    'teamDetailsManagerName'
  ).textContent = manager;


  document.getElementById(
    'teamDetailsCoverage'
  ).textContent = `${coverage}%`;


  document.getElementById(
    'teamDetailsCoverageProgress'
  ).style.width = `${coverage}%`;


  document.getElementById(
    'teamDetailsRepCount'
  ).textContent = repCount;


  document.getElementById(
    'teamDetailsVisits'
  ).textContent =
    demo?.visits ?? '—';


  document.getElementById(
    'teamDetailsAttention'
  ).textContent =
    demo?.attention ?? '—';


  renderTeamSpecialties(
    demo?.specialties || []
  );


  renderTeamReps(
    demo?.reps || []
  );


  openPage('team-details');

}


function renderTeamSpecialties(specialties) {

  const container =
    document.getElementById(
      'teamDetailsSpecialties'
    );

  if (!container) return;


  if (!specialties.length) {

    container.innerHTML = `
      <span class="team-specialty-chip">
        لا توجد بيانات حالياً
      </span>
    `;

    return;
  }


  container.innerHTML =
    specialties
      .map(spec => `
        <span class="team-specialty-chip">
          ${spec}
        </span>
      `)
      .join('');

}


function renderTeamReps(reps) {

  const container =
    document.getElementById(
      'teamDetailsRepList'
    );

  if (!container) return;


  if (!reps.length) {

    container.innerHTML = `
      <div class="simple-table-empty">
        لا توجد بيانات للمندوبين حالياً
      </div>
    `;

    return;
  }


  container.innerHTML =
    reps
      .map(rep => {

        const status =
          rep.coverage >= 80
            ? 'جيد'
            : rep.coverage >= 65
              ? 'متوسط'
              : 'بحاجة للمتابعة';


        const statusClass =
          rep.coverage >= 80
            ? 'good'
            : rep.coverage >= 65
              ? 'medium'
              : 'low';


        return `

          <div class="simple-table-row team-reps-grid">

            <strong>
              ${rep.name}
            </strong>

            <span>
              ${rep.areas}
            </span>

            <strong>
              ${rep.coverage}%
            </strong>

            <span class="performance-badge ${statusClass}">
              ${status}
            </span>

          </div>

        `;

      })
      .join('');

}


/* Team card actions */

document.addEventListener(
  'click',
  event => {

    const button =
      event.target.closest(
        '.company-team-card .team-card-footer button'
      );

    if (!button) return;


    const card =
      button.closest('.company-team-card');

    if (!card) return;


    if (
      button.textContent.trim() ===
      'تعيين مدير'
    ) {

      openTeamManagerModal();

      return;
    }


    openTeamDetails(card);

  }
);


/* Back */

document
  .getElementById('backToTeams')
  ?.addEventListener(
    'click',
    () => openPage('teams')
  );

  /* ========================================
   Add Data
======================================== */

let currentDataType = 'doctors';


const addDataModal =
  document.getElementById('addDataModal');

const dataModalBackdrop =
  document.getElementById('dataModalBackdrop');

const closeDataModal =
  document.getElementById('closeDataModal');

const cancelDataModal =
  document.getElementById('cancelDataModal');

const saveDataButton =
  document.getElementById('saveDataButton');

const dataModalTitle =
  document.getElementById('dataModalTitle');

const dataModalSubtitle =
  document.getElementById('dataModalSubtitle');

const dataModalFields =
  document.getElementById('dataModalFields');

const dataModalError =
  document.getElementById('dataModalError');


const dataFormConfig = {

  doctors: {
    title: 'إضافة طبيب',
    subtitle: 'إضافة طبيب جديد إلى بيانات الشركة'
  },

  pharmacies: {
    title: 'إضافة صيدلية',
    subtitle: 'إضافة صيدلية جديدة إلى بيانات الشركة'
  },

  hospitals: {
    title: 'إضافة مشفى',
    subtitle: 'إضافة مشفى جديد إلى بيانات الشركة'
  },

  areas: {
    title: 'إضافة منطقة',
    subtitle: 'إضافة منطقة جديدة وربطها بمحافظة'
  }

};


function getGovernorateOptions() {

  return `
    <option value="">اختر المحافظة</option>
    <option value="حلب">حلب</option>
    <option value="دمشق">دمشق</option>
    <option value="حمص">حمص</option>
  `;

}


function renderDataForm(type) {

  if (!dataModalFields) return;


  if (type === 'doctors') {

    dataModalFields.innerHTML = `

      <div class="data-form-field full">
        <label>اسم الطبيب</label>

        <input
          type="text"
          id="newDataName"
          placeholder="مثال: د. أحمد محمد"
        >
      </div>


      <div class="data-form-field">
        <label>الاختصاص</label>

        <input
          type="text"
          id="newDoctorSpecialty"
          placeholder="مثال: قلبية"
        >
      </div>


      <div class="data-form-field">
        <label>التصنيف</label>

        <select id="newDoctorGrade">
          <option value="">اختر التصنيف</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </div>


      <div class="data-form-field">
        <label>المحافظة</label>

        <select id="newDataGovernorate">
          ${getGovernorateOptions()}
        </select>
      </div>


      <div class="data-form-field">
        <label>المنطقة</label>

        <input
          type="text"
          id="newDataArea"
          placeholder="مثال: الحمدانية"
        >
      </div>

    `;

  }


  if (type === 'pharmacies') {

    dataModalFields.innerHTML = `

      <div class="data-form-field full">
        <label>اسم الصيدلية</label>

        <input
          type="text"
          id="newDataName"
          placeholder="مثال: صيدلية الشفاء"
        >
      </div>


      <div class="data-form-field">
        <label>المحافظة</label>

        <select id="newDataGovernorate">
          ${getGovernorateOptions()}
        </select>
      </div>


      <div class="data-form-field">
        <label>المنطقة</label>

        <input
          type="text"
          id="newDataArea"
          placeholder="مثال: الحمدانية"
        >
      </div>

    `;

  }


  if (type === 'hospitals') {

    dataModalFields.innerHTML = `

      <div class="data-form-field full">
        <label>اسم المشفى</label>

        <input
          type="text"
          id="newDataName"
          placeholder="مثال: مشفى حلب الجامعي"
        >
      </div>


      <div class="data-form-field">
        <label>المحافظة</label>

        <select id="newDataGovernorate">
          ${getGovernorateOptions()}
        </select>
      </div>


      <div class="data-form-field">
        <label>المنطقة</label>

        <input
          type="text"
          id="newDataArea"
          placeholder="مثال: الجميلية"
        >
      </div>

    `;

  }


  if (type === 'areas') {

    dataModalFields.innerHTML = `

      <div class="data-form-field full">
        <label>اسم المنطقة</label>

        <input
          type="text"
          id="newDataName"
          placeholder="مثال: الحمدانية"
        >
      </div>


      <div class="data-form-field full">
        <label>المحافظة</label>

        <select id="newDataGovernorate">
          ${getGovernorateOptions()}
        </select>
      </div>

    `;

  }

}


function openDataModal() {

  const activeTab =
    document.querySelector('.data-tab.active');

  currentDataType =
    activeTab?.dataset.dataTab || 'doctors';


  const config =
    dataFormConfig[currentDataType];


  dataModalTitle.textContent =
    config.title;

  dataModalSubtitle.textContent =
    config.subtitle;

  dataModalError.textContent = '';


  renderDataForm(currentDataType);


  addDataModal.classList.add('active');


  setTimeout(() => {
    document
      .getElementById('newDataName')
      ?.focus();
  }, 0);

}


function closeDataForm() {

  addDataModal?.classList.remove('active');

}


function saveNewData() {

  const name =
    document
      .getElementById('newDataName')
      ?.value.trim();

  const governorate =
    document
      .getElementById('newDataGovernorate')
      ?.value;

  const area =
    document
      .getElementById('newDataArea')
      ?.value.trim();


  if (!name || !governorate) {

    dataModalError.textContent =
      'يرجى تعبئة الحقول المطلوبة';

    return;

  }


  if (currentDataType !== 'areas' && !area) {

    dataModalError.textContent =
      'يرجى اختيار المنطقة';

    return;

  }


  if (currentDataType === 'doctors') {

    const specialty =
      document
        .getElementById('newDoctorSpecialty')
        ?.value.trim();

    const grade =
      document
        .getElementById('newDoctorGrade')
        ?.value;


    if (!specialty || !grade) {

      dataModalError.textContent =
        'يرجى تعبئة الاختصاص والتصنيف';

      return;

    }


    addDoctorRow(
      name,
      specialty,
      governorate,
      area,
      grade
    );

  }


  if (currentDataType === 'pharmacies') {

    addEntityRow(
      'pharmacies',
      name,
      governorate,
      area
    );

  }


  if (currentDataType === 'hospitals') {

    addEntityRow(
      'hospitals',
      name,
      governorate,
      area
    );

  }


  if (currentDataType === 'areas') {

    addAreaRow(
      name,
      governorate
    );

  }


  updateDataTabCount(currentDataType);

  closeDataForm();

}


function addDoctorRow(
  name,
  specialty,
  governorate,
  area,
  grade
) {

  const panel =
    document.querySelector(
      '[data-data-panel="doctors"] .data-table'
    );

  if (!panel) return;


  const row =
    document.createElement('div');

  row.className =
    'data-table-row doctors-grid';


  row.innerHTML = `

    <strong>${name}</strong>

    <span>${specialty}</span>

    <span>${governorate}</span>

    <span>${area}</span>

    <span class="grade-badge grade-${grade.toLowerCase()}">
      ${grade}
    </span>

    <button class="row-action">
      •••
    </button>

  `;


  panel.appendChild(row);

}


function addEntityRow(
  type,
  name,
  governorate,
  area
) {

  const panel =
    document.querySelector(
      `[data-data-panel="${type}"] .data-table`
    );

  if (!panel) return;


  const row =
    document.createElement('div');

  row.className =
    'data-table-row entity-grid';


  row.innerHTML = `

    <strong>${name}</strong>

    <span>${governorate}</span>

    <span>${area}</span>

    <button class="row-action">
      •••
    </button>

  `;


  panel.appendChild(row);

}


function addAreaRow(
  name,
  governorate
) {

  const panel =
    document.querySelector(
      '[data-data-panel="areas"] .data-table'
    );

  if (!panel) return;


  const row =
    document.createElement('div');

  row.className =
    'data-table-row areas-grid';


  row.innerHTML = `

    <strong>${name}</strong>

    <span>${governorate}</span>

    <span>0 طبيب</span>

    <span>0 مندوب</span>

    <button class="row-action">
      •••
    </button>

  `;


  panel.appendChild(row);

}


function updateDataTabCount(type) {

  const tab =
    document.querySelector(
      `.data-tab[data-data-tab="${type}"]`
    );

  const count =
    tab?.querySelector('span');

  if (!count) return;


  const current =
    parseInt(count.textContent) || 0;

  count.textContent =
    current + 1;

}


addDataButton?.addEventListener(
  'click',
  openDataModal
);


closeDataModal?.addEventListener(
  'click',
  closeDataForm
);


cancelDataModal?.addEventListener(
  'click',
  closeDataForm
);


dataModalBackdrop?.addEventListener(
  'click',
  closeDataForm
);


saveDataButton?.addEventListener(
  'click',
  saveNewData
);