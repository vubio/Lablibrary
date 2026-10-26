import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDatabase,groupItems,fieldOrder,importRows,mergeDatabases,toCsv,normalizeDatabase,toggleGroupSelection,toggleVersionSelection,differingVersionColumns,saveCheckoutRecord,sortLibraryGroups} from '../model.js';

function row(id,name,category,enteredAt,values={}){return {id,name,category,enteredAt,updatedAt:enteredAt,values};}

test('groups case-insensitive duplicate names, newest first',()=>{
  const db=emptyDatabase();db.items=[row('a','C11 BODIPY','Fluorescent probe','2026-10-01T00:00:00Z'),row('b','c11 bodipy','Fluorescent probe','2026-10-22T00:00:00Z')];
  const groups=groupItems(db.items);assert.equal(groups.length,1);assert.equal(groups[0].latest.id,'b');assert.deepEqual(groups[0].items.map(x=>x.id),['b','a']);
});

test('prioritizes populated fields for existing categories',()=>{
  const db=emptyDatabase();db.items=[row('a','A','2° antibody','2026-10-01T00:00:00Z',{host:'Goat',vendor:'Thermo'}),row('b','B','2° antibody','2026-10-02T00:00:00Z',{host:'Goat'})];
  assert.equal(fieldOrder(db,'2° antibody')[0].id,'host');
  assert.equal(fieldOrder(db,'New category')[0].id,'cloneName');
});

test('imports quoted CSV, maps known headers, and can export',()=>{
  const db=emptyDatabase();const count=importRows(db,'Name,Category,Cat #,Lot #,Custom note\n"A, B",2° antibody,G123,L2,"red, green"');
  assert.equal(count,1);assert.equal(db.items[0].name,'A, B');assert.equal(db.items[0].values.catalogNumber,'G123');assert.equal(db.items[0].values.lotNumber,'L2');
  assert(db.columns.some(c=>c.label==='Custom note'));assert.match(toCsv(db),/"A, B"/);
});

test('merges non-overlapping changes without losing remote records',()=>{
  const base=emptyDatabase();base.items=[row('a','A','Cell line','2026-10-01T00:00:00Z')];
  const local=normalizeDatabase(base);local.items[0].values.source='UTHSA';
  const remote=normalizeDatabase(base);remote.items.push(row('b','B','Cell line','2026-10-02T00:00:00Z'));
  const {database,conflicts}=mergeDatabases(base,local,remote);assert.deepEqual(conflicts,[]);assert.equal(database.items.length,2);assert.equal(database.items[0].values.source,'UTHSA');
});

test('stops overlapping concurrent edits',()=>{
  const base=emptyDatabase();base.items=[row('a','A','Cell line','2026-10-01T00:00:00Z')];
  const local=normalizeDatabase(base);local.items[0].name='A new';
  const remote=normalizeDatabase(base);remote.items[0].name='A updated elsewhere';
  assert.equal(mergeDatabases(base,local,remote).conflicts.length,1);
});


test('saved checkouts survive JSON normalization and preserve selected material versions',()=>{
  const db=emptyDatabase();db.checkouts.push({
    id:'plan-1',name:'Ferroptosis imaging',selectedIds:['a','b'],
    categoryOrder:['Drug','Cell line'],itemOrder:{Drug:['b']},
    excludedColumns:{Drug:['vendor']},
    createdAt:'2026-10-22T16:00:00Z',updatedAt:'2026-10-22T16:00:00Z'
  });
  const roundTrip=normalizeDatabase(JSON.parse(JSON.stringify(db)));
  assert.equal(roundTrip.checkouts.length,1);
  assert.deepEqual(roundTrip.checkouts[0].selectedIds,['a','b']);
  assert.deepEqual(roundTrip.checkouts[0].excludedColumns.Drug,['vendor']);
});

test('concurrent edits to different saved checkouts merge; same checkout conflict is detected',()=>{
  const baseline=emptyDatabase();const local=normalizeDatabase(baseline),remote=normalizeDatabase(baseline);
  const plan=id=>({id,name:id,selectedIds:['a'],categoryOrder:[],itemOrder:{},
    excludedColumns:{},createdAt:'2026-10-22T16:00:00Z',updatedAt:'2026-10-22T16:00:00Z'});
  local.checkouts.push(plan('one'));remote.checkouts.push(plan('two'));
  const merged=mergeDatabases(baseline,local,remote);
  assert.deepEqual(merged.conflicts,[]);
  assert.deepEqual(merged.database.checkouts.map(x=>x.id).sort(),['one','two']);
  const a=normalizeDatabase(merged.database),b=normalizeDatabase(merged.database);
  a.checkouts[0].name='Edited on work PC';b.checkouts[0].name='Edited on lab PC';
  assert.equal(mergeDatabases(merged.database,a,b).conflicts.length,1);
});


