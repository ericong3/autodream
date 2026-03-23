import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, User, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { formatRM, formatMileage } from '../utils/format';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

function generateResponse(
  query: string,
  context: {
    cars: ReturnType<typeof useStore.getState>['cars'];
    users: ReturnType<typeof useStore.getState>['users'];
    repairs: ReturnType<typeof useStore.getState>['repairs'];
    isDirector: boolean;
  }
): string {
  const { cars, users, repairs, isDirector } = context;
  const q = query.toLowerCase().trim();

  // --- Inventory queries ---
  if (q.includes('how many car') || q.includes('total car') || q.includes('cars do we have')) {
    const avail = cars.filter((c) => c.status === 'available').length;
    const reserved = cars.filter((c) => c.status === 'reserved').length;
    const sold = cars.filter((c) => c.status === 'sold').length;
    return `We currently have **${cars.length} cars** in total:\n• ${avail} available\n• ${reserved} reserved\n• ${sold} sold`;
  }

  if (q.includes('available car')) {
    const avail = cars.filter((c) => c.status === 'available');
    if (avail.length === 0) return 'There are no available cars at the moment.';
    const list = avail.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)} (${c.colour}, ${formatMileage(c.mileage)})`).join('\n');
    return `There are **${avail.length} available cars**:\n${list}`;
  }

  if (q.includes('reserved car') || q.includes('car reserved')) {
    const reserved = cars.filter((c) => c.status === 'reserved');
    if (reserved.length === 0) return 'No cars are currently reserved.';
    const list = reserved.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n');
    return `There are **${reserved.length} reserved cars**:\n${list}`;
  }

  if (q.includes('sold car') || q.includes('cars sold')) {
    const sold = cars.filter((c) => c.status === 'sold');
    if (sold.length === 0) return 'No cars have been sold yet.';
    const list = sold.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n');
    return `**${sold.length} cars have been sold**:\n${list}`;
  }

  // Brand-specific queries
  const brands = ['perodua', 'proton', 'honda', 'toyota', 'nissan', 'mercedes', 'bmw', 'mazda', 'mitsubishi'];
  for (const brand of brands) {
    if (q.includes(brand)) {
      const brandCars = cars.filter((c) => c.make.toLowerCase() === brand);
      if (brandCars.length === 0) return `We don't have any ${brand.charAt(0).toUpperCase() + brand.slice(1)} cars in inventory.`;
      const list = brandCars.map((c) => `• ${c.year} ${c.model} — ${formatRM(c.sellingPrice)} (${c.status})`).join('\n');
      return `We have **${brandCars.length} ${brand.charAt(0).toUpperCase() + brand.slice(1)} car${brandCars.length !== 1 ? 's' : ''}**:\n${list}`;
    }
  }

  // Condition queries
  if (q.includes('excellent') || q.includes('good condition') || q.includes('fair') || q.includes('poor')) {
    let condition: string | null = null;
    if (q.includes('excellent')) condition = 'excellent';
    else if (q.includes('good condition') || q.includes('good car')) condition = 'good';
    else if (q.includes('fair')) condition = 'fair';
    else if (q.includes('poor')) condition = 'poor';
    if (condition) {
      const filtered = cars.filter((c) => c.condition === condition);
      if (filtered.length === 0) return `No cars in ${condition} condition.`;
      const list = filtered.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n');
      return `**${filtered.length} car${filtered.length !== 1 ? 's' : ''} in ${condition} condition**:\n${list}`;
    }
  }

  // Transmission
  if (q.includes('automatic') || q.includes('auto car')) {
    const autos = cars.filter((c) => c.transmission === 'auto' && c.status === 'available');
    if (autos.length === 0) return 'No automatic cars available.';
    const list = autos.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n');
    return `**${autos.length} automatic cars available**:\n${list}`;
  }

  if (q.includes('manual car') || q.includes('manual transmission')) {
    const manuals = cars.filter((c) => c.transmission === 'manual' && c.status === 'available');
    if (manuals.length === 0) return 'No manual cars available.';
    const list = manuals.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatRM(c.sellingPrice)}`).join('\n');
    return `**${manuals.length} manual cars available**:\n${list}`;
  }

  // Cheapest / most expensive
  if (q.includes('cheapest') || q.includes('lowest price') || q.includes('most affordable')) {
    const avail = cars.filter((c) => c.status === 'available').sort((a, b) => a.sellingPrice - b.sellingPrice);
    if (avail.length === 0) return 'No available cars found.';
    const c = avail[0];
    return `The cheapest available car is the **${c.year} ${c.make} ${c.model}** at **${formatRM(c.sellingPrice)}** (${c.colour}, ${formatMileage(c.mileage)}, ${c.condition} condition).`;
  }

  if (q.includes('most expensive') || q.includes('highest price')) {
    const avail = cars.filter((c) => c.status === 'available').sort((a, b) => b.sellingPrice - a.sellingPrice);
    if (avail.length === 0) return 'No available cars found.';
    const c = avail[0];
    return `The most expensive available car is the **${c.year} ${c.make} ${c.model}** at **${formatRM(c.sellingPrice)}** (${c.colour}, ${formatMileage(c.mileage)}).`;
  }

  // Low mileage
  if (q.includes('low mileage') || q.includes('low km') || q.includes('under 50000') || q.includes('under 50,000')) {
    const lowKm = cars.filter((c) => c.mileage < 50000 && c.status === 'available');
    if (lowKm.length === 0) return 'No low-mileage cars (under 50,000 km) available.';
    const list = lowKm.map((c) => `• ${c.year} ${c.make} ${c.model} — ${formatMileage(c.mileage)}, ${formatRM(c.sellingPrice)}`).join('\n');
    return `**${lowKm.length} low-mileage cars** (under 50,000 km):\n${list}`;
  }

  // Revenue / profit (director only)
  if (isDirector && (q.includes('revenue') || q.includes('profit') || q.includes('earn') || q.includes('money'))) {
    const soldCars = cars.filter((c) => c.status === 'sold');
    const revenue = soldCars.reduce((s, c) => s + c.sellingPrice, 0);
    const costs = soldCars.reduce((s, c) => s + c.purchasePrice, 0);
    const repairCosts = repairs.reduce((s, r) => s + r.totalCost, 0);
    const commission = soldCars.length * 500;
    const profit = revenue - costs - repairCosts - commission;
    return `**Financial Summary** (${soldCars.length} cars sold):\n• Total Revenue: ${formatRM(revenue)}\n• Purchase Costs: ${formatRM(costs)}\n• Repair Costs: ${formatRM(repairCosts)}\n• Commission: ${formatRM(commission)}\n• **Net Profit: ${formatRM(profit)}**`;
  }

  // Repairs
  if (q.includes('repair') || q.includes('workshop') || q.includes('maintenance')) {
    const active = repairs.filter((r) => r.status !== 'done').length;
    const done = repairs.filter((r) => r.status === 'done').length;
    if (isDirector) {
      const total = repairs.reduce((s, r) => s + r.totalCost, 0);
      return `**Workshop Summary**:\n• Total repair jobs: ${repairs.length}\n• Active jobs: ${active}\n• Completed: ${done}\n• Total spend: ${formatRM(total)}`;
    }
    return `**Workshop Summary**:\n• Total repair jobs: ${repairs.length}\n• Active jobs: ${active}\n• Completed: ${done}`;
  }

  // Help
  if (q.includes('help') || q.includes('what can you') || q.includes('what do you') || q === 'hi' || q === 'hello') {
    return `Hi! I'm your AutoDream AI assistant. Here are some things you can ask me:\n\n**Inventory:**\n• "How many cars are available?"\n• "Show me all Toyota cars"\n• "List reserved cars"\n• "What's the cheapest car?"\n• "Show automatic cars"\n${isDirector ? '\n**Finance:**\n• "What is our total revenue?"\n\n**Workshop:**\n• "Show workshop summary"' : ''}`;
  }

  // Recent additions
  if (q.includes('recently added') || q.includes('latest car') || q.includes('newest car')) {
    const sorted = [...cars].sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()).slice(0, 3);
    if (sorted.length === 0) return 'No cars in inventory.';
    const list = sorted.map((c) => `• ${c.year} ${c.make} ${c.model} — Added: ${c.dateAdded}`).join('\n');
    return `**3 Most Recently Added Cars**:\n${list}`;
  }

  return `I'm not sure about that. Try asking me about inventory or workshop status. Type "help" for a list of things I can answer.`;
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const lines = msg.text.split('\n');

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-cyan-500' : 'bg-[#1a2a4a] border border-[#1a2a4a]'}`}>
        {isUser ? <User size={16} className="text-white" /> : <Bot size={16} className="text-cyan-400" />}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${isUser ? 'bg-cyan-500 text-white rounded-tr-sm' : 'bg-[#111d35] border border-[#1a2a4a] text-gray-200 rounded-tl-sm'}`}>
        {lines.map((line, i) => {
          if (!line) return <br key={i} />;
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={i > 0 ? 'mt-0.5' : ''}>
              {parts.map((part, j) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={j} className={isUser ? 'text-white' : 'text-white'}>{part.slice(2, -2)}</strong>;
                }
                return <span key={j}>{part}</span>;
              })}
            </p>
          );
        })}
        <p className={`text-[10px] mt-1.5 ${isUser ? 'text-cyan-200/70' : 'text-gray-600'} text-right`}>
          {msg.timestamp.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'How many cars are available?',
  'Show me all Toyota cars',
  'List reserved cars',
  "What's the cheapest car?",
  'Show workshop summary',
];

export default function AIAssistant() {
  const cars = useStore((s) => s.cars);
  const users = useStore((s) => s.users);
  const repairs = useStore((s) => s.repairs);
  const currentUser = useStore((s) => s.currentUser);

  const isDirector = currentUser?.role === 'director';

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      text: `Hello, ${currentUser?.name?.split(' ')[0] ?? 'there'}! I'm your AutoDream AI assistant. I can help you query inventory and workshop information. Type "help" to see what I can do!`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const sendMessage = async (text?: string) => {
    const query = text ?? input.trim();
    if (!query) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: query,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));

    const response = generateResponse(query, { cars, users, repairs, isDirector });

    const aiMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      text: response,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, aiMsg]);
    setIsTyping(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-t-xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-500/30 rounded-full flex items-center justify-center">
          <Bot size={20} className="text-cyan-400" />
        </div>
        <div>
          <h3 className="text-white font-semibold">AutoDream Assistant</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-gray-400 text-xs">Online · Powered by your dealership data</span>
          </div>
        </div>
        <Sparkles size={16} className="text-cyan-400 ml-auto" />
      </div>

      {/* Messages */}
      <div className="flex-1 bg-[#0a0f1e] border-x border-[#1a2a4a] p-4 overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isTyping && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1a2a4a] border border-[#1a2a4a] flex items-center justify-center shrink-0">
              <Bot size={16} className="text-cyan-400" />
            </div>
            <div className="bg-[#111d35] border border-[#1a2a4a] rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="bg-[#0d1526] border-x border-[#1a2a4a] px-4 py-2 flex gap-2 overflow-x-auto">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => sendMessage(s)}
            className="shrink-0 text-xs bg-[#111d35] border border-[#1a2a4a] text-gray-400 hover:text-cyan-400 hover:border-cyan-500/40 px-3 py-1.5 rounded-full transition-colors whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="bg-[#0d1526] border border-[#1a2a4a] rounded-b-xl p-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about inventory or workshop..."
            className="flex-1 bg-[#111d35] border border-[#1a2a4a] text-white placeholder-gray-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isTyping}
            className="w-11 h-11 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center transition-colors shadow-lg shadow-cyan-500/20"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
