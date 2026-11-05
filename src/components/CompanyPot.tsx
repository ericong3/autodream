import { useState } from 'react';
import { Link } from 'react-router-dom';
import { companyBankRequest } from '../lib/companyBankPayments';
import { formatCents, useInvestorQuery } from '../lib/investorFinance';
import { CarPhoto, Figure, LoadState } from './InvestorFinanceCar';

type Summary = { companyCashCents: number; unpaidCompanyCents: number; customerHeldCents: number; availableCents: number };
type Stock = { id: string; make: string; model: string; year?: number; car_plate?: string; photo?: string; status: string; purchaseCents?: number };
export default function CompanyPot({ actorId }: { actorId: string }) {
  const [page, setPage] = useState(0);
  const query = useInvestorQuery<{company: Summary; cars: Stock[]; hasMore: boolean}>(`company-pot:${actorId}:${page}`, () => companyBankRequest('company',{page}));
  return <section className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-white font-semibold">Company pot</h2><button type="button" className="px-3 py-2 text-sm text-gold-300" onClick={() => void query.reload()}>Refresh</button></div>
    <LoadState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
      {query.data && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-white/10 p-4">
          <Figure label="Recorded money" value={formatCents(query.data.company.companyCashCents)} />
          <Figure label="Bills waiting" value={formatCents(query.data.company.unpaidCompanyCents)} />
          <Figure label="Customer money held" value={formatCents(query.data.company.customerHeldCents)} />
          <Figure label="Money left after bills" value={formatCents(query.data.company.availableCents)} tone="text-gold-300" />
        </div>
        <p className="text-gray-400 text-sm">Based on recorded bank money and bills. Past bank statements still need checking.</p>
        <h3 className="text-white text-sm font-medium">Company cars in stock</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{query.data.cars.map(car => <Link key={car.id} to={`/inventory/${encodeURIComponent(car.id)}`} className="rounded-xl border border-white/10 hover:border-gold-500/40 focus-visible:outline focus-visible:outline-gold-400 overflow-hidden">
          <CarPhoto src={car.photo ?? null} className="aspect-[16/10] w-full" />
          <div className="p-3"><p className="text-white text-sm font-medium">{car.year} {car.make} {car.model}</p><p className="text-gray-300 text-sm mt-1">{car.car_plate || 'Plate pending'}</p><p className="text-gray-400 text-sm mt-1">Car cost {formatCents(car.purchaseCents)}</p></div>
        </Link>)}</div>
        {!query.data.cars.length && <p className="text-gray-400 text-sm py-6">No company cars in stock.</p>}
        <div className="flex justify-between">{page>0 ? <button type="button" className="text-gold-300 px-3 py-2 text-sm" onClick={() => setPage(page-1)}>Previous</button> : <span />}{query.data.hasMore && <button type="button" className="text-gold-300 px-3 py-2 text-sm" onClick={() => setPage(page+1)}>More cars</button>}</div>
      </>}
    </LoadState>
  </section>;
}
