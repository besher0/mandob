const pages = {
  dashboard: {
    title: 'الرئيسية',
    subtitle: 'نظرة عامة على المنصة'
  },

  companies: {
    title: 'الشركات',
    subtitle: 'إنشاء وإدارة الشركات الموجودة على المنصة'
  },

  'company-setup': {
  title: 'إنشاء شركة',
  subtitle: 'إعداد هوية ومنظومة الشركة'
},

  admins: {
    title: 'المديرون والصلاحيات',
    subtitle: 'إدارة الوصول والصلاحيات على مستوى الشركات'
  },

  settings: {
    title: 'إعدادات المنصة',
    subtitle: 'الإعدادات العامة الخاصة بالمنصة'
  }
};


function openPage(pageId) {
  if (!pages[pageId]) return;

  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });

  document.querySelectorAll('.nav-item').forEach(item => {
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


const newCompanyButton =
  document.getElementById('newCompanyButton');

const emptyNewCompanyButton =
  document.getElementById('emptyNewCompanyButton');


let currentSetupStep = 1;


function handleNewCompany() {
  currentSetupStep = 1;

  resetCompanySetup();
  renderSetupStep();

  openPage('company-setup');
}


function renderSetupStep() {
  document.querySelectorAll('.setup-panel').forEach(panel => {
    panel.classList.toggle(
      'active',
      Number(panel.dataset.panel) === currentSetupStep
    );
  });

  document.querySelectorAll('.setup-step').forEach(step => {
    const stepNumber = Number(step.dataset.step);

    step.classList.toggle(
      'active',
      stepNumber === currentSetupStep
    );

    step.classList.toggle(
      'completed',
      stepNumber < currentSetupStep
    );
  });

  const previousButton =
    document.getElementById('previousSetupStep');

  const nextButton =
    document.getElementById('nextSetupStep');

  previousButton.disabled =
    currentSetupStep === 1;

  nextButton.textContent =
    currentSetupStep === 4
      ? 'إنشاء الشركة'
      : 'التالي';
}


function resetCompanySetup() {
  document.getElementById('companyName').value = '';
  document.getElementById('companyCode').value = '';
  document.getElementById('companyStatus').value = 'active';

  document.getElementById('adminName').value = '';
  document.getElementById('adminUsername').value = '';
  document.getElementById('adminPassword').value = '';

  document.getElementById('primaryColor').value =
    '#1d9279';

  document.getElementById('primaryColorText').value =
    '#1D9279';

  document.getElementById('secondaryColor').value =
    '#062c40';

  document.getElementById('secondaryColorText').value =
    '#062C40';

  const defaultStructure =
    document.querySelector(
      'input[name="companyStructure"][value="teams"]'
    );

  if (defaultStructure) {
    defaultStructure.checked = true;
  }

  updateStructureSelection();
  updateCompanyPreview();
}


function updateStructureSelection() {
  document.querySelectorAll('.structure-card').forEach(card => {
    const input = card.querySelector(
      'input[name="companyStructure"]'
    );

    card.classList.toggle(
      'selected',
      input.checked
    );
  });
}


function updateCompanyPreview() {
  const name =
    document.getElementById('companyName').value.trim();

  const primary =
    document.getElementById('primaryColor').value;

  const displayName =
    name || 'اسم الشركة';

  const firstLetter =
    name
      ? name.charAt(0).toUpperCase()
      : 'C';

  document.getElementById(
    'previewCompanyName'
  ).textContent = displayName;

  document.getElementById(
    'previewLogo'
  ).textContent = firstLetter;

  document.getElementById(
    'companyLogoPreview'
  ).textContent = firstLetter;

  document.getElementById(
    'previewLogo'
  ).style.background = primary;

  document.querySelector(
    '.company-preview'
  ).style.setProperty(
    '--company-primary',
    primary
  );
}


function validateSetupStep() {
  if (currentSetupStep === 1) {
    const companyName =
      document.getElementById('companyName').value.trim();

    if (!companyName) {
      document.getElementById('companyName').focus();
      return false;
    }
  }

  return true;
}


document.getElementById(
  'nextSetupStep'
)?.addEventListener('click', () => {

  if (!validateSetupStep()) return;

  if (currentSetupStep < 4) {
    currentSetupStep++;
    renderSetupStep();
    return;
  }

  console.log('جاهز للربط مع Backend');
});


document.getElementById(
  'previousSetupStep'
)?.addEventListener('click', () => {

  if (currentSetupStep <= 1) return;

  currentSetupStep--;
  renderSetupStep();
});


document.getElementById(
  'backToCompanies'
)?.addEventListener('click', () => {
  openPage('companies');
});


document.getElementById(
  'cancelCompanySetup'
)?.addEventListener('click', () => {
  openPage('companies');
});


document.getElementById(
  'companyName'
)?.addEventListener(
  'input',
  updateCompanyPreview
);


document.querySelectorAll(
  'input[name="companyStructure"]'
).forEach(input => {

  input.addEventListener('change', () => {
    updateStructureSelection();
  });
});


const primaryColor =
  document.getElementById('primaryColor');

const primaryColorText =
  document.getElementById('primaryColorText');


primaryColor?.addEventListener('input', () => {
  primaryColorText.value =
    primaryColor.value.toUpperCase();

  updateCompanyPreview();
});


primaryColorText?.addEventListener('input', () => {
  const value =
    primaryColorText.value.trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    primaryColor.value = value;

    updateCompanyPreview();
  }
});


const secondaryColor =
  document.getElementById('secondaryColor');

const secondaryColorText =
  document.getElementById('secondaryColorText');


secondaryColor?.addEventListener('input', () => {
  secondaryColorText.value =
    secondaryColor.value.toUpperCase();
});


secondaryColorText?.addEventListener('input', () => {
  const value =
    secondaryColorText.value.trim();

  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    secondaryColor.value = value;
  }
});


newCompanyButton?.addEventListener(
  'click',
  handleNewCompany
);

emptyNewCompanyButton?.addEventListener(
  'click',
  handleNewCompany
);