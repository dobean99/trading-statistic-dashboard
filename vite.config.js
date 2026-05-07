import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const groqKey = env.GROQ_API_KEY || '';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      proxy: {
        // Browser → /api/groq/* → https://api.groq.com/* with bearer token injected
        '/api/groq': {
          target: 'https://api.groq.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/groq/, ''),
          headers: groqKey ? { Authorization: `Bearer ${groqKey}` } : {},
        },
      },
    },
  };
});
