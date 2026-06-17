import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0e17',
          secondary: '#111827',
          card: '#1a2332',
          'card-hover': '#1e2a3d',
          input: '#0f1729',
          hover: 'rgba(59,130,246,0.1)',
        },
        text: {
          primary: '#e8edf5',
          secondary: '#94a3b8',
          muted: '#64748b',
        },
        accent: {
          blue: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
          gold: '#f59e0b',
          purple: '#8b5cf6',
          cyan: '#06b6d4',
        },
        border: {
          DEFAULT: '#1e293b',
          light: '#334155',
        },
        buy: '#ef4444',
        sell: '#10b981',
        up: '#ef4444',
        down: '#10b981',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '10px',
        sm: '6px',
        lg: '14px',
      },
      boxShadow: {
        DEFAULT: '0 8px 32px rgba(0,0,0,0.5)',
        sm: '0 2px 8px rgba(0,0,0,0.3)',
        glow: '0 0 20px rgba(59,130,246,0.15)',
      },
      backgroundImage: {
        'gradient-header': 'linear-gradient(135deg, #1a2332 0%, #0f1729 100%)',
        'gradient-gold': 'linear-gradient(135deg, #f59e0b, #d97706)',
        'gradient-blue': 'linear-gradient(135deg, #3b82f6, #2563eb)',
        'gradient-green': 'linear-gradient(135deg, #10b981, #059669)',
      },
      animation: {
        'flash-up': 'flashUp 0.5s ease-out',
        'flash-down': 'flashDown 0.5s ease-out',
        'tick-pulse': 'tickPulse 0.5s ease-in-out infinite alternate',
        'ftp-in': 'ftpIn 0.2s ease-out',
      },
      keyframes: {
        flashUp: {
          '0%': { backgroundColor: 'rgba(239,68,68,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        flashDown: {
          '0%': { backgroundColor: 'rgba(34,197,94,0.3)' },
          '100%': { backgroundColor: 'transparent' },
        },
        tickPulse: {
          from: { opacity: '1' },
          to: { opacity: '0.5' },
        },
        ftpIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
