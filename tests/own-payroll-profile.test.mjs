import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownPayrollProfile } from '../src/utils/ownPayrollProfile.ts';

test('private salesperson identity receives only its own payroll fields',()=>{
  const identity={id:'sales-a',role:'salesperson',username:'private',authSource:'server',password:'',businessAccess:'used_car'};
  const profiles=[{id:'sales-b',basicSalary:9000},{id:'sales-a',role:'director',username:'public',password:'hash',businessAccess:'both',employmentType:'full_time',basicSalary:1500,allowance:100,employeeId:'E001'}];
  const result=ownPayrollProfile(identity,profiles);
  assert.equal(result.basicSalary,1500);assert.equal(result.allowance,100);assert.equal(result.employeeId,'E001');
  for(const key of ['id','role','username','authSource','password','businessAccess'])assert.equal(result[key],identity[key]);
  assert.equal(identity.basicSalary,undefined);
});

test('missing payroll profile does not substitute another employee',()=>{
  const identity={id:'sales-a',role:'salesperson',password:''};
  assert.equal(ownPayrollProfile(identity,[{id:'sales-b',basicSalary:9000}]),identity);
  assert.equal(ownPayrollProfile(null,[]),null);
});
