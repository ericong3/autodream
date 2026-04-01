import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Car, RepairJob, Quotation, Instruction, Customer, TestDrive, PersonalReminder } from '../types';

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
  viewPreference: Record<string, 'grid' | 'list'>;

  // Auth
  login: (username: string, password: string) => boolean;
  logout: () => void;

  // Cars
  addCar: (car: Car) => void;
  updateCar: (id: string, car: Partial<Car>) => void;
  deleteCar: (id: string) => void;

  // Repairs
  addRepair: (repair: RepairJob) => void;
  updateRepair: (id: string, repair: Partial<RepairJob>) => void;
  deleteRepair: (id: string) => void;

  // Quotations
  addQuotation: (quotation: Quotation) => void;
  updateQuotation: (id: string, quotation: Partial<Quotation>) => void;
  deleteQuotation: (id: string) => void;

  // Instructions
  addInstruction: (instruction: Instruction) => void;
  updateInstruction: (id: string, instruction: Partial<Instruction>) => void;
  deleteInstruction: (id: string) => void;

  // Users
  addUser: (user: User) => void;
  updateUser: (id: string, user: Partial<User>) => void;
  deleteUser: (id: string) => void;

  // Customers
  addCustomer: (customer: Customer) => void;
  updateCustomer: (id: string, customer: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  // Test Drives
  addTestDrive: (testDrive: TestDrive) => void;
  updateTestDrive: (id: string, testDrive: Partial<TestDrive>) => void;
  deleteTestDrive: (id: string) => void;

  // Personal Reminders
  addPersonalReminder: (reminder: PersonalReminder) => void;
  updatePersonalReminder: (id: string, reminder: Partial<PersonalReminder>) => void;
  deletePersonalReminder: (id: string) => void;

  // View preference
  setViewPreference: (userId: string, page: string, view: 'grid' | 'list') => void;
}

const seedUsers: User[] = [
  {
    id: 'user-1',
    name: 'Ahmad Director',
    username: 'director',
    password: 'admin123',
    role: 'director',
    phone: '+60123456789',
    monthlyTarget: 8,
    carsInMonth: 5,
  },
  {
    id: 'user-2',
    name: 'Ali Hassan',
    username: 'ali',
    password: 'pass123',
    role: 'salesperson',
    phone: '+60112345678',
    monthlyTarget: 4,
    carsInMonth: 3,
  },
  {
    id: 'user-3',
    name: 'Sarah Lim',
    username: 'sarah',
    password: 'pass123',
    role: 'salesperson',
    phone: '+60198765432',
    monthlyTarget: 4,
    carsInMonth: 2,
  },
  {
    id: 'user-4',
    name: 'Rajan Kumar',
    username: 'rajan',
    password: 'pass123',
    role: 'mechanic',
    phone: '+60134567890',
    monthlyTarget: 0,
    carsInMonth: 0,
  },
];

const seedCars: Car[] = [
  {
    id: 'car-1',
    make: 'Perodua',
    model: 'Myvi',
    year: 2020,
    colour: 'White',
    mileage: 45000,
    condition: 'good',
    purchasePrice: 28000,
    sellingPrice: 38000,
    transmission: 'auto',
    status: 'available',
    assignedSalesperson: 'user-2',
    dateAdded: '2024-01-10',
    notes: 'Well maintained, one owner',
  },
  {
    id: 'car-2',
    make: 'Proton',
    model: 'X70',
    year: 2021,
    colour: 'Grey',
    mileage: 32000,
    condition: 'excellent',
    purchasePrice: 58000,
    sellingPrice: 78000,
    transmission: 'auto',
    status: 'reserved',
    assignedSalesperson: 'user-2',
    dateAdded: '2024-01-15',
    notes: 'Full service record, accident free',
  },
  {
    id: 'car-3',
    make: 'Honda',
    model: 'City',
    year: 2019,
    colour: 'Silver',
    mileage: 68000,
    condition: 'good',
    purchasePrice: 42000,
    sellingPrice: 58000,
    transmission: 'auto',
    status: 'available',
    assignedSalesperson: 'user-3',
    dateAdded: '2024-01-20',
    notes: 'Regular serviced at Honda dealer',
  },
  {
    id: 'car-4',
    make: 'Toyota',
    model: 'Vios',
    year: 2018,
    colour: 'Blue',
    mileage: 82000,
    condition: 'fair',
    purchasePrice: 32000,
    sellingPrice: 44000,
    transmission: 'auto',
    status: 'sold',
    assignedSalesperson: 'user-3',
    dateAdded: '2024-01-05',
    notes: 'Minor scratches on rear bumper',
  },
  {
    id: 'car-5',
    make: 'Nissan',
    model: 'Almera',
    year: 2022,
    colour: 'Red',
    mileage: 18000,
    condition: 'excellent',
    purchasePrice: 52000,
    sellingPrice: 68000,
    transmission: 'auto',
    status: 'available',
    assignedSalesperson: 'user-2',
    dateAdded: '2024-02-01',
    notes: 'Like new condition, under warranty',
  },
];


