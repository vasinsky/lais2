/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          dark: '#111217',
          panel: '#181920',
          hover: '#22232e',
          border: '#262833',
          accent: '#6366f1'
        }
      }
    },
  },
  plugins: [],
}
