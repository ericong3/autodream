import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, User as UserIcon, QrCode, Phone, Mail, Globe, Instagram, Facebook, MessageCircle, Briefcase, FileText } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useStore } from '../store';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'profile' | 'namecard';

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { currentUser, updateUser } = useStore((s) => ({
    currentUser: s.currentUser,
    updateUser: s.updateUser,
  }));

  const [tab, setTab] = useState<Tab>('profile');
  const [avatar, setAvatar] = useState(currentUser?.avatar ?? '');
  const [position, setPosition] = useState(currentUser?.position ?? '');
  const [bio, setBio] = useState(currentUser?.bio ?? '');
  const [email, setEmail] = useState(currentUser?.email ?? '');
  const [whatsapp, setWhatsapp] = useState(currentUser?.whatsapp ?? '');
  const [instagram, setInstagram] = useState(currentUser?.instagram ?? '');
  const [facebook, setFacebook] = useState(currentUser?.facebook ?? '');
  const [website, setWebsite] = useState(currentUser?.website ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !currentUser) return null;

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatar(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    await updateUser(currentUser.id, { avatar, position, bio, email, whatsapp, instagram, facebook, website });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const vCard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${currentUser.name}`,
    'ORG:AutoDream Car Dealership',
    position ? `TITLE:${position}` : '',
    currentUser.phone ? `TEL;TYPE=CELL:${currentUser.phone}` : '',
    whatsapp ? `TEL;TYPE=WORK:${whatsapp}` : '',
    email ? `EMAIL:${email}` : '',
    website ? `URL:${website}` : '',
    bio ? `NOTE:${bio}` : '',
    'END:VCARD',
  ].filter(Boolean).join('\n');

  const displayRole = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md glass-panel shadow-card-lg rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto">

          {/* Gold accent */}
          <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl bg-gold-gradient opacity-80" />

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gold-500/10 bg-gradient-to-r from-white/[0.03] to-transparent">
            <h2 className="font-display text-white font-semibold text-sm tracking-wide">My Profile</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-obsidian-500/60 transition-colors">
              <X size={17} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gold-500/10">
            <button
              onClick={() => setTab('profile')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-colors ${
                tab === 'profile' ? 'text-gold-300 border-b-2 border-gold-400' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <UserIcon size={13} />
              Profile
            </button>
            <button
              onClick={() => setTab('namecard')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-colors ${
                tab === 'namecard' ? 'text-gold-300 border-b-2 border-gold-400' : 'text-white/50 hover:text-white/80'
              }`}
            >
              <QrCode size={13} />
              Name Card
            </button>
          </div>

          {tab === 'profile' && (
            <div className="p-5 space-y-4">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className="relative w-20 h-20 rounded-full cursor-pointer group"
                  onClick={() => fileRef.current?.click()}
                >
                  {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-20 h-20 rounded-full object-cover border-2 border-gold-400/50" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gold-gradient flex items-center justify-center text-obsidian-950 font-bold text-2xl uppercase shadow-gold-sm">
                      {currentUser.name.charAt(0)}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={18} className="text-white" />
                  </div>
                </div>
                <p className="text-xs text-gray-400">Tap to change photo</p>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>

              {/* Read-only name + role */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">Name</label>
                  <div className="px-3 py-2 rounded-lg bg-obsidian-700/40 text-white text-sm">{currentUser.name}</div>
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">Role</label>
                  <div className="px-3 py-2 rounded-lg bg-obsidian-700/40 text-white text-sm capitalize">{currentUser.role}</div>
                </div>
              </div>

              {/* Position / Title */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                  <span className="flex items-center gap-1"><Briefcase size={10} />Display Title</span>
                </label>
                <input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g. Senior Sales Executive"
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                />
              </div>

              {/* Bio */}
              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                  <span className="flex items-center gap-1"><FileText size={10} />Bio / Tagline</span>
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="e.g. Let me help you find your dream car!"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors resize-none"
                />
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                    <span className="flex items-center gap-1"><Mail size={10} />Email</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                    <span className="flex items-center gap-1"><MessageCircle size={10} />WhatsApp</span>
                  </label>
                  <input
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+601X-XXXXXXX"
                    className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                    <span className="flex items-center gap-1"><Instagram size={10} />Instagram</span>
                  </label>
                  <input
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="@handle"
                    className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                    <span className="flex items-center gap-1"><Facebook size={10} />Facebook</span>
                  </label>
                  <input
                    value={facebook}
                    onChange={(e) => setFacebook(e.target.value)}
                    placeholder="fb.com/yourname"
                    className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] text-gray-400 font-medium uppercase tracking-wider block mb-1">
                  <span className="flex items-center gap-1"><Globe size={10} />Website</span>
                </label>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg bg-obsidian-700/40 border border-white/[0.08] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gold-500/50 transition-colors"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2.5 rounded-lg bg-gold-gradient text-obsidian-950 text-sm font-bold shadow-gold-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
              >
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
              </button>
            </div>
          )}

          {tab === 'namecard' && (
            <div className="p-5 space-y-4">
              {/* Name Card Preview */}
              <div className="relative rounded-2xl overflow-hidden border border-gold-500/20 shadow-card-lg">
                {/* Card BG */}
                <div className="absolute inset-0 bg-gradient-to-br from-obsidian-800 via-obsidian-900 to-obsidian-950" />
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gold-gradient" />
                <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gold-500/5 blur-2xl" />
                <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-gold-500/5 blur-xl" />

                <div className="relative p-5 flex gap-4 items-start">
                  {/* Avatar */}
                  <div className="shrink-0">
                    {currentUser.avatar ? (
                      <img src={currentUser.avatar} alt="Avatar" className="w-16 h-16 rounded-xl object-cover border border-gold-400/30 shadow-gold-sm" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-gold-gradient flex items-center justify-center text-obsidian-950 font-bold text-xl uppercase shadow-gold-sm">
                        {currentUser.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold text-base leading-tight">{currentUser.name}</p>
                    <p className="text-gold-300 text-xs font-medium mt-0.5">{currentUser.position || displayRole}</p>
                    <p className="text-gray-400 text-[10px] mt-0.5 tracking-wider uppercase">AutoDream Car Dealership</p>
                    {currentUser.bio && <p className="text-gray-400 text-[11px] mt-1.5 italic leading-snug line-clamp-2">{currentUser.bio}</p>}
                  </div>
                </div>

                <div className="relative px-5 pb-4 space-y-1.5">
                  {currentUser.phone && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-300">
                      <Phone size={11} className="text-gold-400" />
                      {currentUser.phone}
                    </div>
                  )}
                  {currentUser.whatsapp && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-300">
                      <MessageCircle size={11} className="text-gold-400" />
                      {currentUser.whatsapp}
                    </div>
                  )}
                  {currentUser.email && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-300">
                      <Mail size={11} className="text-gold-400" />
                      {currentUser.email}
                    </div>
                  )}
                  {currentUser.instagram && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-300">
                      <Instagram size={11} className="text-gold-400" />
                      {currentUser.instagram}
                    </div>
                  )}
                  {currentUser.website && (
                    <div className="flex items-center gap-2 text-[11px] text-gray-300">
                      <Globe size={11} className="text-gold-400" />
                      {currentUser.website}
                    </div>
                  )}
                </div>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-[11px] text-gray-400 text-center">Customer scans this to save your contact</p>
                <div className="p-3 rounded-xl bg-white shadow-gold-sm">
                  <QRCodeSVG
                    value={vCard}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#0a0a0f"
                    level="M"
                  />
                </div>
                <p className="text-[10px] text-gray-500 text-center">Scan to add contact card</p>
              </div>

              <button
                onClick={() => setTab('profile')}
                className="w-full py-2.5 rounded-lg border border-gold-500/30 text-gold-300 text-sm font-medium hover:bg-gold-500/10 transition-colors"
              >
                Edit Profile Details
              </button>
            </div>
          )}
        </div>
    </div>
  );

  return createPortal(modal, document.body);
}
