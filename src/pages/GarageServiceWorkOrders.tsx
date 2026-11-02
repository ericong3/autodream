import {useState} from 'react';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {ClipboardList,Car,User,UserCheck,ChevronRight,LayoutGrid,List} from 'lucide-react';
import GarageShell from '../components/GarageShell';
import GarageWorkOrderBoard from '../components/GarageWorkOrderBoard';
import {JobPriorityBadges,useNow} from '../components/GarageJobPriority';
import {getJobTiming} from '../utils/garageJobPriority';
import {useStore} from '../store';
import {GARAGE_SERVICE_MAP} from '../utils/garageServices';
import {isWorkOrderClosed,WORK_ORDER_STAGE_LABEL,WORK_ORDER_STAGE_BADGE} from '../utils/garageWorkOrderStatus';
import type {GarageService} from '../types';
import type {GarageTrackingState} from '../lib/garageTracking';

// Manager-level oversight — every work order for one service, across every
// salesman, unlike "My Pipeline" which is scoped to the logged-in
// salesman's own orders. Two views of the same work orders: an operational
// Kanban board (the default for Tinted, which has the full installer
// pipeline) and the original list.
export default function GarageServiceWorkOrders({serviceKey,embedded=false,tracking}:{serviceKey?:GarageService|'all';embedded?:boolean;tracking:GarageTrackingState}) {
  const { service: routeService } = useParams<{ service: string }>();
  const service=serviceKey??routeService;
  const navigate = useNavigate();
  const allUsers = useStore((s) => s.users);
  const {loading,error}=tracking;
  const [showClosed,setShowClosed]=useState(false);
  const [search,setSearch]=useState('');
  // In the URL so opening a card and coming back keeps the chosen view.
  const [searchParams, setSearchParams] = useSearchParams();
  const hasBoard = service === 'tinted'||service==='all';
  const viewKey=embedded?'view-'+service:'view';
  const view: 'board' | 'list' = hasBoard && searchParams.get(viewKey) !== 'list' ? 'board' : 'list';
  const setView = (v: 'board' | 'list') => setSearchParams(previous=>{const next=new URLSearchParams(previous);next.set(viewKey,v);return next;}, { replace: true });
  const nameOf = (id?: string) => (id ? allUsers.find((u) => u.id === id)?.name : undefined);
  // Upcoming / Due Now / Overdue / Running Late — derived, refreshed each minute.
  const now = useNow();

  const meta = service==='all'?{label:'Vehicle',icon:ClipboardList}:GARAGE_SERVICE_MAP[service as GarageService];

  const rows=service==='all'?tracking.rows:tracking.rows.filter(row=>row.invoice.service===service);
  const searched=rows.filter(r=>!search.trim()||[r.invoice.invoiceNumber,r.vehicle?.make,r.vehicle?.model,r.vehicle?.registrationNo,r.customer?.name,nameOf(r.invoice.salesOwnerId??r.invoice.createdBy)].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const activeRows = searched.filter((r) => !isWorkOrderClosed(r.invoice));
  const closed = searched.filter((r) => isWorkOrderClosed(r.invoice));
  const visible = showClosed ? closed : activeRows;

  const content = (
      <div className={view === 'board' ? '' : 'max-w-2xl mx-auto'}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2.5">
            <ClipboardList size={18} className="text-gold-400" />
            <h2 className="font-display text-lg text-white font-semibold tracking-wide">{meta?.label ?? 'Service'} Work Orders</h2>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
          {hasBoard && (
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {([['board', 'Board', LayoutGrid], ['list', 'List', List]] as const).map(([v, label, Icon]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? 'bg-gold-500/15 text-gold-400' : 'bg-white/[0.03] text-white/50 hover:text-white/80'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          )}
          {view === 'list' && (
          <div className="flex gap-1.5">
            {([[false, `Active (${activeRows.length})`], [true, `Closed (${closed.length})`]] as [boolean, string][]).map(([val, label]) => (
              <button
                key={String(val)}
                onClick={() => setShowClosed(val)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  showClosed === val
                    ? 'bg-gold-500/15 border-gold-400/50 text-gold-400'
                    : 'bg-white/[0.03] border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          )}
          </div>
        </div>

        <input aria-label="Search work orders" type="search" placeholder="Search invoice, vehicle, customer or salesperson" value={search} onChange={e=>setSearch(e.target.value)} className="w-full min-h-[44px] mb-4 rounded-xl border border-white/15 bg-white/[.04] px-4 py-3 text-white text-sm placeholder:text-white/40 focus:outline-none focus:border-gold-400/50"/>
        {error?<div role="alert" className="text-red-300 text-sm py-8">{error}<button onClick={tracking.reload} className="ml-3 text-gold-300 underline">Try again</button></div>:loading ? (
          <p className="text-white/40 text-sm text-center py-20">Loading…</p>
        ) : view === 'board' ? (
          // The board breaks out of the page's reading-width column to use
          // the whole screen — seven columns don't fit in a form-width frame.
          <div className="relative left-1/2 w-screen -translate-x-1/2 px-5 sm:px-8">
            <GarageWorkOrderBoard
              rows={searched}
              showService={service==='all'}
              nameOf={nameOf}
              onOpen={(invoiceId) => navigate(`/garage/invoice/${invoiceId}`)}
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div className="absolute w-20 h-20 rounded-full bg-gold-400/10 blur-xl" />
              <ClipboardList size={34} strokeWidth={1.5} className="relative text-gold-400/70" />
            </div>
            <p className="text-white/40 text-sm">{showClosed ? 'No closed work orders yet' : 'No active work orders yet'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(({ invoice, vehicle, customer, job, stage }) => {
              const rowMeta = GARAGE_SERVICE_MAP[invoice.service];
              const creator = allUsers.find((u) => u.id === (invoice.salesOwnerId??invoice.createdBy));
              return (
                <button
                  key={invoice.id}
                  onClick={() => navigate(`/garage/invoice/${invoice.id}`)}
                  className="w-full flex items-center gap-3 text-left rounded-xl p-4
                    bg-white/[0.04] backdrop-blur-xl border border-gold-400/15
                    hover:border-gold-400/40 hover:bg-white/[0.06] transition-colors"
                >
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-gold-400/10 flex items-center justify-center text-gold-400">
                    <rowMeta.icon size={16} strokeWidth={1.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-sm font-medium">{invoice.invoiceNumber}</p>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${WORK_ORDER_STAGE_BADGE[stage]}`}>
                        {WORK_ORDER_STAGE_LABEL[stage]}
                      </span>
                      <JobPriorityBadges timing={getJobTiming(invoice, job, now)} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-white/40 text-xs flex-wrap">
                      {vehicle && (
                        <span className="flex items-center gap-1"><Car size={11} /> {vehicle.make} {vehicle.model} · {vehicle.registrationNo}</span>
                      )}
                      {customer && (
                        <span className="flex items-center gap-1"><User size={11} /> {customer.name}</span>
                      )}
                      {creator && (
                        <span className="flex items-center gap-1"><UserCheck size={11} /> {creator.name}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-gold-400/50 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
  );
  return embedded?content:<GarageShell title={`${meta?.label ?? 'Service'} Work Orders`} showBack backTo="/garage/work-order-tracking">{content}</GarageShell>;
}
