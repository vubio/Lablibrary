export const REPOSITORY = 'vubio/Lablibrary';
export const DATA_PATH = 'data/library.json';
export const DEFAULT_CATEGORIES = [
  '1° antibody', '2° antibody', 'Cell line', 'Fluorescent probe',
  'Fluorescent stain', 'Assay reagent', 'Small molecule', 'Fatty acid / Lipid',
  'Fixative', 'Buffer / Salt', 'Detergent', 'Cell culture reagent',
  'Enzyme', 'Protein / Cytokine', 'Transfection reagent', 'Other chemical'
];
export const DEFAULT_COLUMNS = [
  {id:'cloneName',label:'Clone name'}, {id:'host',label:'Host'},
  {id:'stockConcentration',label:'Stock concentration'},
  {id:'workingConcentration',label:'Working concentration'},
  {id:'catalogNumber',label:'Cat #'}, {id:'lotNumber',label:'Lot #'},
  {id:'cellLineCode',label:'Cell line code'}, {id:'origin',label:'Origin'},
  {id:'vendor',label:'Vendor'}, {id:'source',label:'Source'},
  {id:'storage',label:'Storage'}, {id:'notes',label:'Notes'}
];
export const AUTO_COLUMNS = [{id:'name',label:'Name'},{id:'category',label:'Category'},{id:'enteredAt',label:'Entry date and time'}];
const now = () => new Date().toISOString();
export function emptyDatabase(){return {schemaVersion:1,categories:[...DEFAULT_CATEGORIES],columns:DEFAULT_COLUMNS.map(c=>({...c})),items:[],checkouts:[],preferences:{excludedColumns:{},categoryOrder:[],itemOrder:{}}};}
export function normalizeDatabase(input){
  const seed=emptyDatabase();
  if(!input || typeof input!=='object')return seed;
  seed.categories=[...new Set([...(Array.isArray(input.categories)?input.categories:[]),...DEFAULT_CATEGORIES].filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))];
  const extra=Array.isArray(input.columns)?input.columns.filter(c=>c&&typeof c.id==='string'&&typeof c.label==='string'&&c.id!=='name'&&c.id!=='category'&&c.id!=='enteredAt'):[];
  seed.columns=uniqueBy([...DEFAULT_COLUMNS,...extra],c=>c.id).map(c=>({id:c.id,label:c.label}));
  seed.items=(Array.isArray(input.items)?input.items:[]).filter(x=>x&&typeof x.name==='string').map(x=>({
    id:String(x.id||makeId()),name:String(x.name),category:String(x.category||'Uncategorized'),
    values:typeof x.values==='object'&&x.values!==null&&!Array.isArray(x.values)?{...x.values}:{},
    enteredAt:String(x.enteredAt||x.createdAt||now()),updatedAt:String(x.updatedAt||x.enteredAt||now())
  }));
  seed.checkouts=(Array.isArray(input.checkouts)?input.checkouts:[]).filter(c=>c&&typeof c.name==='string'&&c.id).map(c=>({
    id:String(c.id),name:c.name.trim()||'Untitled experiment',selectedIds:Array.isArray(c.selectedIds)?c.selectedIds.map(String):[],
    categoryOrder:Array.isArray(c.categoryOrder)?c.categoryOrder.map(String):[],
    itemOrder:c.itemOrder&&typeof c.itemOrder==='object'&&!Array.isArray(c.itemOrder)?structuredClone(c.itemOrder):{},
    excludedColumns:c.excludedColumns&&typeof c.excludedColumns==='object'&&!Array.isArray(c.excludedColumns)?structuredClone(c.excludedColumns):{},
    createdAt:String(c.createdAt||now()),updatedAt:String(c.updatedAt||c.createdAt||now())
  }));
  const p=input.preferences||{};
  seed.preferences={excludedColumns:(p.excludedColumns&&typeof p.excludedColumns==='object'?p.excludedColumns:{}),categoryOrder:Array.isArray(p.categoryOrder)?p.categoryOrder:[],itemOrder:(p.itemOrder&&typeof p.itemOrder==='object'?p.itemOrder:{})};
  for(const it of seed.items)if(!seed.categories.includes(it.category))seed.categories.push(it.category);
  return seed;
}
export function uniqueBy(items,getKey){const seen=new Set();return items.filter(x=>{const k=getKey(x);if(seen.has(k))return false;seen.add(k);return true;});}
export function makeId(){return globalThis.crypto?.randomUUID?.() || `row_${Date.now()}_${Math.random().toString(36).slice(2)}`;}
export function keyFor(name){return String(name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();}
// The checkout may contain multiple versions of one material.
// Ticking a material initially selects its newest version; individual version
// toggles then add or remove exactly that version without altering the others.
export function toggleGroupSelection(selectedIds, versionIds, checked){
  const next=new Set(selectedIds);
  if(!Array.isArray(versionIds)||!versionIds.length)return next;
  if(checked){
    // First id belongs to the newest version (groupItems sorts newest first).
    if(!versionIds.some(id=>next.has(id)))next.add(versionIds[0]);
  }else{
    for(const id of versionIds)next.delete(id);
  }
  return next;
}
export function toggleVersionSelection(selectedIds, versionId, checked){
  const next=new Set(selectedIds);
  if(checked)next.add(versionId);
  else next.delete(versionId);
  return next;
}
export function recentFirst(a,b){return (Date.parse(b.enteredAt)||0)-(Date.parse(a.enteredAt)||0)||String(b.id).localeCompare(String(a.id));}
export function groupItems(items){
  const groups=new Map();
  for(const item of items){const key=keyFor(item.name);if(!groups.has(key))groups.set(key,{key,items:[]});groups.get(key).items.push(item);}
  for(const g of groups.values()){g.items.sort(recentFirst);g.latest=g.items[0];}
  return [...groups.values()].sort((a,b)=>a.latest.name.localeCompare(b.latest.name,undefined,{numeric:true,sensitivity:'base'}));
}
export function fieldOrder(db,category){
  const matches=db.items.filter(x=>x.category.toLocaleLowerCase()===String(category).toLocaleLowerCase());
  if(!matches.length)return db.columns;
  const score=new Map(db.columns.map(c=>[c.id,0]));
  for(const it of matches)for(const [id,value] of Object.entries(it.values||{}))if(String(value??'').trim())score.set(id,(score.get(id)||0)+1);
  return [...db.columns].sort((a,b)=>(score.get(b.id)||0)-(score.get(a.id)||0));
}
export function displayValue(item,id){if(id==='name')return item.name;if(id==='category')return item.category;if(id==='enteredAt')return formatTime(item.enteredAt);return String(item.values?.[id]??'');}
// Compare versions using saved values, not timestamps: an automatic entry date
// should identify a row, not count as a meaningful inventory-field change.
export function differingVersionColumns(db,versions){
  if(!Array.isArray(versions)||versions.length<2)return [];
  const columns=[{id:'category',label:'Category'},...db.columns.filter(c=>!['name','category','enteredAt','updatedAt'].includes(c.id))];
  const known=new Set(columns.map(c=>c.id));
  for(const item of versions)for(const id of Object.keys(item.values||{})){
    if(known.has(id)||['name','category','enteredAt','updatedAt'].includes(id))continue;
    columns.push({id,label:id});known.add(id);
  }
  return columns.filter(c=>new Set(versions.map(item=>displayValue(item,c.id).trim())).size>1);
}
export function formatTime(value){const t=Date.parse(value);if(!Number.isFinite(t))return String(value||'');return new Date(t).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
export function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,40)||'field';}
export function addColumn(db,label){const clean=label.trim();const existing=db.columns.find(c=>c.label.toLocaleLowerCase()===clean.toLocaleLowerCase());if(existing)return existing;let id=slug(clean),n=2;while([...db.columns,...AUTO_COLUMNS].some(c=>c.id===id))id=`${slug(clean)}_${n++}`;const col={id,label:clean};db.columns.push(col);return col;}
// Saving another experiment must never overwrite the active one implicitly.
// An existing plan is updated only when the explicit "update" action is chosen.
export function saveCheckoutRecord(db,draft,{mode='new',activeId=null,id=makeId(),timestamp=new Date().toISOString()}={}){
  if(mode!=='new'&&mode!=='update')throw new Error('Unknown checkout save mode.');
  const existing=mode==='update'?db.checkouts.find(c=>c.id===activeId):null;
  if(mode==='update'&&!existing)throw new Error('The saved experiment is no longer available to update.');
  if(mode==='new'&&db.checkouts.some(c=>c.id===id))throw new Error('This experiment ID already exists.');
  const record={
    name:String(draft.name||'').trim()||'Untitled experiment',
    selectedIds:[...new Set(draft.selectedIds||[])],
    categoryOrder:[...(draft.categoryOrder||[])],
    itemOrder:structuredClone(draft.itemOrder||{}),
    excludedColumns:structuredClone(draft.excludedColumns||{}),
    updatedAt:timestamp
  };
  if(existing){Object.assign(existing,record);return existing;}
  const created={id,createdAt:timestamp,...record};
  db.checkouts.push(created);
  return created;
}
export function mergeDatabases(base,local,remote){
  // Three-way merge. Concurrent changes to the same record stop rather than silently overwrite.
  base=normalizeDatabase(base);local=normalizeDatabase(local);remote=normalizeDatabase(remote);
  const out=normalizeDatabase(remote),conflicts=[];
  out.categories=[...new Set([...remote.categories,...local.categories])];
  out.columns=uniqueBy([...remote.columns,...local.columns],c=>c.id);
  const bm=new Map(base.items.map(it=>[it.id,it])),lm=new Map(local.items.map(it=>[it.id,it])),rm=new Map(remote.items.map(it=>[it.id,it]));
  for(const id of new Set([...lm.keys(),...rm.keys(),...bm.keys()])){
    const before=bm.get(id),mine=lm.get(id),theirs=rm.get(id);
    const changedMine=JSON.stringify(mine)!==JSON.stringify(before);
    const changedTheirs=JSON.stringify(theirs)!==JSON.stringify(before);
    if(changedMine&&changedTheirs&&JSON.stringify(mine)!==JSON.stringify(theirs)){conflicts.push(mine?.name||theirs?.name||id);continue;}
    if(changedMine){if(mine)rm.set(id,mine);else rm.delete(id);}
  }
  out.items=[...rm.values()];
  // Saved checkout plans are independently mergeable records so different experiments
  // edited on different computers do not overwrite one another.
  const bc=new Map(base.checkouts.map(c=>[c.id,c])),lc=new Map(local.checkouts.map(c=>[c.id,c])),rc=new Map(remote.checkouts.map(c=>[c.id,c]));
  for(const id of new Set([...bc.keys(),...lc.keys(),...rc.keys()])){
    const before=bc.get(id),mine=lc.get(id),theirs=rc.get(id);
    const changedMine=JSON.stringify(mine)!==JSON.stringify(before);
    const changedTheirs=JSON.stringify(theirs)!==JSON.stringify(before);
    if(changedMine&&changedTheirs&&JSON.stringify(mine)!==JSON.stringify(theirs)){
      conflicts.push('saved checkout: '+(mine?.name||theirs?.name||id));continue;
    }
    if(changedMine){if(mine)rc.set(id,mine);else rc.delete(id);}
  }
  out.checkouts=[...rc.values()];
  for(const part of ['excludedColumns','categoryOrder','itemOrder']){
    const before=base.preferences[part],mine=local.preferences[part],theirs=remote.preferences[part];
    if(part==='categoryOrder'){
      const mineChanged=JSON.stringify(mine)!==JSON.stringify(before),theirsChanged=JSON.stringify(theirs)!==JSON.stringify(before);
      if(mineChanged&&theirsChanged&&JSON.stringify(mine)!==JSON.stringify(theirs))conflicts.push('category order');
      else out.preferences[part]=mineChanged?mine:theirs;
    }else{
      const merged={...theirs};
      for(const key of new Set([...Object.keys(mine||{}),...Object.keys(before||{})])){
        const mineChanged=JSON.stringify(mine?.[key])!==JSON.stringify(before?.[key]);
        const theirsChanged=JSON.stringify(theirs?.[key])!==JSON.stringify(before?.[key]);
        if(mineChanged&&theirsChanged&&JSON.stringify(mine?.[key])!==JSON.stringify(theirs?.[key]))conflicts.push(`preferences: ${key}`);
        else if(mineChanged){if(mine?.[key]===undefined)delete merged[key];else merged[key]=mine[key];}
      }
      out.preferences[part]=merged;
    }
  }
  return {database:out,conflicts};
}
function normHeader(s){return String(s).replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
const SYNONYMS={cat:'catalogNumber',catno:'catalogNumber',catnumber:'catalogNumber',catalognumber:'catalogNumber',lot:'lotNumber',lotno:'lotNumber',lotnumber:'lotNumber',clone:'cloneName',cellline:'cellLineCode',celllinecode:'cellLineCode',stockconc:'stockConcentration',stockconcentration:'stockConcentration',workingconc:'workingConcentration',workingconcentration:'workingConcentration',entrydate:'enteredAt',entrydateandtime:'enteredAt',entrydatetime:'enteredAt',date:'enteredAt',itemname:'name'};
export function parseDelimited(text,delimiter=','){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(ch===delimiter&&!quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(c=>c.trim()))rows.push(row);row=[];field='';}
    else field+=ch;
  }
  row.push(field);if(row.some(c=>c.trim()))rows.push(row);return rows;
}
export function importRows(db,text,delimiter=','){
  const rows=parseDelimited(text,delimiter);if(rows.length<2)throw new Error('The file needs a header row and at least one item.');
  const headers=rows[0].map(h=>h.trim());const map=headers.map(h=>{
    const normalized=normHeader(h);
    if(normalized==='name'||normalized==='category'||normalized==='enteredat')return normalized;
    if(SYNONYMS[normalized])return SYNONYMS[normalized];
    const existing=db.columns.find(c=>normHeader(c.label)===normalized||normHeader(c.id)===normalized);
    return existing?.id||addColumn(db,h||'Unnamed field').id;
  });
  if(!map.includes('name'))throw new Error('A Name column is required.');
  let added=0;
  for(const row of rows.slice(1)){
    const obj={};map.forEach((key,i)=>obj[key]=row[i]??'');if(!String(obj.name||'').trim())continue;
    const category=String(obj.category||'Uncategorized').trim();if(!db.categories.includes(category))db.categories.push(category);
    const timestamp=Date.parse(obj.enteredAt)?new Date(obj.enteredAt).toISOString():now();
    const values={};for(const col of db.columns)if(obj[col.id]!==undefined&&String(obj[col.id]).trim())values[col.id]=String(obj[col.id]).trim();
    db.items.push({id:makeId(),name:String(obj.name).trim(),category,values,enteredAt:timestamp,updatedAt:now()});added++;
  }
  return added;
}
export function toCsv(db){
  const cols=[{id:'name',label:'Name'},{id:'category',label:'Category'},...db.columns,{id:'enteredAt',label:'Entry date and time'}];
  const esc=s=>`"${String(s??'').replaceAll('"','""')}"`;
  return [cols.map(c=>esc(c.label)).join(','),...db.items.map(it=>cols.map(c=>esc(c.id==='enteredAt'?it.enteredAt:displayValue(it,c.id))).join(','))].join('\r\n');
}
