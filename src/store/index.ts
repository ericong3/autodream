import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import { User, Car, RepairJob, Quotation, Instruction, Customer, TestDrive, PersonalReminder, Dealer, Workshop, Supplier, Merchant, MiscCost, ExternalSalesman, Banker, LoanCase, LoanCaseDocument, LoanCaseActivity, Payment, AppNotification, InvestorTransaction, Shipment, CarMovement } from '../types';
import { sendPush } from '../utils/sendPush';

// ── Notification helpers ─────────────────────────────────────────────────────
const dirIds      = (users: User[]) => users.filter(u => u.role === 'director').map(u => u.id);
const mechIds     = (users: User[]) => users.filter(u => u.role === 'mechanic').map(u => u.id);
const mgmtIds     = (users: User[]) => users.filter(u => u.role === 'director' || u.role === 'shareholder' || u.role === 'admin').map(u => u.id);
function instrRecipients(i: Instruction, users: User[]): string[] {
  if (i.toType === 'all') return users.filter(u => u.id !== i.fromId).map(u => u.id);
  if (i.toType === 'department') {
    const role = i.toDepartment === 'salesman' ? 'salesperson' : 'mechanic';
    return users.filter(u => u.role === role).map(u => u.id);
  }
  return i.toIds ?? [];
}
const SCHED_KEY = 'autodream-sched-notif-date';
function scheduledNotifAllowed(): boolean {
  const today = new Date().toDateString();
  if (localStorage.getItem(SCHED_KEY) === today) return false;
  localStorage.setItem(SCHED_KEY, today);
  return true;
}

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
  externalSalesmen: ExternalSalesman[];
  bankers: Banker[];
  shipments: Shipment[];
  carMovements: CarMovement[];
  loanCases: LoanCase[];
  loanCaseDocuments: LoanCaseDocument[];
  loanCaseActivities: LoanCaseActivity[];
  viewPreference: Record<string, 'grid' | 'list' | 'board'>;
  notifications: AppNotification[];
  bankerOpenCaseId: string | null;
  loaded: boolean;
  lastFetched: number | null;

  // Init
  loadAll: (force?: boolean) => Promise<void>;

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
  updateDealer: (id: string, updates: Partial<Dealer>) => Promise<void>;
  deleteDealer: (id: string) => Promise<void>;

  // Workshops
  addWorkshop: (workshop: Workshop) => Promise<void>;
  updateWorkshop: (id: string, updates: Partial<Workshop>) => Promise<void>;
  deleteWorkshop: (id: string) => Promise<void>;

  // Suppliers
  addSupplier: (supplier: Supplier) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;

  // Merchants
  addMerchant: (merchant: Merchant) => Promise<void>;
  updateMerchant: (id: string, updates: Partial<Merchant>) => Promise<void>;
  deleteMerchant: (id: string) => Promise<void>;

  // Payments
  payments: Payment[];
  addPayment: (payment: Payment) => Promise<void>;
  batchAddPayments: (payments: Payment[]) => Promise<void>;
  updatePayment: (id: string, updates: Partial<Payment>) => Promise<void>;
  deletePayment: (id: string) => Promise<void>;

  // External Salesmen
  addExternalSalesman: (s: ExternalSalesman) => Promise<void>;
  updateExternalSalesman: (id: string, s: Partial<ExternalSalesman>) => Promise<void>;
  deleteExternalSalesman: (id: string) => Promise<void>;

  // Bankers
  addBanker: (b: Banker) => Promise<void>;
  updateBanker: (id: string, b: Partial<Banker>) => Promise<void>;
  deleteBanker: (id: string) => Promise<void>;

  // Car Movements
  addCarMovement: (m: CarMovement) => Promise<void>;

  // Shipments
  addShipment: (s: Shipment) => Promise<void>;
  updateShipment: (id: string, s: Partial<Shipment>) => Promise<void>;
  deleteShipment: (id: string) => Promise<void>;

  // Loan Cases
  addLoanCase: (loanCase: LoanCase) => Promise<void>;
  updateLoanCase: (id: string, updates: Partial<LoanCase>) => Promise<void>;
  addLoanCaseActivity: (activity: LoanCaseActivity) => Promise<void>;
  addLoanCaseDocument: (doc: LoanCaseDocument) => Promise<void>;
  deleteLoanCaseDocument: (id: string) => Promise<void>;

  // Misc Costs
  addMiscCost: (carId: string, misc: MiscCost) => Promise<void>;
  deleteMiscCost: (carId: string, miscId: string) => Promise<void>;

  // View preference
  setViewPreference: (userId: string, page: string, view: 'grid' | 'list' | 'board') => void;

  // Investor Transactions
  investorTransactions: InvestorTransaction[];
  addInvestorTransaction: (txn: InvestorTransaction) => Promise<void>;
  updateInvestorTransaction: (id: string, updates: Partial<InvestorTransaction>) => Promise<void>;

  // Notifications
  markNotificationsReadByRef: (referenceId: string) => Promise<void>;
  markNotificationReadById: (id: string) => Promise<void>;
  setBankerOpenCaseId: (id: string | null) => void;
  toastQueue: AppNotification[];
  drainToastQueue: () => void;
}

// Supabase realtime can send JSONB columns as serialized strings instead of parsed objects.
// This helper handles both so REST and realtime payloads work the same way.
function parseJsonField<T>(v: any): T | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return undefined; } }
  return v as T;
}

// Map snake_case DB row to camelCase Car
function rowToCar(r: any): Car {
  return {
    id: r.id,
    make: r.make ?? '',
    model: r.model ?? '',
    variant: r.variant,
    year: r.year,
    carPlate: r.car_plate,
    colour: r.colour ?? '',
    mileage: r.mileage,
    condition: r.condition,
    purchasePrice: r.purchase_price,
    sellingPrice: r.selling_price,
    transmission: r.transmission,
    status: r.status,
    photo: r.photo,
    photos: parseJsonField<string[]>(r.photos) ?? [],
    greenCard: r.green_card,
    thumbprintDone: r.thumbprint_done,
    intakeComplete: r.intake_complete,
    assignedSalesperson: r.assigned_salesperson,
    dateAdded: r.date_added,
    notes: r.notes,
    currentLocation: r.current_location,
    checklistItems: parseJsonField<any[]>(r.checklist_items) ?? [],
    photoTakenBy: parseJsonField<string[]>(r.photo_taken_by) ?? [],
    loanSubmissions: parseJsonField<any[]>(r.loan_submissions) ?? [],
    finalDeal: parseJsonField(r.final_deal),
    deliveryPhoto: r.delivery_photo,
    deliveryCollected: r.delivery_collected,
    consignment: parseJsonField(r.consignment),
    outgoingConsignment: parseJsonField(r.outgoing_consignment),
    moneyReceived: r.money_received ?? undefined,
    priceFloor: r.price_floor ?? undefined,
    isStaffSale: r.is_staff_sale ?? false,
    waiveCommission: r.waive_commission ?? false,
    miscCosts: parseJsonField<any[]>(r.misc_costs) ?? [],
    investorId: r.investor_id ?? undefined,
    investorSplit: r.investor_split ?? undefined,
    sourceSalesman: r.source_salesman ?? undefined,
    sourceType: r.source_type ?? undefined,
    externalSalesmanId: r.external_salesman_id ?? undefined,
    sourceSalesmanId: r.source_salesman_id ?? undefined,
    sourceCommission: r.source_commission ?? undefined,
    intakeCommission: r.intake_commission ?? undefined,
    carInDate: r.car_in_date ?? undefined,
    disbursementAmount: r.disbursement_amount ?? undefined,
    disbursementDate: r.disbursement_date ?? undefined,
    comingSoonType: r.coming_soon_type ?? undefined,
    shipmentId: r.shipment_id ?? undefined,
    panelDealerId: r.panel_dealer_id ?? undefined,
    panelChargeAmount: r.panel_charge_amount ?? undefined,
    sellerThumbprintSaved: r.seller_thumbprint_saved ?? false,
    dealProgress: parseJsonField<any>(r.deal_progress) ?? undefined,
  };
}

