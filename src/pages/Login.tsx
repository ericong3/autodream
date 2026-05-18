import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
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
    if (success) {
      const role = useStore.getState().currentUser?.role;
      navigate(role === 'investor' ? '/investor-portal' : '/inventory');
    } else { setError('Invalid username or password'); }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-obsidian-950">

      {/* Full-screen background video */}
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src="/background.mp4?v=2"
        autoPlay loop muted playsInline preload="none"
      />

      {/* Full-screen overlay */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Layout sits on top of video */}
      <div className="relative z-10 min-h-screen flex">

        {/* ── LEFT — Logo sits over the cosmic/nebula part of the video ── */}
        <div className="hidden md:flex md:w-[62%] lg:w-[64%] items-center justify-center px-16 select-none">
          <div className="relative flex items-center justify-center">
            {/* Deep radial dark behind logo */}
            <div className="absolute w-[960px] lg:w-[1060px] aspect-square rounded-full
              bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.92)_0%,rgba(0,0,0,0.72)_30%,rgba(0,0,0,0.3)_58%,transparent_75%)]
              pointer-events-none" />
            <img
              src="/logo.png"
              alt="AutoDream"
              className="relative z-10 w-[666px] lg:w-[738px]
                drop-shadow-[0_0_90px_rgba(255,255,255,0.18)]
                drop-shadow-[0_0_35px_rgba(212,160,23,0.3)]
                drop-shadow-[0_8px_48px_rgba(0,0,0,1)]"
              draggable={false}
            />
          </div>
        </div>

        {/* ── RIGHT — Login form sits over the video's dark panel area ── */}
        <div className="w-full md:w-[38%] lg:w-[36%] flex flex-col items-center justify-center
          pl-6 pr-0 py-12 md:pl-8 md:pr-0 lg:pl-10 lg:pr-0 relative items-start">


          {/* Subtle top glow */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-80 h-48
            bg-gold-400 opacity-[0.06] blur-[60px] pointer-events-none" />

          {/* Corner brackets */}
          <div className="absolute top-7 right-7 w-7 h-7 border-r-2 border-t-2 border-gold-400/40" />
          <div className="absolute bottom-7 right-7 w-7 h-7 border-r-2 border-b-2 border-gold-400/40" />

          <div className="w-full max-w-[320px] relative z-10 -translate-x-[30%]">

            {/* Mobile logo */}
            <div className="md:hidden text-center mb-10">
              <img src="/logo.png" alt="AutoDream" className="w-52 mx-auto" />
            </div>

            {/* Heading */}
            <div className="mb-8 text-center">
              <h1 className="font-display text-[1.85rem] font-bold text-white tracking-wide leading-tight mb-1">
                Welcome Back
              </h1>
              <p className="text-white/40 text-sm font-sans mb-4">
                Sign in to your account
              </p>
              <div className="flex items-center justify-center gap-3">
                <div className="h-px w-16 bg-gradient-to-r from-transparent to-gold-400/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-gold-400/80 shadow-gold-sm" />
                <div className="h-px w-16 bg-gradient-to-l from-transparent to-gold-400/50" />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2.5 bg-red-500/[0.08] border border-red-500/20
                text-red-400 rounded-xl p-3.5 mb-5 text-sm">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            )}

            {/* Form card */}
            <div className="bg-black/40 border border-gold-400/12 rounded-2xl p-6
              shadow-[0_8px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(212,160,23,0.08)]">

              <form onSubmit={handleSubmit} className="space-y-5">

                <div>
                  <label className="block text-white/50 text-[10px] font-semibold mb-2 uppercase tracking-[0.18em]">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="input"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>

                <div>
                  <label className="block text-white/50 text-[10px] font-semibold mb-2 uppercase tracking-[0.18em]">
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
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2
                        text-white/35 hover:text-white/70 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-gold w-full py-3.5 rounded-xl text-sm mt-1"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : 'Sign In'}
                </button>

              </form>
            </div>

            <p className="text-white/45 text-[10px] text-center mt-8 tracking-[0.25em] uppercase font-sans">
              AutoDream &copy; {new Date().getFullYear()}
            </p>

          </div>
        </div>

      </div>
    </div>
  );
}
