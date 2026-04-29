export interface User {
  id: string;
  name: string;
  username: string;
  password: string;
  role: 'director' | 'salesperson' | 'mechanic' | 'admin' | 'investor';
  phone: string;
  monthlyTarget: number;
  carsInMonth: number;
  capitalAmount?: number; // investor total capital in RM
  // Profile / name card fields
  avatar?: string;
  position?: string;
  bio?: string;
  email?: string;
  whatsapp?: string;
  instagram?: string;
  facebook?: string;
  website?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
}

export interface LoanApplication {
  bank: string;
  status: 'submitted' | 'approved' | 'rejected';
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
  status: 'submitted' | 'approved' | 'rejected';
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

export interface Dealer {
  id: string;
  name: string;
}

export interface Workshop {
  id: string;
  name: string;
  phone?: string;
  speciality?: string;
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
  priceFloor?: number;
  miscCosts?: MiscCost[];
  investorId?: string;   // investor user id who funded this car
  investorSplit?: number; // investor's profit share % (default 50)
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

export const BANKS = ['Aeon', 'Chailease', 'CIMB', 'HLB', 'Maybank', 'Public', 'Toyota Capital'] as const;
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

export interface PostSaleChecklist {
  wantsCustomPlate?: boolean;
  puspakomBooked?: boolean;
  puspakomDate?: string;
  b5Obtained?: boolean;
  b7Obtained?: boolean;
  b2Booked?: boolean;
  b2Obtained?: boolean;
  insuranceCoverNote?: boolean;
  nameTransferDone?: boolean;
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
