import React, { useState } from 'react';
import { GitCompare, X, Search } from 'lucide-react';
import { useStore } from '../store';
import { Car } from '../types';
import { formatRM, formatMileage } from '../utils/format';

const CONDITION_COLORS: Record<Car['condition'], string> = {
  excellent: 'text-green-400',
  good: 'text-gold-400',
  fair: 'text-yellow-400',
  poor: 'text-red-400',
};

const STATUS_LABELS: Record<Car['status'], string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  delivered: 'Delivered',
  coming_soon: 'Coming Soon',
  in_workshop: 'In Workshop',
  ready: 'Ready',
  photo_complete: 'Photo Complete',
  submitted: 'Submitted',
  deal_pending: 'Deal Pending',
};

const STATUS_COLORS: Record<Car['status'], string> = {
  available: 'text-green-400',
  reserved: 'text-yellow-400',
  sold: 'text-gray-500',
  delivered: 'text-violet-400',
  coming_soon: 'text-blue-400',
  in_workshop: 'text-orange-400',
  ready: 'text-gold-400',
  photo_complete: 'text-purple-400',
  submitted: 'text-indigo-400',
  deal_pending: 'text-pink-400',
};

export default function CarCompare() {
  const cars = useStore((s) => s.cars);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const selectedCars = selectedIds.map(id => cars.find(c => c.id === id)).filter(Boolean) as Car[];

  const availableCars = cars.filter(c =>
    !selectedIds.includes(c.id) &&
    (!search || `${c.year} ${c.make} ${c.model} ${c.colour}`.toLowerCase().includes(search.toLowerCase()))
  );

  const addCar = (id: string) => {
    if (selectedIds.length < 3) setSelectedIds([...selectedIds, id]);
  };

  const removeCar = (id: string) => setSelectedIds(selectedIds.filter(s => s !== id));

  // Best value: lowest selling price among available/reserved cars
  const bestPriceId = selectedCars.length > 1
    ? [...selectedCars]
        .filter(c => c.status === 'available' || c.status === 'reserved')
        .sort((a, b) => a.sellingPrice - b.sellingPrice)[0]?.id
    : null;

  const compareRows: { label: string; render: (car: Car) => React.ReactNode }[] = [
    { label: 'Make', render: c => <span className="text-white font-medium">{c.make}</span> },
    { label: 'Model', render: c => <span className="text-white">{c.model}</span> },
    { label: 'Year', render: c => <span className="text-white">{c.year}</span> },
    { label: 'Colour', render: c => <span className="text-white capitalize">{c.colour}</span> },
    { label: 'Mileage', render: c => <span className="text-white">{formatMileage(c.mileage)}</span> },
    { label: 'Transmission', render: c => <span className="text-white capitalize">{c.transmission}</span> },
    {
      label: 'Condition',
      render: c => <span className={`capitalize font-semibold ${CONDITION_COLORS[c.condition]}`}>{c.condition}</span>,
    },
    { label: 'Status', render: c => <span className={`font-medium ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span> },
    {
      label: 'Selling Price',
      render: c => <span className="text-gold-400 font-bold text-base">{formatRM(c.sellingPrice)}</span>,
    },
    {
      label: 'Purchase Price',
      render: c => <span className="text-gray-400">{formatRM(c.purchasePrice)}</span>,
    },
    {
      label: 'Est. Profit',
      render: c => {
        const margin = c.sellingPrice - c.purchasePrice;
        return <span className={margin >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{formatRM(margin)}</span>;
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-white text-xl font-bold flex items-center gap-2">
          <GitCompare size={22} className="text-gold-400" />
          Car Comparison
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Compare up to 3 cars side by side</p>
      </div>

      {/* Car picker */}
      <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-xs font-medium">Select cars to compare <span className="text-gray-600">({selectedIds.length}/3)</span></p>
          {selectedIds.length > 0 && (
            <button onClick={() => setSelectedIds([])} className="text-xs text-gray-600 hover:text-red-400 transition-colors">Clear all</button>
          )}
        </div>

        {/* Selected cars chips */}
        {selectedCars.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedCars.map(car => (
              <div key={car.id} className="flex items-center gap-1.5 bg-gold-500/10 border border-gold-500/30 rounded-lg px-2.5 py-1.5">
                <span className="text-gold-400 text-xs font-medium">{car.year} {car.make} {car.model}</span>
                <button onClick={() => removeCar(car.id)} className="text-gold-600 hover:text-red-400 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {selectedIds.length < 3 && (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                type="text"
                placeholder="Search cars..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-obsidian-700/60 border border-obsidian-400/60 text-white placeholder-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors"
              />
            </div>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {availableCars.map(car => (
                <button
                  key={car.id}
                  onClick={() => addCar(car.id)}
                  className="px-3 py-1.5 text-xs bg-obsidian-700/60 border border-obsidian-400/60 text-gray-400 hover:text-white hover:border-gold-500/30 rounded-lg transition-colors"
                >
                  {car.year} {car.make} {car.model} · {formatRM(car.sellingPrice)}
                </button>
              ))}
              {availableCars.length === 0 && (
                <p className="text-gray-600 text-xs">No more cars to add</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Comparison Table */}
      {selectedCars.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card">
          <GitCompare size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400">Select at least one car above to compare</p>
        </div>
      ) : (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-obsidian-400/60 bg-[#161410]">
                <th className="text-left px-5 py-4 text-gray-500 font-medium text-xs w-36">Spec</th>
                {selectedCars.map(car => (
                  <th key={car.id} className="px-5 py-4 text-center min-w-[180px] relative">
                    <div className="relative inline-block">
                      {car.id === bestPriceId && (
                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full text-xs bg-green-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                          Best Value
                        </span>
                      )}
                      <p className="text-white font-semibold">{car.make} {car.model}</p>
                      <p className="text-gray-500 text-xs">{car.year} · {car.colour}</p>
                    </div>
                    <button
                      onClick={() => removeCar(car.id)}
                      className="absolute top-3 right-3 text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </th>
                ))}
                {/* Placeholder columns */}
                {Array.from({ length: 3 - selectedCars.length }).map((_, j) => (
                  <th key={`ph-${j}`} className="px-5 py-4 text-center min-w-[180px]">
                    <p className="text-gray-700 text-xs">— Empty Slot —</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row, i) => (
                <tr key={row.label} className={`border-b border-obsidian-400/60/50 ${i % 2 !== 0 ? 'bg-[#080808]/30' : ''}`}>
                  <td className="px-5 py-3 text-gray-500 text-xs font-medium">{row.label}</td>
                  {selectedCars.map(car => (
                    <td key={car.id} className="px-5 py-3 text-center">{row.render(car)}</td>
                  ))}
                  {Array.from({ length: 3 - selectedCars.length }).map((_, j) => (
                    <td key={`ph-${j}`} className="px-5 py-3 text-center text-gray-700 text-xs">—</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
