import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car as CarIcon, Search, TrendingUp, CheckCircle, DollarSign } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, formatMileage } from '../utils/format';
import StatCard from '../components/StatCard';

export default function History() {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');

  const soldCars = useMemo(() => {
    let result = cars.filter((c) => c.status === 'sold');
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.make.toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q) ||
          c.colour.toLowerCase().includes(q) ||
          String(c.year).includes(q)
      );
    }
    return result.sort(
      (a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
    );
  }, [cars, search]);

  const totalRevenue = soldCars.reduce((s, c) => s + (c.finalDeal?.dealPrice ?? c.sellingPrice), 0);
  const totalProfit = soldCars.reduce((s, c) => s + ((c.finalDeal?.dealPrice ?? c.sellingPrice) - c.purchasePrice), 0);

  const getSalesperson = (id?: string) =>
    id ? users.find((u) => u.id === id)?.name ?? '—' : '—';

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Cars Sold"
          value={soldCars.length}
          icon={CheckCircle}
          borderColor="border-l-green-400"
          iconColor="text-green-400"
        />
        <StatCard
          title="Total Revenue"
          value={formatRM(totalRevenue)}
          icon={DollarSign}
          borderColor="border-l-cyan-400"
          iconColor="text-cyan-400"
        />
        <StatCard
          title="Total Profit"
          value={formatRM(totalProfit)}
          icon={TrendingUp}
          borderColor="border-l-yellow-400"
          iconColor="text-yellow-400"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search sold cars..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0d1526] border border-[#1a2a4a] text-white placeholder-gray-600 rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Count */}
      <p className="text-gray-500 text-sm">
        <span className="text-white font-medium">{soldCars.length}</span> sold car{soldCars.length !== 1 ? 's' : ''}
      </p>

      {/* Empty */}
      {soldCars.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CarIcon size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">No sold cars yet</p>
        </div>
      )}

      {/* Table */}
      {soldCars.length > 0 && (
        <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-[#1a2a4a] bg-[#111d35]">
                  <th className="text-left px-4 py-3 font-medium">Car</th>
                  <th className="text-left px-4 py-3 font-medium">Year</th>
                  <th className="text-left px-4 py-3 font-medium">Colour</th>
                  <th className="text-left px-4 py-3 font-medium">Mileage</th>
                  <th className="text-left px-4 py-3 font-medium">Salesperson</th>
                  <th className="text-right px-4 py-3 font-medium">Purchase Price</th>
                  <th className="text-right px-4 py-3 font-medium">Deal Price</th>
                  <th className="text-right px-4 py-3 font-medium">Profit</th>
                  <th className="text-left px-4 py-3 font-medium">Bank</th>
                </tr>
              </thead>
              <tbody>
                {soldCars.map((car, i) => {
                  const dealPrice = car.finalDeal?.dealPrice ?? car.sellingPrice;
                  const profit = dealPrice - car.purchasePrice;
                  return (
                    <tr
                      key={car.id}
                      onClick={() => navigate(`/inventory/${car.id}`)}
                      className={`border-b border-[#1a2a4a]/50 cursor-pointer hover:bg-[#111d35] transition-colors ${i % 2 === 0 ? 'bg-[#0d1526]' : 'bg-[#0a0f1e]/50'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {car.photo ? (
                            <img src={car.photo} alt="" className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-9 h-9 bg-[#111d35] rounded-lg flex items-center justify-center flex-shrink-0">
                              <CarIcon size={14} className="text-gray-500" />
                            </div>
                          )}
                          <span className="text-white font-medium">{car.make} {car.model}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{car.year}</td>
                      <td className="px-4 py-3 text-gray-400">{car.colour}</td>
                      <td className="px-4 py-3 text-gray-400">{formatMileage(car.mileage)}</td>
                      <td className="px-4 py-3 text-gray-400">{getSalesperson(car.assignedSalesperson)}</td>
                      <td className="px-4 py-3 text-gray-400 text-right">{formatRM(car.purchasePrice)}</td>
                      <td className="px-4 py-3 text-cyan-400 font-semibold text-right">{formatRM(dealPrice)}</td>
                      <td className={`px-4 py-3 font-semibold text-right ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatRM(profit)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{car.finalDeal?.bank ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
