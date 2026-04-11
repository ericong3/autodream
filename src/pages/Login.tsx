import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useStore } from '../store';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400));
    const success = await login(username.trim(), password);
    setLoading(false);
    if (success) { navigate('/inventory'); }
    else { setError('Invalid username or password'); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-obsidian-950">

      {/* Background video */}
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src="/background.mp4"
        autoPlay
        loop
        muted
        playsInline
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/60 pointer-events-none" />

      {/* Background atmosphere */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Central radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[600px] h-[600px] rounded-full opacity-[0.06]
          bg-radial-[at_50%_50%] from-gold-300 to-transparent blur-3xl" />
        {/* Top-left corner */}
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-gold-400 opacity-[0.04] rounded-full blur-3xl" />
        {/* Bottom-right corner */}
        <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-gold-500 opacity-[0.04] rounded-full blur-3xl" />

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: 'linear-gradient(rgba(234,184,32,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(234,184,32,0.3) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="w-full max-w-md relative z-10">

        {/* ── Brand header ────────────────────────── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-32 h-32 rounded-2xl overflow-hidden shadow-gold-lg mb-5">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-display text-4xl font-bold text-white tracking-wide">AutoDream</h1>
          <p className="text-white/50 text-sm mt-2 tracking-widest uppercase font-medium">
            Car Dealership Management
          </p>
          {/* Gold accent line under title */}
          <div className="mt-3 mx-auto w-16 h-[2px] bg-gold-gradient rounded-full opacity-60" />
        </div>

        {/* ── Card ────────────────────────────────── */}
        <div className="bg-gradient-to-b from-obsidian-700 to-obsidian-800
          border border-obsidian-400/80 rounded-2xl
          shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(42,35,22,0.5)]
          overflow-hidden">

          {/* Gold top stripe */}
          <div className="h-[2px] w-full bg-gold-gradient" />

          <div className="p-8">
            {/* Error */}
            {error && (
              <div className="flex items-center gap-2.5 bg-red-500/[0.08] border border-red-500/25
                text-red-400 rounded-xl p-3.5 mb-5 text-sm">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <div>
                <label className="block text-white/70 text-xs font-semibold mb-2 uppercase tracking-wider">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="input"
                  autoComplete="username"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-white/70 text-xs font-semibold mb-2 uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="input pr-11"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2
                      text-white/40 hover:text-white/80 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-gold w-full py-3 rounded-xl text-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Signing in...
                  </span>
                ) : 'Sign In'}
              </button>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}
