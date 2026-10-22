// Enquiry trial: sample data held in memory only. No app records or messages.
let previewSalesperson='Alex';
const enquiryStages=['New','Discussing','Quoted','Booked'];
const initialEnquiries=[
  {id:'e1',name:'Mei Lin',phone:'010-0000001',asset:'Honda Civic · QAB 2188',kind:'car',services:[{name:'Tint',stage:'Booked',order:'ADG-DEMO-028'},{name:'Coating',stage:'Quoted'},{name:'PPF',stage:'Discussing'}],followDate:'2026-10-21',next:'Ask about coating and PPF after the customer reviews the options.',history:[]},
  {id:'e2',name:'Melissa',phone:'010-0000002',asset:'Toyota Yaris · QAB 0088',kind:'car',services:[{name:'Tint',stage:'Quoted'},{name:'Coating',stage:'Quoted'}],followDate:'',next:'Customer is comparing packages.',history:[]},
  {id:'e3',name:'Sara Lim',phone:'010-0000003',asset:'Home · Tabuan Jaya',kind:'building',services:[{name:'Building tint',stage:'New'}],followDate:'2026-10-23',next:'Prepare the measurements and quotation after the site visit.',history:[]}
];
initialEnquiries.forEach(e=>e.owner='Alex');
initialEnquiries.push({id:'e4',owner:'Ben',name:'Mei Lin',phone:'010-0000001',asset:'Honda Civic · QAB 2188',kind:'car',services:[{name:'Coating',stage:'Discussing'}],followDate:'2026-10-22',next:'Prepare my coating recommendation for the customer.',history:[]});
let enquiries=structuredClone(initialEnquiries),enquiryFilter='All',demoOrderSequence=40,pendingServiceBooking=null;
const previewToday='2026-10-22';
const originalHomeRender=render,originalOpenItem=openItem,originalShow=show;
const baselineTasks=structuredClone(tasks),baselineOrders=structuredClone(orders);
show=function(category,html){$('#details').classList.remove('board-dialog');originalShow(category,html);};
function pendingServices(enquiry){return enquiry.services.filter(s=>s.stage!=='Booked');}
function enquiryLane(enquiry){const open=pendingServices(enquiry);return open.length?enquiryStages[Math.min(...open.map(s=>enquiryStages.indexOf(s.stage)))]: 'Booked';}
function serviceChip(service){return `<span class="service-chip ${service.stage==='Booked'?'booked':''}">${escape(service.name)} <small>${escape(service.stage)}</small></span>`;}
function refreshEnquiryTasks(){
  // Follow-up dates are chosen by staff. No date means no Today reminder.
  const other=baselineTasks.filter(t=>t.id!=='t1'&&previewSalesperson==='Alex');
  const followups=enquiries.filter(e=>e.owner===previewSalesperson&&pendingServices(e).length&&e.followDate&&e.followDate<=previewToday).map(e=>({id:'follow-'+e.id,enquiryId:e.id,time:e.followDate<previewToday?'Overdue':'Today',small:e.followDate===previewToday?'Follow up':e.followDate,name:e.name,description:e.asset+' · '+pendingServices(e).map(s=>s.name).join(' + '),category:'Follow up',overdue:e.followDate<previewToday,next:e.next,order:''}));
  tasks.splice(0,tasks.length,...followups,...other);
  const tint=orders.find(o=>o.id==='o0');if(tint){tint.category='Booked';tint.description='Honda Civic · QAB 2188 · Tint';tint.next='Confirm the arrangements for the booked tint service.';}
}
render=function(){refreshEnquiryTasks();originalHomeRender();$('#enquiries').hidden=view!=='today';$('#today-count').textContent=tasks.filter(t=>!completed.has(t.id)).length;};
openItem=function(id){const task=tasks.find(t=>t.id===id);if(task?.enquiryId){openEnquiry(task.enquiryId);return;}originalOpenItem(id);};
function openEnquiryBoard(){
  const matches=enquiries.filter(e=>e.owner===previewSalesperson).filter(e=>enquiryFilter==='All'||e.services.some(s=>s.name===enquiryFilter));
  show('Enquiries',`<div class="board-heading"><div><h2>Your enquiries</h2><p>${escape(previewSalesperson)} · Your conversations and quotations only.</p></div><button class="primary" data-enquiry-new>＋ Enquiry</button></div><div class="product-filters" aria-label="Filter enquiries by product">${['All','Tint','Coating','PPF','Spray','Building tint'].map(p=>`<button data-product-filter="${p}" aria-pressed="${p===enquiryFilter}">${p}</button>`).join('')}</div><div class="enquiry-board">${enquiryStages.map(stage=>{const items=matches.filter(e=>enquiryLane(e)===stage);return `<section class="board-column"><h3>${stage}<span>${items.length}</span></h3>${items.map(e=>`<button class="enquiry-card" data-enquiry="${e.id}"><strong>${escape(e.name)}</strong><span class="card-asset">${escape(e.asset)}</span><span class="service-chips">${e.services.map(serviceChip).join('')}</span><span class="card-next">${pendingServices(e).length?(e.followDate?'Follow up '+escape(e.followDate):'No reminder set'):'All services booked'}</span>${e.services.some(s=>s.stage==='Booked')&&pendingServices(e).length?'<span class="partial-booking">Partly booked · Follow-up stays open</span>':''}</button>`).join('')||'<p class="column-empty">No enquiries</p>'}</section>`;}).join('')}</div><p class="board-note">A card follows its earliest undecided service. Change a service inside the card; booked services keep their own orders.</p>`);
  $('#details').classList.add('board-dialog');
}
function openEnquiry(id){
  const e=enquiries.find(e=>e.id===id);if(!e||e.owner!==previewSalesperson)return;
  show('Customer enquiry',`<button class="back-link" data-enquiry-board>‹ All enquiries</button><h2>${escape(e.name)}</h2><p class="meta">${escape(e.asset)}<br>${escape(e.phone)}</p><div class="enquiry-services"><h3>Services</h3>${e.services.map((s,i)=>`<div class="enquiry-service"><div><strong>${escape(s.name)}</strong>${s.stage==='Booked'?`<span class="booked-label">Booked</span>`:''}</div>${s.stage==='Booked'?`<button class="text-button" data-demo-order="${escape(s.order)}" data-enquiry-id="${e.id}" data-order-service="${escape(s.name)}">View order</button>`:`<select aria-label="${escape(s.name)} status" data-service-index="${i}" data-enquiry-id="${e.id}">${enquiryStages.map(stage=>`<option ${stage===s.stage?'selected':''}>${stage}</option>`).join('')}</select>`}</div>`).join('')}</div><form id="enquiry-followup" data-enquiry-id="${e.id}"><div class="followup-heading"><h3>Your follow-up</h3><span>${pendingServices(e).length?'Open':'No undecided services'}</span></div><label>Next action<textarea name="next" rows="3" maxlength="500" placeholder="What would you like to do next?">${escape(e.next)}</textarea></label><label>Reminder date <span class="optional">Optional</span><input type="date" name="date" value="${escape(e.followDate)}"></label><p class="field-help">Choose your date, or leave it empty. Due and overdue reminders appear on Home.</p><button class="primary">Save follow-up</button></form>${e.history.length?`<details class="followup-history"><summary>Notes (${e.history.length})</summary>${e.history.map(n=>`<p>${escape(n)}</p>`).join('')}</details>`:''}<p class="sample-footer">Sample data · No live orders or reminders are changed.</p>`);
}
function confirmServiceBooking(enquiryId,index){
  const e=enquiries.find(e=>e.id===enquiryId),s=e?.services[index];if(!s||s.stage==='Booked')return;
  pendingServiceBooking={enquiryId,index};
  show('Book one service',`<h2>${escape(s.name)}</h2><p class="meta">${escape(e.name)} · ${escape(e.asset)}</p><div class="detail-block"><h3>This booking</h3><p>Create a sample ${escape(s.name.toLowerCase())} order only.</p></div><p>Other services stay unchanged.</p><button class="primary" data-confirm-service>Book ${escape(s.name)}</button><button class="back-link" data-enquiry="${e.id}">Cancel</button><p class="sample-footer">Preview only. No sale or payment is recorded.</p>`);
}
function newEnquiry(){
  show('New enquiry','<h2>Start a conversation</h2><form id="enquiry-create"><label>Name<input name="name" required maxlength="100" autocomplete="off"></label><label>Phone number<input name="phone" type="tel" required maxlength="30" autocomplete="off"></label><fieldset class="interest-picker"><legend>Interested in</legend>'+['Tint','Coating','PPF','Spray','Building tint'].map(s=>`<label><input type="checkbox" name="service" value="${s}">${s}</label>`).join('')+'</fieldset><p class="field-help">Choose several car services, or building tint as its own enquiry. Car and IC details can wait.</p><p id="enquiry-form-error" role="alert"></p><button class="primary">Add enquiry</button></form>');
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.id==='enquiries'||b.dataset.enquiryBoard!==undefined)openEnquiryBoard();
  if(b.dataset.productFilter){enquiryFilter=b.dataset.productFilter;openEnquiryBoard();}
  if(b.dataset.enquiry)openEnquiry(b.dataset.enquiry);
  if(b.id==='new-lead'||b.dataset.enquiryNew!==undefined)newEnquiry();
  if(b.dataset.demoOrder){const e=enquiries.find(e=>e.id===b.dataset.enquiryId);show('Booked service',`<button class="back-link" data-enquiry="${e.id}">‹ Back to enquiry</button><h2>${escape(b.dataset.orderService)} order</h2><p class="meta">${escape(e.name)} · ${escape(e.asset)}</p><div class="detail-block"><h3>Order</h3><p>${escape(b.dataset.demoOrder)}</p></div><div class="detail-block"><h3>Status</h3><p>Booked</p></div><p>Only this service is on this sample order.</p>`);}
  if(b.dataset.confirmService!==undefined&&pendingServiceBooking){const {enquiryId,index}=pendingServiceBooking;const e=enquiries.find(e=>e.id===enquiryId),s=e.services[index];if(s.stage!=='Booked'){s.stage='Booked';s.order='ADG-DEMO-'+String(++demoOrderSequence);orders.push({owner:previewSalesperson,id:'demo-order-'+demoOrderSequence,time:String(demoOrderSequence),small:'Order',name:e.name,description:e.asset+' · '+s.name,category:'Booked',next:'Confirm the installation arrangements.',order:s.order});e.history.push(s.name+' booked as '+s.order+'.');}pendingServiceBooking=null;render();openEnquiry(enquiryId);}
  if(b.id==='reset-demo'){enquiries=structuredClone(initialEnquiries);enquiryFilter='All';demoOrderSequence=40;pendingServiceBooking=null;tasks.splice(0,tasks.length,...structuredClone(baselineTasks));orders.splice(0,orders.length,...structuredClone(baselineOrders));render();}
});
document.addEventListener('change',event=>{
  const input=event.target;if(input.dataset.serviceIndex!==undefined){const id=input.dataset.enquiryId,index=Number(input.dataset.serviceIndex);if(input.value==='Booked'){confirmServiceBooking(id,index);}else{const e=enquiries.find(e=>e.id===id);e.services[index].stage=input.value;render();openEnquiry(id);}}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='enquiry-followup'){event.preventDefault();const form=new FormData(event.target),e=enquiries.find(e=>e.id===event.target.dataset.enquiryId);e.next=String(form.get('next')||'').trim();e.followDate=String(form.get('date')||'');e.history.push(e.next||'Reminder updated.');render();openEnquiry(e.id);notice('Follow-up updated in this preview.');}
  if(event.target.id==='enquiry-create'){event.preventDefault();const form=new FormData(event.target),services=form.getAll('service');if(!services.length){$('#enquiry-form-error').textContent='Choose at least one service.';return;}if(services.includes('Building tint')&&services.length>1){$('#enquiry-form-error').textContent='Keep building tint in its own enquiry.';return;}const id='e'+(enquiries.length+1);enquiries.push({id,owner:previewSalesperson,name:String(form.get('name')).trim(),phone:String(form.get('phone')).trim(),asset:services[0]==='Building tint'?'Property details not added yet':'Car details not added yet',kind:services[0]==='Building tint'?'building':'car',services:services.map(name=>({name,stage:'New'})),followDate:'',next:'',history:[]});render();openEnquiry(id);notice('Enquiry added to this preview only.');}
});
render();
// Shared sample profile; sales conversations remain separate.
profile=function(){
 const mine=enquiries.filter(e=>e.name==='Mei Lin'&&e.owner===previewSalesperson);
 show('Customer profile',`<h2>Mei Lin</h2><p class="meta">010-0000001 · Shared customer profile</p><div class="detail-block"><h3>Cars</h3><p>Honda Civic · QAB 2188</p></div><div class="detail-block"><h3>Properties</h3><p>Home · Tabuan Jaya</p></div><div class="detail-block"><h3>Previous purchases</h3><p>Honda Civic · Tint installed · 12 June 2025</p><p>Warranty active until 12 June 2030 · DEMO-W001</p></div><div class="detail-block"><h3>Your enquiries</h3>${mine.map(e=>`<button class="choice" data-enquiry="${e.id}">${escape(e.asset)}<small>${e.services.map(s=>escape(s.name)+' · '+escape(s.stage)).join(' / ')}</small></button>`).join('')}</div><p class="sample-footer">Sample history. Ongoing discussions and quotations are private to each salesperson.</p>`);
};
const staffControl=document.createElement('label');
staffControl.innerHTML='Viewing as <select id="preview-salesperson" aria-label="Preview salesperson"><option>Alex</option><option>Ben</option></select>';
$('.preview-strip').insertBefore(staffControl,$('#reset-demo'));
const customerButton=document.createElement('button');customerButton.id='shared-customers';customerButton.className='text-button';customerButton.textContent='Customers';$('.list-actions').prepend(customerButton);
const ownerRender=render;
render=function(){
 const hidden=orders.filter(o=>(o.owner||'Alex')!==previewSalesperson);
 const visible=orders.filter(o=>(o.owner||'Alex')===previewSalesperson);
 orders.splice(0,orders.length,...visible);ownerRender();orders.push(...hidden);
};
document.addEventListener('change',event=>{if(event.target.id==='preview-salesperson'){previewSalesperson=event.target.value;completed.clear();$('#search').value='';$('#details').close();render();notice('Viewing '+previewSalesperson+'’s sample work.');}});
document.addEventListener('click',event=>{if(event.target.closest('#shared-customers'))show('Customers',`<h2>Find a customer</h2><label>Name, phone or car plate<input id="shared-customer-search" type="search" placeholder="Try Mei Lin, 0100000001 or QAB 2188"></label><div id="shared-customer-results"></div><p class="field-help">Shared profiles and purchase history. Your enquiries stay private.</p>`);});
document.addEventListener('input',event=>{if(event.target.id==='shared-customer-search'){const q=event.target.value.toLowerCase().replace(/[^a-z0-9]/g,'');$('#shared-customer-results').innerHTML=q&&['meilin','0100000001','qab2188'].some(v=>v.includes(q))?'<button class="choice" data-profile>Mei Lin<small>010-0000001 · Honda Civic · QAB 2188</small></button>':q?'<p>No matching sample customer.</p>':'';}});
