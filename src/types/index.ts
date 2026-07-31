export interface User {
  id: string;
  name: string;
  username: string;
  password: string;
  role: 'director' | 'salesperson' | 'mechanic' | 'admin' | 'investor' | 'shareholder' | 'banker';
  phone: string;
  monthlyTarget: number;
  carsInMonth: number;
  // Payroll — full-time salespeople get a fixed monthly basic + allowance on
  // top of per-deal commission; commission-only salespeople have neither.
  employmentType?: 'full_time' | 'commission_only';
  basicSalary?: number;
  allowance?: number;
  // A raise on top of basicSalary, kept as its own line rather than folded
  // into basicSalary directly — permanent (no expiry) unlike temporaryBoost.
  salaryIncrement?: number;
  // Time-limited top-up — applies to payroll months up to and including
  // temporaryBoostUntil ('YYYY-MM'), then stops counting on its own without
  // needing to be manually removed.
  temporaryBoost?: number;
  temporaryBoostUntil?: string;
  // Payslip identity fields — separate from position/bio, since those are
  // profile-card display text while these are formal HR record fields.
  employeeId?: string;
  department?: string;
  joiningDate?: string; // 'YYYY-MM-DD'
  capitalAmount?: number; // investor total capital in RM
  banks?: string[];       // for banker role — which banks they handle
  // Profile / name card fields
  avatar?: string;
  position?: string;
  bio?: string;
  email?: string;
  whatsapp?: string;
  instagram?: string;
  facebook?: string;
  website?: string;
  // Bank details (for commission transfers)
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
}

export type LoanCaseStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'need_more_info' | 'appeal' | 'withdrawn' | 'cancelled';

export interface LoanCaseBankProduct {
  name: string;
  amount: number;
}

