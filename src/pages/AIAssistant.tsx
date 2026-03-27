import React, { useState, useRef, useEffect } from 'react';
import {
  Bot, Send, User, Sparkles, Building2, DollarSign, Wrench,
  Settings, X, Eye, EyeOff, AlertCircle,
} from 'lucide-react';
import Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../store';
import { formatRM, formatMileage } from '../utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'dealership' | 'finance' | 'mechanic';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Mode config ──────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<Mode, {
  label: string;
  icon: React.ElementType;
  accent: string;
  border: string;
  badge: string;
  description: string;
  placeholder: string;
  greeting: (name: string) => string;
  suggestions: string[];
}> = {
  dealership: {
    label: 'Dealership',
    icon: Building2,
    accent: 'text-cyan-400',
    border: 'border-cyan-500',
    badge: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
    description: 'Inventory & workshop queries',
    placeholder: 'Ask about inventory, cars, workshop...',
    greeting: (name) => `Hi ${name}! I can help you query inventory, check car statuses, and workshop information. What would you like to know?`,
    suggestions: ['How many cars available?', 'Show Toyota cars', 'Workshop summary', "What's the cheapest car?", 'List reserved cars'],
  },
  finance: {
    label: 'Finance Advisor',
    icon: DollarSign,
    accent: 'text-emerald-400',
    border: 'border-emerald-500',
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    description: 'Malaysian car loan expert',
    placeholder: 'Ask about DSR, CTOS, AKPK, loan eligibility...',
    greeting: (name) => `Hi ${name}! I'm your Malaysian automotive finance consultant. Ask me anything about car loans — DSR calculations, CTOS/CCRIS checks, AKPK, blacklisting, minimum income requirements, and more. How can I help?`,
    suggestions: ['How to calculate DSR?', 'What is AKPK?', 'CTOS blacklist how to clear?', 'Minimum income for RM80k loan?', 'Customer in AKPK can apply?'],
  },
  mechanic: {
    label: 'Mechanic Expert',
    icon: Wrench,
    accent: 'text-orange-400',
    border: 'border-orange-500',
    badge: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    description: 'Car diagnosis & repair advice',
    placeholder: 'Describe the car problem — make, model, symptoms...',
    greeting: (name) => `Hi ${name}! I'm your mechanic expert. Describe the car problem — include the make, model, year, mileage, and symptoms. I'll help diagnose the most likely cause and tell you how serious it is.`,
    suggestions: ['Engine vibrating at idle', 'AC not cold', 'Brake squeaking', 'Check engine light on', 'Car hard to start in morning'],
  },
};

// ─── System prompts ───────────────────────────────────────────────────────────

