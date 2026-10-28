import { test } from 'node:test';
import assert from 'node:assert/strict';
import { garageNavigation, garageSection, garageSecondaryNavigation } from '../src/utils/garageNavigation.ts';
import {canInstallGarageTint,isGarageWorkshopRole,isGarageManager} from '../src/utils/garageRoles.ts';

test('Garage Head can install tint while keeping management navigation and other role boundaries',()=>{
  for(const role of ['garage_head','garage_installer','garage_detailer','garage_spray'])assert.equal(canInstallGarageTint(role),true);
  for(const role of ['garage_salesman','director','shareholder','admin','salesperson',undefined])assert.equal(canInstallGarageTint(role),false);
  assert.equal(isGarageWorkshopRole('garage_head'),false);
  assert.equal(isGarageManager('garage_head'),true);
});

test('Garage navigation preserves role boundaries', () => {
  for (const role of ['director', 'shareholder', 'garage_head']) {
    assert.deepEqual(garageNavigation(role).map(n => n.label), ['Home', 'Sales', 'Jobs', 'Manage']);
    assert.equal(garageNavigation(role)[2].path, '/garage/installer');
  }
  assert.deepEqual(garageNavigation('garage_salesman').map(n => n.label), ['Home', 'Sales', 'Jobs']);
  assert.equal(garageNavigation('garage_salesman')[2].path, '/garage/calendar');
  for (const role of ['garage_installer', 'garage_detailer', 'garage_spray']) {
    assert.deepEqual(garageNavigation(role), [{label:'Home',path:'/garage/dashboard'},{ label: 'Jobs', path: '/garage/installer' }]);
    assert.deepEqual(garageSecondaryNavigation(role, 'Jobs'), []);
  }
  assert.deepEqual(garageNavigation('salesperson'), []);
  assert.deepEqual(garageNavigation(undefined), []);
  assert.deepEqual(garageSecondaryNavigation('garage_salesman', 'Manage'), []);
});
test('deep routes highlight their Garage group without matching similar prefixes', () => {
  for (const path of ['/garage/work-order/customer/c1/vehicle/v1', '/garage/building/new']) assert.equal(garageSection(path), 'Sales');
  assert.equal(garageSection('/garage/installer/job/j1'), 'Jobs');
  assert.equal(garageSection('/garage/team'), 'Manage');
  assert.equal(garageSection('/garage/work-order-tracking/tinted'), 'Home');
  assert.equal(garageSection('/garage/invoice/i1'), 'Home');
});