const seedRepairs: RepairJob[] = [
  {
    id: 'repair-1',
    carId: 'car-1',
    typeOfRepair: 'Full Detailing + Polishing',
    parts: [
      { name: 'Polish Compound', cost: 80 },
      { name: 'Wax Coating', cost: 120 },
    ],
    labourCost: 250,
    totalCost: 450,
    status: 'done',
    notes: 'Deep scratch removed, paint restored',
    createdAt: '2024-01-12T10:00:00Z',
  },
  {
    id: 'repair-2',
    carId: 'car-3',
    typeOfRepair: 'Brake Pad Replacement',
    parts: [
      { name: 'Front Brake Pads', cost: 180 },
      { name: 'Rear Brake Pads', cost: 160 },
      { name: 'Brake Fluid', cost: 35 },
    ],
    labourCost: 150,
    totalCost: 525,
    status: 'in_progress',
    notes: 'Brake pads worn, replacing all four',
    createdAt: '2024-02-15T08:00:00Z',
  },
];

const seedQuotations: Quotation[] = [
  {
    id: 'quot-1',
    type: 'inbound',
    contactName: 'Farid Ismail',
    phone: '+60153456789',
    make: 'Perodua',
    model: 'Ativa',
    year: 2021,
    mileage: 28000,
    offeredPrice: 55000,
    expiryDate: '2024-03-15',
    status: 'pending',
    notes: 'Owner willing to sell, car is in good condition',
    createdAt: '2024-02-18T10:00:00Z',
  },
  {
    id: 'quot-2',
    type: 'outbound',
    contactName: 'Melissa Chong',
    phone: '+60178765432',
    make: 'Toyota',
    model: 'Camry',
    year: 2020,
    mileage: 41000,
    offeredPrice: 115000,
    expiryDate: '2024-03-10',
    status: 'accepted',
    notes: 'Customer interested in Camry, offered price accepted',
    createdAt: '2024-02-10T14:00:00Z',
  },
];

const seedCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'Zahra Binti Azlan',
    ic: '920315-10-5678',
    phone: '+60123334455',
    email: 'zahra@gmail.com',
    employer: 'Maybank',
    monthlySalary: 4500,
    source: 'walk_in',
    leadStatus: 'follow_up',
    interestedCarId: 'car-1',
    assignedSalesId: 'user-2',
    notes: 'Very interested, came twice to view the Myvi. Wants to negotiate price.',
    followUpDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    dealPrice: 36500,
    loanStatus: 'not_started',
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'cust-2',
    name: 'Hafiz Bin Kamal',
    ic: '880920-14-3456',
    phone: '+60198887766',
    employer: 'Petronas',
    monthlySalary: 7000,
    source: 'referral',
    leadStatus: 'follow_up',
    interestedCarId: 'car-2',
    assignedSalesId: 'user-2',
    notes: 'Referred by previous customer. Loan submitted to CIMB.',
    followUpDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
    dealPrice: 75000,
    loanStatus: 'submitted',
    loanBankSubmitted: 'CIMB',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id: 'cust-3',
    name: 'Priya Raj',
    phone: '+60174445566',
    email: 'priya.raj@hotmail.com',
    employer: 'Grab',
    monthlySalary: 3800,
    source: 'online',
    leadStatus: 'test_drive',
    interestedCarId: 'car-3',
    assignedSalesId: 'user-3',
    notes: 'Contacted via Facebook. Wants test drive this weekend.',
    followUpDate: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
    loanStatus: 'not_started',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'cust-4',
    name: 'David Tan Wei Liang',
    ic: '951105-07-1234',
    phone: '+60165556677',
    employer: 'HSBC',
    monthlySalary: 5500,
    source: 'online',
    leadStatus: 'follow_up',
    interestedCarId: 'car-4',
    assignedSalesId: 'user-3',
    dealPrice: 44000,
    loanStatus: 'approved',
    loanBankSubmitted: 'Public',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: 'cust-5',
    name: 'Nurul Ain Binti Hamid',
    phone: '+60112223344',
    employer: 'Shopee',
    monthlySalary: 3200,
    source: 'online',
    leadStatus: 'contacted',
    interestedCarId: 'car-5',
    assignedSalesId: 'user-2',
    notes: 'Enquired about Almera via WhatsApp. Follow up needed.',
    followUpDate: new Date().toISOString().split('T')[0],
    loanStatus: 'not_started',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

