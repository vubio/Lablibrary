import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDatabase,groupItems,fieldOrder,importRows,mergeDatabases,toCsv,normalizeDatabase} from '../model.js';

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
