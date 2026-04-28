import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import { User, Car, RepairJob, Quotation, Instruction, Customer, TestDrive, PersonalReminder, Dealer, Workshop, Supplier, Merchant, MiscCost } from '../types';

interface StoreState {
  currentUser: User | null;
  users: User[];
  cars: Car[];
  repairs: RepairJob[];
  quotations: Quotation[];
  instructions: Instruction[];
  customers: Customer[];
  testDrives: TestDrive[];
  personalReminders: PersonalReminder[];
  dealers: Dealer[];
  workshops: Workshop[];
  suppliers: Supplier[];
  merchants: Merchant[];
  viewPreference: Record<string, 'grid' | 'list'>;
  loaded: boolean;

  // Init
  loadAll: () => Promise<void>;

  // Auth
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;

  // Cars
  addCar: (car: Car) => Promise<void>;
  updateCar: (id: string, car: Partial<Car>) => Promise<void>;
  deleteCar: (id: string) => Promise<void>;

  // Repairs
  addRepair: (repair: RepairJob) => Promise<void>;
  updateRepair: (id: string, repair: Partial<RepairJob>) => Promise<void>;
  deleteRepair: (id: string) => Promise<void>;

  // Quotations
  addQuotation: (quotation: Quotation) => Promise<void>;
  updateQuotation: (id: string, quotation: Partial<Quotation>) => Promise<void>;
  deleteQuotation: (id: string) => Promise<void>;

  // Instructions
  addInstruction: (instruction: Instruction) => Promise<void>;
  updateInstruction: (id: string, instruction: Partial<Instruction>) => Promise<void>;
  deleteInstruction: (id: string) => Promise<void>;

  // Users
  addUser: (user: User) => Promise<void>;
  updateUser: (id: string, user: Partial<User>) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;

  // Customers
  addCustomer: (customer: Customer) => Promise<void>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;

  // Test Drives
  addTestDrive: (testDrive: TestDrive) => Promise<void>;
  updateTestDrive: (id: string, testDrive: Partial<TestDrive>) => Promise<void>;
  deleteTestDrive: (id: string) => Promise<void>;

  // Personal Reminders
  addPersonalReminder: (reminder: PersonalReminder) => Promise<void>;
  updatePersonalReminder: (id: string, reminder: Partial<PersonalReminder>) => Promise<void>;
  deletePersonalReminder: (id: string) => Promise<void>;

  // Dealers
  addDealer: (dealer: Dealer) => Promise<void>;
  deleteDealer: (id: string) => Promise<void>;

  // Workshops
  addWorkshop: (workshop: Workshop) => Promise<void>;
  deleteWorkshop: (id: string) => Promise<void>;

  // Suppliers
  addSupplier: (supplier: Supplier) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  // Merchants
  addMerchant: (merchant: Merchant) => Promise<void>;
  deleteMerchant: (id: string) => Promise<void>;

  // Misc Costs
  addMiscCost: (carId: string, misc: MiscCost) => Promise<void>;
  deleteMiscCost: (carId: string, miscId: string) => Promise<void>;

  // View preference
  setViewPreference: (userId: string, page: string, view: 'grid' | 'list') => void;
}

// Map snake_case DB row to camelCase Car
function rowToCar(r: any): Car {
  return {
    id: r.id,
    make: r.make,
    model: r.model,
    variant: r.variant,
    year: r.year,
    carPlate: r.car_plate,
    colour: r.colour,
    mileage: r.mileage,
    condition: r.condition,
    purchasePrice: r.purchase_price,
    sellingPrice: r.selling_price,
    transmission: r.transmission,
    status: r.status,
    photo: r.photo,
    photos: r.photos ?? [],
    greenCard: r.green_card,
    assignedSalesperson: r.assigned_salesperson,
    dateAdded: r.date_added,
    notes: r.notes,
    currentLocation: r.current_location,
    checklistItems: r.checklist_items ?? [],
    photoTakenBy: r.photo_taken_by ?? [],
    loanSubmissions: r.loan_submissions ?? [],
    finalDeal: r.final_deal,
    deliveryPhoto: r.delivery_photo,
    deliveryCollected: r.delivery_collected,
    consignment: r.consignment ?? undefined,
    priceFloor: r.price_floor ?? undefined,
    miscCosts: r.misc_costs ?? [],
  };
}

