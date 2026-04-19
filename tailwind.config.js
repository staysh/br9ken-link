/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/views/**/*.eta", "./src/routes/**/*.ts"],
  darkMode: "media",
  theme: {
    extend: {
      maxWidth: {
        roll: "640px",
      },
    },
  },
  plugins: [],
};
