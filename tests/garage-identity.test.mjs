import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLegacyIdentity } from '../src/utils/garageIdentity.ts';
test('public profile updates cannot expand private Garage identity',()=>{
  const current={id:'g1',authSource:'server',role:'garage_salesman',businessAccess:'garage',password:''};
  assert.equal(mergeLegacyIdentity(current,'g1',{role:'director',businessAccess:'both',password:'public-hash'}),current);
});
test('legacy identities retain their existing profile update behavior',()=>{
  const current={id:'c1',role:'salesperson'};
  assert.deepEqual(mergeLegacyIdentity(current,'c1',{role:'director'}),{id:'c1',role:'director'});
  assert.equal(mergeLegacyIdentity(current,'other',{role:'director'}),current);
  assert.equal(mergeLegacyIdentity(null,'c1',{}),null);
});