const seedTestDrives: TestDrive[] = [
  {
    id: 'td-1',
    customerId: 'cust-3',
    carId: 'car-3',
    scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16),
    status: 'scheduled',
    notes: 'Customer wants morning slot, weekday preferred',
    salesId: 'user-3',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const seedPersonalReminders: PersonalReminder[] = [
  {
    id: 'prem-1',
    userId: 'user-2',
    title: 'Follow up with Zahra on Myvi deal',
    dueAt: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    isCompleted: false,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'prem-2',
    userId: 'user-2',
    title: 'Submit CIMB loan documents for Hafiz',
    dueAt: new Date().toISOString().split('T')[0],
    isCompleted: false,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'prem-3',
    userId: 'user-3',
    title: 'Confirm test drive appointment with Priya',
    dueAt: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
    isCompleted: false,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

const seedInstructions: Instruction[] = [
  {
    id: 'instr-1',
    type: 'instruction',
    fromId: 'user-1',
    toType: 'all',
    title: 'Monthly Sales Target Reminder',
    message: 'Please ensure all pending quotations are followed up before end of month. Update the system with latest customer status.',
    status: 'pending',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'instr-2',
    type: 'instruction',
    fromId: 'user-1',
    toType: 'department',
    toDepartment: 'mechanic',
    title: 'Workshop Safety Inspection',
    message: 'Conduct a full safety inspection of all tools and equipment this week. Report any issues immediately.',
    status: 'acknowledged',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'req-1',
    type: 'request',
    fromId: 'user-2',
    title: 'Request to Purchase Polish Supplies',
    message: 'We are running low on polish compound and microfibre cloths. Requesting approval to purchase from AutoCare supplier.',
    requestCategory: 'purchase',
    amount: 350,
    status: 'pending',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      users: seedUsers,
      cars: seedCars,
      repairs: seedRepairs,
      quotations: seedQuotations,
      instructions: seedInstructions,
      customers: seedCustomers,
      testDrives: seedTestDrives,
      personalReminders: seedPersonalReminders,
      viewPreference: {},

      login: (username, password) => {
        const user = get().users.find(
          (u) => u.username === username && u.password === password
        );
        if (user) {
          set({ currentUser: user });
          return true;
        }
        return false;
      },

      logout: () => set({ currentUser: null }),

      addCar: (car) => set((s) => ({ cars: [...s.cars, car] })),
      updateCar: (id, car) =>
        set((s) => ({
          cars: s.cars.map((c) => (c.id === id ? { ...c, ...car } : c)),
        })),
      deleteCar: (id) =>
        set((s) => ({ cars: s.cars.filter((c) => c.id !== id) })),

      addRepair: (repair) => set((s) => {
        const updatedCars = repair.location && repair.status !== 'queued'
          ? s.cars.map((c) =>
              c.id === repair.carId
                ? { ...c, currentLocation: repair.location, status: 'in_workshop' as Car['status'] }
                : c
            )
          : s.cars;
        return { repairs: [...s.repairs, repair], cars: updatedCars };
      }),
      updateRepair: (id, repair) => set((s) => {
        const existing = s.repairs.find((r) => r.id === id);
        const updatedRepairs = s.repairs.map((r) => (r.id === id ? { ...r, ...repair } : r));
        let updatedCars = s.cars;
        if (existing) {
          if (repair.status === 'done') {
            updatedCars = s.cars.map((c) =>
              c.id === existing.carId ? { ...c, currentLocation: 'Showroom' } : c
            );
          } else if (repair.status === 'pending' && existing.status === 'queued') {
            // Queued → Sent Out: update car location to this repair's location
            const location = repair.location ?? existing.location;
            if (location) {
              updatedCars = s.cars.map((c) =>
                c.id === existing.carId ? { ...c, currentLocation: location, status: 'in_workshop' as Car['status'] } : c
              );
            }
          } else if (repair.location) {
            updatedCars = s.cars.map((c) =>
              c.id === existing.carId ? { ...c, currentLocation: repair.location } : c
            );
          }
        }
        return { repairs: updatedRepairs, cars: updatedCars };
      }),
      deleteRepair: (id) =>
        set((s) => ({ repairs: s.repairs.filter((r) => r.id !== id) })),

      addQuotation: (quotation) =>
        set((s) => ({ quotations: [...s.quotations, quotation] })),
      updateQuotation: (id, quotation) =>
        set((s) => ({
          quotations: s.quotations.map((q) =>
            q.id === id ? { ...q, ...quotation } : q
          ),
        })),
      deleteQuotation: (id) =>
        set((s) => ({ quotations: s.quotations.filter((q) => q.id !== id) })),

      addInstruction: (instruction) =>
        set((s) => ({ instructions: [...s.instructions, instruction] })),
      updateInstruction: (id, instruction) =>
        set((s) => ({
          instructions: s.instructions.map((i) =>
            i.id === id ? { ...i, ...instruction } : i
          ),
        })),
      deleteInstruction: (id) =>
        set((s) => ({ instructions: s.instructions.filter((i) => i.id !== id) })),

      addUser: (user) => set((s) => ({ users: [...s.users, user] })),
      updateUser: (id, user) =>
        set((s) => ({
          users: s.users.map((u) => (u.id === id ? { ...u, ...user } : u)),
          currentUser:
            s.currentUser?.id === id
              ? { ...s.currentUser, ...user }
              : s.currentUser,
        })),
      deleteUser: (id) =>
        set((s) => ({ users: s.users.filter((u) => u.id !== id) })),

      addCustomer: (customer) => set((s) => ({ customers: [...s.customers, customer] })),
      updateCustomer: (id, customer) =>
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...customer } : c)) })),
      deleteCustomer: (id) =>
        set((s) => ({ customers: s.customers.filter((c) => c.id !== id) })),

      addTestDrive: (testDrive) => set((s) => ({ testDrives: [...s.testDrives, testDrive] })),
      updateTestDrive: (id, testDrive) =>
        set((s) => ({ testDrives: s.testDrives.map((t) => (t.id === id ? { ...t, ...testDrive } : t)) })),
      deleteTestDrive: (id) =>
        set((s) => ({ testDrives: s.testDrives.filter((t) => t.id !== id) })),

      addPersonalReminder: (reminder) => set((s) => ({ personalReminders: [...s.personalReminders, reminder] })),
      updatePersonalReminder: (id, reminder) =>
        set((s) => ({ personalReminders: s.personalReminders.map((r) => (r.id === id ? { ...r, ...reminder } : r)) })),
      deletePersonalReminder: (id) =>
        set((s) => ({ personalReminders: s.personalReminders.filter((r) => r.id !== id) })),

      setViewPreference: (userId, page, view) =>
        set((s) => ({
          viewPreference: {
            ...s.viewPreference,
            [`${userId}-${page}`]: view,
          },
        })),
    }),
    {
      name: 'autodream-storage',
    }
  )
);