const FINANCE_SYSTEM = `You are an expert Malaysian automotive finance consultant and credit analyst with extensive knowledge of the Malaysian car loan industry. You provide practical, accurate advice to car salespeople.

Your deep expertise covers:

**Credit Bureaus & Scoring:**
- CCRIS (Central Credit Reference Information System) — BNM's official credit database, shows 12-month repayment history
- CTOS Data Systems — private credit bureau; CTOS Score ranges (300–850), what affects it, how to interpret reports
- How to read CCRIS and CTOS reports for loan pre-screening
- Difference between CCRIS and CTOS

**DSR (Debt Service Ratio):**
- Formula: (Total Monthly Commitments / Gross Monthly Income) × 100%
- Malaysian bank thresholds: typically max 60–70% (varies by bank and income tier)
- What counts as commitment: car loan, housing loan, personal loan, credit card minimum payment, PTPTN, etc.
- How to calculate for salaried vs. self-employed
- Strategies when DSR is too high (joint applicant, longer tenure, larger down payment)

**NDI (Net Disposable Income):**
- Formula: Net Income − All Monthly Commitments
- Minimum NDI requirements (typically RM800–RM1,500 depending on bank)
- How banks use NDI alongside DSR

**AKPK (Agensi Kaunseling dan Pengurusan Kredit):**
- Government debt counseling agency under BNM
- DMP (Debt Management Programme) — while enrolled, cannot get new loans
- How long AKPK stays on record after completion (typically 1–2 years grace period varies by bank)
- Exit process and what to expect post-AKPK
- URUS programme (special COVID restructuring)

**Blacklisting & Legal Issues:**
- Bank blacklisting — what triggers it (default, fraud, etc.)
- CTOS legal section: summons, judgments, bankruptcy notices
- PTPTN default: impact on loan approval, how to clear via settlement
- Undischarged bankruptcy — cannot obtain credit facilities
- How to check and clear legal records

**Margin of Financing (MOF) & Tenure:**
- Used cars: typically 85–90% MOF, max 9-year tenure (BNM guideline)
- New cars: up to 90% MOF
- Down payment requirements
- How vehicle age affects MOF

**Malaysian Banks:**
- Maybank / Maybank Islamic — largest bank, flexible, Islamic & conventional
- CIMB / CIMB Islamic — aggressive rates, various packages
- RHB — hire purchase specialists
- Public Bank — known for stricter credit assessment
- Hong Leong Bank — competitive hire purchase rates
- Affin Bank / Affin Islamic
- BSN (Bank Simpanan Nasional) — government bank, more accessible for lower income
- Bank Islam / Bank Muamalat / Bank Rakyat — Islamic financing specialists
- AmBank — strong auto financing arm
- MBSB Bank — Islamic

**Loan Types:**
- Conventional Hire Purchase (Hire Purchase Act 1967) — fixed interest, flat rate
- Islamic: Al-Bai Bithaman Ajil (BBA), Murabahah, Ijarah Thumma Al-Bai (AITAB)
- How to compare flat rate vs. effective rate

**Document Requirements:**
- Salaried: IC, 3 months payslip, 3 months bank statement, EPF statement (optional)
- Self-employed: IC, 6 months bank statement, Business registration, EPF/income tax
- Commission earner: 6 months bank statement showing consistent income

**Practical Sales Tips:**
- How to pre-screen a customer in 5 minutes
- Red flags to watch for
- Which banks to try for borderline cases
- How guarantors/joint applicants help
- OPR (Overnight Policy Rate) and its effect on loan rates

When calculating DSR or eligibility, always show your working step by step. Be honest and direct — if a customer is unlikely to qualify, say so and explain why. Suggest workarounds when possible.

Respond in the same language as the user (English or Bahasa Malaysia). Be concise, practical, and professional.`;

const MECHANIC_SYSTEM = `You are a highly experienced automotive mechanic and diagnostic specialist with 20+ years of hands-on experience. You specialize in vehicles common in Malaysia: Perodua (Myvi, Axia, Bezza, Alza, Aruz, Ativa), Proton (Saga, Persona, Iriz, X50, X70, S70), Toyota (Vios, Yaris, Rush, Hilux, Camry), Honda (City, Jazz, Civic, CR-V, HR-V), Nissan, Mazda, Mitsubishi, and others.

Your expertise includes:
- Engine diagnostics: timing, fuel system, ignition, cooling, oil system
- Automatic & CVT transmission problems (very common in Malaysia)
- Manual gearbox issues
- Electrical systems, ECU faults, OBD2 codes
- Suspension & steering: worn bushings, struts, alignment
- Brake systems: disc, drum, ABS, EBD
- Air conditioning (critical in Malaysia's climate — 90% humidity, 30–35°C year-round)
- Common Malaysian road effects: potholes, flooding, heat-related failures
- Proton and Perodua specific known issues
- Hybrid system basics (Toyota hybrids)
- Preventive maintenance schedules

**Response structure when diagnosing:**
1. **Most Likely Cause(s)** — ranked 1st, 2nd, 3rd most probable
2. **Severity Rating:**
   - 🟢 Minor — cosmetic or non-urgent
   - 🟡 Moderate — fix within 1–2 weeks
   - 🔴 Serious — fix ASAP, monitor closely
   - ⛔ Critical — do NOT drive
3. **Safe to drive?** — yes / with caution / no
4. **Recommended action** — DIY / general workshop / specialist
5. **Estimated repair scope** — simple / moderate / major

Ask clarifying questions when needed: make, model, year, mileage, when symptoms started, under what conditions (cold start, highway, turning, etc.), any recent repairs.

Be like a trusted mechanic friend — honest, no-nonsense, practical. Don't overcharge on words.

Respond in the same language as the user (English or Bahasa Malaysia).`;

