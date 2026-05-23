import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Car as CarIcon } from 'lucide-react';
import { Car, Customer } from '../types';
import { formatRM } from '../utils/format';
import { thumbUrl } from '../utils/photoUrl';

type ColId = 'stock' | 'coming_soon' | 'pending' | 'delivered';

const COLS: { id: ColId; label: string; head: string; border: string; glow: string }[] = [
  { id: 'stock',        label: 'All Inventory',    head: 'text-teal-400',   border: 'border-teal-500/20',   glow: 'ring-teal-500/30'   },
  { id: 'coming_soon',  label: 'Coming Soon',       head: 'text-purple-400', border: 'border-purple-500/20', glow: 'ring-purple-500/30' },
  { id: 'pending',      label: 'Pending Delivery',  head: 'text-amber-400',  border: 'border-amber-500/20',  glow: 'ring-amber-500/30'  },
  { id: 'delivered',    label: 'Delivered',          head: 'text-violet-400', border: 'border-violet-500/20', glow: 'ring-violet-500/30' },
];

const DROP_STATUS: Record<ColId, string> = {
  stock:       'available',
  coming_soon: 'coming_soon',
  pending:     'sold',
  delivered:   'delivered',
};

function getCarCol(car: Car): ColId {
  if (car.status === 'coming_soon') return 'coming_soon';
  if (car.status === 'delivered')   return 'delivered';
  if (car.status === 'sold' || car.finalDeal) return 'pending';
  return 'stock';
}

// ── Card ─────────────────────────────────────────────────────────────────────

function MiniCard({ car, customer, ghost }: { car: Car; customer?: Customer; ghost?: boolean }) {
  const photo = car.photos?.[0] || car.photo;
  return (
    <div className={`bg-[#0f0e0c] border border-obsidian-400/50 rounded-xl overflow-hidden select-none ${ghost ? 'opacity-40' : ''}`}>
      {photo
        ? <img src={thumbUrl(photo, 400) ?? photo} alt="" className="w-full h-20 object-cover" />
        : <div className="w-full h-20 bg-obsidian-800 flex items-center justify-center"><CarIcon size={20} className="text-obsidian-600" /></div>
      }
      <div className="px-3 py-2.5 space-y-0.5">
        <p className="text-white text-[11px] font-semibold truncate">{car.year} {car.make} {car.model}</p>
        <p className="text-gray-500 text-[10px]">{car.carPlate || '—'}</p>
        {customer && <p className="text-gold-400 text-[10px] truncate">→ {customer.name}</p>}
        <p className="text-white text-xs font-bold mt-0.5">{formatRM(car.sellingPrice)}</p>
      </div>
    </div>
  );
}

// ── Sortable card wrapper ─────────────────────────────────────────────────────

