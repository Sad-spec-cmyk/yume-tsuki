(() => {
  if(document.body.dataset.page !== 'catalog') return;

  const panel = document.querySelector('#filterPanel');
  const toggle = document.querySelector('#filterToggle');
  const toggleText = document.querySelector('#filterToggleText');
  const filterCount = document.querySelector('#filterCount');
  const closeBtn = document.querySelector('#filterClose');
  const applyBtn = document.querySelector('#filterApply');
  const resetBtn = document.querySelector('#filterReset');
  const quickInput = document.querySelector('#catalogQuickSearch');
  const quickClear = document.querySelector('#catalogQuickClear');
  const genreBox = document.querySelector('#genreFilters');
  const typeBox = document.querySelector('#typeFilters');
  const sortBox = document.querySelector('#sortFilters');
  const yearBox = document.querySelector('#yearFilters');
  const activeFilters = document.querySelector('#activeFilters');

  if(!panel || !toggle) return;

  state.catalogFilters = {
    search: '',
    genres: [],
    types: [],
    yearMode: '',
    fromYear: '',
    toYear: '',
    ongoing: false,
    productionStatus: 'IS_IN_PRODUCTION',
    sorting: '2',
    labels: { genres: [], types: [], year: '', sorting: 'Сначала новые' }
  };

  let refreshTimer = null;
  let quickTimer = null;

  const arrayOf = value => Array.isArray(value) ? value : (value?.data || value?.items || []);
  const clean = value => String(value ?? '').trim();
  const itemValue = item => clean(item?.value ?? item?.id ?? item?.code);
  const itemLabel = item => clean(item?.label ?? item?.name ?? item?.description ?? item?.title ?? itemValue(item));
  const safeHtml = value => esc(value);

  function openPanel(){
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded','true');
    document.body.classList.add('filter-panel-open');
  }

  function closePanel(){
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded','false');
    document.body.classList.remove('filter-panel-open');
  }

  function checkboxHtml(name, value, label, checked=false){
    return `<label class="filter-choice"><input type="checkbox" name="${safeHtml(name)}" value="${safeHtml(value)}" ${checked?'checked':''}><span>${safeHtml(label)}</span></label>`;
  }

  function radioHtml(name, value, label, checked=false){
    return `<label class="filter-choice"><input type="radio" name="${safeHtml(name)}" value="${safeHtml(value)}" ${checked?'checked':''}><span>${safeHtml(label)}</span></label>`;
  }

  function renderYears(){
    const y = new Date().getFullYear();
    const rows = [
      ['ongoing','Онгоинг'],
      [`year:${y}`,String(y)],
      [`year:${y-1}`,String(y-1)],
      [`year:${y-2}`,String(y-2)],
      ['range:2015:2023','2015–2023'],
      ['range:2008:2014','2008–2014'],
      ['range:2000:2007','2000–2007'],
      ['range:1900:1999','до 2000']
    ];
    yearBox.innerHTML = radioHtml('catalogYear','', 'Все годы', true) + rows.map(([value,label]) => radioHtml('catalogYear',value,label)).join('');
  }

  function normalizeSortLabel(value, label){
    if(value === '1') return 'По популярности';
    if(value === '2') return 'Сначала новые';
    return label || `Сортировка ${value}`;
  }

  async function loadReferences(){
    const [genresResult, typesResult, sortingResult, productionResult] = await Promise.allSettled([
      libria('/anime/catalog/references/genres'),
      libria('/anime/catalog/references/types'),
      libria('/anime/catalog/references/sorting'),
      libria('/anime/catalog/references/production-statuses')
    ]);

    if(genresResult.status === 'fulfilled'){
      const genres = arrayOf(genresResult.value)
        .map(item => ({value:itemValue(item), label:itemLabel(item)}))
        .filter(item => item.value && item.label)
        .sort((a,b)=>a.label.localeCompare(b.label,'ru'));
      genreBox.innerHTML = genres.length
        ? genres.map(item => checkboxHtml('catalogGenre',item.value,item.label)).join('')
        : '<span class="filter-loading">Жанры не найдены.</span>';
    }else{
      genreBox.innerHTML = '<span class="filter-loading">Не удалось загрузить жанры.</span>';
    }

    if(typesResult.status === 'fulfilled'){
      const types = arrayOf(typesResult.value)
        .map(item => ({value:itemValue(item), label:itemLabel(item)}))
        .filter(item => item.value && item.label);
      typeBox.innerHTML = types.length
        ? types.map(item => checkboxHtml('catalogType',item.value,item.label)).join('')
        : '<span class="filter-loading">Типы не найдены.</span>';
    }else{
      typeBox.innerHTML = '<span class="filter-loading">Не удалось загрузить типы.</span>';
    }

    if(sortingResult.status === 'fulfilled'){
      const sorting = arrayOf(sortingResult.value)
        .map(item => ({value:itemValue(item), label:normalizeSortLabel(itemValue(item),itemLabel(item))}))
        .filter(item => item.value);
      if(sorting.length){
        sortBox.innerHTML = sorting.map((item,index)=>radioHtml('catalogSortRadio',item.value,item.label,item.value==='2' || (!sorting.some(x=>x.value==='2') && index===0))).join('');
        const selected = sortBox.querySelector('input:checked');
        if(selected) state.catalogFilters.sorting = selected.value;
      }
    }

    if(productionResult.status === 'fulfilled'){
      const statuses = arrayOf(productionResult.value);
      const active = statuses.find(item => {
        const value = itemValue(item).toLowerCase();
        const label = itemLabel(item).toLowerCase();
        return value.includes('production') || value.includes('ongoing') || label.includes('производ') || label.includes('онгоинг') || label.includes('выходит');
      });
      if(active) state.catalogFilters.productionStatus = itemValue(active);
    }
  }

  function readYear(value){
    const result = {yearMode:value, fromYear:'', toYear:'', ongoing:false};
    if(!value) return result;
    if(value === 'ongoing'){
      result.ongoing = true;
      return result;
    }
    if(value.startsWith('year:')){
      const year = value.split(':')[1];
      result.fromYear = year;
      result.toYear = year;
      return result;
    }
    if(value.startsWith('range:')){
      const [,from,to] = value.split(':');
      result.fromYear = from;
      result.toYear = to;
    }
    return result;
  }

  function selectedLabel(input){
    return input?.closest('.filter-choice')?.querySelector('span')?.textContent?.trim() || '';
  }

  function collectFilters(){
    const genres = [...document.querySelectorAll('input[name="catalogGenre"]:checked')];
    const types = [...document.querySelectorAll('input[name="catalogType"]:checked')];
    const yearInput = document.querySelector('input[name="catalogYear"]:checked');
    const sortInput = document.querySelector('input[name="catalogSortRadio"]:checked');
    const year = readYear(yearInput?.value || '');

    state.catalogFilters.genres = genres.map(x=>x.value);
    state.catalogFilters.types = types.map(x=>x.value);
    state.catalogFilters.yearMode = year.yearMode;
    state.catalogFilters.fromYear = year.fromYear;
    state.catalogFilters.toYear = year.toYear;
    state.catalogFilters.ongoing = year.ongoing;
    state.catalogFilters.sorting = sortInput?.value || '2';
    state.catalogFilters.labels = {
      genres: genres.map(selectedLabel).filter(Boolean),
      types: types.map(selectedLabel).filter(Boolean),
      year: yearInput?.value ? selectedLabel(yearInput) : '',
      sorting: selectedLabel(sortInput) || 'Сначала новые'
    };
  }

  function activeCount(){
    const f = state.catalogFilters;
    return f.genres.length + f.types.length + (f.yearMode ? 1 : 0) + (f.sorting !== '2' ? 1 : 0);
  }

  function renderActiveFilters(){
    const f = state.catalogFilters;
    const chips = [];
    if(f.search) chips.push(`<span class="active-filter-chip"><strong>Поиск:</strong> ${safeHtml(f.search)}</span>`);
    f.labels.genres.forEach(label => chips.push(`<span class="active-filter-chip"><strong>Жанр:</strong> ${safeHtml(label)}</span>`));
    f.labels.types.forEach(label => chips.push(`<span class="active-filter-chip"><strong>Тип:</strong> ${safeHtml(label)}</span>`));
    if(f.labels.year) chips.push(`<span class="active-filter-chip"><strong>Год:</strong> ${safeHtml(f.labels.year)}</span>`);
    if(f.sorting !== '2') chips.push(`<span class="active-filter-chip"><strong>Сортировка:</strong> ${safeHtml(f.labels.sorting)}</span>`);

    activeFilters.innerHTML = chips.join('') + (chips.length ? '<button id="activeFilterReset" class="active-filter-reset" type="button">Сбросить всё</button>' : '');
    activeFilters.classList.toggle('hidden', !chips.length);
    document.querySelector('#activeFilterReset')?.addEventListener('click', resetAll);

    const count = activeCount();
    filterCount.textContent = String(count);
    filterCount.classList.toggle('hidden', count === 0);
    toggleText.textContent = count ? `Категории: ${count}` : 'Выбрать категории';
  }

  function refreshCatalog(){
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if(state.loading){
        refreshCatalog();
        return;
      }
      state.done = false;
      state.page = 1;
      if(sentinel) sentinel.textContent = 'Загружаем дальше при прокрутке…';
      loadCatalogPage(true);
    }, 80);
  }

  const originalGetCatalog = getCatalog;
  getCatalog = async function({search='', sorting='FRESH_AT_DESC', limit=36, page=1}={}){
    const f = state.catalogFilters || {};
    const query = {page, limit};
    query['f[sorting]'] = f.sorting || (sorting === 'POPULARITY_DESC' ? '1' : '2');

    const text = clean(f.search || search);
    if(text) query['f[search]'] = text;
    if(f.genres?.length) query['f[genres]'] = f.genres.join(',');
    if(f.types?.length) query['f[types]'] = f.types.join(',');
    if(f.ongoing) query['f[production_statuses]'] = f.productionStatus || 'IS_IN_PRODUCTION';
    if(f.fromYear && f.toYear){
      if(f.fromYear === f.toYear) query['f[years]'] = f.fromYear;
      else{
        query['f[years][from_year]'] = f.fromYear;
        query['f[years][to_year]'] = f.toYear;
      }
    }

    try{
      const json = await libria('/anime/catalog/releases', query);
      const list = Array.isArray(json) ? json : (json?.data || json?.items || []);
      return list.map(normalizeSeries);
    }catch(error){
      console.warn('Расширенный фильтр не сработал, пробуем базовый каталог', error);
      return originalGetCatalog({search:text, sorting:query['f[sorting]']==='1'?'POPULARITY_DESC':'FRESH_AT_DESC', limit, page});
    }
  };

  function applyFilters(){
    collectFilters();
    renderActiveFilters();
    closePanel();
    refreshCatalog();
  }

  function resetPanelControls(){
    document.querySelectorAll('input[name="catalogGenre"],input[name="catalogType"]').forEach(input => input.checked=false);
    const allYears = document.querySelector('input[name="catalogYear"][value=""]');
    if(allYears) allYears.checked=true;
    const newest = document.querySelector('input[name="catalogSortRadio"][value="2"]') || document.querySelector('input[name="catalogSortRadio"]');
    if(newest) newest.checked=true;
  }

  function resetAll(){
    resetPanelControls();
    quickInput.value='';
    quickClear.classList.add('hidden');
    state.catalogFilters.search='';
    collectFilters();
    renderActiveFilters();
    closePanel();
    refreshCatalog();
  }

  toggle.addEventListener('click',()=>panel.classList.contains('hidden') ? openPanel() : closePanel());
  closeBtn?.addEventListener('click',closePanel);
  applyBtn?.addEventListener('click',applyFilters);
  resetBtn?.addEventListener('click',resetAll);

  quickInput?.addEventListener('input',()=>{
    const value = quickInput.value.trim();
    quickClear.classList.toggle('hidden',!value);
    clearTimeout(quickTimer);
    quickTimer = setTimeout(()=>{
      if(value && value.length < 2) return;
      state.catalogFilters.search=value;
      renderActiveFilters();
      refreshCatalog();
    },420);
  });

  quickClear?.addEventListener('click',()=>{
    quickInput.value='';
    quickClear.classList.add('hidden');
    state.catalogFilters.search='';
    renderActiveFilters();
    quickInput.focus();
    refreshCatalog();
  });

  document.addEventListener('click',event=>{
    if(panel.classList.contains('hidden')) return;
    if(panel.contains(event.target) || toggle.contains(event.target)) return;
    closePanel();
  });

  document.addEventListener('keydown',event=>{
    if(event.key === 'Escape' && !panel.classList.contains('hidden')) closePanel();
  });

  renderYears();
  renderActiveFilters();
  loadReferences().catch(console.error);
})();