function rowToExternalSalesman(r: any): ExternalSalesman {
  return {
    id: r.id,
    name: r.name,
    ic: r.ic ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    bank: r.bank ?? undefined,
    bankAccount: r.bank_account ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

function externalSalesmanToRow(s: Partial<ExternalSalesman>) {
  const row: any = {};
  if (s.id !== undefined) row.id = s.id;
  if (s.name !== undefined) row.name = s.name;
  if (s.ic !== undefined) row.ic = s.ic;
  if (s.phone !== undefined) row.phone = s.phone;
  if (s.email !== undefined) row.email = s.email;
  if (s.bank !== undefined) row.bank = s.bank;
  if (s.bankAccount !== undefined) row.bank_account = s.bankAccount;
  if (s.notes !== undefined) row.notes = s.notes;
  if (s.createdAt !== undefined) row.created_at = s.createdAt;
  return row;
}

function rowToWorkshop(r: any): Workshop {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    speciality: r.speciality ?? undefined,
    bankName: r.bank_name ?? undefined,
    bankAccountNumber: r.bank_account_number ?? undefined,
    bankAccountHolder: r.bank_account_holder ?? undefined,
    paymentTerms: r.payment_terms ?? undefined,
    companyDocPath: r.company_doc_path ?? undefined,
    companyDocName: r.company_doc_name ?? undefined,
    deleteRequestedBy: r.delete_requested_by ?? undefined,
    deleteRequestedAt: r.delete_requested_at ?? undefined,
  };
}

function workshopToRow(w: Partial<Workshop>) {
  // Use `in` rather than `!== undefined` so callers can explicitly clear a field
  // by passing `undefined` (e.g. rejecting a delete request nulls deleteRequestedBy) —
  // a strict undefined check can't tell "clear this" apart from "field not touched".
  const row: any = {};
  if ('id' in w) row.id = w.id;
  if ('name' in w) row.name = w.name;
  if ('phone' in w) row.phone = w.phone ?? null;
  if ('speciality' in w) row.speciality = w.speciality ?? null;
  if ('bankName' in w) row.bank_name = w.bankName ?? null;
  if ('bankAccountNumber' in w) row.bank_account_number = w.bankAccountNumber ?? null;
  if ('bankAccountHolder' in w) row.bank_account_holder = w.bankAccountHolder ?? null;
  if ('paymentTerms' in w) row.payment_terms = w.paymentTerms ?? null;
  if ('companyDocPath' in w) row.company_doc_path = w.companyDocPath ?? null;
  if ('companyDocName' in w) row.company_doc_name = w.companyDocName ?? null;
  if ('deleteRequestedBy' in w) row.delete_requested_by = w.deleteRequestedBy ?? null;
  if ('deleteRequestedAt' in w) row.delete_requested_at = w.deleteRequestedAt ?? null;
  return row;
}

function rowToBanker(r: any): Banker {
  return {
    id: r.id,
    name: r.name,
    bank: r.bank,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    notes: r.notes ?? undefined,
    userId: r.user_id ?? undefined,
    createdAt: r.created_at,
  };
}

function bankerToRow(b: Partial<Banker>) {
  const row: any = {};
  if (b.id !== undefined) row.id = b.id;
  if (b.name !== undefined) row.name = b.name;
  if (b.bank !== undefined) row.bank = b.bank;
  if (b.phone !== undefined) row.phone = b.phone;
  if (b.email !== undefined) row.email = b.email;
  if (b.notes !== undefined) row.notes = b.notes;
  if (b.userId !== undefined) row.user_id = b.userId;
  if (b.createdAt !== undefined) row.created_at = b.createdAt;
  return row;
}

function rowToCarMovement(r: any): CarMovement {
  return {
    id: r.id,
    carId: r.car_id ?? undefined,
    carPlate: r.car_plate,
    type: r.type,
    userId: r.user_id,
    userName: r.user_name,
    reason: r.reason ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

function rowToShipment(r: any): Shipment {
  return {
    id: r.id,
    vesselName: r.vessel_name,
    shippingLine: r.shipping_line ?? undefined,
    originPort: r.origin_port,
    destinationPort: r.destination_port,
    etd: r.etd,
    eta: r.eta,
    freightCost: r.freight_cost ?? undefined,
    paymentStatus: r.payment_status,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  };
}

function shipmentToRow(s: Partial<Shipment>) {
  const row: any = {};
  if (s.id !== undefined) row.id = s.id;
  if (s.vesselName !== undefined) row.vessel_name = s.vesselName;
  if (s.shippingLine !== undefined) row.shipping_line = s.shippingLine;
  if (s.originPort !== undefined) row.origin_port = s.originPort;
  if (s.destinationPort !== undefined) row.destination_port = s.destinationPort;
  if (s.etd !== undefined) row.etd = s.etd;
  if (s.eta !== undefined) row.eta = s.eta;
  if (s.freightCost !== undefined) row.freight_cost = s.freightCost;
  if (s.paymentStatus !== undefined) row.payment_status = s.paymentStatus;
  if (s.notes !== undefined) row.notes = s.notes;
  if (s.createdAt !== undefined) row.created_at = s.createdAt;
  return row;
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
  if (c.thumbprintDone !== undefined) row.thumbprint_done = c.thumbprintDone;
  if (c.intakeComplete !== undefined) row.intake_complete = c.intakeComplete;
  if (c.assignedSalesperson !== undefined) row.assigned_salesperson = c.assignedSalesperson;
  if (c.dateAdded !== undefined) row.date_added = c.dateAdded;
  if (c.notes !== undefined) row.notes = c.notes;
  if (c.currentLocation !== undefined) row.current_location = c.currentLocation;
  if (c.checklistItems !== undefined) row.checklist_items = c.checklistItems;
  if (c.photoTakenBy !== undefined) row.photo_taken_by = c.photoTakenBy;
  if (c.loanSubmissions !== undefined) row.loan_submissions = c.loanSubmissions;
  if ('finalDeal' in c) row.final_deal = c.finalDeal ?? null;
  if (c.deliveryPhoto !== undefined) row.delivery_photo = c.deliveryPhoto;
  if (c.deliveryCollected !== undefined) row.delivery_collected = c.deliveryCollected;
  if (c.consignment !== undefined) row.consignment = c.consignment;
  if ('outgoingConsignment' in c) row.outgoing_consignment = c.outgoingConsignment ?? null;
  if ('moneyReceived' in c) row.money_received = c.moneyReceived ?? null;
  if (c.priceFloor !== undefined) row.price_floor = c.priceFloor;
  if ('isStaffSale' in c) row.is_staff_sale = c.isStaffSale ?? false;
  if ('waiveCommission' in c) row.waive_commission = c.waiveCommission ?? false;
  if (c.miscCosts !== undefined) row.misc_costs = c.miscCosts;
  if (c.investorId !== undefined) row.investor_id = c.investorId;
  if (c.investorSplit !== undefined) row.investor_split = c.investorSplit;
  if (c.sourceSalesman !== undefined) row.source_salesman = c.sourceSalesman;
  if (c.sourceType !== undefined) row.source_type = c.sourceType;
  if (c.externalSalesmanId !== undefined) row.external_salesman_id = c.externalSalesmanId;
  if (c.sourceSalesmanId !== undefined) row.source_salesman_id = c.sourceSalesmanId;
  if (c.sourceCommission !== undefined) row.source_commission = c.sourceCommission;
  if (c.intakeCommission !== undefined) row.intake_commission = c.intakeCommission;
  if (c.carInDate !== undefined) row.car_in_date = c.carInDate;
  if (c.disbursementAmount !== undefined) row.disbursement_amount = c.disbursementAmount;
  if (c.disbursementDate !== undefined) row.disbursement_date = c.disbursementDate;
  if (c.comingSoonType !== undefined) row.coming_soon_type = c.comingSoonType;
  if ('shipmentId' in c) row.shipment_id = c.shipmentId ?? null;
  if (c.panelDealerId !== undefined) row.panel_dealer_id = c.panelDealerId;
  if (c.panelChargeAmount !== undefined) row.panel_charge_amount = c.panelChargeAmount;
  if (c.sellerThumbprintSaved !== undefined) row.seller_thumbprint_saved = c.sellerThumbprintSaved;
  if ('dealProgress' in c) row.deal_progress = c.dealProgress ?? null;
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
    loanOrder: parseJsonField(r.loan_order),
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
    dealType: r.deal_type ?? undefined,
    bookingFee: r.booking_fee ?? undefined,
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
  if (c.loanOrder !== undefined) row.loan_order = c.loanOrder;
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
  if (c.dealType !== undefined) row.deal_type = c.dealType;
  if (c.bookingFee !== undefined) row.booking_fee = c.bookingFee;
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
    capitalAmount: r.capital_amount ?? undefined,
    banks: r.banks ?? [],
    avatar: r.avatar ?? undefined,
    position: r.position ?? undefined,
    bio: r.bio ?? undefined,
    email: r.email ?? undefined,
    whatsapp: r.whatsapp ?? undefined,
    instagram: r.instagram ?? undefined,
    facebook: r.facebook ?? undefined,
    website: r.website ?? undefined,
    bankName: r.bank_name ?? undefined,
    bankAccountNumber: r.bank_account_number ?? undefined,
    bankAccountHolder: r.bank_account_holder ?? undefined,
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
  if (u.capitalAmount !== undefined) row.capital_amount = u.capitalAmount;
  if (u.banks !== undefined) row.banks = u.banks;
  if (u.avatar !== undefined) row.avatar = u.avatar;
  if (u.position !== undefined) row.position = u.position;
  if (u.bio !== undefined) row.bio = u.bio;
  if (u.email !== undefined) row.email = u.email;
  if (u.whatsapp !== undefined) row.whatsapp = u.whatsapp;
  if (u.instagram !== undefined) row.instagram = u.instagram;
  if (u.facebook !== undefined) row.facebook = u.facebook;
  if (u.website !== undefined) row.website = u.website;
  if (u.bankName !== undefined) row.bank_name = u.bankName;
  if (u.bankAccountNumber !== undefined) row.bank_account_number = u.bankAccountNumber;
  if (u.bankAccountHolder !== undefined) row.bank_account_holder = u.bankAccountHolder;
  return row;
}

function rowToLoanCase(r: any): LoanCase {
  return {
    id: r.id,
    customerId: r.customer_id ?? '',
    carId: r.car_id ?? undefined,
    salesmanId: r.salesman_id,
    bankerId: r.banker_id,
    bankerName: r.banker_name ?? undefined,
    bank: r.bank,
    loanAmount: r.loan_amount,
    applicantInterviewText: r.applicant_interview_text ?? undefined,
    guarantorInterviewText: r.guarantor_interview_text ?? undefined,
    status: r.status,
    approvedAmount: r.approved_amount ?? undefined,
    interestRate: r.interest_rate ?? undefined,
    tenure: r.tenure ?? undefined,
    bankProducts: r.bank_products ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToNotification(r: any): AppNotification {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    body: r.body ?? undefined,
    url: r.url ?? '/',
    referenceId: r.reference_id ?? undefined,
    isRead: r.is_read ?? false,
    createdAt: r.created_at,
  };
}

function rowToLoanCaseDocument(r: any): LoanCaseDocument {
  return {
    id: r.id,
    caseId: r.case_id,
    type: r.type,
    fileName: r.file_name,
    filePath: r.file_path,
    uploadedAt: r.uploaded_at,
  };
}

function rowToLoanCaseActivity(r: any): LoanCaseActivity {
  return {
    id: r.id,
    caseId: r.case_id,
    userId: r.user_id,
    userName: r.user_name,
    userRole: r.user_role,
    type: r.type,
    content: r.content ?? undefined,
    oldStatus: r.old_status ?? undefined,
    newStatus: r.new_status ?? undefined,
    createdAt: r.created_at,
  };
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

function rowToPayment(r: any): Payment {
  return {
    id: r.id,
    type: r.type,
    carId: r.car_id ?? undefined,
    repairJobId: r.repair_job_id ?? undefined,
    miscCostId: r.misc_cost_id ?? undefined,
    recipientType: r.recipient_type,
    recipientId: r.recipient_id,
    recipientName: r.recipient_name,
    bankName: r.bank_name ?? undefined,
    accountNumber: r.account_number ?? undefined,
    accountHolder: r.account_holder ?? undefined,
    amount: r.amount,
    description: r.description ?? undefined,
    status: r.status,
    transferredAt: r.transferred_at ?? undefined,
    transferredBy: r.transferred_by ?? undefined,
    referenceNumber: r.reference_number ?? undefined,
    receiptUrl: r.receipt_url ?? undefined,
    notes: r.notes ?? undefined,
    deleteRequestedBy: r.delete_requested_by ?? undefined,
    deleteRequestedAt: r.delete_requested_at ?? undefined,
    batchId: r.batch_id ?? undefined,
    periodStart: r.period_start ?? undefined,
    periodEnd: r.period_end ?? undefined,
    createdAt: r.created_at,
  };
}

function paymentToRow(p: Partial<Payment>) {
  const row: any = {};
  if (p.id !== undefined) row.id = p.id;
  if (p.type !== undefined) row.type = p.type;
  if (p.carId !== undefined) row.car_id = p.carId;
  if (p.repairJobId !== undefined) row.repair_job_id = p.repairJobId;
  if (p.miscCostId !== undefined) row.misc_cost_id = p.miscCostId;
  if (p.recipientType !== undefined) row.recipient_type = p.recipientType;
  if (p.recipientId !== undefined) row.recipient_id = p.recipientId;
  if (p.recipientName !== undefined) row.recipient_name = p.recipientName;
  if (p.bankName !== undefined) row.bank_name = p.bankName;
  if (p.accountNumber !== undefined) row.account_number = p.accountNumber;
  if (p.accountHolder !== undefined) row.account_holder = p.accountHolder;
  if (p.amount !== undefined) row.amount = p.amount;
  if (p.description !== undefined) row.description = p.description;
  if (p.status !== undefined) row.status = p.status;
  if (p.transferredAt !== undefined) row.transferred_at = p.transferredAt;
  if (p.transferredBy !== undefined) row.transferred_by = p.transferredBy;
  if (p.referenceNumber !== undefined) row.reference_number = p.referenceNumber;
  if (p.receiptUrl !== undefined) row.receipt_url = p.receiptUrl;
  if (p.notes !== undefined) row.notes = p.notes;
  if (p.deleteRequestedBy !== undefined) row.delete_requested_by = p.deleteRequestedBy ?? null;
  if (p.deleteRequestedAt !== undefined) row.delete_requested_at = p.deleteRequestedAt ?? null;
  if (p.batchId !== undefined) row.batch_id = p.batchId;
  if (p.periodStart !== undefined) row.period_start = p.periodStart;
  if (p.periodEnd !== undefined) row.period_end = p.periodEnd;
  if (p.createdAt !== undefined) row.created_at = p.createdAt;
  return row;
}

function rowToInvestorTxn(r: any): InvestorTransaction {
  return {
    id: r.id,
    investorId: r.investor_id,
    type: r.type,
    amount: r.amount,
    status: r.status,
    createdAt: r.created_at,
    approvedAt: r.approved_at ?? undefined,
    dueDate: r.due_date ?? undefined,
    waitingMonths: r.waiting_months ?? undefined,
    approvedBy: r.approved_by ?? undefined,
    rejectedBy: r.rejected_by ?? undefined,
    rejectedAt: r.rejected_at ?? undefined,
  };
}

function investorTxnToRow(t: Partial<InvestorTransaction>) {
  const row: any = {};
  if (t.id !== undefined) row.id = t.id;
  if (t.investorId !== undefined) row.investor_id = t.investorId;
  if (t.type !== undefined) row.type = t.type;
  if (t.amount !== undefined) row.amount = t.amount;
  if (t.status !== undefined) row.status = t.status;
  if (t.createdAt !== undefined) row.created_at = t.createdAt;
  if (t.approvedAt !== undefined) row.approved_at = t.approvedAt;
  if (t.dueDate !== undefined) row.due_date = t.dueDate;
  if (t.waitingMonths !== undefined) row.waiting_months = t.waitingMonths;
  if (t.approvedBy !== undefined) row.approved_by = t.approvedBy;
  if (t.rejectedBy !== undefined) row.rejected_by = t.rejectedBy;
  if (t.rejectedAt !== undefined) row.rejected_at = t.rejectedAt;
  return row;
}

// Guard: realtime channels are set up only once per session, regardless of how many
// times loadAll is called (e.g. pull-to-refresh creates duplicate channels otherwise).
let realtimeSubscribed = false;

// Car IDs with an updateCar write in flight (optimistic set() already applied locally,
// DB write not yet confirmed). loadAll's phase 1/2 queries are snapshots that can resolve
// after a local write and are otherwise merged in wholesale by status filter — without this
// guard, a delivered-in-flight car gets dropped or reverted by a stale concurrent fetch.
const pendingCarWrites = new Set<string>();

// Reconciles a freshly-fetched car list with local state: any car with a write in flight
// keeps its local (optimistic) version — and is kept even if the fetch's status filter
// would otherwise have excluded it — since the fetch may be a stale snapshot relative to
// that in-flight write.
function mergePendingCars(fetched: Car[], localCars: Car[]): Car[] {
  if (pendingCarWrites.size === 0) return fetched;
  const fetchedIds = new Set(fetched.map((c) => c.id));
  const merged = fetched
    // A pending id with no local match means it was deleted locally while its DB write
    // was still in flight — drop it rather than letting the stale fetch resurrect it.
    .map((c) => (pendingCarWrites.has(c.id) ? localCars.find((l) => l.id === c.id) ?? null : c))
    .filter((c): c is Car => c !== null);
  for (const c of localCars) {
    if (pendingCarWrites.has(c.id) && !fetchedIds.has(c.id)) merged.push(c);
  }
  return merged;
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
  externalSalesmen: [],
  bankers: [],
  shipments: [],
  carMovements: [],
  loanCases: [],
  loanCaseDocuments: [],
  loanCaseActivities: [],
  payments: [],
  investorTransactions: [],
  notifications: [],
  toastQueue: [],
  bankerOpenCaseId: null,
  viewPreference: {},
  loaded: false,
  lastFetched: null,

  loadAll: async (force = false) => {
    const { lastFetched, loaded } = get();
    const TTL = 5 * 60 * 1000; // 5 minutes
    if (!force && loaded && lastFetched && (Date.now() - lastFetched) < TTL) return;

    // ── Phase 1: critical tables, filtered to active records only ──
    // Delivered cars and closed loan cases are loaded in phase 2 so this stays
    // fast forever regardless of how much historical data accumulates.
    const [users, cars, repairs, customers, externalSalesmenResult, bankersResult, loanCasesResult] =
      await Promise.all([
        supabase.from('users').select('*'),
        supabase.from('cars').select('*').neq('status', 'delivered'),
        supabase.from('repairs').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('external_salesmen').select('*'),
        supabase.from('bankers').select('*'),
        supabase.from('loan_cases').select('*').not('status', 'in', '(rejected,cancelled,withdrawn)'),
      ]);

    const allCars = (cars.data ?? []).map(rowToCar);
    const allCustomers = (customers.data ?? []).map(rowToCustomer);
    const allUsers = (users.data ?? []).map(rowToUser);

    // Auto-reconcile: clear finalDeal on cars with no matching customer work order
    const confirmedCarIds = new Set(
      allCustomers
        .filter(c => c.cashWorkOrder || c.loanWorkOrder)
        .map(c => c.interestedCarId)
        .filter(Boolean)
    );
    const orphanedCars = allCars.filter(c =>
      c.finalDeal &&
      c.status !== 'delivered' &&
      c.status !== 'deal_pending' &&
      !confirmedCarIds.has(c.id) &&
      !c.outgoingConsignment
    );
    if (orphanedCars.length > 0) {
      await Promise.all(orphanedCars.map(c =>
        supabase.from('cars').update({ final_deal: null }).eq('id', c.id)
      ));
      orphanedCars.forEach(c => {
        const idx = allCars.findIndex(x => x.id === c.id);
        if (idx !== -1) allCars[idx] = { ...allCars[idx], finalDeal: undefined };
      });
    }

    set((s) => ({
      users:           users.data              ? allUsers                                                            : s.users,
      cars:            cars.data               ? mergePendingCars(allCars, s.cars)                                   : s.cars,
      repairs:         repairs.data            ? repairs.data.map(rowToRepair)                                       : s.repairs,
      customers:       customers.data          ? allCustomers                                                        : s.customers,
      externalSalesmen:externalSalesmenResult.data ? externalSalesmenResult.data.map(rowToExternalSalesman)          : s.externalSalesmen,
      bankers:         bankersResult.data      ? bankersResult.data.map(rowToBanker)                                 : s.bankers,
      loanCases:       loanCasesResult.data    ? loanCasesResult.data.map(rowToLoanCase)                             : s.loanCases,
      loaded: true,
      lastFetched: Date.now(),
    }));

    // Load notifications in parallel with phase 2 (non-blocking for the UI)
    const currentUser = get().currentUser;
    if (currentUser) {
      supabase.from('notifications').select('*')
        .eq('user_id', currentUser.id).eq('is_read', false)
        .order('created_at', { ascending: false }).limit(200)
        .then(({ data: notifs }) => {
          if (notifs) set({ notifications: notifs.map(rowToNotification) });
        });
    }

    // ── Phase 2: historical + secondary tables — load in background ──
    Promise.all([
      supabase.from('cars').select('*').eq('status', 'delivered'),
      supabase.from('loan_cases').select('*').in('status', ['rejected', 'cancelled', 'withdrawn']),
      supabase.from('quotations').select('*'),
      supabase.from('instructions').select('*'),
      supabase.from('test_drives').select('*'),
      supabase.from('personal_reminders').select('*'),
      supabase.from('dealers').select('*'),
      supabase.from('workshops').select('*'),
      supabase.from('suppliers').select('*'),
      supabase.from('merchants').select('*'),
      supabase.from('loan_case_documents').select('*'),
      supabase.from('loan_case_activity').select('*'),
      supabase.from('payments').select('*').order('created_at', { ascending: false }),
      supabase.from('investor_transactions').select('*').order('created_at', { ascending: true }),
      supabase.from('shipments').select('*').order('eta', { ascending: true }),
      supabase.from('car_movements').select('*').order('created_at', { ascending: false }),
    ]).then(([deliveredCarsResult, closedCasesResult, quotations, instructions, testDrives, reminders, dealers, workshops, suppliers, merchants, loanCaseDocsResult, loanCaseActivitiesResult, paymentsResult, investorTxnsResult, shipmentsResult, carMovementsResult]) => {
      const allQuotations  = (quotations.data ?? []).map(rowToQuotation);
      const allTestDrives  = (testDrives.data ?? []).map(rowToTestDrive);
      const deliveredCars  = (deliveredCarsResult.data ?? []).map(rowToCar);
      const closedCases    = (closedCasesResult.data ?? []).map(rowToLoanCase);

      set((s) => ({
        // Merge delivered cars into store — deduplicate by id so force-refresh is safe.
        // Guarded by mergePendingCars so a car whose delivery write is still in flight
        // (or just landed) isn't reverted by this fetch's now-stale snapshot.
        cars: deliveredCarsResult.data
          ? mergePendingCars([...s.cars.filter(c => c.status !== 'delivered'), ...deliveredCars], s.cars)
          : s.cars,
        // Merge closed loan cases — deduplicate by id
        loanCases: closedCasesResult.data
          ? [...s.loanCases.filter(lc => !['rejected','cancelled','withdrawn'].includes(lc.status)), ...closedCases]
          : s.loanCases,
        quotations:          quotations.data           ? allQuotations                                                          : s.quotations,
        instructions:        instructions.data         ? instructions.data.map(rowToInstruction)                                : s.instructions,
        testDrives:          testDrives.data           ? allTestDrives                                                          : s.testDrives,
        personalReminders:   reminders.data            ? reminders.data.map(rowToReminder)                                      : s.personalReminders,
        dealers:             dealers.data              ? (dealers.data as Dealer[])                                             : s.dealers,
        workshops:           workshops.data            ? workshops.data.map(rowToWorkshop)                                      : s.workshops,
        suppliers:           suppliers.data            ? (suppliers.data as Supplier[])                                         : s.suppliers,
        merchants:           merchants.data            ? (merchants.data as Merchant[])                                         : s.merchants,
        loanCaseDocuments:   loanCaseDocsResult.data   ? loanCaseDocsResult.data.map(rowToLoanCaseDocument)                     : s.loanCaseDocuments,
        loanCaseActivities:  loanCaseActivitiesResult.data ? loanCaseActivitiesResult.data.map(rowToLoanCaseActivity)           : s.loanCaseActivities,
        payments:            paymentsResult.data       ? paymentsResult.data.map(rowToPayment)                                  : s.payments,
        investorTransactions:investorTxnsResult.data   ? investorTxnsResult.data.map(rowToInvestorTxn)                          : s.investorTransactions,
        shipments:           shipmentsResult.data      ? shipmentsResult.data.map(rowToShipment)                                : s.shipments,
        carMovements:        carMovementsResult.data   ? carMovementsResult.data.map(rowToCarMovement)                           : s.carMovements,
      }));

      // ── Scheduled notifications (once per day, after secondary data is ready) ──
      if (scheduledNotifAllowed()) {
        const today    = new Date().toDateString();
        const tomorrow = new Date(Date.now() + 86400000).toDateString();

        allCustomers
          .filter(c => !c.isTrashed && !c.isDead && c.followUpDate && new Date(c.followUpDate).toDateString() === today)
          .forEach(c => sendPush([c.assignedSalesId].filter(Boolean), '📞 Follow-up reminder', `Call ${c.name} today`, '/customers', c.id));

        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        get().loanCases
          .filter(lc => lc.status === 'need_more_info' && lc.updatedAt <= threeDaysAgo)
          .forEach(lc => {
            const lastSalesActivity = get().loanCaseActivities
              .filter(a => a.caseId === lc.id && a.userRole !== 'banker')
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            if (!lastSalesActivity || lastSalesActivity.createdAt <= lc.updatedAt) {
              sendPush([lc.salesmanId], '⏰ Banker is waiting', `${lc.bank} case needs your reply`, '/loan-cases', lc.id);
            }
          });

        allTestDrives
          .filter(t => t.status === 'scheduled' && new Date(t.scheduledAt).toDateString() === tomorrow)
          .forEach(t => {
            const cust = allCustomers.find(c => c.id === t.customerId);
            sendPush([t.salesId], '🚗 Test drive tomorrow', `${cust?.name ?? 'Customer'} has a test drive scheduled`, '/calendar');
          });

        allQuotations
          .filter(q => q.status === 'pending' && new Date(q.expiryDate).toDateString() === tomorrow)
          .forEach(q => sendPush(dirIds(allUsers), '⏰ Quotation expiring', `${q.contactName} – ${q.make} ${q.model} expires tomorrow`, '/quotations'));
      }
    });

    // Real-time subscriptions — set up once only; calling loadAll again (e.g. pull-to-refresh)
    // must not create duplicate channels or the server may reset the socket on seeing
    // multiple joins for the same topic, which can wipe all in-memory data.
    if (realtimeSubscribed) return;
    realtimeSubscribed = true;

    // Set up notifications realtime for persisted sessions (login sets it up on first login)
    const persistedUser = get().currentUser;
    if (persistedUser) {
      supabase.channel(`notifs-${persistedUser.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${persistedUser.id}` }, (p) => {
          const n = rowToNotification(p.new);
          set((s) => ({ notifications: [n, ...s.notifications], toastQueue: [...s.toastQueue, n] }));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${persistedUser.id}` }, (p) => {
          const updated = rowToNotification(p.new);
          set((s) => ({ notifications: s.notifications.map(n => n.id === updated.id ? updated : n).filter(n => !n.isRead) }));
        })
        .subscribe();
    }

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
              // Preserve locally-stored fields if the real-time payload omits the column
              if (!('misc_costs' in (payload.new as any))) {
                incoming.miscCosts = c.miscCosts;
              }
              if (!('outgoing_consignment' in (payload.new as any))) {
                incoming.outgoingConsignment = c.outgoingConsignment;
              }
              if (!('money_received' in (payload.new as any))) {
                incoming.moneyReceived = c.moneyReceived;
              }
              // A car with a confirmed deal must always be deal_pending (or delivered)
              if (incoming.finalDeal != null && incoming.status !== 'delivered') {
                incoming.status = 'deal_pending';
              }
              return incoming;
            }),
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ cars: s.cars.filter((c) => c.id !== (payload.old as any)?.id) }));
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
          set((s) => ({ customers: s.customers.filter((c) => c.id !== (payload.old as any)?.id) }));
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
          set((s) => ({ repairs: s.repairs.filter((r) => r.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-users')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            users: s.users.some((u) => u.id === (payload.new as any).id)
              ? s.users
              : [...s.users, rowToUser(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => {
            const updated = rowToUser(payload.new);
            // Only merge fields that actually exist in the payload (skip undefined so
            // columns not yet in the DB don't wipe optimistic updates).
            const definedFields = Object.fromEntries(
              Object.entries(updated).filter(([, v]) => v !== undefined)
            ) as Partial<User>;
            return {
              users: s.users.map((u) => u.id === updated.id ? { ...u, ...definedFields } : u),
              currentUser: s.currentUser?.id === updated.id ? { ...s.currentUser, ...definedFields } : s.currentUser,
            };
          });
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ users: s.users.filter((u) => u.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-workshops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workshops' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const w = rowToWorkshop(payload.new);
          set((s) => ({
            workshops: s.workshops.some((x) => x.id === w.id) ? s.workshops : [...s.workshops, w],
          }));
        } else if (payload.eventType === 'UPDATE') {
          const w = rowToWorkshop(payload.new);
          set((s) => ({
            workshops: s.workshops.map((x) => x.id === w.id ? w : x),
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ workshops: s.workshops.filter((w) => w.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-merchants')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchants' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            merchants: s.merchants.some((m) => m.id === (payload.new as any).id)
              ? s.merchants
              : [...s.merchants, payload.new as Merchant],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({
            merchants: s.merchants.map((m) => m.id === (payload.new as any).id ? payload.new as Merchant : m),
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ merchants: s.merchants.filter((m) => m.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-quotations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            quotations: s.quotations.some((q) => q.id === (payload.new as any).id)
              ? s.quotations
              : [...s.quotations, rowToQuotation(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ quotations: s.quotations.map((q) => q.id === (payload.new as any).id ? rowToQuotation(payload.new) : q) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ quotations: s.quotations.filter((q) => q.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-instructions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'instructions' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            instructions: s.instructions.some((i) => i.id === (payload.new as any).id)
              ? s.instructions
              : [...s.instructions, rowToInstruction(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ instructions: s.instructions.map((i) => i.id === (payload.new as any).id ? rowToInstruction(payload.new) : i) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ instructions: s.instructions.filter((i) => i.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-test-drives')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_drives' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            testDrives: s.testDrives.some((t) => t.id === (payload.new as any).id)
              ? s.testDrives
              : [...s.testDrives, rowToTestDrive(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ testDrives: s.testDrives.map((t) => t.id === (payload.new as any).id ? rowToTestDrive(payload.new) : t) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ testDrives: s.testDrives.filter((t) => t.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-personal-reminders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'personal_reminders' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            personalReminders: s.personalReminders.some((r) => r.id === (payload.new as any).id)
              ? s.personalReminders
              : [...s.personalReminders, rowToReminder(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ personalReminders: s.personalReminders.map((r) => r.id === (payload.new as any).id ? rowToReminder(payload.new) : r) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ personalReminders: s.personalReminders.filter((r) => r.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-dealers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dealers' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            dealers: s.dealers.some((d) => d.id === (payload.new as any).id)
              ? s.dealers
              : [...s.dealers, payload.new as Dealer],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ dealers: s.dealers.map((d) => d.id === (payload.new as any).id ? payload.new as Dealer : d) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ dealers: s.dealers.filter((d) => d.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-suppliers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            suppliers: s.suppliers.some((x) => x.id === (payload.new as any).id)
              ? s.suppliers
              : [...s.suppliers, payload.new as Supplier],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ suppliers: s.suppliers.map((x) => x.id === (payload.new as any).id ? payload.new as Supplier : x) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ suppliers: s.suppliers.filter((x) => x.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-external-salesmen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_salesmen' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            externalSalesmen: s.externalSalesmen.some((x) => x.id === (payload.new as any).id)
              ? s.externalSalesmen
              : [...s.externalSalesmen, rowToExternalSalesman(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ externalSalesmen: s.externalSalesmen.map((x) => x.id === (payload.new as any).id ? rowToExternalSalesman(payload.new) : x) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ externalSalesmen: s.externalSalesmen.filter((x) => x.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-loan-cases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_cases' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            loanCases: s.loanCases.some((c) => c.id === (payload.new as any).id)
              ? s.loanCases
              : [...s.loanCases, rowToLoanCase(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({ loanCases: s.loanCases.map((c) => c.id === (payload.new as any).id ? rowToLoanCase(payload.new) : c) }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ loanCases: s.loanCases.filter((c) => c.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-loan-case-documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_case_documents' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            loanCaseDocuments: s.loanCaseDocuments.some((d) => d.id === (payload.new as any).id)
              ? s.loanCaseDocuments
              : [...s.loanCaseDocuments, rowToLoanCaseDocument(payload.new)],
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({ loanCaseDocuments: s.loanCaseDocuments.filter((d) => d.id !== (payload.old as any)?.id) }));
        }
      })
      .subscribe();

    supabase.channel('realtime-loan-case-activity')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loan_case_activity' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            loanCaseActivities: s.loanCaseActivities.some((a) => a.id === (payload.new as any).id)
              ? s.loanCaseActivities
              : [...s.loanCaseActivities, rowToLoanCaseActivity(payload.new)],
          }));
        }
      })
      .subscribe();

    supabase.channel('realtime-investor-transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investor_transactions' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          set((s) => ({
            investorTransactions: s.investorTransactions.some((t) => t.id === (payload.new as any).id)
              ? s.investorTransactions
              : [...s.investorTransactions, rowToInvestorTxn(payload.new)],
          }));
        } else if (payload.eventType === 'UPDATE') {
          set((s) => ({
            investorTransactions: s.investorTransactions.map((t) => t.id === (payload.new as any).id ? rowToInvestorTxn(payload.new) : t),
          }));
        } else if (payload.eventType === 'DELETE') {
          set((s) => ({
            investorTransactions: s.investorTransactions.filter((t) => t.id !== (payload.old as any)?.id),
          }));
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
      const user = rowToUser(data);
      set({ currentUser: user });
      // Load unread notifications for this user
      const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(200);
      if (notifs) set({ notifications: notifs.map(rowToNotification) });
      // Realtime: listen for new notifications for this user
      supabase.channel(`notifs-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (p) => {
          const n = rowToNotification(p.new);
          set((s) => ({ notifications: [n, ...s.notifications], toastQueue: [...s.toastQueue, n] }));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (p) => {
          const updated = rowToNotification(p.new);
          set((s) => ({ notifications: s.notifications.map(n => n.id === updated.id ? updated : n).filter(n => !n.isRead) }));
        })
        .subscribe();
      return true;
    }
    return false;
  },

  logout: () => set({ currentUser: null }),

  // Cars
  addCar: async (car) => {
    set((s) => ({ cars: [...s.cars, car] }));
    pendingCarWrites.add(car.id);
    let error;
    try {
      ({ error } = await supabase.from('cars').insert(carToRow(car)));
    } finally {
      pendingCarWrites.delete(car.id);
    }
    if (error) {
      set((s) => ({ cars: s.cars.filter((c) => c.id !== car.id) }));
      throw new Error(error.message);
    }
    // #20 New car added
    sendPush(dirIds(get().users), '🚘 New car added', `${car.year} ${car.make} ${car.model} added to inventory`, '/inventory', car.id);
  },
  updateCar: async (id, car) => {
    const prev = get().cars.find(c => c.id === id);
    // deal_pending cars: ONLY 'delivered' can change the status. Everything else is blocked.
    // Exception: explicitly clearing finalDeal (rejection/cancellation) is always allowed.
    const clearingFinalDeal = 'finalDeal' in car && !car.finalDeal;
    if (!clearingFinalDeal && (prev?.status === 'deal_pending' || prev?.finalDeal != null) && car.status && car.status !== 'delivered') {
      delete (car as any).status;
    }
    // delivered cars: status is permanently locked — nothing can change it
    if (prev?.status === 'delivered' && car.status) {
      delete (car as any).status;
    }
    set((s) => ({ cars: s.cars.map((c) => (c.id === id ? { ...c, ...car } : c)) }));
    pendingCarWrites.add(id);
    let error;
    try {
      ({ error } = await supabase.from('cars').update(carToRow(car)).eq('id', id));
    } finally {
      pendingCarWrites.delete(id);
    }
    if (error) {
      if (prev) set((s) => ({ cars: s.cars.map((c) => (c.id === id ? prev : c)) }));
      console.error('updateCar failed:', error.message);
      throw new Error(error.message);
    }
    const dirs = dirIds(get().users);
    const carName = `${prev?.year ?? ''} ${prev?.make ?? ''} ${prev?.model ?? ''}`.trim();
    // #14 Disbursement received
    if (car.disbursementDate && !prev?.disbursementDate) {
      const ids = [...new Set([...dirs, ...(prev?.assignedSalesperson ? [prev.assignedSalesperson] : [])])];
      sendPush(ids, '💰 Disbursement received', `${carName} – RM ${(car.disbursementAmount ?? 0).toLocaleString()}`, '/inventory', id);
    }
    // #15 New deal submitted
    if (car.finalDeal && !prev?.finalDeal) {
      sendPush(dirs, '📋 New deal submitted', `${carName} – submitted by ${car.finalDeal.submittedBy}`, '/inventory?tab=pending_delivery', id);
    }
    // #15b Deal edited — needs re-approval
    if (car.finalDeal?.approvalStatus === 'pending' && prev?.finalDeal?.approvalStatus !== 'pending') {
      sendPush(dirs, '⚠️ Deal needs approval', `${carName} – ${car.finalDeal.submittedBy} updated the deal`, '/inventory?tab=pending_delivery', id);
    }
    // #16 Deal approved + Puspakom reminder
    if (car.finalDeal?.approvalStatus === 'approved' && prev?.finalDeal?.approvalStatus !== 'approved') {
      const submitter = get().users.find(u => u.name === car.finalDeal?.submittedBy);
      const plate = prev?.carPlate ?? '';
      const recipients = [...new Set([...dirs, ...(submitter ? [submitter.id] : [])])];
      sendPush(recipients, '✅ Deal approved!', `${carName} deal confirmed – book Puspakom for ${plate} now`, '/inventory?tab=pending_delivery', id);
    }
    // #17 Deal rejected
    if (car.finalDeal?.approvalStatus === 'rejected' && prev?.finalDeal?.approvalStatus !== 'rejected') {
      const submitter = get().users.find(u => u.name === car.finalDeal?.submittedBy);
      if (submitter) sendPush([submitter.id], '❌ Deal rejected', `Your deal for ${carName} was rejected`, '/inventory', id);
    }
    // #18 Car ready for delivery
    if (car.status === 'deal_pending' && prev?.status !== 'deal_pending') {
      const ids = [...new Set([...dirs, ...(prev?.assignedSalesperson ? [prev.assignedSalesperson] : [])])];
      sendPush(ids, '🎉 Car ready for delivery', `${carName} is pending delivery`, '/inventory?tab=pending_delivery', id);
    }
    // #19 Car delivered
    if (car.status === 'delivered' && prev?.status !== 'delivered') {
      sendPush(dirs, '🏁 Car delivered', `${carName} has been delivered`, '/inventory', id);
    }
    // #21 Car status changed to Ready
    if (car.status === 'ready' && prev?.status !== 'ready') {
      sendPush(dirs, '✅ Car is ready', `${carName} is ready for sale`, '/inventory', id);
    }
    // #22 Car moved to workshop
    if (car.status === 'in_workshop' && prev?.status !== 'in_workshop') {
      sendPush(dirs, '🔧 Car in workshop', `${carName} moved to workshop`, '/inventory', id);
    }
    // #23 Car photos uploaded
    if (car.photos && prev?.photos && car.photos.length > prev.photos.length) {
      sendPush(dirs, '📸 Photos uploaded', `New photos added for ${carName}`, '/inventory', id);
    }
  },
  deleteCar: async (id) => {
    // Optimistic: remove from UI immediately so the page doesn't go blank
    set((s) => ({ cars: s.cars.filter((c) => c.id !== id) }));
    pendingCarWrites.add(id);
    let error;
    try {
      ({ error } = await supabase.from('cars').delete().eq('id', id));
    } finally {
      pendingCarWrites.delete(id);
    }
    if (error) {
      console.error('deleteCar failed:', error.message);
      // Restore state on failure — only if re-fetch has data
      const { data } = await supabase.from('cars').select('*');
      if (data && data.length > 0) set({ cars: data.map(rowToCar) });
    } else {
      // Clear orphaned notifications so badge count stays accurate
      supabase.from('notifications').update({ is_read: true }).eq('reference_id', id).then(() => {});
      set(s => ({ notifications: s.notifications.filter(n => n.referenceId !== id) }));
    }
  },

  // Repairs
  addRepair: async (repair) => {
    // Admin only logs expenses/bills here — they have no in-house mechanic tracking
    // physical car location, so their entries must never move the car.
    const actorIsAdmin = get().currentUser?.role === 'admin';
    const car = get().cars.find((c) => c.id === repair.carId);
    const protectedStatus = car?.status === 'delivered' || car?.status === 'deal_pending' || car?.finalDeal != null;
    const shouldMoveCar = !actorIsAdmin && repair.location && repair.status !== 'queued';
    const updatedCars = shouldMoveCar
      ? get().cars.map((c) =>
          c.id === repair.carId
            ? { ...c, currentLocation: repair.location, ...(protectedStatus ? {} : { status: 'in_workshop' as Car['status'] }) }
            : c
        )
      : get().cars;
    set((s) => ({ repairs: [...s.repairs, repair], cars: updatedCars }));
    const { error } = await supabase.from('repairs').insert(repairToRow(repair));
    if (error) console.error('addRepair failed:', error.message);
    if (shouldMoveCar) {
      const dbUpdate: any = { current_location: repair.location };
      if (!protectedStatus) dbUpdate.status = 'in_workshop';
      await supabase.from('cars').update(dbUpdate).eq('id', repair.carId);
    }
    // #25 New repair job assigned to workshop
    const mechs = mechIds(get().users);
    const carName = `${car?.year ?? ''} ${car?.make ?? ''} ${car?.model ?? ''}`.trim();
    sendPush(mechs, '🔧 New repair job', `${repair.typeOfRepair} for ${carName}`, '/inventory', repair.carId);
    // #22 Car moved to workshop (notify directors)
    if (shouldMoveCar && !protectedStatus) {
      sendPush(dirIds(get().users), '🔧 Car in workshop', `${carName} moved to workshop`, '/inventory', repair.carId);
    }
  },
  updateRepair: async (id, repair) => {
    const actorIsAdmin = get().currentUser?.role === 'admin';
    const existing = get().repairs.find((r) => r.id === id);
    const { error: repErr } = await supabase.from('repairs').update(repairToRow(repair)).eq('id', id);
    if (repErr) console.error('updateRepair failed:', repErr.message);
    // #24 Repair job completed
    if (repair.status === 'done' && existing?.status !== 'done') {
      const car = get().cars.find(c => c.id === existing?.carId);
      const carName = `${car?.year ?? ''} ${car?.make ?? ''} ${car?.model ?? ''}`.trim();
      sendPush(dirIds(get().users), '✅ Repair completed', `${existing?.typeOfRepair} done for ${carName}`, '/inventory', existing?.carId);
    }
    set((s) => {
      const updatedRepairs = s.repairs.map((r) => (r.id === id ? { ...r, ...repair } : r));
      let updatedCars = s.cars;
      if (existing && !actorIsAdmin) {
        if (repair.status === 'done') {
          updatedCars = s.cars.map((c) =>
            c.id === existing.carId ? { ...c, currentLocation: 'Showroom' } : c
          );
        } else if (repair.status === 'pending' && existing.status === 'queued') {
          const location = repair.location ?? existing.location;
          if (location) {
            updatedCars = s.cars.map((c) => {
              if (c.id !== existing.carId) return c;
              const isProtected = c.status === 'delivered' || c.status === 'deal_pending' || c.finalDeal != null;
              return { ...c, currentLocation: location, ...(isProtected ? {} : { status: 'in_workshop' as Car['status'] }) };
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
    const { users } = get();
    if (instruction.type === 'instruction') {
      // #1 New instruction from director
      const recipients = instrRecipients(instruction, users);
      sendPush(recipients, '📋 New instruction', instruction.title, '/reminders', instruction.id);
    } else {
      // Request submitted → notify directors
      sendPush(dirIds(users), '📩 New request', `${instruction.title} from ${users.find(u => u.id === instruction.fromId)?.name ?? 'staff'}`, '/reminders', instruction.id);
    }
  },
  updateInstruction: async (id, instruction) => {
    const existing = get().instructions.find(i => i.id === id);
    set((s) => ({ instructions: s.instructions.map((i) => (i.id === id ? { ...i, ...instruction } : i)) }));
    await supabase.from('instructions').update(instructionToRow(instruction)).eq('id', id);
    if (!existing) return;
    // #2 Request approved
    if (instruction.status === 'completed' && existing.type === 'request') {
      sendPush([existing.fromId], '✅ Request approved', existing.title, '/reminders', id);
    }
    // #3 Request rejected
    if (instruction.status === 'rejected' && existing.type === 'request') {
      sendPush([existing.fromId], '❌ Request rejected', existing.title, '/reminders', id);
    }
    // #4 Instruction completed by staff
    if (instruction.status === 'completed' && existing.type === 'instruction') {
      sendPush(dirIds(get().users), '✅ Task completed', `${existing.title} marked done`, '/reminders', id);
    }
  },
  deleteInstruction: async (id) => {
    set((s) => ({ instructions: s.instructions.filter((i) => i.id !== id) }));
    await supabase.from('instructions').delete().eq('id', id);
  },

  // Users
  addUser: async (user) => {
    set((s) => ({ users: [...s.users, user] }));
    const { error } = await supabase.from('users').insert(userToRow(user));
    if (error) {
      set((s) => ({ users: s.users.filter((u) => u.id !== user.id) }));
      throw new Error(error.message);
    }
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
    // #5 New lead assigned
    if (customer.assignedSalesId) {
      sendPush([customer.assignedSalesId], '👤 New lead assigned', `${customer.name} has been assigned to you`, '/customers', customer.id);
    }
  },
  updateCustomer: async (id, customer) => {
    const prev = get().customers.find(c => c.id === id);
    set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...customer } : c)) }));
    const { error } = await supabase.from('customers').update(customerToRow(customer)).eq('id', id);
    if (error) {
      if (prev) set((s) => ({ customers: s.customers.map((c) => (c.id === id ? prev : c)) }));
      console.error('updateCustomer failed:', error.message);
      throw new Error(error.message);
    }
    // When a lead is moved to the bin, cancel any active loan cases
    if (customer.isTrashed && !prev?.isTrashed) {
      const now = new Date().toISOString();
      const activeCases = get().loanCases.filter(
        c => c.customerId === id && !['cancelled', 'withdrawn', 'approved'].includes(c.status)
      );
      if (activeCases.length > 0) {
        // Optimistic state update
        set((s) => ({
          loanCases: s.loanCases.map(c =>
            c.customerId === id && !['cancelled', 'withdrawn', 'approved'].includes(c.status)
              ? { ...c, status: 'cancelled', updatedAt: now }
              : c
          ),
        }));
        // Persist to DB
        const { error: cancelErr } = await supabase.from('loan_cases')
          .update({ status: 'cancelled', updated_at: now })
          .eq('customer_id', id)
          .not('status', 'in', '("cancelled","withdrawn","approved")');
        if (cancelErr) console.error('cancelLoanCases failed:', cancelErr.message);
        // Add a visible activity entry on each case so the banker sees why it was cancelled
        const salesPerson = get().users.find(u => u.id === (prev ?? get().customers.find(c => c.id === id))?.assignedSalesId);
        for (const lc of activeCases) {
          const activityRow = {
            id: crypto.randomUUID(),
            case_id: lc.id,
            user_id: prev?.assignedSalesId ?? '',
            user_name: salesPerson?.name ?? 'Salesman',
            user_role: 'salesperson',
            type: 'status_change',
            content: 'Case cancelled — customer moved to bin',
            old_status: lc.status,
            new_status: 'cancelled',
            created_at: now,
          };
          set((s) => ({
            loanCaseActivities: [...s.loanCaseActivities, {
              id: activityRow.id, caseId: lc.id,
              userId: activityRow.user_id, userName: activityRow.user_name, userRole: 'salesperson',
              type: 'status_change', content: activityRow.content,
              oldStatus: lc.status, newStatus: 'cancelled', createdAt: now,
            }],
          }));
          await supabase.from('loan_case_activity').insert(activityRow);
        }
      }
    }
    if (!prev) return;
    const dirs = dirIds(get().users);
    // #9 Loan submitted by salesman
    if (customer.loanApplications && customer.loanApplications.length > (prev.loanApplications?.length ?? 0)) {
      const latest = customer.loanApplications[customer.loanApplications.length - 1];
      sendPush(dirs, '🏦 Loan submitted', `${prev.name} – ${latest.bank}`, '/customers', id);
    }
    // #10 Loan approved / #11 Loan rejected
    if (customer.loanApplications) {
      const prevApps = prev.loanApplications ?? [];
      customer.loanApplications.forEach((app, i) => {
        const prevApp = prevApps[i];
        if (app.status === 'approved' && prevApp?.status !== 'approved') {
          sendPush([prev.assignedSalesId], '✅ Loan approved!', `${prev.name} – ${app.bank}`, '/customers', id);
        }
        if (app.status === 'rejected' && prevApp?.status !== 'rejected') {
          sendPush([prev.assignedSalesId], '❌ Loan rejected', `${prev.name} – ${app.bank}`, '/customers', id);
        }
      });
    }
    // #12 New loan work order
    if (customer.loanWorkOrder && !prev.loanWorkOrder) {
      sendPush(dirs, '📄 Loan work order', `New loan work order for ${prev.name}`, '/customers', id);
    }
    // #13 New cash work order
    if (customer.cashWorkOrder && !prev.cashWorkOrder) {
      sendPush(dirs, '💵 Cash work order', `New cash work order for ${prev.name}`, '/customers', id);
    }
    // #26 Commission calculated
    if (customer.commission && !prev.commission) {
      sendPush([prev.assignedSalesId], '💰 Commission calculated', `Your commission for ${prev.name} is RM ${customer.commission.toLocaleString()}`, '/customers', id);
    }
  },
  deleteCustomer: async (id) => {
    const now = new Date().toISOString();
    const activeCases = get().loanCases.filter(
      c => c.customerId === id && !['cancelled', 'withdrawn', 'approved'].includes(c.status)
    );
    if (activeCases.length > 0) {
      set((s) => ({
        loanCases: s.loanCases.map(c =>
          c.customerId === id && !['cancelled', 'withdrawn', 'approved'].includes(c.status)
            ? { ...c, status: 'cancelled', updatedAt: now }
            : c
        ),
      }));
      await supabase.from('loan_cases')
        .update({ status: 'cancelled', updated_at: now })
        .eq('customer_id', id)
        .not('status', 'in', '("cancelled","withdrawn","approved")');
    }
    set((s) => ({ customers: s.customers.filter((c) => c.id !== id) }));
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) {
      console.error('deleteCustomer failed:', error.message);
    } else {
      supabase.from('notifications').update({ is_read: true }).eq('reference_id', id).then(() => {});
      set(s => ({ notifications: s.notifications.filter(n => n.referenceId !== id) }));
    }
    // Always re-sync after delete — prevents cases where other leads temporarily vanish
    const { data } = await supabase.from('customers').select('*');
    if (data) set({ customers: data.map(rowToCustomer) });
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

  markNotificationsReadByRef: async (referenceId) => {
    const userId = get().currentUser?.id;
    if (!userId) return;
    set((s) => ({
      notifications: s.notifications.map(n =>
        n.referenceId === referenceId ? { ...n, isRead: true } : n
      ).filter(n => !n.isRead),
    }));
    await supabase.from('notifications')
      .update({ is_read: true })
      .eq('reference_id', referenceId)
      .eq('user_id', userId)
      .eq('is_read', false);
  },

  drainToastQueue: () => set({ toastQueue: [] }),

  markNotificationReadById: async (id) => {
    const userId = get().currentUser?.id;
    if (!userId) return;
    set((s) => ({ notifications: s.notifications.filter(n => n.id !== id) }));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', userId);
  },

  setBankerOpenCaseId: (id) => set({ bankerOpenCaseId: id }),

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
  updateDealer: async (id, updates) => {
    set((s) => ({ dealers: s.dealers.map((d) => d.id === id ? { ...d, ...updates } : d) }));
    await supabase.from('dealers').update(updates).eq('id', id);
  },
  deleteDealer: async (id) => {
    set((s) => ({ dealers: s.dealers.filter((d) => d.id !== id) }));
    await supabase.from('dealers').delete().eq('id', id);
  },

  addWorkshop: async (workshop) => {
    set((s) => ({ workshops: [...s.workshops, workshop] }));
    const { error } = await supabase.from('workshops').insert(workshopToRow(workshop));
    if (error) {
      set((s) => ({ workshops: s.workshops.filter((w) => w.id !== workshop.id) }));
      throw new Error(error.message);
    }
  },
  updateWorkshop: async (id, updates) => {
    set((s) => ({ workshops: s.workshops.map((w) => w.id === id ? { ...w, ...updates } : w) }));
    await supabase.from('workshops').update(workshopToRow(updates)).eq('id', id);
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
  updateMerchant: async (id, updates) => {
    set((s) => ({ merchants: s.merchants.map((m) => m.id === id ? { ...m, ...updates } : m) }));
    await supabase.from('merchants').update(updates).eq('id', id);
  },
  deleteMerchant: async (id) => {
    set((s) => ({ merchants: s.merchants.filter((m) => m.id !== id) }));
    await supabase.from('merchants').delete().eq('id', id);
  },

  addPayment: async (payment) => {
    set((s) => ({ payments: [payment, ...s.payments] }));
    const { error } = await supabase.from('payments').insert(paymentToRow(payment));
    if (error) {
      set((s) => ({ payments: s.payments.filter((p) => p.id !== payment.id) }));
      throw new Error(error.message);
    }
    const PAYMENT_TYPE_LABELS: Record<string, string> = {
      salesman_commission: 'Commission', intake_bonus: 'Intake Bonus',
      source_commission: 'Source Comm.', repair: 'Workshop', misc_cost: 'Misc Cost',
      consignment_payout: 'Consignment', panel_charge: 'Panel Charge',
    };
    const label = PAYMENT_TYPE_LABELS[payment.type] ?? payment.type;
    const amtStr = `RM ${payment.amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    sendPush(
      mgmtIds(get().users),
      `💳 New payment pending`,
      `${payment.recipientName} · ${amtStr} · ${label}`,
      '/finance',
    );
  },
  batchAddPayments: async (newPayments) => {
    if (!newPayments.length) return;
    set((s) => ({ payments: [...newPayments, ...s.payments] }));
    await supabase.from('payments').insert(newPayments.map(paymentToRow));
  },
  updatePayment: async (id, updates) => {
    set((s) => ({ payments: s.payments.map((p) => p.id === id ? { ...p, ...updates } : p) }));
    await supabase.from('payments').update(paymentToRow(updates)).eq('id', id);
  },
  deletePayment: async (id) => {
    set((s) => ({ payments: s.payments.filter((p) => p.id !== id) }));
    await supabase.from('payments').delete().eq('id', id);
  },

  addExternalSalesman: async (s) => {
    set((st) => ({ externalSalesmen: [...st.externalSalesmen, s] }));
    const row = externalSalesmanToRow(s);
    delete row.id; // let Supabase generate the UUID
    const { data, error } = await supabase.from('external_salesmen').insert(row).select().single();
    if (error) {
      set((st) => ({ externalSalesmen: st.externalSalesmen.filter((x) => x.id !== s.id) }));
      throw new Error(error.message);
    }
    // Replace temp optimistic entry with real DB record (gets the proper UUID)
    if (data) {
      set((st) => ({
        externalSalesmen: st.externalSalesmen.map((x) => x.id === s.id ? rowToExternalSalesman(data) : x),
      }));
    }
  },
  updateExternalSalesman: async (id, s) => {
    set((st) => ({ externalSalesmen: st.externalSalesmen.map((x) => x.id === id ? { ...x, ...s } : x) }));
    await supabase.from('external_salesmen').update(externalSalesmanToRow(s)).eq('id', id);
  },
  deleteExternalSalesman: async (id) => {
    set((st) => ({ externalSalesmen: st.externalSalesmen.filter((x) => x.id !== id) }));
    await supabase.from('external_salesmen').delete().eq('id', id);
  },

  addBanker: async (b) => {
    set((st) => ({ bankers: [...st.bankers, b] }));
    const row = bankerToRow(b);
    delete row.id;
    const { data, error } = await supabase.from('bankers').insert(row).select().single();
    if (error) {
      set((st) => ({ bankers: st.bankers.filter((x) => x.id !== b.id) }));
      throw new Error(error.message);
    }
    if (data) set((st) => ({ bankers: st.bankers.map((x) => x.id === b.id ? rowToBanker(data) : x) }));
  },
  updateBanker: async (id, b) => {
    set((st) => ({ bankers: st.bankers.map((x) => x.id === id ? { ...x, ...b } : x) }));
    const { error } = await supabase.from('bankers').update(bankerToRow(b)).eq('id', id);
    if (error) console.error('updateBanker failed:', error.message);
  },
  deleteBanker: async (id) => {
    set((st) => ({ bankers: st.bankers.filter((x) => x.id !== id) }));
    await supabase.from('bankers').delete().eq('id', id);
  },

  // Car Movements
  addCarMovement: async (m) => {
    set((st) => ({ carMovements: [m, ...st.carMovements] }));
    const { data, error } = await supabase.from('car_movements').insert({
      id: m.id,
      car_id: m.carId ?? null,
      car_plate: m.carPlate,
      type: m.type,
      user_id: m.userId,
      user_name: m.userName,
      reason: m.reason ?? null,
      notes: m.notes ?? null,
      created_at: m.createdAt,
    }).select().single();
    if (error) {
      set((st) => ({ carMovements: st.carMovements.filter((x) => x.id !== m.id) }));
      throw new Error(error.message);
    }
    if (data) set((st) => ({ carMovements: st.carMovements.map((x) => x.id === m.id ? rowToCarMovement(data) : x) }));
  },

  // Shipments
  addShipment: async (s) => {
    set((st) => ({ shipments: [...st.shipments, s] }));
    const row = shipmentToRow(s);
    delete row.id;
    const { data, error } = await supabase.from('shipments').insert(row).select().single();
    if (error) {
      set((st) => ({ shipments: st.shipments.filter((x) => x.id !== s.id) }));
      throw new Error(error.message);
    }
    if (data) set((st) => ({ shipments: st.shipments.map((x) => x.id === s.id ? rowToShipment(data) : x) }));
  },
  updateShipment: async (id, s) => {
    set((st) => ({ shipments: st.shipments.map((x) => x.id === id ? { ...x, ...s } : x) }));
    const { error } = await supabase.from('shipments').update(shipmentToRow(s)).eq('id', id);
    if (error) console.error('updateShipment failed:', error.message);
  },
  deleteShipment: async (id) => {
    set((st) => ({ shipments: st.shipments.filter((x) => x.id !== id) }));
    await supabase.from('shipments').delete().eq('id', id);
  },

  // Loan Cases
  addLoanCase: async (loanCase) => {
    set((s) => ({ loanCases: [...s.loanCases, loanCase] }));
    const { error } = await supabase.from('loan_cases').insert({
      id: loanCase.id,
      customer_id: loanCase.customerId,
      car_id: loanCase.carId ?? null,
      salesman_id: loanCase.salesmanId,
      banker_id: loanCase.bankerId,
      banker_name: loanCase.bankerName ?? null,
      bank: loanCase.bank,
      loan_amount: loanCase.loanAmount,
      applicant_interview_text: loanCase.applicantInterviewText ?? null,
      guarantor_interview_text: loanCase.guarantorInterviewText ?? null,
      status: loanCase.status,
      created_at: loanCase.createdAt,
      updated_at: loanCase.updatedAt,
    });
    if (error) {
      set((s) => ({ loanCases: s.loanCases.filter((c) => c.id !== loanCase.id) }));
      throw new Error(error.message);
    }
    // Notify the banker (support both User.id and Banker.id formats)
    const salesman = get().users.find(u => u.id === loanCase.salesmanId);
    const customer = get().customers.find(c => c.id === loanCase.customerId);
    const bankerUser = get().users.find(u => u.id === loanCase.bankerId)
      ?? (() => {
        const profile = get().bankers.find(b => b.id === loanCase.bankerId);
        return profile?.userId ? get().users.find(u => u.id === profile.userId) : undefined;
      })();
    if (bankerUser) {
      sendPush([bankerUser.id], '📋 New case submitted', `${salesman?.name ?? 'Salesman'} – ${customer?.name ?? 'Customer'} · RM ${loanCase.loanAmount.toLocaleString()}`, '/banker-dashboard', loanCase.id);
    }
  },
  updateLoanCase: async (id, updates) => {
    const prev = get().loanCases.find(c => c.id === id);
    const now = new Date().toISOString();
    set((s) => ({ loanCases: s.loanCases.map((c) => c.id === id ? { ...c, ...updates, updatedAt: now } : c) }));
    const dbRow: any = { updated_at: now };
    if (updates.status !== undefined) dbRow.status = updates.status;
    if (updates.applicantInterviewText !== undefined) dbRow.applicant_interview_text = updates.applicantInterviewText;
    if (updates.guarantorInterviewText !== undefined) dbRow.guarantor_interview_text = updates.guarantorInterviewText;
    if (updates.bankerName !== undefined) dbRow.banker_name = updates.bankerName;
    if (updates.approvedAmount !== undefined) dbRow.approved_amount = updates.approvedAmount;
    if (updates.interestRate !== undefined) dbRow.interest_rate = updates.interestRate;
    if (updates.tenure !== undefined) dbRow.tenure = updates.tenure;
    if (updates.bankProducts !== undefined) dbRow.bank_products = updates.bankProducts;
    const { error } = await supabase.from('loan_cases').update(dbRow).eq('id', id);
    if (error) {
      if (prev) set((s) => ({ loanCases: s.loanCases.map((c) => c.id === id ? prev : c) }));
      throw new Error(error.message);
    }
    // Resolve banker User account from either User.id or Banker.id
    const resolveBankerUser = (bankerId: string) =>
      get().users.find(u => u.id === bankerId) ??
      (() => {
        const profile = get().bankers.find(b => b.id === bankerId);
        return profile?.userId ? get().users.find(u => u.id === profile.userId) : undefined;
      })();

    // Notify banker when guarantor info is added for the first time
    if (updates.guarantorInterviewText && !prev?.guarantorInterviewText && prev) {
      const cust = get().customers.find(c => c.id === prev.customerId);
      const bankerUser = resolveBankerUser(prev.bankerId);
      if (bankerUser) {
        sendPush([bankerUser.id], '👤 Guarantor added', `${prev.bank} · ${cust?.name ?? 'Customer'} – interview notes available`, '/banker-dashboard', id);
      }
    }
    // Notify on status change
    if (updates.status && prev?.status !== updates.status && prev) {
      const cust = get().customers.find(c => c.id === prev.customerId);
      const custName = cust?.name ?? 'Customer';
      // Banker → salesman updates
      const toSalesmanLabels: Record<string, string> = {
        under_review:   'Under Review',
        approved:       'Approved ✅',
        rejected:       'Rejected ❌',
        need_more_info: 'More Info Needed',
      };
      const salesLabel = toSalesmanLabels[updates.status];
      if (salesLabel) {
        sendPush([prev.salesmanId], `📋 Case ${salesLabel}`, `${prev.bank} · ${custName}`, '/loan-cases', id);
      }
      // Salesman → banker updates
      if (updates.status === 'appeal') {
        const bankerUser = resolveBankerUser(prev.bankerId);
        if (bankerUser) {
          sendPush([bankerUser.id], '🔁 Appeal filed', `${custName} · ${prev.bank} case appealed`, '/banker-dashboard', id);
        }
      }
      if (updates.status === 'withdrawn') {
        const bankerUser = resolveBankerUser(prev.bankerId);
        if (bankerUser) {
          sendPush([bankerUser.id], '↩️ Case withdrawn', `${custName} · ${prev.bank} case withdrawn`, '/banker-dashboard', id);
        }
      }
    }
  },
  addLoanCaseActivity: async (activity) => {
    set((s) => ({ loanCaseActivities: [...s.loanCaseActivities, activity] }));
    await supabase.from('loan_case_activity').insert({
      id: activity.id,
      case_id: activity.caseId,
      user_id: activity.userId,
      user_name: activity.userName,
      user_role: activity.userRole,
      type: activity.type,
      content: activity.content ?? null,
      old_status: activity.oldStatus ?? null,
      new_status: activity.newStatus ?? null,
      created_at: activity.createdAt,
    });
    const resolveBankerUser = (bankerId: string) =>
      get().users.find(u => u.id === bankerId) ??
      (() => {
        const profile = get().bankers.find(b => b.id === bankerId);
        return profile?.userId ? get().users.find(u => u.id === profile.userId) : undefined;
      })();
    // Banker adds remark/instruction → notify salesman
    if ((activity.type === 'remark' || activity.type === 'instruction') && activity.userRole === 'banker') {
      const lc = get().loanCases.find(c => c.id === activity.caseId);
      if (lc) {
        const cust = get().customers.find(c => c.id === lc.customerId);
        const label = activity.type === 'instruction' ? 'Instruction' : 'Remark';
        sendPush([lc.salesmanId], `💬 Banker ${label}`, `${lc.bank} · ${cust?.name ?? 'Customer'}: ${activity.content ?? ''}`.slice(0, 100), '/loan-cases', lc.id);
      }
    }
    // Salesman adds remark → notify banker
    if (activity.type === 'remark' && activity.userRole !== 'banker') {
      const lc = get().loanCases.find(c => c.id === activity.caseId);
      if (lc) {
        const cust = get().customers.find(c => c.id === lc.customerId);
        const bankerUser = resolveBankerUser(lc.bankerId);
        if (bankerUser) {
          sendPush([bankerUser.id], '💬 Salesman Remark', `${lc.bank} · ${cust?.name ?? 'Customer'}: ${activity.content ?? ''}`.slice(0, 100), '/banker-dashboard', lc.id);
        }
      }
    }
  },
  addLoanCaseDocument: async (doc) => {
    set((s) => ({ loanCaseDocuments: [...s.loanCaseDocuments, doc] }));
    const { error } = await supabase.from('loan_case_documents').insert({
      id: doc.id,
      case_id: doc.caseId,
      type: doc.type,
      file_name: doc.fileName,
      file_path: doc.filePath,
      uploaded_at: doc.uploadedAt,
    });
    if (error) {
      set((s) => ({ loanCaseDocuments: s.loanCaseDocuments.filter((d) => d.id !== doc.id) }));
      throw new Error(error.message);
    }
    // Notify banker that new documents have been uploaded
    const lc = get().loanCases.find(c => c.id === doc.caseId);
    if (lc) {
      const banker = get().users.find(u => u.id === lc.bankerId);
      const cust = get().customers.find(c => c.id === lc.customerId);
      if (banker) {
        sendPush([banker.id], '📎 Document uploaded', `${lc.bank} · ${cust?.name ?? 'Customer'} – ${doc.fileName}`, '/banker-dashboard', lc.id);
      }
    }
  },
  deleteLoanCaseDocument: async (id) => {
    const doc = get().loanCaseDocuments.find(d => d.id === id);
    set((s) => ({ loanCaseDocuments: s.loanCaseDocuments.filter((d) => d.id !== id) }));
    if (doc) await supabase.storage.from('loan-documents').remove([doc.filePath]);
    await supabase.from('loan_case_documents').delete().eq('id', id);
  },

  // Investor Transactions
  addInvestorTransaction: async (txn) => {
    set((s) => ({ investorTransactions: [...s.investorTransactions, txn] }));
    const { error } = await supabase.from('investor_transactions').insert(investorTxnToRow(txn));
    if (error) {
      set((s) => ({ investorTransactions: s.investorTransactions.filter((t) => t.id !== txn.id) }));
      throw new Error(error.message);
    }
    // Notifications
    if (txn.type === 'withdrawal' && txn.status === 'pending') {
      const investor = get().users.find(u => u.id === txn.investorId);
      const amtStr = `RM ${txn.amount.toLocaleString()}`;
      sendPush(dirIds(get().users), '💸 Withdrawal request', `${investor?.name ?? 'Investor'} requests ${amtStr}`, '/investors', txn.id);
    }
    if (txn.type === 'top_up') {
      const amtStr = `RM ${txn.amount.toLocaleString()}`;
      sendPush([txn.investorId], '💰 Capital top-up', `${amtStr} has been added to your account`, '/investor-portal', txn.id);
    }
  },
  updateInvestorTransaction: async (id, updates) => {
    const prev = get().investorTransactions.find(t => t.id === id);
    set((s) => ({ investorTransactions: s.investorTransactions.map((t) => t.id === id ? { ...t, ...updates } : t) }));
    const { error } = await supabase.from('investor_transactions').update(investorTxnToRow(updates)).eq('id', id);
    if (error) {
      if (prev) set((s) => ({ investorTransactions: s.investorTransactions.map((t) => t.id === id ? prev : t) }));
      throw new Error(error.message);
    }
    if (!prev) return;
    // Notify investor on approval / rejection / transfer
    if (updates.status === 'approved' && prev.status !== 'approved') {
      const months = updates.waitingMonths ?? prev.waitingMonths ?? 3;
      sendPush([prev.investorId], '✅ Withdrawal approved', `RM ${prev.amount.toLocaleString()} – ${months} months waiting period`, '/investor-portal', id);
    }
    if (updates.status === 'rejected' && prev.status !== 'rejected') {
      sendPush([prev.investorId], '❌ Withdrawal rejected', `RM ${prev.amount.toLocaleString()} request was rejected`, '/investor-portal', id);
    }
    if (updates.status === 'transferred' && prev.status !== 'transferred') {
      sendPush([prev.investorId], '💸 Withdrawal transferred', `RM ${prev.amount.toLocaleString()} has been transferred`, '/investor-portal', id);
    }
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