function carToRow(c: Partial<Car>) {
  const row: any = {};
  if (c.id !== undefined) row.id = c.id;
  if (c.make !== undefined) row.make = c.make;
  if (c.model !== undefined) row.model = c.model;
  if (c.variant !== undefined) row.variant = c.variant;
  if (c.year !== undefined) row.year = c.year;
  if (c.carPlate !== undefined) row.car_plate = c.carPlate;
  if (c.colour !== undefined) row.colour = c.colour;
  if (c.mileage !== undefined) row.mileage = c.mileage;
  if (c.condition !== undefined) row.condition = c.condition;
  if (c.purchasePrice !== undefined) row.purchase_price = c.purchasePrice;
  if (c.sellingPrice !== undefined) row.selling_price = c.sellingPrice;
  if (c.transmission !== undefined) row.transmission = c.transmission;
  if (c.status !== undefined) row.status = c.status;
  if (c.photo !== undefined) row.photo = c.photo;
  if (c.photos !== undefined) row.photos = c.photos;
  if (c.greenCard !== undefined) row.green_card = c.greenCard;
  if (c.assignedSalesperson !== undefined) row.assigned_salesperson = c.assignedSalesperson;
  if (c.dateAdded !== undefined) row.date_added = c.dateAdded;
  if (c.notes !== undefined) row.notes = c.notes;
  if (c.currentLocation !== undefined) row.current_location = c.currentLocation;
  if (c.checklistItems !== undefined) row.checklist_items = c.checklistItems;
  if (c.photoTakenBy !== undefined) row.photo_taken_by = c.photoTakenBy;
  if (c.loanSubmissions !== undefined) row.loan_submissions = c.loanSubmissions;
  if (c.finalDeal !== undefined) row.final_deal = c.finalDeal;
  if (c.deliveryPhoto !== undefined) row.delivery_photo = c.deliveryPhoto;
  if (c.deliveryCollected !== undefined) row.delivery_collected = c.deliveryCollected;
  if (c.consignment !== undefined) row.consignment = c.consignment;
  if (c.priceFloor !== undefined) row.price_floor = c.priceFloor;
  if (c.miscCosts !== undefined) row.misc_costs = c.miscCosts;
  return row;
}

