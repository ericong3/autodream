import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const modules=new Map();
function load(path){const url=new URL(path,import.meta.url);if(modules.has(url.href))return modules.get(url.href);const module={exports:{}};modules.set(url.href,module.exports);vm.runInNewContext(ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,Date,Math,Map,crypto:{randomUUID:()=>String(Math.random())},require:n=>load(new URL(n+'.ts',url).href)});return module.exports;}
const {campaignBonusFor}=load('../src/utils/campaignPayroll.ts'),{computePayslipDraft}=load('../src/utils/payslip.ts');
test('campaign payroll earnings use frozen payments for the right staff and month, once per ID',()=>{
 const p={id:'one',type:'campaign_bonus',recipientId:'a',bonusMonth:'2026-10',amount:750,status:'pending'};
 assert.equal(campaignBonusFor([p,p,{...p,id:'two',amount:100,status:'transferred'},{...p,id:'other-person',recipientId:'b'},{...p,id:'other-month',bonusMonth:'2026-11'},{...p,id:'per-car',type:'salesman_commission'}],'a','2026-10'),850);
});
test('new payslip draft adds campaign bonus separately from basic/commission, without prorating its earned share',()=>{
 const user={id:'a',role:'salesperson',employmentType:'commission_only'};
 const plain=computePayslipDraft({user,month:'2026-10',salesCommission:2000});
 const withBonus=computePayslipDraft({user,month:'2026-10',salesCommission:2000,campaignBonus:750});
 assert.equal(withBonus.basicSalary,plain.basicSalary);assert.equal(withBonus.salesCommission,2000);assert.equal(withBonus.performanceBonus,750);
 const fullTime={...user,employmentType:'full_time',basicSalary:2000,salaryIncrement:100,joiningDate:'2026-10-16'};
 const base=computePayslipDraft({user:fullTime,month:'2026-10',salesCommission:0});
 const bonus=computePayslipDraft({user:fullTime,month:'2026-10',salesCommission:0,campaignBonus:750});
 assert.equal(bonus.performanceBonus-base.performanceBonus,750);assert.equal(bonus.basicSalary,base.basicSalary);
});