// ─── Rule-based fallback for dealership mode ──────────────────────────────────

function ruleBasedResponse(
  query: string,
  cars: ReturnType<typeof useStore.getState>['cars'],
  repairs: ReturnType<typeof useStore.getState>['repairs'],
  isDirector: boolean,
): string {
  const q = query.toLowerCase().trim();

  if (q.includes('how many car') || q.includes('total car') || q.includes('cars do we have')) {
    const avail = cars.filter((c) => c.status === 'available').length;
    const reserved = cars.filter((c) => c.status === 'reserved').length;
    const sold = cars.filter((c) => c.status === 'sold').length;
    return `We currently have **${cars.length} cars** in total:\n• ${avail} available\n• ${reserved} reserved\n• ${sold} sold`;
  }
  if (q.includes('available car')) {
    const avail = cars.filter((c) => c.status === 'available');
    if (avail.length === 0) return 'No available cars at the moment.';
    return `**${avail.length} available cars**:\n${avail.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)} (${c.colour}, ${formatMileage(c.mileage)})`).join('\n')}`;
  }
  if (q.includes('reserved car') || q.includes('car reserved')) {
    const reserved = cars.filter((c) => c.status === 'reserved');
    if (reserved.length === 0) return 'No cars currently reserved.';
    return `**${reserved.length} reserved cars**:\n${reserved.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n')}`;
  }
  if (q.includes('sold car') || q.includes('cars sold')) {
    const sold = cars.filter((c) => c.status === 'sold');
    if (sold.length === 0) return 'No cars sold yet.';
    return `**${sold.length} cars sold**:\n${sold.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n')}`;
  }
  const brands = ['perodua', 'proton', 'honda', 'toyota', 'nissan', 'mercedes', 'bmw', 'mazda', 'mitsubishi'];
  for (const brand of brands) {
    if (q.includes(brand)) {
      const brandCars = cars.filter((c) => c.make.toLowerCase() === brand);
      if (brandCars.length === 0) return `No ${brand.charAt(0).toUpperCase() + brand.slice(1)} cars in inventory.`;
      return `**${brandCars.length} ${brand.charAt(0).toUpperCase() + brand.slice(1)} car${brandCars.length !== 1 ? 's' : ''}**:\n${brandCars.map((c) => `• ${c.year} ${c.model} — ${formatRM(c.sellingPrice)} (${c.status})`).join('\n')}`;
    }
  }
  if (q.includes('cheapest') || q.includes('lowest price') || q.includes('most affordable')) {
    const avail = cars.filter((c) => c.status === 'available').sort((a, b) => a.sellingPrice - b.sellingPrice);
    if (avail.length === 0) return 'No available cars.';
    const c = avail[0];
    return `Cheapest available: **${c.year} ${c.make} ${c.model}** at **${formatRM(c.sellingPrice)}** (${c.colour}, ${formatMileage(c.mileage)}, ${c.condition} condition)`;
  }
  if (q.includes('most expensive') || q.includes('highest price')) {
    const avail = cars.filter((c) => c.status === 'available').sort((a, b) => b.sellingPrice - a.sellingPrice);
    if (avail.length === 0) return 'No available cars.';
    const c = avail[0];
    return `Most expensive available: **${c.year} ${c.make} ${c.model}** at **${formatRM(c.sellingPrice)}** (${c.colour}, ${formatMileage(c.mileage)})`;
  }
  if (q.includes('automatic') || q.includes('auto car')) {
    const autos = cars.filter((c) => c.transmission === 'auto' && c.status === 'available');
    if (autos.length === 0) return 'No automatic cars available.';
    return `**${autos.length} automatic cars available**:\n${autos.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n')}`;
  }
  if (q.includes('manual')) {
    const manuals = cars.filter((c) => c.transmission === 'manual' && c.status === 'available');
    if (manuals.length === 0) return 'No manual cars available.';
    return `**${manuals.length} manual cars available**:\n${manuals.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n')}`;
  }
  if (q.includes('low mileage') || q.includes('low km')) {
    const lowKm = cars.filter((c) => c.mileage < 50000 && c.status === 'available');
    if (lowKm.length === 0) return 'No low-mileage cars (under 50,000 km) available.';
    return `**${lowKm.length} low-mileage cars**:\n${lowKm.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatMileage(c.mileage)}, ${formatRM(c.sellingPrice)}`).join('\n')}`;
  }
  if (q.includes('recently added') || q.includes('latest car') || q.includes('newest')) {
    const sorted = [...cars].sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()).slice(0, 3);
    if (sorted.length === 0) return 'No cars in inventory.';
    return `**3 Most Recently Added**:\n${sorted.map((c) => `• ${c.year} ${c.make} ${c.model} — Added: ${c.dateAdded}`).join('\n')}`;
  }
  if (q.includes('repair') || q.includes('workshop') || q.includes('maintenance')) {
    const active = repairs.filter((r) => r.status !== 'done').length;
    const done = repairs.filter((r) => r.status === 'done').length;
    if (isDirector) {
      const total = repairs.reduce((s, r) => s + r.totalCost, 0);
      return `**Workshop Summary**:\n• Total jobs: ${repairs.length}\n• Active: ${active}\n• Completed: ${done}\n• Total spend: ${formatRM(total)}`;
    }
    return `**Workshop Summary**:\n• Total jobs: ${repairs.length}\n• Active: ${active}\n• Completed: ${done}`;
  }
  if (isDirector && (q.includes('revenue') || q.includes('profit') || q.includes('earn'))) {
    const soldCars = cars.filter((c) => c.status === 'sold');
    const revenue = soldCars.reduce((s, c) => s + c.sellingPrice, 0);
    const costs = soldCars.reduce((s, c) => s + c.purchasePrice, 0);
    const repairCosts = repairs.reduce((s, r) => s + r.totalCost, 0);
    const profit = revenue - costs - repairCosts;
    return `**Financial Summary** (${soldCars.length} cars sold):\n• Revenue: ${formatRM(revenue)}\n• Purchase Costs: ${formatRM(costs)}\n• Repair Costs: ${formatRM(repairCosts)}\n• **Net Profit: ${formatRM(profit)}**`;
  }
  if (q.includes('help') || q === 'hi' || q === 'hello') {
    return `Hi! Here's what I can help with:\n\n**Inventory:**\n• "How many cars available?"\n• "Show Toyota cars"\n• "Cheapest car?"\n• "Automatic cars"\n\n**Workshop:**\n• "Workshop summary"\n\n**Tip:** Switch to **Finance Advisor** for loan questions or **Mechanic Expert** for car problems!`;
  }
  return `I'm not sure about that. Try asking about inventory or workshop status, or switch to Finance Advisor / Mechanic Expert mode for specialized help.`;
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  history: ApiMessage[],
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages: history,
  });
  const block = response.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '(No response)';
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, accent }: { msg: Message; accent: string }) {
  const isUser = msg.role === 'user';
  const lines = msg.text.split('\n');

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        isUser ? 'bg-slate-600' : 'bg-[#1a2a4a] border border-[#1a2a4a]'
      }`}>
        {isUser
          ? <User size={15} className="text-white" />
          : <Bot size={15} className={accent} />}
      </div>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-slate-700 text-white rounded-tr-sm'
          : 'bg-[#111d35] border border-[#1a2a4a] text-gray-200 rounded-tl-sm'
      }`}>
        {lines.map((line, i) => {
          if (!line) return <div key={i} className="h-1" />;
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={i > 0 ? 'mt-0.5' : ''}>
              {parts.map((part, j) =>
                part.startsWith('**') && part.endsWith('**')
                  ? <strong key={j} className="text-white font-semibold">{part.slice(2, -2)}</strong>
                  : <span key={j}>{part}</span>
              )}
            </p>
          );
        })}
        <p className={`text-[10px] mt-2 text-right ${isUser ? 'text-slate-400' : 'text-gray-600'}`}>
          {msg.timestamp.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// ─── API Key Panel ────────────────────────────────────────────────────────────

function ApiKeyPanel({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(() => localStorage.getItem('autodream_api_key') ?? '');
  const [show, setShow] = useState(false);

  const save = () => {
    if (key.trim()) localStorage.setItem('autodream_api_key', key.trim());
    else localStorage.removeItem('autodream_api_key');
    onClose();
  };

  return (
    <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-gray-400" />
          <span className="text-white text-sm font-medium">Claude API Key</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={14} />
        </button>
      </div>
      <p className="text-gray-500 text-xs">Required for Finance Advisor &amp; Mechanic Expert modes. Your key is stored locally on this device only.</p>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full bg-[#111d35] border border-[#1a2a4a] text-white text-sm rounded-lg px-3 py-2.5 pr-10 focus:outline-none focus:border-cyan-500 transition-colors"
        />
        <button
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Save Key
        </button>
        {key && (
          <button
            onClick={() => { setKey(''); localStorage.removeItem('autodream_api_key'); }}
            className="px-3 text-red-400 hover:text-red-300 text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AIAssistant() {
  const cars = useStore((s) => s.cars);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);
  const isDirector = currentUser?.role === 'director';
  const firstName = currentUser?.name?.split(' ')[0] ?? 'there';

  const [mode, setMode] = useState<Mode>('dealership');
  const [showSettings, setShowSettings] = useState(false);
  const [apiError, setApiError] = useState('');

  // Separate conversation histories per mode
  const [histories, setHistories] = useState<Record<Mode, Message[]>>({
    dealership: [{
      id: '0', role: 'assistant',
      text: MODE_CONFIG.dealership.greeting(firstName),
      timestamp: new Date(),
    }],
    finance: [{
      id: '1', role: 'assistant',
      text: MODE_CONFIG.finance.greeting(firstName),
      timestamp: new Date(),
    }],
    mechanic: [{
      id: '2', role: 'assistant',
      text: MODE_CONFIG.mechanic.greeting(firstName),
      timestamp: new Date(),
    }],
  });

  // Per-mode API conversation history for context
  const [apiHistories, setApiHistories] = useState<Record<Mode, ApiMessage[]>>({
    dealership: [], finance: [], mechanic: [],
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const cfg = MODE_CONFIG[mode];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [histories, isTyping, mode]);

  const sendMessage = async (text?: string) => {
    const query = (text ?? input).trim();
    if (!query || isTyping) return;
    setInput('');
    setApiError('');

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: query,
      timestamp: new Date(),
    };

    setHistories((prev) => ({ ...prev, [mode]: [...prev[mode], userMsg] }));
    setIsTyping(true);

    try {
      let responseText: string;

      if (mode === 'dealership') {
        // Rule-based — no API needed
        await new Promise((r) => setTimeout(r, 350 + Math.random() * 250));
        responseText = ruleBasedResponse(query, cars, repairs, isDirector);
      } else {
        // Finance or Mechanic — Claude API
        const apiKey = localStorage.getItem('autodream_api_key') ?? '';
        if (!apiKey) {
          setIsTyping(false);
          setApiError('API key required for this mode. Click the settings icon to add your Claude API key.');
          setHistories((prev) => ({ ...prev, [mode]: prev[mode].slice(0, -0) }));
          // Remove user message if no API key
          setHistories((prev) => ({ ...prev, [mode]: prev[mode].filter((m) => m.id !== userMsg.id) }));
          return;
        }

        const systemPrompt = mode === 'finance' ? FINANCE_SYSTEM : MECHANIC_SYSTEM;
        const updatedApiHistory: ApiMessage[] = [
          ...apiHistories[mode],
          { role: 'user', content: query },
        ];

        responseText = await callClaude(apiKey, systemPrompt, updatedApiHistory);

        // Save updated API history with assistant response
        setApiHistories((prev) => ({
          ...prev,
          [mode]: [...updatedApiHistory, { role: 'assistant', content: responseText }],
        }));
      }

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: responseText,
        timestamp: new Date(),
      };
      setHistories((prev) => ({ ...prev, [mode]: [...prev[mode], aiMsg] }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      setApiError(errMsg);
      // Remove the user message on error
      setHistories((prev) => ({ ...prev, [mode]: prev[mode].filter((m) => m.id !== userMsg.id) }));
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setApiError('');
    setInput('');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-t-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
              mode === 'finance' ? 'bg-emerald-500/20 border-emerald-500/30'
              : mode === 'mechanic' ? 'bg-orange-500/20 border-orange-500/30'
              : 'bg-cyan-500/20 border-cyan-500/30'
            }`}>
              {React.createElement(cfg.icon, { size: 18, className: cfg.accent })}
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">AutoDream Assistant</h3>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                <span className="text-gray-500 text-xs">{cfg.description}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles size={14} className={cfg.accent} />
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'text-cyan-400 bg-cyan-500/10' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
            >
              <Settings size={15} />
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 bg-[#111d35] rounded-lg p-1">
          {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => {
            const mc = MODE_CONFIG[m];
            const Icon = mc.icon;
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? `${mc.badge} shadow-sm`
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon size={12} />
                <span className="hidden sm:inline">{mc.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="border-x border-[#1a2a4a] px-4 pt-3 bg-[#0a0f1e]">
          <ApiKeyPanel onClose={() => setShowSettings(false)} />
        </div>
      )}

      {/* API error banner */}
      {apiError && (
        <div className="border-x border-[#1a2a4a] px-4 pt-3 bg-[#0a0f1e]">
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-xs text-red-400">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{apiError}</span>
            <button onClick={() => setApiError('')} className="ml-auto shrink-0">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="flex-1 bg-[#0a0f1e] border-x border-[#1a2a4a] p-4 overflow-y-auto space-y-4">
        {histories[mode].map((msg) => (
          <MessageBubble key={msg.id} msg={msg} accent={cfg.accent} />
        ))}

        {isTyping && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1a2a4a] border border-[#1a2a4a] flex items-center justify-center shrink-0">
              {React.createElement(cfg.icon, { size: 15, className: cfg.accent })}
            </div>
            <div className="bg-[#111d35] border border-[#1a2a4a] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Suggestions ── */}
      <div className="bg-[#0d1526] border-x border-[#1a2a4a] px-4 py-2 flex gap-2 overflow-x-auto">
        {cfg.suggestions.map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            disabled={isTyping}
            className={`shrink-0 text-xs bg-[#111d35] border border-[#1a2a4a] px-3 py-1.5 rounded-full transition-colors whitespace-nowrap disabled:opacity-40 text-gray-400 hover:border-opacity-60 ${
              mode === 'finance' ? 'hover:text-emerald-400 hover:border-emerald-500/40'
              : mode === 'mechanic' ? 'hover:text-orange-400 hover:border-orange-500/40'
              : 'hover:text-cyan-400 hover:border-cyan-500/40'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── Input ── */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-b-xl p-4">
        {(mode === 'finance' || mode === 'mechanic') && !localStorage.getItem('autodream_api_key') && (
          <div className="flex items-center gap-2 mb-3 text-xs text-amber-400/80">
            <AlertCircle size={12} />
            <span>Add your Claude API key in settings to use this mode.</span>
            <button onClick={() => setShowSettings(true)} className="underline hover:text-amber-300">
              Open settings
            </button>
          </div>
        )}
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={cfg.placeholder}
            className={`flex-1 bg-[#111d35] border border-[#1a2a4a] text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors ${
              mode === 'finance' ? 'focus:border-emerald-500'
              : mode === 'mechanic' ? 'focus:border-orange-500'
              : 'focus:border-cyan-500'
            }`}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isTyping}
            className={`w-11 h-11 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors shadow-lg ${
              mode === 'finance'
                ? 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20'
                : mode === 'mechanic'
                ? 'bg-orange-500 hover:bg-orange-400 shadow-orange-500/20'
                : 'bg-cyan-500 hover:bg-cyan-400 shadow-cyan-500/20'
            }`}
          >
            <Send size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
