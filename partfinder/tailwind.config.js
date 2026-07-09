/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        // Palette « Atelier Mécanique » — clair, bleu acier + orange sécurité
        bg: '#EEF1F6',
        surface: '#FFFFFF',
        elevated: '#E7ECF3',
        txt: '#1A2B45',
        'txt-2': '#4C5F7A',
        'txt-3': '#7E8EA6',
        electric: { DEFAULT: '#1F5FD6', hover: '#174AAB' },
        neon: '#F26B1D',
        success: '#178A5B',
        warning: '#DB930B',
        danger: '#D64040',
        line: 'rgba(26,43,69,0.12)',
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px' },
      boxShadow: {
        glow: '0 0 0 3px rgba(31,95,214,0.15)',
        card: '0 10px 24px -6px rgba(26,43,69,0.18)',
      },
    },
  },
  corePlugins: { preflight: false },
  plugins: [],
};
