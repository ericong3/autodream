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
  status: 'available' | 'reserved' | 'sold';
  photo?: string;
  photos?: string[];
  greenCard?: string;
  assignedSalesperson?: string;
  dateAdded: string;
  notes?: string;
}


export interface RepairJob {
  id: string;
  carId: string;
  typeOfRepair: string;
  parts: { name: string; cost: number }[];
  labourCost: number;
  totalCost: number;
  status: 'pending' | 'in_progress' | 'done';
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
