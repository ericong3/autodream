import React, { useState } from 'react';
import {
  Plus,
  ClipboardList,
  CheckCircle,
  XCircle,
  Send,
  Inbox,
  AlertCircle,
  User,
  Users,
} from 'lucide-react';
import { useStore } from '../store';
import { Instruction } from '../types';
import Modal from '../components/Modal';
import { generateId } from '../utils/format';

function inputCls(error?: string) {
  return `w-full bg-obsidian-700/60 border ${error ? 'border-red-500/50' : 'border-obsidian-400/60'} text-white placeholder-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 transition-colors`;
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

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  acknowledged: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
};

const CATEGORY_LABEL: Record<string, string> = {
  purchase: 'Purchase Request',
  payment: 'Payment to Merchant',
  other: 'Other',
};

const TARGET_BADGE: Record<string, string> = {
  company: 'bg-gold-500/20 text-gold-400',
  salesman: 'bg-blue-500/20 text-blue-400',
  mechanic: 'bg-orange-500/20 text-orange-400',
  admin: 'bg-purple-500/20 text-purple-400',
};

const TARGET_LABEL: Record<string, string> = {
  company: 'Company',
  salesman: 'Salesman',
  mechanic: 'Mechanic',
  admin: 'Admin',
};

export default function Instructions() {
  const instructions = useStore((s) => s.instructions);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const addInstruction = useStore((s) => s.addInstruction);
  const updateInstruction = useStore((s) => s.updateInstruction);
  const deleteInstruction = useStore((s) => s.deleteInstruction);

  const isDirector = currentUser?.role === 'director';
  const [tab, setTab] = useState<'main' | 'secondary'>('main');
  const [showModal, setShowModal] = useState(false);

  const [instrForm, setInstrForm] = useState({
    toType: 'all' as 'all' | 'department' | 'individual',
    toDepartment: 'salesman' as 'salesman' | 'mechanic',
    toIds: [] as string[],
    title: '',
    message: '',
  });
  const [instrErrors, setInstrErrors] = useState<Record<string, string>>({});

  const [reqForm, setReqForm] = useState({
    title: '',
    message: '',
    requestCategory: 'purchase' as 'purchase' | 'payment' | 'other',
    requestTarget: 'company' as 'company' | 'salesman' | 'mechanic' | 'admin',
    amount: '',
  });
  const [reqErrors, setReqErrors] = useState<Record<string, string>>({});

  const getUserName = (id: string) => users.find((u) => u.id === id)?.name ?? 'Unknown';

  const isAddressedToMe = (i: Instruction) => {
    if (i.toType === 'all') return true;
    if (i.toType === 'department') {
      if (i.toDepartment === 'salesman') return currentUser?.role === 'salesperson';
      if (i.toDepartment === 'mechanic') return currentUser?.role === 'mechanic';
    }
    if (i.toType === 'individual') return i.toIds?.includes(currentUser?.id ?? '');
    return false;
  };

  const myInstructions = instructions.filter(
    (i) => i.type === 'instruction' && isAddressedToMe(i)
  );
  const myRequests = instructions.filter(
    (i) => i.type === 'request' && i.fromId === currentUser?.id
  );
  const allInstructions = instructions.filter((i) => i.type === 'instruction');
  const allRequests = instructions.filter((i) => i.type === 'request');

  const getTargetLabel = (instr: Instruction) => {
    if (instr.toType === 'all') return 'All Staff';
    if (instr.toType === 'department')
      return `${instr.toDepartment === 'salesman' ? 'Salesman' : 'Mechanic'} Dept.`;
    if (instr.toType === 'individual' && instr.toIds)
      return instr.toIds.map(getUserName).join(', ');
    return '—';
  };

  const validateInstruction = () => {
    const e: Record<string, string> = {};
    if (!instrForm.title.trim()) e.title = 'Title is required';
    if (!instrForm.message.trim()) e.message = 'Message is required';
    if (instrForm.toType === 'individual' && instrForm.toIds.length === 0)
      e.toIds = 'Select at least one person';
    setInstrErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateRequest = () => {
    const e: Record<string, string> = {};
    if (!reqForm.title.trim()) e.title = 'Title is required';
    if (!reqForm.message.trim()) e.message = 'Details are required';
    setReqErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitInstruction = () => {
    if (!validateInstruction()) return;
    addInstruction({
      id: generateId(),
      type: 'instruction',
      fromId: currentUser!.id,
      toType: instrForm.toType,
      toDepartment: instrForm.toType === 'department' ? instrForm.toDepartment : undefined,
      toIds: instrForm.toType === 'individual' ? instrForm.toIds : undefined,
      title: instrForm.title,
      message: instrForm.message,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setInstrForm({ toType: 'all', toDepartment: 'salesman', toIds: [], title: '', message: '' });
    setInstrErrors({});
    setShowModal(false);
  };

  const submitRequest = () => {
    if (!validateRequest()) return;
    addInstruction({
      id: generateId(),
      type: 'request',
      fromId: currentUser!.id,
      title: reqForm.title,
      message: reqForm.message,
      requestCategory: reqForm.requestCategory,
      requestTarget: reqForm.requestTarget,
      amount: reqForm.amount ? Number(reqForm.amount) : undefined,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    setReqForm({ title: '', message: '', requestCategory: 'purchase', requestTarget: 'company', amount: '' });
    setReqErrors({});
    setShowModal(false);
  };

  const staffForSelect = users.filter((u) => u.role !== 'director');

  const pendingRequests = allRequests.filter((r) => r.status === 'pending').length;
  const pendingInstructions = myInstructions.filter((i) => i.status === 'pending').length;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

  // ── Director UI ──────────────────────────────────────────────────────────
  if (isDirector) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex bg-[#0F0E0C] border border-obsidian-400/60 rounded-lg p-1 gap-1">
            <button
              onClick={() => setTab('main')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'main' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Instructions Sent
            </button>
            <button
              onClick={() => setTab('secondary')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${tab === 'secondary' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Staff Requests
              {pendingRequests > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {pendingRequests}
                </span>
              )}
            </button>
          </div>
          {tab === 'main' && (
            <button
              onClick={() => {
                setInstrForm({ toType: 'all', toDepartment: 'salesman', toIds: [], title: '', message: '' });
                setInstrErrors({});
                setShowModal(true);
              }}
              className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
            >
              <Plus size={16} />
              New Instruction
            </button>
          )}
        </div>

        {/* Instructions Sent */}
        {tab === 'main' && (
          <div className="space-y-3">
            {allInstructions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ClipboardList size={40} className="text-gray-600 mb-3" />
                <p className="text-gray-400 font-medium">No instructions sent yet</p>
              </div>
            ) : (
              allInstructions.map((instr) => (
                <div
                  key={instr.id}
                  className="bg-[#0F0E0C] border border-obsidian-400/60 border-l-4 border-l-gold-500 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-white font-semibold">{instr.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[instr.status]}`}>
                          {instr.status}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm">{instr.message}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-gray-600 text-xs flex items-center gap-1">
                          <Users size={11} /> To: {getTargetLabel(instr)}
                        </span>
                        <span className="text-gray-600 text-xs">{formatDate(instr.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {instr.status !== 'completed' && (
                        <button
                          onClick={() => updateInstruction(instr.id, { status: 'completed' })}
                          className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                          title="Mark completed"
                        >
                          <CheckCircle size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteInstruction(instr.id)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Staff Requests */}
        {tab === 'secondary' && (
          <div className="space-y-3">
            {allRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Inbox size={40} className="text-gray-600 mb-3" />
                <p className="text-gray-400 font-medium">No requests from staff</p>
              </div>
            ) : (
              allRequests.map((req) => (
                <div
                  key={req.id}
                  className="bg-[#0F0E0C] border border-obsidian-400/60 border-l-4 border-l-purple-500 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-white font-semibold">{req.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[req.status]}`}>
                          {req.status}
                        </span>
                        {req.requestCategory && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-obsidian-700/60 text-gray-400">
                            {CATEGORY_LABEL[req.requestCategory]}
                          </span>
                        )}
                        {req.requestTarget && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TARGET_BADGE[req.requestTarget]}`}>
                            {TARGET_LABEL[req.requestTarget]}
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 text-sm">{req.message}</p>
                      {req.amount && (
                        <p className="text-gold-400 text-sm font-medium mt-1">
                          Amount: RM {req.amount.toLocaleString()}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2">
                        <span className="text-gray-600 text-xs flex items-center gap-1">
                          <User size={11} /> From: {getUserName(req.fromId)}
                        </span>
                        <span className="text-gray-600 text-xs">{formatDate(req.createdAt)}</span>
                      </div>
                    </div>
                    {req.status === 'pending' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => updateInstruction(req.id, { status: 'completed' })}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-xs font-medium transition-colors"
                        >
                          <CheckCircle size={13} /> Approve
                        </button>
                        <button
                          onClick={() => updateInstruction(req.id, { status: 'rejected' })}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-medium transition-colors"
                        >
                          <XCircle size={13} /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Send Instruction Modal */}
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Send Instruction">
          <div className="space-y-4">
            <FormField label="Send To">
              <select
                className={inputCls()}
                value={instrForm.toType}
                onChange={(e) => setInstrForm({ ...instrForm, toType: e.target.value as 'all' | 'department' | 'individual' })}
              >
                <option value="all">All Staff</option>
                <option value="department">Department</option>
                <option value="individual">Individual</option>
              </select>
            </FormField>
            {instrForm.toType === 'department' && (
              <FormField label="Department">
                <select
                  className={inputCls()}
                  value={instrForm.toDepartment}
                  onChange={(e) => setInstrForm({ ...instrForm, toDepartment: e.target.value as 'salesman' | 'mechanic' })}
                >
                  <option value="salesman">Salesman</option>
                  <option value="mechanic">Mechanic</option>
                </select>
              </FormField>
            )}
            {instrForm.toType === 'individual' && (
              <FormField label="Select Staff" error={instrErrors.toIds}>
                <div className="space-y-2 bg-obsidian-700/60 border border-obsidian-400/60 rounded-lg p-3">
                  {staffForSelect.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={instrForm.toIds.includes(u.id)}
                        onChange={(e) => {
                          const ids = e.target.checked
                            ? [...instrForm.toIds, u.id]
                            : instrForm.toIds.filter((id) => id !== u.id);
                          setInstrForm({ ...instrForm, toIds: ids });
                        }}
                        className="accent-cyan-500"
                      />
                      <span className="text-gray-300 text-sm">{u.name}</span>
                      <span className="text-gray-600 text-xs capitalize">({u.role})</span>
                    </label>
                  ))}
                </div>
              </FormField>
            )}
            <FormField label="Title" error={instrErrors.title}>
              <input
                className={inputCls(instrErrors.title)}
                value={instrForm.title}
                onChange={(e) => setInstrForm({ ...instrForm, title: e.target.value })}
                placeholder="Instruction title..."
              />
            </FormField>
            <FormField label="Message" error={instrErrors.message}>
              <textarea
                className={`${inputCls(instrErrors.message)} h-24 resize-none`}
                value={instrForm.message}
                onChange={(e) => setInstrForm({ ...instrForm, message: e.target.value })}
                placeholder="Describe the instruction..."
              />
            </FormField>
          </div>
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={submitInstruction}
              className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
            >
              <Send size={14} /> Send
            </button>
          </div>
        </Modal>
      </div>
    );
  }

  // ── Staff UI ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex bg-[#0F0E0C] border border-obsidian-400/60 rounded-lg p-1 gap-1">
          <button
            onClick={() => setTab('main')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${tab === 'main' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            My Instructions
            {pendingInstructions > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {pendingInstructions}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('secondary')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'secondary' ? 'bg-gold-500 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            My Requests
          </button>
        </div>
        {tab === 'secondary' && (
          <button
            onClick={() => {
              setReqForm({ title: '', message: '', requestCategory: 'purchase', requestTarget: 'company', amount: '' });
              setReqErrors({});
              setShowModal(true);
            }}
            className="flex items-center gap-2 btn-gold px-4 py-2.5 rounded-lg text-sm"
          >
            <Plus size={16} />
            New Request
          </button>
        )}
      </div>

      {/* My Instructions */}
      {tab === 'main' && (
        <div className="space-y-3">
          {myInstructions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ClipboardList size={40} className="text-gray-600 mb-3" />
              <p className="text-gray-400 font-medium">No instructions yet</p>
            </div>
          ) : (
            myInstructions.map((instr) => (
              <div
                key={instr.id}
                className="bg-[#0F0E0C] border border-obsidian-400/60 border-l-4 border-l-gold-500 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-white font-semibold">{instr.title}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[instr.status]}`}>
                        {instr.status}
                      </span>
                    </div>
                    <p className="text-gray-400 text-sm">{instr.message}</p>
                    <p className="text-gray-600 text-xs mt-2">{formatDate(instr.createdAt)}</p>
                  </div>
                  {instr.status === 'pending' && (
                    <button
                      onClick={() => updateInstruction(instr.id, { status: 'acknowledged' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg text-xs font-medium transition-colors shrink-0"
                    >
                      <CheckCircle size={13} /> Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* My Requests */}
      {tab === 'secondary' && (
        <div className="space-y-3">
          {myRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Inbox size={40} className="text-gray-600 mb-3" />
              <p className="text-gray-400 font-medium">No requests submitted yet</p>
              <p className="text-gray-600 text-sm mt-1">Click "New Request" to submit one</p>
            </div>
          ) : (
            myRequests.map((req) => (
              <div
                key={req.id}
                className="bg-[#0F0E0C] border border-obsidian-400/60 border-l-4 border-l-purple-500 rounded-xl p-4"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-white font-semibold">{req.title}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[req.status]}`}>
                        {req.status}
                      </span>
                      {req.requestCategory && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-obsidian-700/60 text-gray-400">
                          {CATEGORY_LABEL[req.requestCategory]}
                        </span>
                      )}
                      {req.requestTarget && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TARGET_BADGE[req.requestTarget]}`}>
                          To: {TARGET_LABEL[req.requestTarget]}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm">{req.message}</p>
                    {req.amount && (
                      <p className="text-gold-400 text-sm font-medium mt-1">
                        Amount: RM {req.amount.toLocaleString()}
                      </p>
                    )}
                    <p className="text-gray-600 text-xs mt-2">{formatDate(req.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* New Request Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Submit Request">
        <div className="space-y-4">
          <FormField label="Send To">
            <select
              className={inputCls()}
              value={reqForm.requestTarget}
              onChange={(e) => setReqForm({ ...reqForm, requestTarget: e.target.value as 'company' | 'salesman' | 'mechanic' | 'admin' })}
            >
              <option value="company">Company</option>
              <option value="salesman">Salesman</option>
              <option value="mechanic">Mechanic</option>
              <option value="admin">Admin</option>
            </select>
          </FormField>
          <FormField label="Category">
            <select
              className={inputCls()}
              value={reqForm.requestCategory}
              onChange={(e) => setReqForm({ ...reqForm, requestCategory: e.target.value as 'purchase' | 'payment' | 'other' })}
            >
              <option value="purchase">Purchase Request</option>
              <option value="payment">Payment to Merchant</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Title" error={reqErrors.title}>
            <input
              className={inputCls(reqErrors.title)}
              value={reqForm.title}
              onChange={(e) => setReqForm({ ...reqForm, title: e.target.value })}
              placeholder="Brief title..."
            />
          </FormField>
          <FormField label="Details" error={reqErrors.message}>
            <textarea
              className={`${inputCls(reqErrors.message)} h-24 resize-none`}
              value={reqForm.message}
              onChange={(e) => setReqForm({ ...reqForm, message: e.target.value })}
              placeholder="Describe your request in detail..."
            />
          </FormField>
          <FormField label="Amount (RM) — optional">
            <input
              type="number"
              className={inputCls()}
              value={reqForm.amount}
              onChange={(e) => setReqForm({ ...reqForm, amount: e.target.value })}
              placeholder="0.00"
            />
          </FormField>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => setShowModal(false)}
            className="flex-1 px-4 py-2.5 btn-ghost rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submitRequest}
            className="flex-1 btn-gold px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
          >
            <Send size={14} /> Submit
          </button>
        </div>
      </Modal>
    </div>
  );
}
