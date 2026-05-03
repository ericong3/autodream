/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          50:  '#FFFBEB',
          100: '#FEF0C2',
          200: '#F7D96A',
          300: '#EAB820',
          400: '#D4A017',
          500: '#B8880A',
          600: '#9A7008',
          700: '#7A5706',
          800: '#5C4005',
          900: '#3D2B03',
        },
        obsidian: {
          950: '#050504',
          900: '#0A0906',
          800: '#0E0D0B',
          700: '#141210',
          600: '#1C1A14',
          500: '#252118',
          400: '#2A2316',
          300: '#3D3420',
        }
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'gold-sm':    '0 0 10px rgba(234,184,32,0.18)',
        'gold':       '0 0 24px rgba(234,184,32,0.28)',
        'gold-lg':    '0 0 44px rgba(234,184,32,0.38)',
        'gold-xl':    '0 0 70px rgba(234,184,32,0.48)',
        'gold-deep':  '0 8px 32px rgba(234,184,32,0.22), 0 2px 8px rgba(0,0,0,0.5)',
        'card':       '0 4px 24px rgba(0,0,0,0.45)',
        'card-lg':    '0 8px 40px rgba(0,0,0,0.65)',
        'card-xl':    '0 16px 60px rgba(0,0,0,0.75)',
        'inset-gold': 'inset 0 1px 0 rgba(234,184,32,0.12)',
        'emerald':    '0 4px 20px rgba(52,211,153,0.18), 0 2px 8px rgba(0,0,0,0.4)',
        'red':        '0 4px 20px rgba(239,68,68,0.20),  0 2px 8px rgba(0,0,0,0.4)',
        'blue':       '0 4px 20px rgba(96,165,250,0.18), 0 2px 8px rgba(0,0,0,0.4)',
        'purple':     '0 4px 20px rgba(167,139,250,0.18),0 2px 8px rgba(0,0,0,0.4)',
      },
      keyframes: {
        'page-in':    { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'float':      { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        'price-in':   { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'gold-pulse': { '0%,100%': { boxShadow: '0 0 0 0 rgba(234,184,32,0)' }, '50%': { boxShadow: '0 0 16px 4px rgba(234,184,32,0.2)' } },
      },
      animation: {
        'page-in':    'page-in 0.25s ease forwards',
        'float':      'float 3s ease-in-out infinite',
        'price-in':   'price-in 0.4s ease forwards',
        'gold-pulse': 'gold-pulse 2.5s ease-in-out infinite',
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #F7D96A 0%, #EAB820 40%, #B8880A 100%)',
        'gold-gradient-soft': 'linear-gradient(135deg, #EAB820 0%, #9A7008 100%)',
        'card-gradient': 'linear-gradient(160deg, rgba(26,24,18,0.55) 0%, rgba(13,12,10,0.55) 100%)',
        'card-gradient-hover': 'linear-gradient(160deg, rgba(32,30,22,0.65) 0%, rgba(19,17,9,0.65) 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, rgba(12,11,9,0.78) 0%, rgba(7,6,5,0.78) 100%)',
        'header-gradient': 'linear-gradient(180deg, rgba(15,13,10,0.72) 0%, rgba(10,9,6,0.72) 100%)',
      },
    },
  },
  plugins: [],
}
