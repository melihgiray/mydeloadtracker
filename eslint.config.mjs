// ESLint flat config for Next 16 + ESLint 9. eslint-config-next 16 ships a
// native flat config as its default export, so we spread it directly (the old
// FlatCompat path hits a circular-ref bug in ESLint 9/10's validator).
import next from "eslint-config-next";

const base = Array.isArray(next) ? next : (next.default ?? []);

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...base,
  {
    rules: {
      // New rule in the React 19 hooks plugin. Several of our animation effects
      // (requestAnimationFrame count-ups, reduced-motion fallbacks) intentionally
      // setState inside an effect. Keep it visible as a warning rather than a
      // hard error so it does not fail lint on deliberate patterns.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