function SortableCard({ car, customer }: { car: Car; customer?: Customer }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: car.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing">
      <MiniCard car={car} customer={customer} ghost={isDragging} />
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────────────

function KanbanCol({
  col, carIds, carMap, customerMap, isOver,
}: {
  col: typeof COLS[number];
  carIds: string[];
  carMap: Map<string, Car>;
  customerMap: Map<string, Customer>;
  isOver: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: col.id });

  return (
    <div className={`flex flex-col rounded-2xl border ${col.border} bg-obsidian-900/40 ${isOver ? `ring-2 ${col.glow}` : ''} transition-all w-[270px] shrink-0`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-obsidian-400/30 flex items-center justify-between shrink-0">
        <span className={`text-[11px] font-bold uppercase tracking-widest ${col.head}`}>{col.label}</span>
        <span className="text-[10px] text-gray-600 bg-obsidian-700/60 px-2 py-0.5 rounded-full font-semibold">{carIds.length}</span>
      </div>

      {/* Drop zone + sortable list */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[160px]">
        <SortableContext items={carIds} strategy={verticalListSortingStrategy}>
          {carIds.map(id => {
            const car = carMap.get(id);
            if (!car) return null;
            const buyer = customerMap.get(id);
            return <SortableCard key={id} car={car} customer={buyer} />;
          })}
        </SortableContext>
        {carIds.length === 0 && (
          <div className="flex items-center justify-center h-16 text-gray-700 text-xs border border-dashed border-obsidian-400/20 rounded-xl">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main board ───────────────────────────────────────────────────────────────

interface Props {
  cars: Car[];
  customers: Customer[];
  onStatusChange: (carId: string, newStatus: string) => void;
}

export default function InventoryKanban({ cars, customers, onStatusChange }: Props) {
  // Local column order — CarId arrays per column
  const [cols, setCols] = useState<Record<ColId, string[]>>(() => buildCols(cars));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColId, setOverColId] = useState<ColId | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Re-sync when cars change externally (add / delete / status update)
  useEffect(() => {
    setCols(prev => {
      const next = buildCols(cars);
      // Preserve user-defined order within each column, append new arrivals
      for (const colId of Object.keys(next) as ColId[]) {
        const existingOrder = (prev[colId] ?? []).filter(id => next[colId].includes(id));
        const newArrivals  = next[colId].filter(id => !existingOrder.includes(id));
        next[colId] = [...existingOrder, ...newArrivals];
      }
      return next;
    });
  }, [cars]);

  const carMap = new Map(cars.map(c => [c.id, c]));
  // buyer map: carId → customer who has a work order for that car
  const customerMap = new Map<string, Customer>(
    customers
      .filter(c => c.interestedCarId && (c.cashWorkOrder || c.loanWorkOrder))
      .map(c => [c.interestedCarId!, c])
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  // Auto-scroll board while dragging near edges
  const handlePointerMove = (e: PointerEvent) => {
    if (!activeId || !boardRef.current) return;
    const board = boardRef.current;
    const { left, right } = board.getBoundingClientRect();
    const margin = 80;
    if (e.clientX < left + margin)       board.scrollLeft -= 8;
    else if (e.clientX > right - margin) board.scrollLeft += 8;
  };
  useEffect(() => {
    if (activeId) window.addEventListener('pointermove', handlePointerMove);
    else          window.removeEventListener('pointermove', handlePointerMove);
    return ()  => window.removeEventListener('pointermove', handlePointerMove);
  }, [activeId]);

  const findColOfCard = (cardId: string): ColId | null => {
    for (const colId of Object.keys(cols) as ColId[]) {
      if (cols[colId].includes(cardId)) return colId;
    }
    return null;
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id as string);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) { setOverColId(null); return; }
    const activeCardId = active.id as string;
    const overId = over.id as string;
    const sourceCol = findColOfCard(activeCardId);

    // over is a column header
    if (COLS.some(c => c.id === overId)) {
      const targetCol = overId as ColId;
      setOverColId(targetCol);
      if (sourceCol === targetCol) return;
      // Move card into target column on hover (live preview)
      setCols(prev => {
        const src = prev[sourceCol!].filter(id => id !== activeCardId);
        const tgt = [...prev[targetCol], activeCardId];
        return { ...prev, [sourceCol!]: src, [targetCol]: tgt };
      });
      return;
    }

    // over is another card
    const targetCol = findColOfCard(overId);
    if (!targetCol) return;
    setOverColId(targetCol);
    if (sourceCol === targetCol) {
      // Reorder within same column
      setCols(prev => {
        const arr = prev[targetCol];
        const oldIdx = arr.indexOf(activeCardId);
        const newIdx = arr.indexOf(overId);
        if (oldIdx === -1 || newIdx === -1) return prev;
        return { ...prev, [targetCol]: arrayMove(arr, oldIdx, newIdx) };
      });
    } else {
      // Move to target column before the hovered card
      setCols(prev => {
        const src = prev[sourceCol!].filter(id => id !== activeCardId);
        const tgt = [...prev[targetCol]];
        const insertIdx = tgt.indexOf(overId);
        if (insertIdx >= 0) tgt.splice(insertIdx, 0, activeCardId);
        else tgt.push(activeCardId);
        return { ...prev, [sourceCol!]: src, [targetCol]: tgt };
      });
    }
  };

  const handleDragEnd = ({ active }: DragEndEvent) => {
    const cardId = active.id as string;
    const finalCol = findColOfCard(cardId);
    const originalCar = carMap.get(cardId);
    if (finalCol && originalCar) {
      const newStatus = DROP_STATUS[finalCol];
      const originalCol = getCarCol(originalCar);
      if (finalCol !== originalCol) {
        onStatusChange(cardId, newStatus);
      }
    }
    setActiveId(null);
    setOverColId(null);
  };

  const handleDragCancel = () => {
    // Rebuild from original car data to undo live preview
    setCols(buildCols(cars));
    setActiveId(null);
    setOverColId(null);
  };

  const activeCar = activeId ? carMap.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        ref={boardRef}
        className="flex gap-4 overflow-x-auto pb-6 px-4 pt-2 items-start"
        style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
      >
        {COLS.map(col => (
          <div key={col.id} style={{ scrollSnapAlign: 'start' }}>
            <KanbanCol
              col={col}
              carIds={cols[col.id] ?? []}
              carMap={carMap}
              customerMap={customerMap}
              isOver={overColId === col.id}
            />
          </div>
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeCar && <MiniCard car={activeCar} customer={customerMap.get(activeCar.id)} />}
      </DragOverlay>
    </DndContext>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCols(cars: Car[]): Record<ColId, string[]> {
  const result: Record<ColId, string[]> = { stock: [], coming_soon: [], pending: [], delivered: [] };
  for (const car of cars) result[getCarCol(car)].push(car.id);
  return result;
}