function rowToRepair(r: any): RepairJob {
  return {
    id: r.id,
    carId: r.car_id,
    typeOfRepair: r.type_of_repair,
    parts: r.parts ?? [],
    labourCost: r.labour_cost,
    totalCost: r.total_cost,
    status: r.status,
    location: r.location,
    receiptPhoto: r.receipt_photo,
    actualCost: r.actual_cost,
    completedAt: r.completed_at,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

function repairToRow(r: Partial<RepairJob>) {
  const row: any = {};
  if (r.id !== undefined) row.id = r.id;
  if (r.carId !== undefined) row.car_id = r.carId;
  if (r.typeOfRepair !== undefined) row.type_of_repair = r.typeOfRepair;
  if (r.parts !== undefined) row.parts = r.parts;
  if (r.labourCost !== undefined) row.labour_cost = r.labourCost;
  if (r.totalCost !== undefined) row.total_cost = r.totalCost;
  if (r.status !== undefined) row.status = r.status;
  if (r.location !== undefined) row.location = r.location;
  if (r.receiptPhoto !== undefined) row.receipt_photo = r.receiptPhoto;
  if (r.actualCost !== undefined) row.actual_cost = r.actualCost;
  if (r.completedAt !== undefined) row.completed_at = r.completedAt;
  if (r.notes !== undefined) row.notes = r.notes;
  if (r.createdAt !== undefined) row.created_at = r.createdAt;
  return row;
}

function rowToQuotation(r: any): Quotation {
  return {
    id: r.id,
    type: r.type,
    contactName: r.contact_name,
    phone: r.phone,
    make: r.make,
    model: r.model,
    year: r.year,
    mileage: r.mileage,
    offeredPrice: r.offered_price,
    expiryDate: r.expiry_date,
    status: r.status,
    photo: r.photo,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

function quotationToRow(q: Partial<Quotation>) {
  const row: any = {};
  if (q.id !== undefined) row.id = q.id;
  if (q.type !== undefined) row.type = q.type;
  if (q.contactName !== undefined) row.contact_name = q.contactName;
  if (q.phone !== undefined) row.phone = q.phone;
  if (q.make !== undefined) row.make = q.make;
  if (q.model !== undefined) row.model = q.model;
  if (q.year !== undefined) row.year = q.year;
  if (q.mileage !== undefined) row.mileage = q.mileage;
  if (q.offeredPrice !== undefined) row.offered_price = q.offeredPrice;
  if (q.expiryDate !== undefined) row.expiry_date = q.expiryDate;
  if (q.status !== undefined) row.status = q.status;
  if (q.photo !== undefined) row.photo = q.photo;
  if (q.notes !== undefined) row.notes = q.notes;
  if (q.createdAt !== undefined) row.created_at = q.createdAt;
  return row;
}

function rowToInstruction(r: any): Instruction {
  return {
    id: r.id,
    type: r.type,
    fromId: r.from_id,
    toType: r.to_type,
    toDepartment: r.to_department,
    toIds: r.to_ids ?? [],
    title: r.title,
    message: r.message,
    status: r.status,
    requestCategory: r.request_category,
    requestTarget: r.request_target,
    amount: r.amount,
    createdAt: r.created_at,
  };
}

function instructionToRow(i: Partial<Instruction>) {
  const row: any = {};
  if (i.id !== undefined) row.id = i.id;
  if (i.type !== undefined) row.type = i.type;
  if (i.fromId !== undefined) row.from_id = i.fromId;
  if (i.toType !== undefined) row.to_type = i.toType;
  if (i.toDepartment !== undefined) row.to_department = i.toDepartment;
  if (i.toIds !== undefined) row.to_ids = i.toIds;
  if (i.title !== undefined) row.title = i.title;
  if (i.message !== undefined) row.message = i.message;
  if (i.status !== undefined) row.status = i.status;
  if (i.requestCategory !== undefined) row.request_category = i.requestCategory;
  if (i.requestTarget !== undefined) row.request_target = i.requestTarget;
  if (i.amount !== undefined) row.amount = i.amount;
  if (i.createdAt !== undefined) row.created_at = i.createdAt;
  return row;
}

function rowToCustomer(r: any): Customer {
  return {
    id: r.id,
    name: r.name,
    ic: r.ic,
    phone: r.phone,
    email: r.email,
    employer: r.employer,
    monthlySalary: r.monthly_salary,
    source: r.source,
    leadStatus: r.lead_status,
    interestedCarId: r.interested_car_id,
    assignedSalesId: r.assigned_sales_id,
    notes: r.notes,
    followUpDate: r.follow_up_date,
    dealPrice: r.deal_price,
    loanStatus: r.loan_status,
    loanBankSubmitted: r.loan_bank_submitted,
    loanApplications: r.loan_applications ?? [],
    followUpRemark: r.follow_up_remark ?? undefined,
    tradeIn: r.trade_in ?? undefined,
    cashWorkOrder: r.cash_work_order ?? undefined,
    loanWorkOrder: r.loan_work_order ?? undefined,
    delivered: r.delivered ?? false,
    deliveredAt: r.delivered_at ?? undefined,
    deliveryPhoto: r.delivery_photo_customer ?? undefined,
    postSaleChecklist: r.post_sale_checklist ?? undefined,
    lastActionAt: r.last_action_at ?? undefined,
    isDead: r.is_dead ?? false,
    deadAt: r.dead_at ?? undefined,
    isTrashed: r.is_trashed ?? false,
    trashedAt: r.trashed_at ?? undefined,
    commission: r.commission ?? undefined,
    createdAt: r.created_at,
  };
}

function customerToRow(c: Partial<Customer>) {
  const row: any = {};
  if (c.id !== undefined) row.id = c.id;
  if (c.name !== undefined) row.name = c.name;
  if (c.ic !== undefined) row.ic = c.ic;
  if (c.phone !== undefined) row.phone = c.phone;
  if (c.email !== undefined) row.email = c.email;
  if (c.employer !== undefined) row.employer = c.employer;
  if (c.monthlySalary !== undefined) row.monthly_salary = c.monthlySalary;
  if (c.source !== undefined) row.source = c.source;
  if (c.leadStatus !== undefined) row.lead_status = c.leadStatus;
  if (c.interestedCarId !== undefined) row.interested_car_id = c.interestedCarId;
  if (c.assignedSalesId !== undefined) row.assigned_sales_id = c.assignedSalesId;
  if (c.notes !== undefined) row.notes = c.notes;
  if (c.followUpDate !== undefined) row.follow_up_date = c.followUpDate;
  if (c.dealPrice !== undefined) row.deal_price = c.dealPrice;
  if (c.loanStatus !== undefined) row.loan_status = c.loanStatus;
  if (c.loanBankSubmitted !== undefined) row.loan_bank_submitted = c.loanBankSubmitted;
  if (c.loanApplications !== undefined) row.loan_applications = c.loanApplications;
  if (c.followUpRemark !== undefined) row.follow_up_remark = c.followUpRemark;
  if (c.tradeIn !== undefined) row.trade_in = c.tradeIn;
  if (c.cashWorkOrder !== undefined) row.cash_work_order = c.cashWorkOrder;
  if (c.loanWorkOrder !== undefined) row.loan_work_order = c.loanWorkOrder;
  if (c.delivered !== undefined) row.delivered = c.delivered;
  if (c.deliveredAt !== undefined) row.delivered_at = c.deliveredAt;
  if (c.deliveryPhoto !== undefined) row.delivery_photo_customer = c.deliveryPhoto;
  if (c.postSaleChecklist !== undefined) row.post_sale_checklist = c.postSaleChecklist;
  if (c.lastActionAt !== undefined) row.last_action_at = c.lastActionAt;
  if (c.isDead !== undefined) row.is_dead = c.isDead;
  if (c.deadAt !== undefined) row.dead_at = c.deadAt;
  if (c.isTrashed !== undefined) row.is_trashed = c.isTrashed;
  if (c.trashedAt !== undefined) row.trashed_at = c.trashedAt;
  if (c.commission !== undefined) row.commission = c.commission;
  if (c.createdAt !== undefined) row.created_at = c.createdAt;
  return row;
}

function rowToTestDrive(r: any): TestDrive {
  return {
    id: r.id,
    customerId: r.customer_id,
    carId: r.car_id,
    scheduledAt: r.scheduled_at,
    status: r.status,
    notes: r.notes,
    salesId: r.sales_id,
    createdAt: r.created_at,
  };
}

function testDriveToRow(t: Partial<TestDrive>) {
  const row: any = {};
  if (t.id !== undefined) row.id = t.id;
  if (t.customerId !== undefined) row.customer_id = t.customerId;
  if (t.carId !== undefined) row.car_id = t.carId;
  if (t.scheduledAt !== undefined) row.scheduled_at = t.scheduledAt;
  if (t.status !== undefined) row.status = t.status;
  if (t.notes !== undefined) row.notes = t.notes;
  if (t.salesId !== undefined) row.sales_id = t.salesId;
  if (t.createdAt !== undefined) row.created_at = t.createdAt;
  return row;
}

function rowToUser(r: any): User {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    password: r.password,
    role: r.role,
    phone: r.phone,
    monthlyTarget: r.monthly_target,
    carsInMonth: r.cars_in_month,
  };
}

function userToRow(u: Partial<User>) {
  const row: any = {};
  if (u.id !== undefined) row.id = u.id;
  if (u.name !== undefined) row.name = u.name;
  if (u.username !== undefined) row.username = u.username;
  if (u.password !== undefined) row.password = u.password;
  if (u.role !== undefined) row.role = u.role;
  if (u.phone !== undefined) row.phone = u.phone;
  if (u.monthlyTarget !== undefined) row.monthly_target = u.monthlyTarget;
  if (u.carsInMonth !== undefined) row.cars_in_month = u.carsInMonth;
  return row;
}

function rowToReminder(r: any): PersonalReminder {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    dueAt: r.due_at,
    isCompleted: r.is_completed,
    createdAt: r.created_at,
  };
}

function reminderToRow(r: Partial<PersonalReminder>) {
  const row: any = {};
  if (r.id !== undefined) row.id = r.id;
  if (r.userId !== undefined) row.user_id = r.userId;
  if (r.title !== undefined) row.title = r.title;
  if (r.dueAt !== undefined) row.due_at = r.dueAt;
  if (r.isCompleted !== undefined) row.is_completed = r.isCompleted;
  if (r.createdAt !== undefined) row.created_at = r.createdAt;
  return row;
}

export const useStore = create<StoreState>()(persist((set, get) => ({
  currentUser: null,
  users: [],
  cars: [],
  repairs: [],
  quotations: [],
  instructions: [],
  customers: [],
  testDrives: [],
  personalReminders: [],
  dealers: [],
  workshops: [],
  suppliers: [],
  merchants: [],
  viewPreference: {},
  loaded: false,

  loadAll: async () => {
    const [users, cars, repairs, quotations, instructions, customers, testDrives, reminders, dealers, workshops, suppliers, merchants] =
      await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('cars').select('*'),
        supabase.from('repairs').select('*'),
        supabase.from('quotations').select('*'),
        supabase.from('instructions').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('test_drives').select('*'),
        supabase.from('personal_reminders').select('*'),
        supabase.from('dealers').select('*'),
        supabase.from('workshops').select('*'),
        supabase.from('suppliers').select('*'),
        supabase.from('merchants').select('*'),
      ]);

    const allCars = (cars.data ?? []).map(rowToCar);
    const allCustomers = (customers.data ?? []).map(rowToCustomer);

    // Auto-reconcile: clear finalDeal on cars that have no confirmed customer
    const confirmedCarIds = new Set(
      allCustomers
        .filter(c => c.cashWorkOrder || c.loanWorkOrder)
        .map(c => c.interestedCarId)
        .filter(Boolean)
    );
    const orphanedCars = allCars.filter(c => c.finalDeal && !confirmedCarIds.has(c.id));
    if (orphanedCars.length > 0) {
      await Promise.all(orphanedCars.map(c =>
        supabase.from('cars').update({ final_deal: null, status: 'available' }).eq('id', c.id)
      ));
      orphanedCars.forEach(c => {
        const idx = allCars.findIndex(x => x.id === c.id);
        if (idx !== -1) allCars[idx] = { ...allCars[idx], finalDeal: undefined, status: 'available' };
      });
    }

    set({
      users: (users.data ?? []).map(rowToUser),
      cars: allCars,
      repairs: (repairs.data ?? []).map(rowToRepair),
      quotations: (quotations.data ?? []).map(rowToQuotation),
      instructions: (instructions.data ?? []).map(rowToInstruction),
      customers: allCustomers,
      testDrives: (testDrives.data ?? []).map(rowToTestDrive),
      personalReminders: (reminders.data ?? []).map(rowToReminder),
      dealers: (dealers.data ?? []) as Dealer[],
      workshops: (workshops.data ?? []) as Workshop[],
      suppliers: (suppliers.data ?? []) as Supplier[],
      merchants: (merchants.data ?? []) as Merchant[],
      loaded: true,
    });

    // Real-time subscriptions — keep all clients in sync
    supabase.channel('realtime-cars')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cars' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            cars: s.cars.some((c) => c.id === (payload.new as any).id)
              ? s.cars.map((c) => c.id === (payload.new as any).id ? rowToCar(payload.new) : c)
              : [...s.cars, rowToCar(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({
            cars: s.cars.map((c) => {
              if (c.id !== (payload.new as any).id) return c;
              const incoming = rowToCar(payload.new);
              // Preserve locally-stored miscCosts if the real-time payload omits the column
              if (!('misc_costs' in (payload.new as any))) {
                incoming.miscCosts = c.miscCosts;
              }
              return incoming;
            }),
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ cars: s.cars.filter((c) => c.id !== (payload.old as any).id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-customers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            customers: s.customers.some((c) => c.id === (payload.new as any).id)
              ? s.customers
              : [...s.customers, rowToCustomer(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ customers: s.customers.map((c) => c.id === (payload.new as any).id ? rowToCustomer(payload.new) : c) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ customers: s.customers.filter((c) => c.id !== (payload.old as any).id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-repairs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'repairs' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            repairs: s.repairs.some((r) => r.id === (payload.new as any).id)
              ? s.repairs
              : [...s.repairs, rowToRepair(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ repairs: s.repairs.map((r) => r.id === (payload.new as any).id ? rowToRepair(payload.new) : r) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ repairs: s.repairs.filter((r) => r.id !== (payload.old as any).id) }));
        }
      })
      .subscribe();
  },

  login: async (username, password) => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();
    if (data) {
      set({ currentUser: rowToUser(data) });
      return true;
    }
    return false;
  },

  logout: () => set({ currentUser: null }),

  // Cars
  addCar: async (car) => {
    set((s) => ({ cars: [...s.cars, car] }));
    const { error } = await supabase.from('cars').insert(carToRow(car));
    if (error) {
      set((s) => ({ cars: s.cars.filter((c) => c.id !== car.id) }));
      throw new Error(error.message);
    }
  },
  updateCar: async (id, car) => {
    set((s) => ({ cars: s.cars.map((c) => (c.id === id ? { ...c, ...car } : c)) }));
    const { error } = await supabase.from('cars').update(carToRow(car)).eq('id', id);
    if (error) console.error('updateCar failed:', error.message);
  },
  deleteCar: async (id) => {
    set((s) => ({ cars: s.cars.filter((c) => c.id !== id) }));
    const { error } = await supabase.from('cars').delete().eq('id', id);
    if (error) console.error('deleteCar failed:', error.message);
  },

  // Repairs
  addRepair: async (repair) => {
    const car = get().cars.find((c) => c.id === repair.carId);
    const isDelivered = car?.status === 'delivered';
    const updatedCars = repair.location && repair.status !== 'queued'
      ? get().cars.map((c) =>
          c.id === repair.carId
            ? { ...c, currentLocation: repair.location, ...(isDelivered ? {} : { status: 'in_workshop' as Car['status'] }) }
            : c
        )
      : get().cars;
    set((s) => ({ repairs: [...s.repairs, repair], cars: updatedCars }));
    const { error } = await supabase.from('repairs').insert(repairToRow(repair));
    if (error) console.error('addRepair failed:', error.message);
    if (repair.location && repair.status !== 'queued') {
      const dbUpdate: any = { current_location: repair.location };
      if (!isDelivered) dbUpdate.status = 'in_workshop';
      await supabase.from('cars').update(dbUpdate).eq('id', repair.carId);
    }
  },
  updateRepair: async (id, repair) => {
    const existing = get().repairs.find((r) => r.id === id);
    const { error: repErr } = await supabase.from('repairs').update(repairToRow(repair)).eq('id', id);
    if (repErr) console.error('updateRepair failed:', repErr.message);
    set((s) => {
      const updatedRepairs = s.repairs.map((r) => (r.id === id ? { ...r, ...repair } : r));
      let updatedCars = s.cars;
      if (existing) {
        if (repair.status === 'done') {
          updatedCars = s.cars.map((c) =>
            c.id === existing.carId ? { ...c, currentLocation: 'Showroom' } : c
          );
        } else if (repair.status === 'pending' && existing.status === 'queued') {
          const location = repair.location ?? existing.location;
          if (location) {
            updatedCars = s.cars.map((c) => {
              if (c.id !== existing.carId) return c;
              return { ...c, currentLocation: location, ...(c.status === 'delivered' ? {} : { status: 'in_workshop' as Car['status'] }) };
            });
          }
        } else if (repair.location) {
          updatedCars = s.cars.map((c) =>
            c.id === existing.carId ? { ...c, currentLocation: repair.location } : c
          );
        }
      }
      return { repairs: updatedRepairs, cars: updatedCars };
    });
  },
  deleteRepair: async (id) => {
    set((s) => ({ repairs: s.repairs.filter((r) => r.id !== id) }));
    await supabase.from('repairs').delete().eq('id', id);
  },

  // Quotations
  addQuotation: async (quotation) => {
    set((s) => ({ quotations: [...s.quotations, quotation] }));
    const { error } = await supabase.from('quotations').insert(quotationToRow(quotation));
    if (error) console.error('addQuotation failed:', error.message);
  },
  updateQuotation: async (id, quotation) => {
    set((s) => ({ quotations: s.quotations.map((q) => (q.id === id ? { ...q, ...quotation } : q)) }));
    await supabase.from('quotations').update(quotationToRow(quotation)).eq('id', id);
  },
  deleteQuotation: async (id) => {
    set((s) => ({ quotations: s.quotations.filter((q) => q.id !== id) }));
    await supabase.from('quotations').delete().eq('id', id);
  },

  // Instructions
  addInstruction: async (instruction) => {
    set((s) => ({ instructions: [...s.instructions, instruction] }));
    const { error } = await supabase.from('instructions').insert(instructionToRow(instruction));
    if (error) console.error('addInstruction failed:', error.message);
  },
  updateInstruction: async (id, instruction) => {
    set((s) => ({ instructions: s.instructions.map((i) => (i.id === id ? { ...i, ...instruction } : i)) }));
    await supabase.from('instructions').update(instructionToRow(instruction)).eq('id', id);
  },
  deleteInstruction: async (id) => {
    set((s) => ({ instructions: s.instructions.filter((i) => i.id !== id) }));
    await supabase.from('instructions').delete().eq('id', id);
  },

  // Users
  addUser: async (user) => {
    set((s) => ({ users: [...s.users, user] }));
    const { error } = await supabase.from('users').insert(userToRow(user));
    if (error) console.error('addUser failed:', error.message);
  },
  updateUser: async (id, user) => {
    set((s) => ({
      users: s.users.map((u) => (u.id === id ? { ...u, ...user } : u)),
      currentUser: s.currentUser?.id === id ? { ...s.currentUser, ...user } : s.currentUser,
    }));
    await supabase.from('users').update(userToRow(user)).eq('id', id);
  },
  deleteUser: async (id) => {
    set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
    await supabase.from('users').delete().eq('id', id);
  },

  // Customers
  addCustomer: async (customer) => {
    set((s) => ({ customers: [...s.customers, customer] }));
    const { error } = await supabase.from('customers').insert(customerToRow(customer));
    if (error) console.error('addCustomer failed:', error.message);
  },
  updateCustomer: async (id, customer) => {
    set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...customer } : c)) }));
    await supabase.from('customers').update(customerToRow(customer)).eq('id', id);
  },
  deleteCustomer: async (id) => {
    set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }));
    await supabase.from('customers').delete().eq('id', id);
  },

  // Test Drives
  addTestDrive: async (testDrive) => {
    set((s) => ({ testDrives: [...s.testDrives, testDrive] }));
    const { error } = await supabase.from('test_drives').insert(testDriveToRow(testDrive));
    if (error) console.error('addTestDrive failed:', error.message);
  },
  updateTestDrive: async (id, testDrive) => {
    set((s) => ({ testDrives: s.testDrives.map((t) => (t.id === id ? { ...t, ...testDrive } : t)) }));
    await supabase.from('test_drives').update(testDriveToRow(testDrive)).eq('id', id);
  },
  deleteTestDrive: async (id) => {
    set((s) => ({ testDrives: s.testDrives.filter((t) => t.id !== id) }));
    await supabase.from('test_drives').delete().eq('id', id);
  },

  // Personal Reminders
  addPersonalReminder: async (reminder) => {
    set((s) => ({ personalReminders: [...s.personalReminders, reminder] }));
    const { error } = await supabase.from('personal_reminders').insert(reminderToRow(reminder));
    if (error) console.error('addPersonalReminder failed:', error.message);
  },
  updatePersonalReminder: async (id, reminder) => {
    set((s) => ({ personalReminders: s.personalReminders.map((r) => (r.id === id ? { ...r, ...reminder } : r)) }));
    await supabase.from('personal_reminders').update(reminderToRow(reminder)).eq('id', id);
  },
  deletePersonalReminder: async (id) => {
    set((s) => ({ personalReminders: s.personalReminders.filter((r) => r.id !== id) }));
    await supabase.from('personal_reminders').delete().eq('id', id);
  },

  setViewPreference: (userId, page, view) =>
    set((s) => ({
      viewPreference: {
        ...s.viewPreference,
        [`${userId}-${page}`]: view,
      },
    })),

  addDealer: async (dealer) => {
    set((s) => ({ dealers: [...s.dealers, dealer] }));
    const { error } = await supabase.from('dealers').insert(dealer);
    if (error) {
      set((s) => ({ dealers: s.dealers.filter((d) => d.id !== dealer.id) }));
      throw new Error(error.message);
    }
  },
  deleteDealer: async (id) => {
    set((s) => ({ dealers: s.dealers.filter((d) => d.id !== id) }));
    await supabase.from('dealers').delete().eq('id', id);
  },

  addWorkshop: async (workshop) => {
    set((s) => ({ workshops: [...s.workshops, workshop] }));
    const { error } = await supabase.from('workshops').insert(workshop);
    if (error) {
      set((s) => ({ workshops: s.workshops.filter((w) => w.id !== workshop.id) }));
      throw new Error(error.message);
    }
  },
  deleteWorkshop: async (id) => {
    set((s) => ({ workshops: s.workshops.filter((w) => w.id !== id) }));
    await supabase.from('workshops').delete().eq('id', id);
  },

  addSupplier: async (supplier) => {
    set((s) => ({ suppliers: [...s.suppliers, supplier] }));
    const { error } = await supabase.from('suppliers').insert(supplier);
    if (error) {
      set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== supplier.id) }));
      throw new Error(error.message);
    }
  },
  deleteSupplier: async (id) => {
    set((s) => ({ suppliers: s.suppliers.filter((s2) => s2.id !== id) }));
    await supabase.from('suppliers').delete().eq('id', id);
  },

  addMerchant: async (merchant) => {
    set((s) => ({ merchants: [...s.merchants, merchant] }));
    const { error } = await supabase.from('merchants').insert(merchant);
    if (error) console.error('addMerchant failed:', error.message);
  },

  deleteMerchant: async (id) => {
    set((s) => ({ merchants: s.merchants.filter((m) => m.id !== id) }));
    await supabase.from('merchants').delete().eq('id', id);
  },

  addMiscCost: async (carId, misc) => {
    const car = get().cars.find((c) => c.id === carId);
    if (!car) return;
    const updated = [...(car.miscCosts ?? []), misc];
    set((s) => ({ cars: s.cars.map((c) => c.id === carId ? { ...c, miscCosts: updated } : c) }));
    const { error } = await supabase.from('cars').update({ misc_costs: updated }).eq('id', carId);
    if (error) {
      console.error('addMiscCost failed:', error.message);
      // Rollback
      set((s) => ({ cars: s.cars.map((c) => c.id === carId ? { ...c, miscCosts: car.miscCosts ?? [] } : c) }));
    }
  },

  deleteMiscCost: async (carId, miscId) => {
    const car = get().cars.find((c) => c.id === carId);
    if (!car) return;
    const updated = (car.miscCosts ?? []).filter((m) => m.id !== miscId);
    set((s) => ({ cars: s.cars.map((c) => c.id === carId ? { ...c, miscCosts: updated } : c) }));
    const { error } = await supabase.from('cars').update({ misc_costs: updated }).eq('id', carId);
    if (error) {
      console.error('deleteMiscCost failed:', error.message);
      set((s) => ({ cars: s.cars.map((c) => c.id === carId ? { ...c, miscCosts: car.miscCosts ?? [] } : c) }));
    }
  },
}), {
  name: 'autodream-session',
  partialize: (state) => ({
    currentUser: state.currentUser,
    viewPreference: state.viewPreference,
  }),
}));
