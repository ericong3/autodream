export interface User {
  id: string;
  name: string;
  username: string;
  password: string;
  role: 'director' | 'salesperson' | 'mechanic';
  phone: string;
  monthlyTarget: number;
  carsInMonth: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
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

export interface Car {
  id: string;
  make: string;
  model: string;
  year: number;
  colour: string;
  mileage: number;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  purchasePrice: number;
  sellingPrice: number;
  transmission: 'auto' | 'manual';
  status: 'coming_soon' | 'in_workshop' | 'ready' | 'photo_complete' | 'submitted' | 'deal_pending' | 'sold' | 'available' | 'reserved';
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
