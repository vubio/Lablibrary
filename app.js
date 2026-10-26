import {
  REPOSITORY,DATA_PATH,DEFAULT_COLUMNS,AUTO_COLUMNS,emptyDatabase,normalizeDatabase,
  makeId,keyFor,recentFirst,groupItems,fieldOrder,displayValue,formatTime,
  addColumn,mergeDatabases,importRows,toCsv,saveCheckoutRecord,toggleGroupSelection,toggleVersionSelection,differingVersionColumns
} from './model.js';

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOCAL_KEY='vubio-lablibrary-local-v1',TOKEN_KEY='vubio-lablibrary-token-session';
const API=`https://api.github.com/repos/${REPOSITORY}/contents/${DATA_PATH}`;
const state={db:emptyDatabase(),baseDb:emptyDatabase(),baseSha:null,dirty:false,revision:0,token:sessionStorage.getItem(TOKEN_KEY)||'',busy:false,networkError:'',currentPage:'library',selected:new Set(),expanded:new Set(),checkoutExpanded:new Set(),checkoutCategory:'',activeCheckoutId:null,checkoutPrefs:null,editingId:null,cloning:false,fieldDraft:{},syncTimer:null,toastTimer:null};

function toast(message,error=false){const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.classList.remove('hidden');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.add('hidden'),3600);}
function setNotice(message='',danger=false){$('notice').textContent=message;$('notice').classList.toggle('hidden',!message);$('notice').classList.toggle('danger',danger);}
function getLocal(){try{return JSON.parse(localStorage.getItem(LOCAL_KEY)||'null');}catch{return null;}}
function persistLocal(){try{localStorage.setItem(LOCAL_KEY,JSON.stringify({db:state.db,baseDb:state.baseDb,baseSha:state.baseSha,dirty:state.dirty}));}catch{setNotice('Browser storage is full or unavailable. Export a JSON backup to avoid losing edits.',true);}}
function changed(){state.dirty=true;state.revision++;persistLocal();render();refreshSyncStatus();if(state.token){clearTimeout(state.syncTimer);state.syncTimer=setTimeout(()=>syncNow(),7000);}}
function refreshSyncStatus(){
  const dot=$('syncDot');dot.className='sync-dot';
  let label,detail;
  if(state.busy){label='Syncing with GitHub…';detail='Uploading shared records';}
  else if(state.networkError){label='GitHub sync needs attention';detail='Your unsynced edits remain on this device';dot.classList.add('error');}
  else if(state.dirty){label=state.token?'Changes waiting to upload':'Local changes only';detail=state.token?'GitHub sync is queued':'Not yet available on other computers';}
  else if(state.token){label='Library loaded from GitHub';detail='Shared data available anywhere • write access checked on upload';dot.classList.add('ok');}
  else{label='Viewing GitHub library';detail='Shared data loads anywhere • connect to publish edits';dot.classList.add('ok');}
  $('syncLabel').textContent=label;$('syncDetail').textContent=detail;
  $('saveBtn').textContent=state.busy?'↻ Saving…':state.dirty?'↻ Upload changes':'↻ Sync with GitHub';$('saveBtn').disabled=state.busy;
  const needsTokenHelp=!!state.networkError && /(?:GitHub 403|GitHub 401|token|permission|forbidden)/i.test(state.networkError);
  $('syncGuide').classList.toggle('hidden',!!state.token&&!needsTokenHelp);
  $('syncGuideText').textContent=needsTokenHelp
    ? 'Your token was rejected. Check that it targets vubio/Lablibrary with Contents: Read and write, then replace it here. Local changes are preserved.'
    : state.dirty
    ? 'These changes are saved only in this browser. Connect GitHub to make them accessible on your lab PC.'
    : 'The library loads from GitHub anywhere. To save new items or experiment plans across computers, connect GitHub.';
  $('syncGuideConnect').textContent=needsTokenHelp?'Replace GitHub token →':'Enable GitHub saving →';
}

function safeCategories(){return [...new Set([...state.db.categories,...state.db.items.map(x=>x.category)])].filter(Boolean);}
function countCategories(){return new Set(state.db.items.map(x=>x.category)).size;}
function allGroups(){return groupItems(state.db.items);}

function render(){renderStats();renderCategories();renderLibrary();renderPicker();renderCheckout();renderSavedPlans();refreshSyncStatus();}
function renderStats(){const groups=allGroups();$('statItems').textContent=groups.length;$('statCategories').textContent=countCategories();$('statVersions').textContent=Math.max(0,state.db.items.length-groups.length);$('libraryCount').textContent=groups.length;$('checkoutCount').textContent=state.selected.size;}
function renderCategories(){
  const categories=safeCategories(),counts=new Map();
  for(const g of allGroups())counts.set(g.latest.category,(counts.get(g.latest.category)||0)+1);
  const active=state.currentPage==='checkout'?state.checkoutCategory:$('libraryCategory').value;
  $('categoryNav').innerHTML=`<button class="category-link ${!active?'active':''}" data-filter-category=""><span></span><span>All materials</span><small>${allGroups().length}</small></button>`+
    categories.filter(c=>counts.get(c)).sort((a,b)=>a.localeCompare(b)).map(c=>`<button class="category-link ${active===c?'active':''}" data-filter-category="${esc(c)}"><span></span><span>${esc(c)}</span><small>${counts.get(c)}</small></button>`).join('');
  const select=$('libraryCategory'),value=select.value;
  select.innerHTML='<option value="">All categories</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value=value;
}
function renderCheckoutCategories(){
  const counts=new Map();
  for(const g of allGroups())counts.set(g.latest.category,(counts.get(g.latest.category)||0)+1);
  const categories=[...counts.keys()].sort((a,b)=>a.localeCompare(b));
  $('checkoutCategoryChips').innerHTML=
    `<button type="button" class="checkout-filter-chip ${state.checkoutCategory===''?'active':''}" data-quick-category="">All <span>${allGroups().length}</span></button>`+
    categories.map(c=>`<button type="button" class="checkout-filter-chip ${state.checkoutCategory===c?'active':''}" data-quick-category="${esc(c)}">${esc(c)} <span>${counts.get(c)}</span></button>`).join('');
}
function checkoutPreferences(){return state.checkoutPrefs||state.db.preferences;}
function ensureCheckoutPreferences(){
  if(!state.checkoutPrefs)state.checkoutPrefs=structuredClone(state.db.preferences);
  return state.checkoutPrefs;
}

