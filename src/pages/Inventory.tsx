import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutGrid,
  List,
  Plus,
  Filter,
  ChevronDown,
  Car as CarIcon,
  AlertCircle,
  ImagePlus,
  X,
  FileText,
  Upload,
  MapPin,
} from 'lucide-react';
import { useStore } from '../store';
import { supabase } from '../lib/supabase';
import { Car } from '../types';
import Modal from '../components/Modal';
import { formatRM, formatMileage, generateId } from '../utils/format';


const STATUS_BADGE: Record<string, string> = {
  coming_soon: 'bg-purple-500/80 text-white',
  in_workshop: 'bg-orange-500/80 text-white',
  ready: 'bg-yellow-500/80 text-white',
  photo_complete: 'bg-blue-500/80 text-white',
  submitted: 'bg-indigo-500/80 text-white',
  deal_pending: 'bg-yellow-600/80 text-white',
  available: 'bg-green-500/80 text-white',
  reserved: 'bg-yellow-500/80 text-white',
  sold: 'bg-gray-500/80 text-white',
};

const STATUS_LABEL: Record<string, string> = {
  coming_soon: 'Coming Soon',
  in_workshop: 'In Workshop',
  ready: 'Ready',
  photo_complete: 'Photo Complete',
  submitted: 'Submitted',
  deal_pending: 'Deal Pending',
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
};

const CAR_MAKES = ['All', 'Perodua', 'Proton', 'Honda', 'Toyota', 'Nissan', 'Other'];

const emptyForm: Omit<Car, 'id' | 'dateAdded'> = {
  make: '',
  model: '',
  variant: '',
  year: new Date().getFullYear(),
  carPlate: '',
  colour: '',
  mileage: 0,
  condition: 'good',
  purchasePrice: 0,
  sellingPrice: 0,
  transmission: 'auto',
  status: 'available',
  photo: '',
  photos: [],
  greenCard: '',
  assignedSalesperson: '',
  notes: '',
  currentLocation: 'Showroom',
  consignment: undefined,
};

