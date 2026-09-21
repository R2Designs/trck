/**
 * PostCSS pipeline.
 *
 * Tailwind generates the utility classes; Autoprefixer covers the older
 * Android WebViews this product actually runs on — a depot phone is rarely the
 * newest one in the building.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