function renderLibrary(){
  const term=$('librarySearch').value.trim().toLocaleLowerCase(),category=$('libraryCategory').value;
  const matches=allGroups().filter(g=>g.items.some(it=>(!category||it.category===category)&&(!term||[it.name,it.category,...Object.values(it.values||{})].some(x=>String(x).toLocaleLowerCase().includes(term)))));
  const cols=[AUTO_COLUMNS[0],AUTO_COLUMNS[1],...(category?fieldOrder(state.db,category):state.db.columns),AUTO_COLUMNS[2]];
  const table=$('libraryTable');table.querySelector('thead').innerHTML=`<tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}<th>Actions</th></tr>`;
  table.querySelector('tbody').innerHTML=matches.map(g=>{
    const chosen=g.items.find(it=>(!category||it.category===category)&&(!term||[it.name,it.category,...Object.values(it.values||{})].some(x=>String(x).toLocaleLowerCase().includes(term))))||g.latest;
    const latest=g.latest;const expanded=state.expanded.has(g.key);const multi=g.items.length>1;
    let body=renderLibraryRow(latest,cols,multi?g.key:null,false,expanded);
    if(expanded)body+=g.items.slice(1).map(it=>renderLibraryRow(it,cols,null,true,false)).join('');
    return body;
  }).join('');
  const noRecords=state.db.items.length===0;$('emptyLibrary').classList.toggle('hidden',!noRecords);table.classList.toggle('hidden',noRecords);
  $('libraryFootnote').textContent=`Showing ${matches.length} unique item${matches.length===1?'':'s'} · ${state.db.items.length} total records`;
}
function renderLibraryRow(item,cols,groupKey,isOld,expanded){
  return `<tr class="${isOld?'version-row':''}" data-row-id="${esc(item.id)}">${cols.map(col=>{
    const id=col.id;
    if(id==='name')return `<td class="name-cell"><div class="table-name">${groupKey?`<button class="versions-toggle" data-expand="${esc(groupKey)}" aria-label="${expanded?'Hide':'Show'} previous versions">${expanded?'⌄':'›'}</button>`:'<span class="name-spacer"></span>'}<span class="editable-cell" data-edit="name" data-id="${esc(item.id)}">${esc(item.name)}</span>${groupKey?`<span class="version-badge">${groupItems(state.db.items).find(g=>g.key===groupKey)?.items.length||0} versions</span>`:isOld?'<span class="version-badge">Earlier</span>':''}</div></td>`;
    return `<td class="${id==='category'?'category-cell':''} ${id==='enteredAt'?'':'editable-cell'}" ${id==='enteredAt'?'':`data-edit="${esc(id)}" data-id="${esc(item.id)}" title="Click to edit"`}>${esc(displayValue(item,id))||'<span style="color:#c6d2cb">—</span>'}</td>`;
  }).join('')}<td><div class="row-actions"><button class="row-icon-btn" data-edit-item="${esc(item.id)}">Edit</button><button class="row-icon-btn" data-copy-version="${esc(item.id)}">＋ Version</button></div></td></tr>`;
}
function renderPicker(){
  const term=$('checkoutSearch').value.trim().toLowerCase(),category=state.checkoutCategory;
  renderCheckoutCategories();
  const matches=allGroups().filter(g=>g.items.some(it=>(!category||it.category===category)&&(!term||[it.name,it.category,...Object.values(it.values||{})].some(v=>String(v).toLowerCase().includes(term)))));
  $('pickerList').innerHTML=matches.map(g=>{
    const selectedCount=g.items.filter(it=>state.selected.has(it.id)).length;
    const checked=selectedCount>0,hasOld=g.items.length>1,expanded=state.checkoutExpanded.has(g.key);
    return `<div class="picker-group">
      <div class="picker-head">
        <input type="checkbox" data-check-group="${esc(g.key)}" ${checked?'checked':''} aria-label="${checked?'Remove all selected versions of':'Select newest version of'} ${esc(g.latest.name)}" title="${checked?'Uncheck to remove every selected version':'Select newest version'}" />
        <div class="picker-title">
          <div class="picker-name-line"><span>${esc(g.latest.name)}</span>${hasOld?`<button class="picker-compare-btn" type="button" data-compare-group="${esc(g.key)}" aria-label="Compare ${esc(g.latest.name)} versions" title="Show only fields that differ between versions">⇄ Compare</button>`:''}</div>
          <div class="picker-sub">${esc(g.latest.category)}${hasOld?` · ${g.items.length} versions`:''}${selectedCount?` · ${selectedCount} selected`:''}</div>
        </div>
        <div class="picker-actions">
          <button class="picker-action-btn" type="button" data-edit-picker="${esc(g.latest.id)}" aria-label="Edit ${esc(g.latest.name)} latest version">Edit</button>
          <button class="picker-action-btn" type="button" data-copy-picker="${esc(g.latest.id)}" aria-label="Create a new version of ${esc(g.latest.name)}">＋ Version</button>
        </div>
        ${hasOld?`<button class="toggle-link" type="button" data-toggle-picker="${esc(g.key)}" aria-label="${expanded?'Hide':'Show'} versions of ${esc(g.latest.name)}" aria-expanded="${expanded}">${expanded?'⌄':'›'}</button>`:''}
      </div>
      ${expanded&&hasOld?`<div class="picker-versions">${g.items.map((it,index)=>{
        const detail=[it.values?.cellLineCode,it.values?.lotNumber?`Lot ${it.values.lotNumber}`:'',it.values?.workingConcentration].filter(Boolean).join(' · ');
        return `<div class="version-entry">
          <label class="version-choice">
            <input type="checkbox" data-choose-version="${esc(g.key)}" value="${esc(it.id)}" ${state.selected.has(it.id)?'checked':''} aria-label="Select ${esc(it.name)} ${index===0?'newest':'earlier'} version ${esc(detail)}" />
            <span>${index===0?'Newest':'Earlier'} · ${esc(formatTime(it.enteredAt))}</span>
            ${detail?`<small title="${esc(detail)}">${esc(detail)}</small>`:''}
          </label>
          <button type="button" class="picker-version-edit" data-edit-picker="${esc(it.id)}" aria-label="Edit this version of ${esc(it.name)}">Edit</button>
        </div>`;
      }).join('')}</div>`:''}
    </div>`;
  }).join('')||'<div class="empty-preview"><p>No matching items.</p></div>';
}
function openCompareDialog(groupKey){
  const group=allGroups().find(g=>g.key===groupKey);
  if(!group||group.items.length<2)return;
  const differing=differingVersionColumns(state.db,group.items);
  $('compareDialogTitle').textContent='Compare · '+group.latest.name;
  $('compareSummary').textContent=group.items.length+' versions · '+differing.length+
    ' different field'+(differing.length===1?'':'s')+' (entry dates are shown only to identify versions)';
  if(!differing.length){
    $('compareContent').innerHTML='<div class="compare-identical">No differences in saved fields across these versions. Only their entry dates or record IDs differ.</div>';
  }else{
    $('compareContent').innerHTML=`<div class="compare-scroll"><table class="compare-table">
      <thead><tr><th scope="col">Version</th>${differing.map(col=>`<th scope="col">${esc(col.label)}</th>`).join('')}</tr></thead>
      <tbody>${group.items.map((it,index)=>`<tr>
        <th scope="row"><strong>${index===0?'Newest':`Earlier ${index}`}</strong><small>${esc(formatTime(it.enteredAt))}</small></th>
        ${differing.map(col=>{
          const value=displayValue(it,col.id);
          return `<td>${value.trim()?esc(value):'<span class="compare-empty">—</span>'}</td>`;
        }).join('')}
      </tr>`).join('')}</tbody></table></div>`;
  }
  openModal('compareDialog');
}
function selectedItems(){return [...state.selected].map(id=>state.db.items.find(it=>it.id===id)).filter(Boolean);}
function orderedCategories(categories){const preferred=checkoutPreferences().categoryOrder;return [...categories].sort((a,b)=>{const ia=preferred.indexOf(a),ib=preferred.indexOf(b);return (ia<0?999:ia)-(ib<0?999:ib)||a.localeCompare(b);});}
function orderedItems(items,category){const preferred=checkoutPreferences().itemOrder[category]||[];return [...items].sort((a,b)=>{const ia=preferred.indexOf(a.id),ib=preferred.indexOf(b.id);return (ia<0?999:ia)-(ib<0?999:ib)||a.name.localeCompare(b.name);});}
function checkoutColumns(items){const cols=[AUTO_COLUMNS[0],...state.db.columns,AUTO_COLUMNS[2]];return cols.filter(c=>c.id==='name'||c.id==='enteredAt'||items.some(it=>String(displayValue(it,c.id)||'').trim()));}
function renderCheckout(){
  const items=selectedItems(),byCategory=new Map();for(const it of items){if(!byCategory.has(it.category))byCategory.set(it.category,[]);byCategory.get(it.category).push(it);}
  $('previewCount').textContent=`${items.length} selected`;$('checkoutCount').textContent=items.length;
  $('copyCheckout').disabled=$('copyBottom').disabled=!items.length;
  if(!items.length){$('checkoutPreview').innerHTML='<div class="empty-preview"><span>☑</span><h3>Nothing selected yet</h3><p>Tick materials on the left to build your experiment record.</p></div>';return;}
  $('checkoutPreview').innerHTML=orderedCategories([...byCategory.keys()]).map(category=>{
    const rows=orderedItems(byCategory.get(category),category),allCols=checkoutColumns(rows),excluded=checkoutPreferences().excludedColumns[category]||[];
    const visible=allCols.filter(c=>!excluded.includes(c.id));
    return `<section class="checkout-card" data-category="${esc(category)}"><div class="checkout-card-head"><button class="drag-handle" draggable="true" data-drag-category="${esc(category)}" title="Drag to reorder tables">≡</button><span class="checkout-card-title">${esc(category)}</span><span class="checkout-card-subtitle">${rows.length} item${rows.length>1?'s':''}</span></div><div class="field-chips">${allCols.map(c=>`<label class="field-chip"><input type="checkbox" data-column-category="${esc(category)}" data-column-id="${esc(c.id)}" ${excluded.includes(c.id)?'':'checked'} />${esc(c.label)}</label>`).join('')}</div><div class="export-scroll"><table class="export-table"><thead><tr><th class="item-handle"></th>${visible.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(it=>`<tr data-preview-row="${esc(it.id)}"><td class="item-handle"><div class="preview-row-controls"><button class="drag-handle" draggable="true" data-drag-item="${esc(it.id)}" data-drag-item-category="${esc(category)}" title="Drag to reorder items" aria-label="Move ${esc(it.name)}">≡</button><button class="preview-remove-item" type="button" data-remove-preview="${esc(it.id)}" title="Remove ${esc(it.name)} from this checkout" aria-label="Remove ${esc(it.name)} from preview">×</button></div></td>${visible.map(c=>`<td contenteditable="true" spellcheck="false" title="Edit only this checkout copy">${esc(displayValue(it,c.id))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }).join('');
}

function defaultPlanName(){return 'Experiment — '+new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date());}
function renderSavedPlans(){
  const plans=[...state.db.checkouts].sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
  $('savedCount').textContent=plans.length;
  $('saveCheckoutPlan').disabled=!state.selected.size;
  const activePlan=state.db.checkouts.find(c=>c.id===state.activeCheckoutId);
  $('updateCheckoutPlan').classList.toggle('hidden',!activePlan);
  $('updateCheckoutPlan').disabled=!activePlan||!state.selected.size;
  $('clearEverything').disabled=!state.selected.size&&!state.activeCheckoutId;
  $('savedPlanList').innerHTML=plans.length?plans.map(plan=>{
    const valid=plan.selectedIds.filter(id=>state.db.items.some(item=>item.id===id)).length;
    return `<div class="saved-plan ${state.activeCheckoutId===plan.id?'open':''}">
      <div class="saved-plan-info"><strong>${esc(plan.name)}</strong><span>${valid} item${valid===1?'':'s'} · Saved ${esc(formatTime(plan.updatedAt))}</span></div>
      <button class="button subtle small" data-open-plan="${esc(plan.id)}" type="button">${state.activeCheckoutId===plan.id?'Reload':'Open'}</button>
      <button class="saved-plan-delete" data-delete-plan="${esc(plan.id)}" title="Delete saved plan" type="button" aria-label="Delete ${esc(plan.name)}">✕</button>
    </div>`;
  }).join(''):'<span class="saved-empty">No saved experiments yet. Select materials and click Save checkout.</span>';
}
function checkoutPlanDraft(){
  const preference=checkoutPreferences();
  return {
    name:$('planName').value.trim()||defaultPlanName(),
    selectedIds:selectedItems().map(item=>item.id),
    categoryOrder:[...preference.categoryOrder],
    itemOrder:preference.itemOrder,
    excludedColumns:preference.excludedColumns
  };
}
function saveCheckoutPlan(){
  if(!state.selected.size){toast('Select some materials before saving this experiment.',true);return;}
  const saved=saveCheckoutRecord(state.db,checkoutPlanDraft(),{mode:'new'});
  state.activeCheckoutId=saved.id;$('planName').value=saved.name;changed();
  toast(state.token?'New experiment saved; GitHub sync queued.':'New experiment saved on this device. Connect GitHub to share it.');
}
function updateCheckoutPlan(){
  if(!state.selected.size){toast('Select some materials before updating this experiment.',true);return;}
  const active=state.db.checkouts.find(c=>c.id===state.activeCheckoutId);
  if(!active){toast('Open a saved experiment first, or use Save as new.',true);return;}
  const saved=saveCheckoutRecord(state.db,checkoutPlanDraft(),{mode:'update',activeId:active.id});
  $('planName').value=saved.name;changed();
  toast(state.token?'Saved experiment updated; GitHub sync queued.':'Saved experiment updated on this device. Connect GitHub to share it.');
}
function clearEverything(){
  state.selected.clear();state.checkoutExpanded.clear();state.checkoutCategory='';
  state.checkoutPrefs=null;state.activeCheckoutId=null;
  $('checkoutSearch').value='';$('planName').value=defaultPlanName();
  render();toast('Checkout cleared. Saved experiments remain available.');
}
function loadCheckoutPlan(id){
  const plan=state.db.checkouts.find(c=>c.id===id);if(!plan)return;
  state.selected=new Set(plan.selectedIds.filter(id=>!!itemById(id)));
  state.checkoutExpanded=new Set([...state.selected].map(id=>keyFor(itemById(id).name)));
  state.checkoutPrefs={categoryOrder:[...plan.categoryOrder],itemOrder:structuredClone(plan.itemOrder),
    excludedColumns:structuredClone(plan.excludedColumns)};
  state.checkoutCategory='';state.activeCheckoutId=id;
  $('checkoutSearch').value='';$('planName').value=plan.name;render();
  toast('Saved checkout loaded. Use Update opened to change it, or Save as new to keep another copy.');
}
function deleteCheckoutPlan(id){
  const plan=state.db.checkouts.find(c=>c.id===id);if(!plan)return;
  if(!window.confirm(`Delete saved checkout “${plan.name}”? Your original library items will not be deleted.`))return;
  state.db.checkouts=state.db.checkouts.filter(c=>c.id!==id);
  if(state.activeCheckoutId===id)state.activeCheckoutId=null;
  changed();toast('Saved checkout deleted; library items kept.');
}

function showPage(page){state.currentPage=page;$('libraryScreen').classList.toggle('hidden',page!=='library');$('checkoutScreen').classList.toggle('hidden',page!=='checkout');$('navLibrary').classList.toggle('active',page==='library');$('navCheckout').classList.toggle('active',page==='checkout');$('currentPage').textContent=page==='library'?'LIBRARY':'EXPERIMENT CHECKOUT';if(page==='checkout'){renderCheckout();renderSavedPlans();}renderCategories();}
function openModal(id){$(id).showModal();}
function closeModal(id){$(id).close();}
function itemById(id){return state.db.items.find(x=>x.id===id);}
function collectFields(){const values={...state.fieldDraft};$('itemFields').querySelectorAll('[data-form-col]').forEach(input=>{values[input.dataset.formCol]=input.value;});return values;}
function renderItemFields(){
  const category=$('itemCategory').value.trim(),cols=fieldOrder(state.db,category),existing=state.db.items.filter(it=>it.category.toLowerCase()===category.toLowerCase());
  $('smartHint').textContent=existing.length?`${existing.length} earlier entr${existing.length===1?'y':'ies'} · frequently used fields first`:'All fields available for this new category';
  $('itemFields').innerHTML=cols.map(col=>{
    const value=state.fieldDraft[col.id]||'';
    const suggestions=[...new Set(existing.map(it=>it.values?.[col.id]).filter(Boolean))].slice(-15);
    return `<label class="form-field"><span>${esc(col.label)}</span><input data-form-col="${esc(col.id)}" value="${esc(value)}" list="suggest_${esc(col.id)}" autocomplete="off" placeholder="${suggestions.length?'Reuse or enter…':'Optional'}" /><datalist id="suggest_${esc(col.id)}">${suggestions.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist></label>`;
  }).join('');
}
function warningForName(){
  const name=$('itemName').value.trim(),match=allGroups().find(g=>g.key===keyFor(name));
  const warning=$('versionWarning');
  if(!state.editingId&&!state.cloning&&match){warning.classList.remove('hidden');warning.innerHTML=`A record named <strong>${esc(match.latest.name)}</strong> exists (${match.items.length} version${match.items.length>1?'s':''}). Saving this name will create a new version.`;}
  else warning.classList.add('hidden');
}
function openItemDialog(item=null,clone=false,presetCategory=''){
  state.editingId=item&&!clone?item.id:null;state.cloning=!!clone;state.fieldDraft={...(item?.values||{})};
  $('itemDialogTitle').textContent=clone?'New version of item':item?'Edit research item':'New research item';
  $('submitItem').textContent=clone?'Create version':item?'Save changes':'Save item';
  $('itemName').value=item?.name||'';$('itemCategory').value=item?.category||presetCategory;
  $('categorySuggestions').innerHTML=safeCategories().map(c=>`<option value="${esc(c)}"></option>`).join('');
  renderItemFields();warningForName();openModal('itemDialog');if(!item)$('itemName').focus();
}
function submitItem(event){
  event.preventDefault();const name=$('itemName').value.trim(),category=$('itemCategory').value.trim();if(!name||!category){toast('Name and category are required.',true);return;}
  const values={};for(const [key,value] of Object.entries(collectFields()))if(String(value||'').trim())values[key]=String(value).trim();
  if(!state.editingId&&!state.cloning&&state.db.items.some(it=>keyFor(it.name)===keyFor(name))&&!window.confirm(`“${name}” already exists. Create a new version with this same name?`))return;
  if(!state.db.categories.includes(category))state.db.categories.push(category);
  if(state.editingId){const item=itemById(state.editingId);if(item){item.name=name;item.category=category;item.values=values;item.updatedAt=new Date().toISOString();}}
  else {const stamp=new Date().toISOString();state.db.items.push({id:makeId(),name,category,values,enteredAt:stamp,updatedAt:stamp});}
  closeModal('itemDialog');changed();toast(state.editingId?'Item updated.':'Item version saved.');
}
function inlineEdit(el){
  if(el.querySelector('input'))return;
  const id=el.dataset.id,column=el.dataset.edit,item=itemById(id);if(!item)return;
  const current=column==='name'?item.name:column==='category'?item.category:String(item.values[column]||'');
  const input=document.createElement('input');input.className='inline-cell';input.value=current;el.replaceChildren(input);input.focus();input.select();
  let finished=false;
  const finish=save=>{if(finished)return;finished=true;const next=input.value.trim();if(save&&next!==current){if((column==='name'||column==='category')&&!next){toast('Name and category cannot be empty.',true);}else{if(column==='name')item.name=next;else if(column==='category'){item.category=next;if(!state.db.categories.includes(next))state.db.categories.push(next);}else if(next)item.values[column]=next;else delete item.values[column];item.updatedAt=new Date().toISOString();changed();return;}}renderLibrary();};
  input.addEventListener('blur',()=>finish(true),{once:true});input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();finish(true);}if(event.key==='Escape'){event.preventDefault();finish(false);}});
}

function refreshSelection(){
  renderStats();renderPicker();renderCheckout();renderSavedPlans();
}
function setGroupSelection(key,checked){
  const group=allGroups().find(g=>g.key===key);
  if(!group)return;
  state.selected=toggleGroupSelection(state.selected,group.items.map(it=>it.id),checked);
  if(checked)state.checkoutExpanded.add(key);
  refreshSelection();
}
function setVersionSelection(id,checked){
  const item=itemById(id);if(!item)return;
  state.selected=toggleVersionSelection(state.selected,id,checked);
  state.checkoutExpanded.add(keyFor(item.name));
  refreshSelection();
}
function applyColumnChoice(category,id,checked){
  const set=new Set(checkoutPreferences().excludedColumns[category]||[]);
  if(checked)set.delete(id);else set.add(id);
  if(state.checkoutPrefs){state.checkoutPrefs.excludedColumns[category]=[...set];renderCheckout();}
  else{state.db.preferences.excludedColumns[category]=[...set];changed();}
}

// Drag-and-drop order lives with category preferences, not on the underlying inventory rows.
let dragging=null;
function onDragStart(event){
  const handle=event.target.closest('[data-drag-category],[data-drag-item]');if(!handle)return;
  dragging=handle.dataset.dragCategory?{kind:'category',id:handle.dataset.dragCategory}:{kind:'item',id:handle.dataset.dragItem,category:handle.dataset.dragItemCategory};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragging.id);
  handle.closest('.checkout-card,[data-preview-row]')?.classList.add('dragging');
}
function onDragOver(event){if(dragging&&event.target.closest('.checkout-card,[data-preview-row]'))event.preventDefault();}
function onDrop(event){if(!dragging)return;event.preventDefault();
  if(dragging.kind==='category'){
    const card=event.target.closest('.checkout-card');const target=card?.dataset.category;
    if(target&&target!==dragging.id){const present=orderedCategories([...new Set(selectedItems().map(it=>it.category))]);const from=present.indexOf(dragging.id),to=present.indexOf(target);present.splice(from,1);present.splice(to,0,dragging.id);if(state.checkoutPrefs){state.checkoutPrefs.categoryOrder=present;renderCheckout();}else{state.db.preferences.categoryOrder=present;changed();}}
  }else{
    const row=event.target.closest('[data-preview-row]');const target=row?.dataset.previewRow;
    const members=orderedItems(selectedItems().filter(it=>it.category===dragging.category),dragging.category).map(it=>it.id);
    if(target&&members.includes(target)&&target!==dragging.id){members.splice(members.indexOf(dragging.id),1);members.splice(members.indexOf(target),0,dragging.id);if(state.checkoutPrefs){state.checkoutPrefs.itemOrder[dragging.category]=members;renderCheckout();}else{state.db.preferences.itemOrder[dragging.category]=members;changed();}}
  }
  dragging=null;
}
function onDragEnd(){dragging=null;document.querySelectorAll('.dragging').forEach(el=>el.classList.remove('dragging'));}

function cleanCheckoutHtml(){
  const cards=[...document.querySelectorAll('#checkoutPreview .checkout-card')];const htmlParts=[],plainParts=[];
  for(const card of cards){
    const category=card.dataset.category,table=card.querySelector('.export-table');if(!table)continue;
    const columns=[...table.querySelectorAll('thead th')].slice(1).map(th=>th.textContent.trim());
    const htmlRows=[],plainRows=[];
    for(const tr of table.querySelectorAll('tbody tr')){
      const cells=[...tr.querySelectorAll('td')].slice(1);
      htmlRows.push('<tr>'+cells.map(td=>`<td style="border:1px solid #c8d7cd;padding:4px 6px;vertical-align:top">${td.innerHTML}</td>`).join('')+'</tr>');
      plainRows.push(cells.map(td=>td.innerText.replaceAll('\t',' ').replaceAll('\n',' ')).join('\t'));
    }
    htmlParts.push(`<h3 style="font-family:Arial,sans-serif;font-size:10pt;color:#185d46;margin:10px 0 4px">${esc(category)}</h3><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:9pt"><thead><tr>${columns.map(c=>`<th style="border:1px solid #c8d7cd;padding:7px 9px;background:#e9f3ec;text-align:left">${esc(c)}</th>`).join('')}</tr></thead><tbody>${htmlRows.join('')}</tbody></table>`);
    plainParts.push([category,columns.join('\t'),...plainRows].join('\n'));
  }
  return {html:htmlParts.join('<p></p>'),plain:plainParts.join('\n\n')};
}
async function copyCheckout(){const {html,plain}=cleanCheckoutHtml();if(!plain){toast('Choose an item first.',true);return;}
  try{if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(plain);else throw new Error('Clipboard not available');toast('Copied! Paste your tables into OneNote, Word, or your lab notes.');}
  catch(err){toast(`Clipboard unavailable: ${err.message}. Please use a secure (HTTPS) browser.`,true);}
}

function b64encode(text){const bytes=new TextEncoder().encode(text);let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function b64decode(text){const binary=atob(text.replace(/\s/g,''));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);}
async function githubRequest(url,options={}){
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})};
  if(state.token)headers.Authorization=`Bearer ${state.token}`;
  const response=await fetch(url,{...options,headers,cache:'no-store'});
  if(response.status===404&&options.allowNotFound)return null;
  if(!response.ok){let description='';try{description=(await response.json()).message||'';}catch{}throw new Error(`GitHub ${response.status}: ${description||response.statusText}`);}
  return response.json();
}
async function fetchRemote(){const response=await githubRequest(`${API}?ref=main&_=${Date.now()}`,{allowNotFound:true});if(!response)return {db:emptyDatabase(),sha:null};
  if(response.type!=='file'||!response.content)throw new Error('GitHub did not return the database file.');
  return {db:normalizeDatabase(JSON.parse(b64decode(response.content))),sha:response.sha};
}
async function syncNow(){
  clearTimeout(state.syncTimer);
  if(state.busy)return;
  if(!state.token){openModal('connectDialog');toast('Connect a repository-limited GitHub token to save across computers.');return;}
  state.busy=true;state.networkError='';refreshSyncStatus();const startRevision=state.revision;
  try{
    const remote=await fetchRemote();let upload=structuredClone(state.db);
    if(remote.sha!==state.baseSha){const merged=mergeDatabases(state.baseDb,upload,remote.db);if(merged.conflicts.length){
      throw new Error(`Conflict in ${merged.conflicts.slice(0,3).join(', ')}. Your local draft remains safe; export a backup and reload to reconcile.`);
    }upload=merged.database;}
    if(!state.dirty){state.db=remote.db;state.baseDb=structuredClone(remote.db);state.baseSha=remote.sha;state.networkError='';setNotice('');persistLocal();render();toast('Fetched the latest library.');return;}
    const payload={message:`Update research library (${new Date().toISOString()})`,content:b64encode(JSON.stringify(upload,null,2)+'\n'),branch:'main'};
    if(remote.sha)payload.sha=remote.sha;
    const response=await githubRequest(API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    state.baseDb=structuredClone(upload);state.baseSha=response.content?.sha||null;
    if(state.revision===startRevision){state.db=upload;state.dirty=false;}
    state.networkError='';setNotice('');persistLocal();render();toast('Library saved to GitHub.');
    if(state.dirty){state.syncTimer=setTimeout(()=>syncNow(),2000);}
  }catch(err){
    const forbidden=/GitHub 403:.*(?:Resource not accessible by personal access token|Forbidden)/i.test(err.message);
    state.networkError=forbidden
      ? 'GitHub 403: This access token cannot write to vubio/Lablibrary. In your GitHub fine-grained token settings select Resource owner vubio, repository Lablibrary, and Contents: Read and write. Then replace the token under GitHub sync settings.'
      : err.message;
    setNotice(`${state.networkError} Your local draft is still stored in this browser. Do not clear browser data before syncing.`,true);
    toast(forbidden?'GitHub token needs write permission. Local changes were preserved.':'GitHub sync failed; your changes are safe locally.',true);
  }
  finally{state.busy=false;refreshSyncStatus();}
}
async function initData(){
  const local=getLocal();
  try{
    const remote=await fetchRemote();
    if(local?.dirty){state.db=normalizeDatabase(local.db);state.baseDb=normalizeDatabase(local.baseDb);state.baseSha=local.baseSha;state.dirty=true;setNotice('You have unsynced edits on this device. They were restored safely; connect and sync when ready.');}
    else{state.db=remote.db;state.baseDb=structuredClone(remote.db);state.baseSha=remote.sha;state.dirty=false;setNotice('');}
    state.networkError='';
  }catch(err){state.db=normalizeDatabase(local?.db);state.baseDb=normalizeDatabase(local?.baseDb);state.baseSha=local?.baseSha||null;state.dirty=!!local?.dirty;state.networkError=err.message;setNotice('Could not reach GitHub. Working from this browser’s last saved copy.',true);}
  persistLocal();render();if(state.token&&state.dirty)setTimeout(()=>syncNow(),1000);
}

function download(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function importFile(file){
  try{
    const text=await file.text();let total=0;
    if(file.name.toLowerCase().endsWith('.json')){
      const source=JSON.parse(text);if(!Array.isArray(source.items))throw new Error('This JSON does not contain Lab Library items.');
      const imported=normalizeDatabase(source);for(const cat of imported.categories)if(!state.db.categories.includes(cat))state.db.categories.push(cat);
      for(const col of imported.columns)if(!state.db.columns.some(c=>c.id===col.id))state.db.columns.push(col);
      const ids=new Set(state.db.items.map(it=>it.id));for(const item of imported.items)if(!ids.has(item.id)){state.db.items.push(item);ids.add(item.id);total++;}
      const checkoutIds=new Set(state.db.checkouts.map(it=>it.id));for(const plan of imported.checkouts)if(!checkoutIds.has(plan.id)){state.db.checkouts.push(plan);checkoutIds.add(plan.id);total++;}
    }else total=importRows(state.db,text,file.name.toLowerCase().endsWith('.tsv')?'\t':',');
    if(total){changed();$('importMessage').textContent=`Successfully added ${total} item rows. Sync to GitHub when ready.`;toast(`${total} records imported.`);}else $('importMessage').textContent='No new records to add.';
  }catch(err){$('importMessage').textContent=`Import failed: ${err.message}`;toast(err.message,true);}
}

function registerEvents(){
  $('navLibrary').addEventListener('click',()=>showPage('library'));
  $('navCheckout').addEventListener('click',()=>showPage('checkout'));
  $('addItemBtn').addEventListener('click',()=>openItemDialog());$('emptyAdd').addEventListener('click',()=>openItemDialog());
  $('addCategoryBtn').addEventListener('click',()=>{openItemDialog();$('itemCategory').focus();});
  $('librarySearch').addEventListener('input',renderLibrary);$('checkoutSearch').addEventListener('input',renderPicker);
  $('libraryCategory').addEventListener('change',()=>{renderCategories();renderLibrary();});
  $('checkoutCategoryChips').addEventListener('click',event=>{
    const btn=event.target.closest('[data-quick-category]');if(!btn)return;
    state.checkoutCategory=btn.dataset.quickCategory;renderPicker();renderCategories();
  });
  $('categoryNav').addEventListener('click',event=>{
    const btn=event.target.closest('[data-filter-category]');if(!btn)return;
    if(state.currentPage==='checkout'){state.checkoutCategory=btn.dataset.filterCategory;renderPicker();renderCategories();}
    else{$('libraryCategory').value=btn.dataset.filterCategory;renderCategories();renderLibrary();}
  });
  $('libraryTable').addEventListener('click',event=>{
    const toggle=event.target.closest('[data-expand]');if(toggle){const key=toggle.dataset.expand;if(state.expanded.has(key))state.expanded.delete(key);else state.expanded.add(key);renderLibrary();return;}
    const version=event.target.closest('[data-copy-version]');if(version){openItemDialog(itemById(version.dataset.copyVersion),true);return;}
    const edit=event.target.closest('[data-edit-item]');if(edit){openItemDialog(itemById(edit.dataset.editItem));return;}
    const cell=event.target.closest('[data-edit]');if(cell)inlineEdit(cell);
  });
  $('itemCategory').addEventListener('change',()=>{state.fieldDraft=collectFields();renderItemFields();});
  $('itemCategory').addEventListener('input',()=>{state.fieldDraft=collectFields();renderItemFields();});
  $('itemName').addEventListener('input',warningForName);$('itemForm').addEventListener('submit',submitItem);
  $('cancelItem').addEventListener('click',()=>closeModal('itemDialog'));
  $('addFieldBtn').addEventListener('click',()=>{state.fieldDraft=collectFields();$('newFieldName').value='';openModal('fieldDialog');$('newFieldName').focus();});
  $('fieldForm').addEventListener('submit',event=>{event.preventDefault();const label=$('newFieldName').value.trim();if(!label)return;const col=addColumn(state.db,label);closeModal('fieldDialog');renderItemFields();document.querySelector(`[data-form-col="${CSS.escape(col.id)}"]`)?.focus();changed();});
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
  $('pickerList').addEventListener('change',event=>{
    if(event.target.matches('[data-check-group]'))setGroupSelection(event.target.dataset.checkGroup,event.target.checked);
    if(event.target.matches('[data-choose-version]'))setVersionSelection(event.target.value,event.target.checked);
  });
  $('pickerList').addEventListener('click',event=>{
    const compare=event.target.closest('[data-compare-group]');
    if(compare){openCompareDialog(compare.dataset.compareGroup);return;}
    const edit=event.target.closest('[data-edit-picker]');
    if(edit){openItemDialog(itemById(edit.dataset.editPicker));return;}
    const copy=event.target.closest('[data-copy-picker]');
    if(copy){openItemDialog(itemById(copy.dataset.copyPicker),true);return;}
    const button=event.target.closest('[data-toggle-picker]');
    if(button){
      const key=button.dataset.togglePicker;
      if(state.checkoutExpanded.has(key))state.checkoutExpanded.delete(key);else state.checkoutExpanded.add(key);
      renderPicker();
    }
  });
  $('clearSelection').addEventListener('click',clearEverything);
  $('clearEverything').addEventListener('click',clearEverything);
  $('saveCheckoutPlan').addEventListener('click',saveCheckoutPlan);
  $('updateCheckoutPlan').addEventListener('click',updateCheckoutPlan);
  $('savedPlanList').addEventListener('click',event=>{
    const open=event.target.closest('[data-open-plan]');
    if(open){loadCheckoutPlan(open.dataset.openPlan);return;}
    const remove=event.target.closest('[data-delete-plan]');
    if(remove)deleteCheckoutPlan(remove.dataset.deletePlan);
  });
  $('checkoutPreview').addEventListener('change',event=>{if(event.target.matches('[data-column-id]'))applyColumnChoice(event.target.dataset.columnCategory,event.target.dataset.columnId,event.target.checked);});
  $('checkoutPreview').addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove-preview]');
    if(!remove)return;
    const id=remove.dataset.removePreview;
    if(!state.selected.has(id))return;
    state.selected.delete(id);
    // This updates the working checkout only. A saved plan changes only via "Update opened".
    refreshSelection();
  });
  $('checkoutPreview').addEventListener('dragstart',onDragStart);$('checkoutPreview').addEventListener('dragover',onDragOver);$('checkoutPreview').addEventListener('drop',onDrop);$('checkoutPreview').addEventListener('dragend',onDragEnd);
  $('checkoutPreview').addEventListener('paste',event=>{if(event.target.closest('[contenteditable]')){event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));}});
  document.querySelectorAll('[data-format]').forEach(btn=>{btn.addEventListener('mousedown',event=>event.preventDefault());btn.addEventListener('click',()=>document.execCommand(btn.dataset.format,false,btn.dataset.value||null));});
  $('clearFormat').addEventListener('mousedown',event=>event.preventDefault());$('clearFormat').addEventListener('click',()=>document.execCommand('removeFormat',false,null));
  $('copyCheckout').addEventListener('click',copyCheckout);$('copyBottom').addEventListener('click',copyCheckout);
  const openGithubConnection=()=>{openModal('connectDialog');$('tokenInput').value=state.token;};
  $('connectBtn').addEventListener('click',openGithubConnection);
  $('syncGuideConnect').addEventListener('click',openGithubConnection);
  $('connectForm').addEventListener('submit',async event=>{event.preventDefault();const token=$('tokenInput').value.trim();if(!token){$('connectionMessage').textContent='Enter a fine-grained token to connect.';return;}
    state.token=token;try{await githubRequest(`https://api.github.com/repos/${REPOSITORY}`);sessionStorage.setItem(TOKEN_KEY,token);$('connectionMessage').textContent='Connected. Your token is available only in this tab session.';closeModal('connectDialog');state.networkError='';if(!state.dirty)setNotice('');refreshSyncStatus();toast('Token accepted for reading. Checking GitHub write access when saving.');if(state.dirty)syncNow();}catch(err){state.token='';$('connectionMessage').textContent=`Could not connect: ${err.message}`;}
  });
  $('disconnectBtn').addEventListener('click',()=>{state.token='';sessionStorage.removeItem(TOKEN_KEY);$('tokenInput').value='';$('connectionMessage').textContent='Token forgotten for this browser session.';refreshSyncStatus();toast('Token removed from this session.');});
  $('saveBtn').addEventListener('click',syncNow);
  $('backupBtn').addEventListener('click',()=>openModal('backupDialog'));
  $('exportJson').addEventListener('click',()=>download(`LabLibrary_backup_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(state.db,null,2),'application/json'));
  $('exportCsv').addEventListener('click',()=>download(`LabLibrary_${new Date().toISOString().slice(0,10)}.csv`,toCsv(state.db),'text/csv;charset=utf-8'));
  $('importFile').addEventListener('change',event=>{if(event.target.files[0])importFile(event.target.files[0]);event.target.value='';});
  window.addEventListener('online',()=>{if(state.dirty&&state.token)syncNow();});
}

$('todayText').textContent=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date());
$('planName').value=defaultPlanName();
registerEvents();initData();
