import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        tertiary: 'rgb(var(--color-tertiary) / <alpha-value>)',
        'hot-pink': 'rgb(var(--color-hot-pink) / <alpha-value>)',
        'success-green': 'rgb(var(--color-success-green) / <alpha-value>)',
        'danger-red': 'rgb(var(--color-danger-red) / <alpha-value>)',
        background: 'rgb(var(--color-background) / <alpha-value>)',
        'terminal-bg': 'rgb(var(--color-terminal-bg) / <alpha-value>)',
        'surface-container-lowest': 'rgb(var(--color-surface-container-lowest) / <alpha-value>)',
        'surface-container-low': 'rgb(var(--color-surface-container-low) / <alpha-value>)',
        'surface-container': 'rgb(var(--color-surface-container) / <alpha-value>)',
        'surface-container-high': 'rgb(var(--color-surface-container-high) / <alpha-value>)',
        'surface-container-highest': 'rgb(var(--color-surface-container-highest) / <alpha-value>)',
        'surface-variant': 'rgb(var(--color-surface-variant) / <alpha-value>)',
        'surface-dark': 'rgb(var(--color-surface-dark) / <alpha-value>)',
        'on-background': 'rgb(var(--color-on-background) / <alpha-value>)',
        'on-surface': 'rgb(var(--color-on-surface) / <alpha-value>)',
        'on-surface-variant': 'rgb(var(--color-on-surface-variant) / <alpha-value>)',
        outline: 'rgb(var(--color-outline) / <alpha-value>)',
        'outline-variant': 'rgb(var(--color-outline-variant) / <alpha-value>)',
        error: 'rgb(var(--color-error) / <alpha-value>)',
        'error-container': 'rgb(var(--color-error-container) / <alpha-value>)',
        // Legacy dark scale mapped to new colors
        dark: {
          700: '#1c2433',
          800: '#0f131a',
          900: '#07090e',
        },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Anybody', 'sans-serif'],
      },
      fontSize: {
        'body-md': ['16px', { lineHeight: '1.6' }],
        'code-block': ['14px', { lineHeight: '1.7' }],
        'label-caps': ['12px', { lineHeight: '1', letterSpacing: '0.1em', fontWeight: '700' }],
        'headline-xl': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-lg': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
      },
      keyframes: {
        'crt-scanline': {
          '0%': { top: '0%' },
          '100%': { top: '100%' },
        },
        'crt-flicker': {
          '0%': { opacity: '0.97' },
          '5%': { opacity: '1' },
          '10%': { opacity: '0.98' },
          '15%': { opacity: '1' },
          '20%': { opacity: '0.97' },
          '50%': { opacity: '1' },
          '80%': { opacity: '0.98' },
          '90%': { opacity: '1' },
          '100%': { opacity: '0.97' },
        },
        'terminal-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'crt-scanline': 'crt-scanline 8s linear infinite',
        'crt-flicker': 'crt-flicker 0.15s infinite',
        'terminal-blink': 'terminal-blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
};

export default config;
