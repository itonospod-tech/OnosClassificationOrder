/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  // `@zero-126/zalo-ui` (trang /adm/zalo) là dist JSX mang sẵn class Tailwind (size-10, rounded-full…)
  // nhưng KHÔNG kèm CSS — phải cho Tailwind quét dist của gói, không thì avatar/nút mất kích thước
  // (prod 07/09/2026: avatar phình to cả màn). thghub làm bằng `@source` của Tailwind 4.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './node_modules/@zero-126/zalo-ui/dist/**/*.js'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        // Identity thương hiệu Onos (lấy từ onosglobal.com): tím #6f26c2 = brand.600.
        // Dùng cho các trang public (landing/marketing), và cho MỘT chỗ trong app:
        // màu khu vực của nhóm "Sản xuất" trên sidebar (`NAV_TONES` ở Sidebar.tsx),
        // nơi màu thương hiệu đánh dấu khu làm việc chính. Mọi chỗ khác trong app vẫn
        // dùng token shadcn.
        brand: {
          50: '#f6f1fd',
          100: '#ede1fb',
          200: '#dcc6f7',
          300: '#c4a1f0',
          400: '#a875e6',
          500: '#8d4ed8',
          600: '#6f26c2',
          700: '#5d1fa4',
          800: '#4d1c86',
          900: '#401a6d',
          950: '#270d47',
        },
        // Nền các band tối (stat band, CTA cuối, footer) của trang public.
        ink: {
          DEFAULT: '#2b2739',
          700: '#3a3550',
          800: '#2b2739',
          900: '#211e2d',
        },
        // Sidebar navigation (legacy OnosPod look) — values live in theme/globals.css (--nav-*),
        // light and dark, so the sidebar never carries raw colors.
        nav: {
          accent: 'hsl(var(--nav-accent) / <alpha-value>)',
          text: 'hsl(var(--nav-text) / <alpha-value>)',
          group: 'hsl(var(--nav-group) / <alpha-value>)',
          open: 'hsl(var(--nav-open) / <alpha-value>)',
        },
        // Status colors by meaning (theme/globals.css --tone-*), light + dark.
        tone: {
          info: 'hsl(var(--tone-info) / <alpha-value>)',
          success: 'hsl(var(--tone-success) / <alpha-value>)',
          warning: 'hsl(var(--tone-warning) / <alpha-value>)',
          danger: 'hsl(var(--tone-danger) / <alpha-value>)',
        },
        // Staff app page background (grey in light mode, see theme/globals.css --page).
        page: 'hsl(var(--page) / <alpha-value>)',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      boxShadow: {
        'nav-rail': 'var(--nav-rail-shadow)',
      },
      fontFamily: {
        // Font tiêu đề của trang public — khớp identity onosglobal.com.
        display: ['Lexend Deca', 'Inter', '-apple-system', 'Segoe UI', 'sans-serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'indeterminate-bar': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Dải chữ chạy ngang ở trang public (landing).
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'indeterminate-bar': 'indeterminate-bar 1.2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    // `touch:` = the primary input is a finger (phones, tablets), not a narrow desktop window.
    // Used for the 44px minimum touch target (DesignSystem-LegacyParity.md §10). `(hover: none)` is
    // there too because device emulation (and some webviews) report no pointer type at all while
    // still reporting that hovering is impossible; a desktop with a mouse matches neither.
    ({ addVariant }) => addVariant('touch', '@media (pointer: coarse), (hover: none)'),
    // Gói zalo-ui viết cho Tailwind 4: 4 tiện ích dưới đây không có ở v3 → khai bằng tên v4, giá trị tương đương v3.
    ({ addUtilities }) =>
      addUtilities({
        '.shadow-xs': { 'box-shadow': '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
        '.rounded-xs': { 'border-radius': '0.125rem' },
        '.outline-hidden': { outline: '2px solid transparent', 'outline-offset': '2px' },
        '.field-sizing-content': { 'field-sizing': 'content' },
      }),
  ],
};