export interface LoanCase {
  id: string;
  customerId: string;
  carId?: string;
  salesmanId: string;
  bankerId: string;   // Banker.id (new) or User.id for legacy cases
  bankerName?: string; // display name for bankers without app accounts
  bank: string;
  loanAmount: number;
  applicantInterviewText?: string;
  guarantorInterviewText?: string;
  additionalInterviewText?: string;
  status: LoanCaseStatus;
  // Approval details (filled in when status = approved)
  approvedAmount?: number;
  interestRate?: number;
  tenure?: number; // months
  bankProducts?: LoanCaseBankProduct[];
  // Set when Change Car touches this case without fully resolving it — surfaces a
  // follow-up action (get a fresh LOU, or decide whether to resubmit) instead of
  // silently pretending the switch is complete.
  carChangeFollowUp?: {
    type: 'lou_update' | 'resubmit';
    fromCarId: string;
    toCarId: string;
    flaggedAt: string;
  };
  // Set automatically when this car sells out from under an open case (someone
  // else's deal on it went to deal_pending/delivered first) — surfaces an
  // urgent "unit sold, convert car" banner instead of the salesperson finding
  // out only when they happen to check.
  carSoldAlert?: {
    soldCarId: string;
    flaggedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LoanOrder {
  carId: string;
  sellingPrice: number;
  insurance: number;
  bankProduct: number;
  additionalItems: WorkOrderItem[];
  discount: number;
  requestedLoanAmount: number;
  hasTradeIn: boolean;
  tradeInPlate?: string;
  tradeInMake?: string;
  tradeInModel?: string;
  tradeInVariant?: string;
  tradeInPrice?: number;
  settlementFigure?: number;
  submittedBy: string;
  createdAt: string;
}

export interface LoanCaseDocument {
  id: string;
  caseId: string;
  type: 'applicant' | 'guarantor' | 'additional';
  fileName: string;
  filePath: string;
  uploadedAt: string;
}

export interface LoanCaseActivity {
  id: string;
  caseId: string;
  userId: string;
  userName: string;
  userRole: string;
  type: 'status_change' | 'remark' | 'instruction' | 'whatsapp_response';
  content?: string;
  oldStatus?: string;
  newStatus?: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
}

export interface Banker {
  id: string;
  name: string;
  bank: string;       // which bank they work at (must match BANKS)
  phone?: string;
  email?: string;
  notes?: string;
  userId?: string;    // linked User account (if they use the app); absent = no account
  createdAt: string;
}

export interface LoanApplication {
  bank: string;
  bankerId?: string;   // links to Banker.id
  bankerName?: string; // denormalised for display
  status: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  approvalReason?: string;
  approvedAt?: string;
  approvedAmount?: number;
  interestRate?: number;
  rejectionReason?: string;
}

export interface WorkOrderItem {
  label: string;
  amount: number;
}

export interface LoanWorkOrder {
  carId: string;
  bank: string;
  loanAmount: number;
  // Deal
  sellingPrice: number;
  insurance: number;
  bankProduct: number;
  bankProductItems?: WorkOrderItem[];
  additionalItems: WorkOrderItem[];
  bookingFee: number;
  discount: number;
  // Customer
  customerName: string;
  customerIc: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  // Trade in
  hasTradeIn: boolean;
  tradeInPhotos: string[];
  greenCardPhoto: string;
  tradeInPlate: string;
  tradeInMake: string;
  tradeInModel: string;
  tradeInVariant: string;
  tradeInPrice: number;
  settlementFigure: number;
  // Meta
  submittedBy: string;
  createdAt: string;
}

export interface CashWorkOrder {
  carId: string;
  // Deal
  sellingPrice: number;
  insurance: number;
  bankProduct: number;
  bankProductItems?: WorkOrderItem[];
  additionalItems: WorkOrderItem[];
  bookingFee: number;
  downpayment: number;
  discount: number;
  // Customer
  customerName: string;
  customerIc: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  // Trade in
  hasTradeIn: boolean;
  tradeInPhotos: string[];
  greenCardPhoto: string;
  tradeInPlate: string;
  tradeInMake: string;
  tradeInModel: string;
  tradeInVariant: string;
  tradeInPrice: number;
  settlementFigure: number;
  // Meta
  submittedBy: string;
  createdAt: string;
}

export interface TradeIn {
  make: string;
  model: string;
  year: number;
  carPlate: string;
  colour: string;
  mileage: number;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  outstandingLoan: number;
  offeredValue: number;
  damages: string;
  photos: string[];
}

export interface LoanSubmission {
  id: string;
  bank: string;
  customerName: string;
  customerPhone: string;
  submittedBy: string;
  submittedAt: string;
  status: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  notes?: string;
}

export interface FinalDeal {
  submittedBy: string;
  submittedAt: string;
  dealPrice: number;
  bank: string;
  notes?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  rejectionNotes?: string;
}

export type PaymentTerms = 'per_job' | 'weekly' | 'monthly';

export interface Dealer {
  id: string;
  name: string;
  phone?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
}

export interface Workshop {
  id: string;
  name: string;
  phone?: string;
  speciality?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  paymentTerms?: PaymentTerms;
  companyDocPath?: string;   // storage path in 'workshop-documents' bucket (SSM / business registration)
  companyDocName?: string;   // original filename for display
  // Deletion requires director approval — admin can only flag it
  deleteRequestedBy?: string;
  deleteRequestedAt?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  category?: string;
}

export interface Merchant {
  id: string;
  name: string;
  phone?: string;
  category?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  paymentTerms?: PaymentTerms;
}

// Admin-managed list of expense claim categories — 'kind' decides which car
// cost bucket a confirmed claim in that category writes into.
export interface ClaimCategory {
  id: string;
  name: string;
  kind: 'repair' | 'misc';
}

export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';

// The Chart of Accounts — admin-managed, forms the backbone of proper
// double-entry bookkeeping (journal entries reference these, not free text).
export interface LedgerAccount {
  id: string;
  name: string;
  type: LedgerAccountType;
  // Only meaningful for Bank accounts under a single-investor setup —
  // ties a bank account to the investor whose money sits in it.
  investorTagged?: boolean;
  notes?: string;
}

export interface JournalLine {
  accountId: string;
  debit: number;
  credit: number;
}

// A balanced double-entry posting — sum(debit) must equal sum(credit) across
// lines. Never hard-deleted once posted; corrections are voided, not removed,
// so there's always a trail of what was recorded and why it was reversed.
export interface JournalEntry {
  id: string;
  date: string;
  description: string;
  lines: JournalLine[];
  // What real-world event produced this entry, for tracing back
  sourceType?: string;
  sourceId?: string;
  carId?: string;
  createdBy?: string;
  createdAt: string;
  voided?: boolean;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

export interface ExternalSalesman {
  id: string;
  name: string;
  ic?: string;
  phone?: string;
  email?: string;
  bank?: string;
  bankAccount?: string;
  notes?: string;
  createdAt: string;
}

export interface DealProgress {
  puspakomBookedDate?: string;
  puspakomDoneDate?: string;
  puspakomType?: ('B2' | 'B5' | 'B7')[];
  ehakRequestedDate?: string;
  ehakReceivedDate?: string;
  insuranceCovernoteDone?: boolean;
  nameChangeDone?: boolean;
  nameChangeMethod?: 'eauto' | 'jpj';
  deliveryOrderSigned?: boolean;
  documentsSubmittedDate?: string;
  disbursementReceived?: boolean;
  fullPaymentCollected?: boolean;
}

export interface Consignment {
  dealer: string;
  terms: 'fixed_amount' | 'profit_split';
  fixedAmount?: number;
  splitPercent?: number;
}

export interface Car {
  id: string;
  make: string;
  model: string;
  variant?: string;
  year: number;
  carPlate?: string;
  colour: string;
  mileage: number;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  purchasePrice: number;
  sellingPrice: number;
  transmission: 'auto' | 'manual';
  status: 'coming_soon' | 'in_workshop' | 'ready' | 'photo_complete' | 'submitted' | 'deal_pending' | 'sold' | 'available' | 'reserved' | 'delivered';
  photo?: string;
  photos?: string[];
  greenCard?: string;
  // Intake checklist (own stock only) — prep required when the car is taken in,
  // before it's resold: the physical green card from the previous owner (the
  // greenCard photo above is the proof it's in hand), and the eAuto
  // ownership-transfer thumbprint from the previous owner (as seller).
  // intakeComplete is a separate explicit confirmation — having both the green
  // card and thumbprint doesn't remove the task by itself, so it can't vanish
  // unnoticed; admin has to actually confirm it before it drops off.
  thumbprintDone?: boolean;
  intakeComplete?: boolean;
  assignedSalesperson?: string;
  dateAdded: string;
  notes?: string;
  // Workshop & status tracking
  currentLocation?: string;
  checklistItems?: ChecklistItem[];
  photoTakenBy?: string[];
  loanSubmissions?: LoanSubmission[];
  finalDeal?: FinalDeal;
  deliveryPhoto?: string;
  deliveryCollected?: boolean;
  consignment?: Consignment;
  outgoingConsignment?: Consignment;
  moneyReceived?: boolean;
  priceFloor?: number;
  miscCosts?: MiscCost[];
  investorId?: string;   // investor user id who funded this car
  investorSplit?: number; // investor's profit share % (default 50)
  sourceSalesman?: string;       // display name (kept for backward compat)
  sourceType?: 'external' | 'internal';
  externalSalesmanId?: string;   // links to ExternalSalesman entity
  sourceSalesmanId?: string;     // links to User.id for internal AutoDream salesperson
  sourceCommission?: number;     // commission paid to source person (external fee or internal sourcing bonus)
  intakeCommission?: number;     // in-house salesman bonus when external source: 0 | 500 | 1000
  carInDate?: string;            // date director clicked "Car In" — commission counts from this date
  disbursementAmount?: number;   // loan disbursement from bank (RM)
  disbursementDate?: string;     // date bank sent the money
  comingSoonType?: 'trade_in' | 'direct_purchase' | 'pending_shipment' | 'in_shipment';
  shipmentId?: string;
  panelDealerId?: string;        // dealer whose bank panel was used for loan submission
  panelChargeAmount?: number;    // fee charged by panel dealer (varies by bank)
  collectionReceiptUrl?: string;
  isStaffSale?: boolean;
  waiveCommission?: boolean;
  // Per-car exception to the normal "commission counts once delivered" rule —
  // a director can flag a specific deal to count toward commission before the
  // car has physically been delivered. Doesn't change the rule for any other
  // car. commissionCreditedMonth ('YYYY-MM') is the director's explicit
  // choice of which month it counts toward — a dedicated field rather than
  // reusing dateAdded/finalDeal, since those mean other things (inventory
  // intake date, days-in-stock) that shouldn't shift just for this.
  commissionCreditedEarly?: boolean;
  commissionCreditedMonth?: string;
  sellerThumbprintSaved?: boolean;
  dealProgress?: DealProgress;
}

export interface MiscCost {
  id: string;
  description: string;
  amount: number;
  category?: string;
  merchant?: string;
  createdAt: string;
  createdBy?: string;
}

export interface RepairJob {
  id: string;
  carId: string;
  typeOfRepair: string;
  parts: { name: string; cost: number }[];
  labourCost: number;
  totalCost: number;
  status: 'queued' | 'pending' | 'in_progress' | 'done';
  location?: string;
  receiptPhoto?: string;
  actualCost?: number;
  completedAt?: string;
  notes?: string;
  createdAt: string;
}

export interface Quotation {
  id: string;
  type: 'inbound' | 'outbound';
  contactName: string;
  phone: string;
  make: string;
  model: string;
  year: number;
  mileage: number;
  offeredPrice: number;
  expiryDate: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  photo?: string;
  notes?: string;
  createdAt: string;
}

export interface Instruction {
  id: string;
  type: 'instruction' | 'request';
  fromId: string;
  toType?: 'all' | 'department' | 'individual';
  toDepartment?: 'salesman' | 'mechanic';
  toIds?: string[];
  title: string;
  message: string;
  status: 'pending' | 'acknowledged' | 'completed' | 'rejected';
  requestCategory?: 'purchase' | 'payment' | 'other';
  requestTarget?: 'company' | 'salesman' | 'mechanic' | 'admin';
  amount?: number;
  createdAt: string;
}

export type CarStatus = Car['status'];
export type CarCondition = Car['condition'];
export type QuotationStatus = Quotation['status'];
export type RepairStatus = RepairJob['status'];

export const BANKS = ['Aeon', 'Affin', 'Chailease', 'CIMB', 'HLB', 'Maybank', 'Public', 'RHB', 'Toyota Capital'] as const;
// Banks that are finance companies — no individual banker assigned
export const NO_BANKER_BANKS = ['Aeon', 'Chailease', 'Toyota Capital'] as const;
export type Bank = typeof BANKS[number];

export const REPAIR_TYPES = [
  'Spray Paint',
  'Panel Beating',
  'Full Detailing',
  'Polishing',
  'Interior Cleaning',
  'Engine Repair',
  'Brake Service',
  'Tyre Replacement',
  'Air Conditioning',
  'Electrical',
  'Transmission Service',
  'Suspension / Steering',
  'Glass / Windscreen',
  'Others',
] as const;

export const REPAIR_LOCATIONS = [
  'Workshop A',
  'Workshop B',
  'Spray Shop',
  'Panel Shop',
  'Tyre Shop',
  'Electrical Workshop',
  'AC Workshop',
  'Glass Shop',
] as const;

export const DEFAULT_CHECKLIST_LABELS = [
  'Body & Paint Inspection',
  'Tyre Condition',
  'Engine Bay Check',
  'Air Conditioning',
  'Interior Cleaning',
  'Electrical & Lights',
  'Brake Test',
  'Test Drive Completed',
];

// Merged with what used to be the separate car-side "Deal Progress" checklist —
// Puspakom/insurance/name-transfer were tracked twice (once here, once on
// Car.dealProgress) under different field names, so ticking one didn't tick the
// other. This is now the single source of truth; Car.dealProgress is legacy-only,
// read once to backfill this on first open and never written to again.
export interface PostSaleChecklist {
  estimatedDeliveryDate?: string;
  deliveryReminderId?: string; // links to a PersonalReminder, kept in sync when the date changes
  agreementSigned?: boolean;
  thumbprintDone?: boolean;
  puspakomBooked?: boolean;
  puspakomDate?: string;
  puspakomType?: ('B2' | 'B5' | 'B7')[]; // inspection cert types actually obtained
  wantsCustomPlate?: boolean;
  b2Booked?: boolean;
  b2Obtained?: boolean;
  puspakomDone?: boolean;   // auto-implies b5 (+ b7 for loan) obtained
  ehakRequestedDate?: string; // loan only
  ehakReceivedDate?: string;  // loan only
  eHakDone?: boolean;       // loan only — hire purchase transfer, after puspakom
  insuranceCoverNote?: boolean;
  nameChangeMethod?: 'eauto' | 'jpj';
  nameTransferDone?: boolean;
  deliveryOrderSigned?: boolean;
  documentsSubmittedDate?: string;
  disbursementReceived?: boolean;  // loan
  fullPaymentCollected?: boolean;  // cash
}

export interface Customer {
  id: string;
  name: string;
  ic?: string;
  phone: string;
  email?: string;
  employer?: string;
  monthlySalary?: number;
  source: 'walk_in' | 'referral' | 'online' | 'repeat' | 'fb_marketplace' | 'mudah' | 'fb_page';
  leadStatus: 'contacted' | 'test_drive' | 'follow_up' | 'loan_submitted';
  interestedCarId?: string;
  assignedSalesId: string;
  notes?: string;
  followUpDate?: string;
  dealPrice?: number;
  loanStatus?: 'not_started' | 'submitted' | 'approved' | 'rejected';
  loanBankSubmitted?: string;
  loanApplications?: LoanApplication[];
  followUpRemark?: string;
  tradeIn?: TradeIn;
  cashWorkOrder?: CashWorkOrder;
  loanWorkOrder?: LoanWorkOrder;
  loanOrder?: LoanOrder;
  delivered?: boolean;
  deliveredAt?: string;
  deliveryPhoto?: string;
  postSaleChecklist?: PostSaleChecklist;
  lastActionAt?: string;
  isDead?: boolean;
  deadAt?: string;
  isTrashed?: boolean;
  trashedAt?: string;
  commission?: number;
  dealType?: 'cash' | 'loan';
  bookingFee?: number;
  bookingFeeReceiptUrl?: string;
  bookingFeeRecordedAt?: string;
  createdAt: string;
}

export interface TestDrive {
  id: string;
  customerId: string;
  carId: string;
  scheduledAt: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string;
  salesId: string;
  createdAt: string;
}

export interface PersonalReminder {
  id: string;
  userId: string;
  title: string;
  dueAt: string;
  isCompleted: boolean;
  createdAt: string;
}

// Personal Kanban board for Leads/Cash/Loan — fully user-defined columns (not tied to
// leadStatus), so dragging a card between columns is pure personal organization and
// never changes the customer's real pipeline status. Each user has their own set of
// columns; a customer not yet placed in any of the current user's columns shows in an
// "Unsorted" bucket computed client-side, not stored.
export interface KanbanColumn {
  id: string;
  userId: string;
  name: string;
  color: string; // key into COLUMN_COLORS palette, e.g. 'gold' | 'red' | 'blue' — user-picked
  cardIds: string[]; // customer ids, in this column's display order
  sortOrder: number;
  createdAt: string;
}

export type PaymentType =
  | 'salesman_commission'
  | 'intake_bonus'
  | 'salary'
  | 'allowance'
  | 'source_commission'
  | 'repair'
  | 'misc_cost'
  | 'consignment_payout'
  | 'consignment_collection'
  | 'panel_charge'
  | 'investor_payout'
  | 'customer_refund'
  | 'customer_collection'
  | 'loan_disbursement'
  | 'expense_claim';

export type PaymentStatus = 'pending' | 'transferred';
export type RecipientType = 'user' | 'external_salesman' | 'workshop' | 'dealer' | 'merchant' | 'customer';

export type InvestorTxnType = 'buy_in' | 'top_up' | 'withdrawal';
export type InvestorTxnStatus = 'completed' | 'pending' | 'approved' | 'rejected' | 'transferred';

export interface InvestorTransaction {
  id: string;
  investorId: string;
  type: InvestorTxnType;
  amount: number;
  status: InvestorTxnStatus;
  createdAt: string;
  approvedAt?: string;
  dueDate?: string;
  waitingMonths?: number;
  approvedBy?: string;
  rejectedBy?: string;
  rejectedAt?: string;
}

// A generated payslip snapshot — deliberately immutable (like a JournalEntry)
// once created, since it's a record of what was actually issued to someone,
// not a live-editable form. EPF/SOCSO/EIS are stored as whatever the director
// confirmed at generation time (auto-calculated suggestions, editable before
// saving) rather than recomputed later, so a past payslip never silently
// changes if rates or someone's rate profile changes afterward.
export interface Payslip {
  id: string;
  userId: string;
  payslipNo: string;
  payPeriodStart: string; // 'YYYY-MM-DD'
  payPeriodEnd: string;   // 'YYYY-MM-DD'
  payDate: string;        // 'YYYY-MM-DD'
  paymentMethod: string;
  // Earnings
  basicSalary: number;
  salesCommission: number;
  performanceBonus: number;
  allowance: number;
  // Deductions — employee side
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  pcbTax: number;
  otherDeduction: number;
  // Employer contributions — shown on the payslip, not part of net pay
  epfEmployer: number;
  socsoEmployer: number;
  eisEmployer: number;
  onProbation: boolean; // EPF/SOCSO/EIS intentionally not declared yet
  createdAt: string;
  createdBy: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body?: string;
  url: string;
  referenceId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface CarMovement {
  id: string;
  carId?: string;
  carPlate: string;
  type: 'in' | 'out';
  userId: string;
  userName: string;
  reason?: string;
  notes?: string;
  // Set when the movement is to/from an actual dealer or workshop (not the
  // lightweight reasons like Test Drive) — lets the log render a real
  // "AutoDream → X" trail instead of just a generic reason string.
  destinationType?: 'dealer' | 'workshop';
  destinationName?: string;
  createdAt: string;
}

export interface Shipment {
  id: string;
  vesselName: string;
  shippingLine?: string;
  originPort: string;
  destinationPort: string;
  etd: string;
  eta: string;
  freightCost?: number;
  paymentStatus: 'unpaid' | 'paid';
  notes?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  type: PaymentType;
  // Source references
  carId?: string;
  repairJobId?: string;
  miscCostId?: string;
  // Recipient
  recipientType: RecipientType;
  recipientId: string;
  recipientName: string;
  // Bank details snapshot at creation
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  // Amount
  amount: number;
  description?: string;
  // Transfer details
  status: PaymentStatus;
  transferredAt?: string;
  transferredBy?: string;
  referenceNumber?: string;
  receiptUrl?: string;
  notes?: string;
  // Delete request (admin requests, director approves)
  deleteRequestedBy?: string;
  deleteRequestedAt?: string;
  // Expense claim review (admin checks receipt/amount before it's payable)
  claimConfirmedBy?: string;
  claimConfirmedAt?: string;
  // Which car-cost bucket a confirmed claim writes into (repair vs misc) —
  // 'repair' becomes a completed RepairJob, 'misc' becomes a MiscCost entry,
  // so the car's existing profit math picks it up without any changes there.
  claimKind?: 'repair' | 'misc';
  claimCategory?: string;
  // Batch info for weekly/monthly grouped payments
  batchId?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}
