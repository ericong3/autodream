import type { ReactNode } from 'react';
import { Clock, ArrowRight } from 'lucide-react';
import { formatTime } from '../utils/garageWorkOrderTimeline';
import type { PipelineStage, ActivityEvent } from '../utils/garageWorkOrderTimeline';

export {default as PipelineStageTiles} from './GarageJourneyNavigator';

const STATE_TEXT:Record<PipelineStage['state'],string>={done:'Done',current:'Now',upcoming:'Pending'};

const EYEBROW: Record<PipelineStage['state'], string> = {
  current: 'Current Stage',
  done: 'Completed Stage',
  upcoming: 'Upcoming Stage',
};

// The selected stage — what it is, who's responsible, what the salesman
// sees, and what's been recorded for it. Read-only.
export function StagePanel({
  stage, salesmanSees, children,
}: { stage: PipelineStage; salesmanSees: string; children?: ReactNode }) {
  return (
    <div>
      <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${
        stage.state === 'current' ? 'text-gold-400' : 'text-white/40'
      }`}>
        {EYEBROW[stage.state]}
      </p>
      <h3 aria-live="polite" aria-atomic="true" className="font-display text-xl text-white font-semibold tracking-wide mb-2">{stage.headline}</h3>
      <p className="text-white/55 text-sm leading-relaxed mb-5 whitespace-pre-line">{stage.note}</p>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl p-3.5 bg-white/[0.03] border border-white/10">
          <p className="text-white/40 text-[11px] mb-1">{stage.state === 'current' ? 'Responsible now' : 'Responsible'}</p>
          <p className="text-white text-sm font-semibold">{stage.responsible}</p>
        </div>
        <div className="rounded-xl p-3.5 bg-white/[0.03] border border-white/10">
          <p className="text-white/40 text-[11px] mb-1">Salesman sees</p>
          <p className="text-white text-sm font-semibold">{salesmanSees}</p>
        </div>
      </div>

      {stage.facts.length > 0 && (
        <div className="rounded-xl border border-white/10 divide-y divide-white/[0.06] mb-5">
          {stage.facts.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="text-white/60">{f.label}</span>
              <span className="text-white text-right">
                {f.by && <span className="text-gold-400 font-medium">{f.by}</span>}
                {f.by && f.at && <span className="text-white/30"> · </span>}
                {f.at && formatTime(f.at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}

// Everything that's happened to the work order — newest first.
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <p className="text-white/40 text-sm">No activity recorded yet.</p>;
  }
  const newestFirst = [...events].reverse();
  return (
    <ol className="relative">
      {newestFirst.map((e, i) => {
        const latest = i === 0;
        const last = i === newestFirst.length - 1;
        // Per-glass confirmations can run to 8+ entries — keep them quieter
        // than the work order's milestone events.
        const minor = e.type === 'GLASS_ITEM_COMPLETED' || e.type === 'GLASS_ITEM_REOPENED';
        return (
          <li key={e.key} className={`relative flex gap-3 ${last ? '' : minor ? 'pb-2.5' : 'pb-4'}`}>
            {!last && <span className="absolute left-[4px] top-3 bottom-0 w-px bg-white/10" />}
            <span className={`relative shrink-0 rounded-full mt-1.5 ${
              latest
                ? 'w-[9px] h-[9px] bg-gold-400 shadow-[0_0_10px_rgba(212,175,55,0.7)]'
                : minor
                  ? 'w-[9px] h-[9px] border border-white/25 bg-obsidian-950'
                  : 'w-[9px] h-[9px] bg-gold-400/50'
            }`} />
            <div className="flex-1 min-w-0">
              <p className={minor ? 'text-white/60 text-xs' : 'text-white text-sm font-medium'}>
                {e.label}{e.by && !minor && <span className="text-white/50 font-normal"> · {e.by}</span>}
              </p>
              <p className="text-white/40 text-xs mt-0.5 flex items-center gap-1 flex-wrap">
                <Clock size={10} className="shrink-0" /> {formatTime(e.at)}
                {minor && e.by && <span>· {e.by}</span>}
                {e.detail && <span className="text-white/50">· {e.detail}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function NextAction({ text }: { text: string }) {
  return (
    <div className="mt-5 pt-5 border-t border-white/10">
      <p className="text-white/40 text-[11px] font-semibold uppercase tracking-wider mb-1.5">Next Action</p>
      <p className="flex items-center gap-2 text-white text-sm font-semibold">
        <ArrowRight size={14} className="text-gold-400 shrink-0" /> {text}
      </p>
    </div>
  );
}

// Compact tracker for list cards — one dot per stage, current one lit.
export function MiniPipeline({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="flex items-center gap-0 mt-2.5" aria-label="Work order progress">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1 last:flex-none">
          <span
            title={`${s.label}: ${STATE_TEXT[s.state]}`}
            className={`relative shrink-0 rounded-full ${
              s.state === 'current'
                ? 'w-2.5 h-2.5 bg-gold-400 shadow-[0_0_8px_rgba(212,175,55,0.8)]'
                : s.state === 'done'
                  ? 'w-2 h-2 bg-gold-400/70'
                  : 'w-2 h-2 border border-white/20'
            }`}
          />
          {i < stages.length - 1 && (
            <span className={`h-px flex-1 mx-0.5 ${stages[i + 1].state === 'upcoming' ? 'bg-white/10' : 'bg-gold-400/40'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export function MiniPipelineLabels({ stages }: { stages: PipelineStage[] }) {
  return (
    <div className="hidden sm:flex justify-between mt-1">
      {stages.map((s) => (
        <span key={s.key} className={`text-[9px] uppercase tracking-wider ${
          s.state === 'current' ? 'text-gold-400 font-semibold' : s.state === 'done' ? 'text-white/40' : 'text-white/20'
        }`}>
          {s.label}
        </span>
      ))}
    </div>
  );
}
