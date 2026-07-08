/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        bg: '#0B0F19',
        surface: '#131A2A',
        elevated: '#1C263B',
        txt: '#F8FAFC',
        'txt-2': '#94A3B8',
        'txt-3': '#64748B',
        electric: { DEFAULT: '#3B82F6', hover: '#2563EB' },
        neon: '#F97316',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        line: 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px' },
      boxShadow: {
        glow: '0 0 15px rgba(59,130,246,0.3)',
        card: '0 10px 15px -3px rgba(0,0,0,0.4)',
      },
    },
  },
  corePlugins: { preflight: false },
  plugins: [],
};
