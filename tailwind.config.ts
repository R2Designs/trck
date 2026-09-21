import type { Config } from 'tailwindcss';

/**
 * trck design tokens.
 *
 * Colour choices are deliberately high-contrast: the primary users operate the
 * app outdoors, next to a bus, in direct sunlight on a cheap Android screen.
 * Every semantic colour pair below meets WCAG 2.2 AA (>= 4.5:1) against its
 * documented background. See docs/ARCHITECTURE.md ("Design system").
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', lg: '2rem' },
      screens: { '2xl': '1400px' },
    },
    extend: {
      screens: {
        // Smallest supported handset width. Layouts must not break below this.
        xs: '360px',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          muted: 'hsl(var(--primary-muted))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          muted: 'hsl(var(--destructive-muted))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          muted: 'hsl(var(--success-muted))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          muted: 'hsl(var(--warning-muted))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          muted: 'hsl(var(--info-muted))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // Noto Sans covers Latin; the Indic families are required for Tamil,
        // Telugu and Kannada glyphs which many low-end Android ROMs ship
        // incompletely. See docs/I18N.md ("Fonts").
        sans: [
          '"Noto Sans"',
          '"Noto Sans Tamil"',
          '"Noto Sans Telugu"',
          '"Noto Sans Kannada"',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Nothing below 14px is allowed in product UI.
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
      },
      spacing: {
        touch: '2.75rem', // 44px — minimum interactive target
        'touch-lg': '3.5rem', // 56px — primary outdoor CTA
        'safe-bottom': 'calc(4rem + env(safe-area-inset-bottom))',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'slide-up': 'slide-up 180ms ease-out',
        'fade-in': 'fade-in 140ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