export default function Inventory() {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const addCar = useStore((s) => s.addCar);
  const dealers = useStore((s) => s.dealers);
  const viewPreference = useStore((s) => s.viewPreference);
  const setViewPreference = useStore((s) => s.setViewPreference);
  const navigate = useNavigate();

  const isDirector = currentUser?.role === 'director';
  const canAddCar = currentUser?.role === 'director' || currentUser?.role === 'salesperson';
  const viewKey = `${currentUser?.id}-inventory`;
  const view = viewPreference[viewKey] ?? 'grid';

  const [search, setSearch] = useState('');
  const [filterMake, setFilterMake] = useState('All');
  const [filterTransmission, setFilterTransmission] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [sortBy, setSortBy] = useState('dateAdded-desc');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const greenCardInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragIndexRef.current === null) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const photoEl = el?.closest('[data-photo-idx]') as HTMLElement | null;
    if (!photoEl) return;
    const targetIdx = Number(photoEl.dataset.photoIdx);
    const from = dragIndexRef.current;
    if (from === targetIdx) return;
    const updated = [...(form.photos ?? [])];
    const [moved] = updated.splice(from, 1);
    updated.splice(targetIdx, 0, moved);
    dragIndexRef.current = targetIdx;
    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
  };


  const compressImage = (file: File, maxWidth = 1280, quality = 0.82): Promise<Blob> =>
    new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality);
      };
      img.src = url;
    });

  const uploadToStorage = async (file: File, folder: string): Promise<string> => {
    const compressed = await compressImage(file);
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error } = await supabase.storage.from('car-photos').upload(path, compressed, { contentType: 'image/jpeg' });
    if (error) throw new Error(error.message);
    const { data } = supabase.storage.from('car-photos').getPublicUrl(path);
    return data.publicUrl;
  };

  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter((f) => f.type.startsWith('image/'));
    setUploadingPhotos(true);
    try {
      const urls = await Promise.all(valid.map((f) => uploadToStorage(f, 'cars')));
      const updated = [...(form.photos ?? []), ...urls].slice(0, 20);
      setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? prev.photo }));
      setErrors((prev) => ({ ...prev, photos: '' }));
    } catch (e) {
      setErrors((prev) => ({ ...prev, photos: 'Failed to upload photos. Please try again.' }));
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removePhoto = (idx: number) => {
    const updated = (form.photos ?? []).filter((_, i) => i !== idx);
    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
  };

  const handleGreenCard = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const url = await uploadToStorage(file, 'greencards');
    setForm((prev) => ({ ...prev, greenCard: url }));
    setErrors((prev) => ({ ...prev, greenCard: '' }));
  };

  const filtered = useMemo(() => {
    let result = cars.filter((c) => c.status !== 'sold');

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.make.toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q) ||
          c.colour.toLowerCase().includes(q) ||
          String(c.year).includes(q) ||
          (c.carPlate ?? '').toLowerCase().includes(q)
      );
    }
    if (filterMake !== 'All') result = result.filter((c) => c.make === filterMake);
    if (filterTransmission !== 'All')
      result = result.filter((c) => c.transmission === filterTransmission);
    if (filterStatus !== 'All')
      result = result.filter((c) => c.status === filterStatus);

    result.sort((a, b) => {
      switch (sortBy) {
        case 'dateAdded-desc':
          return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
        case 'dateAdded-asc':
          return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
        case 'price-asc':
          return a.sellingPrice - b.sellingPrice;
        case 'price-desc':
          return b.sellingPrice - a.sellingPrice;
        case 'brand-asc':
          return a.make.localeCompare(b.make);
        default:
          return 0;
      }
    });

    return result;
  }, [cars, search, filterMake, filterTransmission, filterStatus, sortBy]);

  const isComingSoon = form.status === 'coming_soon';

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};

    if (!form.make.trim()) newErrors.make = 'Make is required';
    if (!form.model.trim()) newErrors.model = 'Model is required';
    if (!form.colour.trim()) newErrors.colour = 'Colour is required';
    if (!isComingSoon && (form.photos?.length ?? 0) < 4) {
      newErrors.photos = 'Please upload at least 4 photos';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const newCar: Car = {
      ...form,
      id: generateId(),
      dateAdded: new Date().toISOString().split('T')[0],
    };

    setSubmitting(true);
    setSubmitError('');
    try {
      await addCar(newCar);
      setShowModal(false);
      setForm(emptyForm);
      setErrors({});
    } catch (e: any) {
      setSubmitError(e.message || 'Failed to save car. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getSalesperson = (id?: string) =>
    id ? users.find((u) => u.id === id)?.name ?? 'Unassigned' : 'Unassigned';

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search cars..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 pr-4 py-2.5"
          />
        </div>

        {/* Filters */}
        <Select value={filterMake} onChange={setFilterMake} options={CAR_MAKES} placeholder="Brand" />
        <Select
          value={filterTransmission}
          onChange={setFilterTransmission}
          options={['All', 'auto', 'manual']}
          placeholder="Transmission"
        />
        <Select
          value={filterStatus}
          onChange={setFilterStatus}
          options={['All', 'coming_soon', 'in_workshop', 'ready', 'photo_complete', 'submitted', 'deal_pending', 'available', 'reserved']}
          labels={['All Status', 'Coming Soon', 'In Workshop', 'Ready', 'Photo Complete', 'Submitted', 'Deal Pending', 'Available', 'Reserved']}
          placeholder="Status"
        />
        <Select
          value={sortBy}
          onChange={setSortBy}
          options={['dateAdded-desc', 'dateAdded-asc', 'price-asc', 'price-desc', 'brand-asc']}
          labels={['Newest First', 'Oldest First', 'Price: Low-High', 'Price: High-Low', 'Brand: A–Z']}
          placeholder="Sort"
        />

        {/* View toggle */}
        <div className="flex border border-obsidian-400/60 rounded-lg p-1 gap-1" style={{background:'#0E0D0B'}}>
          <button
            onClick={() => setViewPreference(currentUser!.id, 'inventory', 'grid')}
            className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewPreference(currentUser!.id, 'inventory', 'list')}
            className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            <List size={16} />
          </button>
        </div>

        {canAddCar && (
          <button
            onClick={() => { setForm(emptyForm); setErrors({}); setSubmitError(''); setShowModal(true); }}
            className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            <Plus size={16} />
            Add Car
          </button>
        )}
      </div>

      {/* Count */}
      <p className="text-gray-500 text-sm">
        Showing <span className="text-white font-medium">{filtered.length}</span> of {cars.length} cars
      </p>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CarIcon size={40} className="text-gray-600 mb-3" />
          <p className="text-gray-400 font-medium">No cars found</p>
          <p className="text-gray-600 text-sm mt-1">Try adjusting your filters</p>
        </div>
      )}

      {/* Grid view */}
      {view === 'grid' && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((car) => (
            <div
              key={car.id}
              onClick={() => navigate(`/inventory/${car.id}`)}
              className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden cursor-pointer hover:border-gold-500/40 hover:shadow-xl hover:shadow-gold-500/10 transition-all group"
            >
              {/* Photo */}
              <div className="h-36 bg-obsidian-700/60 flex items-center justify-center relative">
                {car.photo ? (
                  <img
                    src={car.photo}
                    alt={`${car.make} ${car.model}`}
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                    loading="lazy"
                    onLoad={(e) => e.currentTarget.classList.replace('opacity-0', 'opacity-100')}
                  />
                ) : (
                  <CarIcon size={40} className="text-gray-700 group-hover:text-gray-600 transition-colors" />
                )}
                <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[car.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                  {STATUS_LABEL[car.status] ?? car.status}
                </span>
                {!car.greenCard && car.status !== 'coming_soon' && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 bg-orange-500/80 border border-orange-400 text-white px-2 py-0.5 rounded-full text-[10px] font-medium">
                    <AlertCircle size={10} /> No Green Card
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-white font-semibold text-sm group-hover:text-gold-400 transition-colors">
                      {car.year} {car.make} {car.model}
                    </h3>
                    <p className="text-gray-500 text-xs mt-0.5">{car.variant ? `${car.variant} · ` : ''}{car.colour} · {car.transmission}</p>
                  </div>
                  {car.carPlate && (
                    <span className="ml-2 shrink-0 text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">
                      {car.carPlate}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <MapPin size={11} className="text-gray-500 flex-shrink-0" />
                  <span className="text-gray-400 text-xs truncate">{car.currentLocation ?? 'Showroom'}</span>
                </div>

                <p className="text-gray-400 text-xs mt-2">{formatMileage(car.mileage)}</p>

                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-gold-400 text-lg font-bold">{formatRM(car.sellingPrice)}</p>
                    {isDirector && (
                      <p className="text-green-400 text-xs font-medium mt-0.5">
                        Profit: {formatRM(car.sellingPrice - car.purchasePrice)}
                      </p>
                    )}
                  </div>
                </div>

                <p className="text-gray-600 text-xs mt-2 truncate">
                  {getSalesperson(car.assignedSalesperson)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {view === 'list' && filtered.length > 0 && (
        <div className="bg-card-gradient border border-obsidian-400/70 rounded-xl shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-obsidian-400/60 bg-obsidian-700/60">
                  <th className="text-left px-4 py-3 font-medium">Car</th>
                  <th className="text-left px-4 py-3 font-medium">Plate</th>
                  <th className="text-left px-4 py-3 font-medium">Year</th>
                  <th className="text-left px-4 py-3 font-medium">Colour</th>
                  <th className="text-left px-4 py-3 font-medium">Mileage</th>
                  <th className="text-left px-4 py-3 font-medium">Transmission</th>
                  <th className="text-left px-4 py-3 font-medium">Location</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Selling Price</th>
                  {isDirector && <th className="text-right px-4 py-3 font-medium">Profit</th>}
                  <th className="text-left px-4 py-3 font-medium">Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((car, i) => (
                  <tr
                    key={car.id}
                    onClick={() => navigate(`/inventory/${car.id}`)}
                    className={`border-b border-obsidian-400/60/50 cursor-pointer hover:bg-obsidian-700/50 transition-colors ${i % 2 === 0 ? 'bg-card-gradient' : 'bg-obsidian-950/30'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-obsidian-700/60 rounded-lg flex items-center justify-center">
                          <CarIcon size={14} className="text-gray-500" />
                        </div>
                        <span className="text-white font-medium">{car.make} {car.model}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {car.carPlate
                        ? <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#2C2415] text-gold-300 border border-[#3C321E] tracking-wider">{car.carPlate}</span>
                        : <span className="text-gray-600 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-400">{car.year}</td>
                    <td className="px-4 py-3 text-gray-400">{car.colour}</td>
                    <td className="px-4 py-3 text-gray-400">{formatMileage(car.mileage)}</td>
                    <td className="px-4 py-3 text-gray-400 capitalize">{car.transmission}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <MapPin size={11} className="text-gray-500 flex-shrink-0" />
                        <span className="text-gray-400 text-xs">{car.currentLocation ?? 'Showroom'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[car.status] ?? 'bg-gray-500/20 text-gray-400'}`}>
                          {STATUS_LABEL[car.status] ?? car.status}
                        </span>
                        {!car.greenCard && car.status !== 'coming_soon' && (
                          <span className="flex items-center gap-1 bg-orange-500/80 border border-orange-400 text-white px-2 py-0.5 rounded-full text-[10px] font-medium">
                            <AlertCircle size={10} /> No Green Card
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gold-400 font-semibold text-right">{formatRM(car.sellingPrice)}</td>
                    {isDirector && (
                      <td className="px-4 py-3 text-green-400 text-right">
                        {formatRM(car.sellingPrice - car.purchasePrice)}
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-400">{getSalesperson(car.assignedSalesperson)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Car Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add New Car" maxWidth="max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Make" error={errors.make}>
            <input
              className={inputCls(errors.make)}
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              placeholder="e.g. Perodua"
            />
          </FormField>
          <FormField label="Model" error={errors.model}>
            <input
              className={inputCls(errors.model)}
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g. Myvi"
            />
          </FormField>
          <FormField label="Variant" className="col-span-2">
            <input
              className={inputCls()}
              value={form.variant ?? ''}
              onChange={(e) => setForm({ ...form, variant: e.target.value })}
              placeholder="e.g. 1.5 Advance"
            />
          </FormField>
          <FormField label="Year" error={errors.year}>
            <input
              type="number"
              className={inputCls(errors.year)}
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Car Plate">
            <input
              className={inputCls()}
              value={form.carPlate ?? ''}
              onChange={(e) => setForm({ ...form, carPlate: e.target.value.toUpperCase() })}
              placeholder="e.g. WXX 1234"
            />
          </FormField>
          <FormField label="Colour" error={errors.colour}>
            <input
              className={inputCls(errors.colour)}
              value={form.colour}
              onChange={(e) => setForm({ ...form, colour: e.target.value })}
              placeholder="e.g. White"
            />
          </FormField>
          <FormField label="Mileage (km)" error={errors.mileage}>
            <input
              type="number"
              className={inputCls(errors.mileage)}
              value={form.mileage}
              onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Purchase Price (RM)" error={errors.purchasePrice}>
            <input
              type="number"
              className={inputCls(errors.purchasePrice)}
              value={form.purchasePrice}
              onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })}
            />
          </FormField>
          <FormField label={isDirector ? 'Selling Price (RM)' : 'Selling Price (RM) — Director only'} error={errors.sellingPrice}>
            <input
              type="number"
              className={inputCls(errors.sellingPrice)}
              value={form.sellingPrice}
              onChange={(e) => isDirector && setForm({ ...form, sellingPrice: Number(e.target.value) })}
              readOnly={!isDirector}
              placeholder={isDirector ? '' : 'Set by Director'}
              style={!isDirector ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            />
          </FormField>
          <FormField label="Transmission">
            <select
              className={inputCls()}
              value={form.transmission}
              onChange={(e) => setForm({ ...form, transmission: e.target.value as Car['transmission'] })}
            >
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </select>
          </FormField>
          <div className="flex items-center col-span-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, status: isComingSoon ? 'available' : 'coming_soon' })}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${isComingSoon ? 'bg-purple-500/10 border-purple-500/40 text-purple-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isComingSoon ? 'bg-purple-500 border-purple-500' : 'border-gray-600'}`}>
                {isComingSoon && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-medium">Coming Soon</p>
                <p className="text-xs opacity-60 mt-0.5">Car is confirmed but not yet in the shop</p>
              </div>
            </button>
          </div>
          {/* Consignment */}
          <div className="col-span-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, consignment: form.consignment ? undefined : { dealer: '', terms: 'fixed_amount', fixedAmount: 0 } })}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg border transition-colors text-left ${form.consignment ? 'bg-blue-500/10 border-blue-500/40 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400 hover:border-gold-500/40'}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${form.consignment ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}`}>
                {form.consignment && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <div>
                <p className="text-sm font-medium">Consignment with Dealer</p>
                <p className="text-xs opacity-60 mt-0.5">Car belongs to another dealer, sold on their behalf</p>
              </div>
            </button>

            {form.consignment && (
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-blue-500/30">
                <FormField label="Dealer Name">
                  <select
                    className={inputCls()}
                    value={form.consignment.dealer}
                    onChange={(e) => setForm({ ...form, consignment: { ...form.consignment!, dealer: e.target.value } })}
                  >
                    <option value="">— Select dealer —</option>
                    {dealers.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                  {dealers.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">No dealers yet — add them in the Data page under Car Dealers</p>
                  )}
                </FormField>

                <div>
                  <label className="block text-gray-300 text-xs font-medium mb-2">Consignment Terms</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, consignment: { ...form.consignment!, terms: 'fixed_amount' } })}
                      className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${form.consignment.terms === 'fixed_amount' ? 'bg-blue-500/15 border-blue-500/50 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400'}`}
                    >
                      <p className="font-medium">Fixed Amount</p>
                      <p className="text-xs opacity-60 mt-0.5">Dealer takes back a set amount</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, consignment: { ...form.consignment!, terms: 'profit_split', splitPercent: 50 } })}
                      className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${form.consignment.terms === 'profit_split' ? 'bg-blue-500/15 border-blue-500/50 text-blue-300' : 'bg-obsidian-700/60 border-obsidian-400/60 text-gray-400'}`}
                    >
                      <p className="font-medium">Profit Split</p>
                      <p className="text-xs opacity-60 mt-0.5">Split profit after expenses</p>
                    </button>
                  </div>
                </div>

                {form.consignment.terms === 'fixed_amount' && (
                  <FormField label="Dealer Takes Back (RM)">
                    <input
                      type="number"
                      className={inputCls()}
                      value={form.consignment.fixedAmount ?? 0}
                      onChange={(e) => setForm({ ...form, consignment: { ...form.consignment!, fixedAmount: Number(e.target.value) } })}
                    />
                  </FormField>
                )}

                {form.consignment.terms === 'profit_split' && (
                  <FormField label="Dealer's Split (%)">
                    <input
                      type="number"
                      className={inputCls()}
                      value={form.consignment.splitPercent ?? 50}
                      min={1}
                      max={99}
                      onChange={(e) => setForm({ ...form, consignment: { ...form.consignment!, splitPercent: Number(e.target.value) } })}
                    />
                  </FormField>
                )}
              </div>
            )}
          </div>

          <FormField label="Notes" className="col-span-2">
            <textarea
              className={`${inputCls()} h-20 resize-none`}
              value={form.notes ?? ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Any additional notes..."
            />
          </FormField>

          {/* Car Photos — not required for Coming Soon */}
          {!isComingSoon && <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-gray-300 text-xs font-medium">
                Car Photos
                <span className="ml-1.5 text-gray-500 font-normal">(minimum 4 required)</span>
              </label>
              <span className={`text-xs font-medium ${(form.photos?.length ?? 0) >= 4 ? 'text-green-400' : 'text-yellow-400'}`}>
                {form.photos?.length ?? 0} / 4 min
              </span>
            </div>

            {/* Thumbnail grid — drag to reorder */}
            <div className="flex flex-wrap gap-2 mb-2">
              {(form.photos ?? []).map((src, idx) => (
                <div
                  key={idx}
                  data-photo-idx={idx}
                  draggable
                  onDragStart={() => { dragIndexRef.current = idx; }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const from = dragIndexRef.current;
                    if (from === null || from === idx) return;
                    const updated = [...(form.photos ?? [])];
                    const [moved] = updated.splice(from, 1);
                    updated.splice(idx, 0, moved);
                    dragIndexRef.current = idx;
                    setForm((prev) => ({ ...prev, photos: updated, photo: updated[0] ?? '' }));
                  }}
                  onDragEnd={() => { dragIndexRef.current = null; }}
                  onTouchStart={() => { dragIndexRef.current = idx; }}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={() => { dragIndexRef.current = null; }}
                  style={{ touchAction: 'none' }}
                  className="relative w-20 h-20 rounded-lg overflow-hidden border border-obsidian-400/60 group cursor-grab active:cursor-grabbing"
                >
                  <img src={src} alt={`car-${idx + 1}`} className="w-full h-full object-cover pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  >
                    <X size={12} className="text-white" />
                  </button>
                  {idx === 0 && (
                    <span className="absolute bottom-0 left-0 right-0 bg-gold-500/80 text-white text-[9px] text-center py-0.5">
                      Cover
                    </span>
                  )}
                </div>
              ))}

              {/* Uploading indicator */}
              {uploadingPhotos && (
                <div className="w-20 h-20 rounded-lg border border-obsidian-400/60 flex flex-col items-center justify-center gap-1 text-gold-400">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-[9px]">Uploading...</span>
                </div>
              )}

              {/* Add photo button */}
              {!uploadingPhotos && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-obsidian-400/60 hover:border-gold-500/50 flex flex-col items-center justify-center gap-1 text-gray-600 hover:text-gold-400 transition-colors"
                >
                  <ImagePlus size={18} />
                  <span className="text-[10px]">Add</span>
                </button>
              )}
            </div>

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handlePhotoFiles(e.target.files)}
            />

            {errors.photos && (
              <p className="text-red-400 text-xs flex items-center gap-1">
                <AlertCircle size={12} /> {errors.photos}
              </p>
            )}
          </div>}

          {/* Green Card */}
          {!isComingSoon && <div className="col-span-2">
            <label className="block text-gray-300 text-xs font-medium mb-1.5">
              Green Card
              <span className="ml-1.5 text-gray-500 font-normal">(JPG, PNG or PDF)</span>
            </label>

            {form.greenCard ? (
              <div className="flex items-center gap-3 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg p-3">
                {form.greenCard.startsWith('data:image') ? (
                  <img src={form.greenCard} alt="green card" className="w-16 h-12 object-cover rounded border border-obsidian-400/60" />
                ) : (
                  <div className="w-16 h-12 bg-green-500/10 border border-green-500/30 rounded flex items-center justify-center">
                    <FileText size={20} className="text-green-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-medium">Green card uploaded</p>
                  <p className="text-gray-500 text-xs mt-0.5">Click replace to change</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => greenCardInputRef.current?.click()}
                    className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, greenCard: '' }))}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => greenCardInputRef.current?.click()}
                className={`w-full border-2 border-dashed ${errors.greenCard ? 'border-red-500/50' : 'border-obsidian-400/60 hover:border-gold-500/50'} rounded-lg p-5 flex flex-col items-center gap-2 text-gray-600 hover:text-gold-400 transition-colors`}
              >
                <Upload size={20} />
                <span className="text-xs">Click to upload green card</span>
                <span className="text-[10px] text-gray-700">JPG, PNG, PDF accepted</span>
              </button>
            )}

            <input
              ref={greenCardInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => handleGreenCard(e.target.files)}
            />

            {errors.greenCard && (
              <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                <AlertCircle size={12} /> {errors.greenCard}
              </p>
            )}
          </div>}
        </div>

        {submitError && (
          <p className="mt-4 text-red-400 text-xs flex items-center gap-1.5">
            <AlertCircle size={13} /> {submitError}
          </p>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => setShowModal(false)}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || uploadingPhotos}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Saving...
              </>
            ) : 'Add Car'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  labels,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels?: string[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input appearance-none pl-3 pr-8 py-2.5 cursor-pointer"
      >
        {options.map((opt, i) => (
          <option key={opt} value={opt}>
            {labels ? labels[i] : opt === 'All' ? placeholder ?? opt : opt}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  );
}

function FormField({
  label,
  children,
  error,
  className,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-gray-300 text-xs font-medium mb-1.5">{label}</label>
      {children}
      {error && (
        <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  );
}

function inputCls(error?: string) {
  return `input ${error ? '!border-red-500/50' : ''}`;
}

// Export Filter icon for use
export { Filter };
