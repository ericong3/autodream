// Isolated layout trial. No API calls, browser storage, messages, or transactions.
const tasks=[
  {id:'t1',time:'Yesterday',small:'Follow up',name:'Mei Lin',description:'Honda Civic · QAB 2188 · Tint',category:'Follow up',overdue:true,next:'Check whether Mei Lin wants to proceed with the quotation.',order:'ADG-DEMO-028'},
  {id:'t2',time:'10:00',small:'Today',name:'Daniel Tan',description:'BMW 320i · QAA 8821 · Tint + Coating',category:'Booking',next:'Confirm arrival for the tint and coating appointment.',order:'ADG-DEMO-029'},
  {id:'t3',time:'11:30',small:'Today',name:'Sara Lim',description:'Building tint · Tabuan Jaya',category:'Site visit',next:'Visit the property and measure the glass.',order:'ADG-DEMO-030'},
  {id:'t4',time:'15:00',small:'Today',name:'Ahmad',description:'Toyota Vios · QAB 3308 · Coating',category:'Handover',ready:true,next:'Confirm collection time and explain the care instructions.',order:'ADG-DEMO-031'}
];
const orders=[...tasks.map((t,i)=>({...t,id:'o'+i,time:t.order.slice(-3),small:'Order',category:['Quotation','Booked','Site visit','Ready'][i],overdue:false})),{id:'o4',time:'032',small:'Order',name:'Jason Lee',description:'Perodua Ativa · QAB 5192 · PPF',category:'In progress',next:'Check workshop progress before updating the customer.',order:'ADG-DEMO-032'},{id:'o5',time:'033',small:'Order',name:'Farah',description:'Honda City · QAB 7721 · Spray',category:'Booked',next:'Confirm the agreed paintwork scope.',order:'ADG-DEMO-033'}];
let view='today',completed=new Set(),toastTimer;
const $=s=>document.querySelector(s),escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){
  const query=$('#search').value.trim().toLowerCase();
  const all=view==='today'?tasks.filter(t=>!completed.has(t.id)):orders;
  const visible=all.filter(t=>[t.name,t.description,t.category,t.order].join(' ').toLowerCase().includes(query));
  $('#today-count').textContent=tasks.length-completed.size;$('#orders-count').textContent=orders.length;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));
  $('#list-title').textContent=view==='today'?'Today’s work':'My orders';$('#new-lead').hidden=view!=='today';
  $('#work-list').setAttribute('aria-labelledby',view==='today'?'today-tab':'orders-tab');
  $('#work-list').innerHTML=visible.length?visible.map(t=>`<button class="work-row" data-item="${t.id}" aria-label="Open ${escape(t.name)}, ${escape(t.category)}"><span class="when ${t.overdue?'overdue':''}">${escape(t.time)}<small>${escape(t.small)}</small></span><span><span class="customer">${escape(t.name)}</span><span class="description" style="display:block">${escape(t.description)}</span></span><span class="category ${t.ready?'ready':''}">${escape(t.category)}</span><span class="chevron" aria-hidden="true">›</span></button>`).join(''):`<div class="empty"><strong>${query?'No matches':'You’re up to date'}</strong>${query?'Try a customer name or number plate.':'Nothing else needs your attention today.'}</div>`;
  $('#list-summary').textContent=query?`${visible.length} ${visible.length===1?"match":"matches"}`:view==='today'?`${all.length} things to do today`:`${all.length} active orders`;
}
function show(category,html){$('#dialog-category').textContent=category;$('#dialog-content').innerHTML=html;$('#details').showModal();}
function notice(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);}
function openItem(id){const t=[...tasks,...orders].find(t=>t.id===id);if(!t)return;show(t.category,`<h2>${escape(t.name)}</h2><p class="meta">${escape(t.description)}</p><div class="detail-block"><h3>Next step</h3><p>${escape(t.next)}</p></div><div class="detail-block"><h3>Order</h3><p>${escape(t.order)}</p></div>${view==='today'?`<button class="primary" data-complete="${t.id}">Mark done</button>`:'<div class="detail-block"><h3>Status</h3><p>'+escape(t.category)+'</p></div>'}<p>Sample data · Nothing is saved to your app.</p>`);}
function sale(){show('New sale','<h2>Choose a customer</h2><p class="meta">Start with the customer, then their car or property.</p><button class="choice" data-new-customer>New customer<small>Add their details</small></button><button class="choice" data-existing-customer>Existing customer<small>Find their profile</small></button>');}
function profile(){show('Customer profile','<h2>Mei Lin</h2><p class="meta">Sample customer</p><div class="detail-block"><h3>Cars</h3><button class="choice" data-car>Honda Civic<small>QAB 2188</small></button></div><div class="detail-block"><h3>Properties</h3><button class="choice" data-property>Home<small>Building tint · Tabuan Jaya</small></button></div>');}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.view){view=button.dataset.view;$('#search').value='';render();}
  if(button.dataset.item)openItem(button.dataset.item);
  if(button.id==='close-dialog')$('#details').close();
  if(button.dataset.complete){completed.add(button.dataset.complete);$('#details').close();render();notice('Marked done in this preview.');}
  if(button.id==='new-sale'||button.dataset.section==='Sales')sale();
  if(button.dataset.existingCustomer!==undefined)show('Existing customer','<h2>Choose a customer</h2><button class="choice" data-profile>Mei Lin<small>Honda Civic · QAB 2188</small></button>');
  if(button.dataset.profile!==undefined)profile();
  if(button.dataset.newCustomer!==undefined)show('New customer','<h2>Customer details</h2><form id="customer-form"><label>Name<input required name="name" autocomplete="off"></label><label>Phone number<input required name="phone" type="tel" autocomplete="off"></label><button class="primary">Continue</button></form>');
  if(button.dataset.car!==undefined)show('New sale','<h2>Honda Civic</h2><p class="meta">Mei Lin · QAB 2188</p><div class="detail-block"><h3>Services</h3><p>Tint · Coating · PPF · Spray</p></div><p>The full sale continues from this customer and car.</p>');
  if(button.dataset.property!==undefined)show('Building tint','<h2>Home</h2><p class="meta">Mei Lin · Tabuan Jaya</p><div class="detail-block"><h3>Project</h3><p>Measurements, quotation and installation stay under this customer.</p></div>');
  if(button.id==='new-lead')show('New lead','<h2>Customer enquiry</h2><form id="lead-form"><label>Name<input name="name" required autocomplete="off"></label><label>Phone number<input name="phone" type="tel" required autocomplete="off"></label><label>Interested in<input name="interest" placeholder="Tint, coating, PPF, spray or building tint" required></label><button class="primary">Add lead</button></form>');
  if(button.dataset.section==='Jobs')show('Jobs','<h2>Today’s appointments</h2><p class="meta">Sample schedule</p>'+tasks.filter(t=>!t.overdue).map(t=>`<div class="detail-block"><h3>${t.time} · ${escape(t.category)}</h3><p>${escape(t.name)}</p></div>`).join(''));
  if(button.dataset.section==='Manage')show('Manage','<h2>Garage settings</h2><div class="detail-block"><h3>Team</h3><p>Members and director setup links</p></div><div class="detail-block"><h3>Pricing & films</h3><p>Service prices and tint options</p></div>');
  if(button.id==='reset-demo'){completed.clear();view='today';$('#search').value='';render();notice('Preview reset.');}
});
document.addEventListener('submit',e=>{if(!['customer-form','lead-form'].includes(e.target.id))return;e.preventDefault();$('#details').close();notice('Preview only. No customer or lead was saved.');});
$('#search').addEventListener('input',render);$('#theme').addEventListener('change',e=>document.body.dataset.theme=e.target.value);
$('#details').addEventListener('click',e=>{if(e.target===$('#details')){const r=$('#details').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#details').close();}});
document.querySelector('[role=tablist]').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();view=view==='today'?'orders':'today';render();document.querySelector(`[data-view="${view}"]`).focus();});
render();