test('checkout initially selects newest version and can select both versions',()=>{
  const versions=['newer','older'];
  let chosen=toggleGroupSelection(new Set(),versions,true);
  assert.deepEqual([...chosen],['newer']);
  chosen=toggleVersionSelection(chosen,'older',true);
  assert.deepEqual([...chosen],['newer','older']);
  chosen=toggleVersionSelection(chosen,'newer',false);
  assert.deepEqual([...chosen],['older']);
  chosen=toggleVersionSelection(chosen,'newer',true);
  assert.deepEqual([...chosen],['older','newer']);
  chosen=toggleGroupSelection(chosen,versions,false);
  assert.deepEqual([...chosen],[]);
});

test('selecting material groups does not disturb versions selected in other groups',()=>{
  let chosen=new Set(['drug-v1']);
  chosen=toggleGroupSelection(chosen,['cell-v2','cell-v1'],true);
  chosen=toggleVersionSelection(chosen,'cell-v1',true);
  assert.deepEqual([...chosen],['drug-v1','cell-v2','cell-v1']);
  chosen=toggleGroupSelection(chosen,['cell-v2','cell-v1'],false);
  assert.deepEqual([...chosen],['drug-v1']);
});

test('a saved checkout can preserve multiple versions of a single material',()=>{
  const db=emptyDatabase();
  db.items=[
    row('older','A549','Cell line','2026-10-20T12:00:00Z',{cellLineCode:'WT'}),
    row('newer','A549','Cell line','2026-10-22T12:00:00Z',{cellLineCode:'DKO'})
  ];
  db.checkouts.push({id:'draft',name:'Compare A549 versions',selectedIds:['newer','older'],
    categoryOrder:['Cell line'],itemOrder:{},excludedColumns:{},createdAt:'2026-10-22T12:00:00Z',updatedAt:'2026-10-22T12:00:00Z'});
  const restored=normalizeDatabase(JSON.parse(JSON.stringify(db)));
  assert.equal(groupItems(restored.items).length,1);
  assert.deepEqual(restored.checkouts[0].selectedIds,['newer','older']);
  assert.deepEqual(restored.checkouts[0].selectedIds.map(id=>restored.items.find(x=>x.id===id).values.cellLineCode),['DKO','WT']);
});


test('compares A549 variants using only the differing cell line code',()=>{
  const db=emptyDatabase();
  const versions=[
    row('new','A549','Cell line','2026-10-25T15:02:00Z',{cellLineCode:'GPX4/UBXD8 DKO',origin:'Human alveolar basal epithelial carcinoma',source:'Department'}),
    row('old','A549','Cell line','2026-10-22T23:58:00Z',{cellLineCode:'CCL-185 (WT)',origin:'Human alveolar basal epithelial carcinoma',source:'Department'})
  ];
  assert.deepEqual(differingVersionColumns(db,versions).map(c=>c.id),['cellLineCode']);
});

test('detects any differing field among 3 versions including blank versus entered values',()=>{
  const db=emptyDatabase();
  db.columns.push({id:'treatment',label:'Treatment'});
  const versions=[
    row('v3','SV589','Cell line','2026-10-25T00:00:00Z',{media:'DMEM',treatment:'Erastin',source:'Department'}),
    row('v2','SV589','Cell line','2026-10-24T00:00:00Z',{media:'DMEM',source:'Department'}),
    row('v1','SV589','Cell line','2026-10-22T00:00:00Z',{media:'DMEM',treatment:'RSL3',source:'Department'})
  ];
  assert.deepEqual(differingVersionColumns(db,versions).map(c=>c.id),['treatment']);
});

test('shows an empty comparison when only entry dates differ',()=>{
  const db=emptyDatabase();
  const versions=[
    row('recent','A549','Cell line','2026-10-25T00:00:00Z',{source:'Department'}),
    row('old','A549','Cell line','2026-10-22T00:00:00Z',{source:'Department'})
  ];
  assert.deepEqual(differingVersionColumns(db,versions),[]);
});

test('compares categories and custom fields even when not in current schema',()=>{
  const db=emptyDatabase();
  const versions=[
    row('a','Compound X','Drug','2026-10-25T00:00:00Z',{storage:'-20',unregisteredField:'A'}),
    row('b','Compound X','Small molecule','2026-10-22T00:00:00Z',{storage:'-20',unregisteredField:'B'})
  ];
  assert.deepEqual(differingVersionColumns(db,versions).map(c=>c.id),['category','unregisteredField']);
});


