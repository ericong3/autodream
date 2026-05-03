import { Plus } from 'lucide-react';

interface FABProps {
  onClick: () => void;
  label: string;
  icon?: React.ElementType;
}

export default function FAB({ onClick, label, icon: Icon = Plus }: FABProps) {
  return (
    <div className="fixed bottom-24 right-4 z-20 md:hidden">
      <button
        onClick={onClick}
        className="flex items-center gap-2 btn-gold px-4 py-3 rounded-2xl shadow-gold-sm text-sm font-semibold active:scale-95 transition-transform"
      >
        <Icon size={16} />
        {label}
      </button>
    </div>
  );
}
