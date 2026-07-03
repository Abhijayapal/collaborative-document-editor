/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // You can also define your Navy/Light Blue here for cleaner code
        navy: "#1E3A8A",
        lightblue: "#E0F2FE",
      },
    },
  },
  plugins: [],
}