test('saving successive checkouts always creates independent records',()=>{
  const db=emptyDatabase();
  const draft={name:'SV589 viability',selectedIds:['sv1'],categoryOrder:['Cell line'],itemOrder:{},excludedColumns:{}};
  const first=saveCheckoutRecord(db,draft,{mode:'new',id:'plan-a',timestamp:'2026-10-26T10:00:00Z'});
  draft.name='A549 DKO imaging';draft.selectedIds=['a549','drug1'];
  const second=saveCheckoutRecord(db,draft,{mode:'new',activeId:'plan-a',id:'plan-b',timestamp:'2026-10-26T11:00:00Z'});
  assert.equal(db.checkouts.length,2);
  assert.equal(first.name,'SV589 viability');
  assert.deepEqual(first.selectedIds,['sv1']);
  assert.equal(second.name,'A549 DKO imaging');
  assert.deepEqual(second.selectedIds,['a549','drug1']);
  assert.equal(db.checkouts[0].id,'plan-a');
  assert.equal(db.checkouts[1].id,'plan-b');
});

test('only explicit update can replace an opened saved checkout',()=>{
  const db=emptyDatabase();
  saveCheckoutRecord(db,{name:'Original',selectedIds:['a']},{id:'plan-a',timestamp:'2026-10-26T10:00:00Z'});
  const changed=saveCheckoutRecord(db,{name:'Revised',selectedIds:['b']},{mode:'update',activeId:'plan-a',timestamp:'2026-10-26T12:00:00Z'});
  assert.equal(db.checkouts.length,1);
  assert.equal(changed.name,'Revised');
  assert.deepEqual(changed.selectedIds,['b']);
  assert.equal(changed.createdAt,'2026-10-26T10:00:00Z');
  assert.equal(changed.updatedAt,'2026-10-26T12:00:00Z');
});

test('updating missing plans fails rather than making a silent duplicate',()=>{
  const db=emptyDatabase();
  assert.throws(()=>saveCheckoutRecord(db,{name:'Missing',selectedIds:[]},{mode:'update',activeId:'not-here'}));
  assert.equal(db.checkouts.length,0);
});


test('sorts research materials by category ascending and descending',()=>{
  const db=emptyDatabase();
  db.items=[
    row('b','Erastin 2','Drug','2026-10-25T00:00:00Z'),
    row('c','A549','Cell line','2026-10-26T00:00:00Z'),
    row('a','BODIPY','Fluorescent probe','2026-10-24T00:00:00Z')
  ];
  const groups=groupItems(db.items);
  assert.deepEqual(sortLibraryGroups(groups,'category','asc').map(g=>g.latest.name),['A549','Erastin 2','BODIPY']);
  assert.deepEqual(sortLibraryGroups(groups,'category','desc').map(g=>g.latest.name),['BODIPY','Erastin 2','A549']);
});

test('sorts column values naturally and puts blanks last in either direction',()=>{
  const items=[
    row('c','Blank','Cell line','2026-10-25T00:00:00Z',{}),
    row('a','Ten','Cell line','2026-10-26T00:00:00Z',{lotNumber:'10'}),
    row('b','Two','Cell line','2026-10-24T00:00:00Z',{lotNumber:'2'})
  ];
  const groups=groupItems(items);
  assert.deepEqual(sortLibraryGroups(groups,'lotNumber','asc').map(g=>g.latest.name),['Two','Ten','Blank']);
  assert.deepEqual(sortLibraryGroups(groups,'lotNumber','desc').map(g=>g.latest.name),['Ten','Two','Blank']);
});

test('sorts timestamps chronologically rather than by displayed date strings',()=>{
  const items=[
    row('old','Older','Drug','2026-09-30T18:00:00Z'),
    row('new','Newer','Drug','2026-10-25T12:00:00Z'),
    row('mid','Middle','Drug','2026-10-04T12:00:00Z')
  ];
  assert.deepEqual(sortLibraryGroups(groupItems(items),'enteredAt','asc').map(g=>g.latest.name),['Older','Middle','Newer']);
  assert.deepEqual(sortLibraryGroups(groupItems(items),'enteredAt','desc').map(g=>g.latest.name),['Newer','Middle','Older']);
});

test('sorting leaves earlier versions attached to their latest group',()=>{
  const items=[
    row('old','A549','Cell line','2026-10-01T00:00:00Z',{cellLineCode:'WT'}),
    row('new','A549','Cell line','2026-10-26T00:00:00Z',{cellLineCode:'DKO'}),
    row('other','Huh7','Cell line','2026-10-25T00:00:00Z',{cellLineCode:'Huh7'})
  ];
  const ordered=sortLibraryGroups(groupItems(items),'cellLineCode','asc');
  assert.equal(ordered.length,2);
  assert.deepEqual(ordered.find(g=>g.latest.name==='A549').items.map(x=>x.id),['new','old']);
});
