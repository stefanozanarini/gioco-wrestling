import { defineConfig } from 'vite';
import { attachRooms } from './server/rooms.js';

// le stanze multiplayer (WebSocket /ws) girano anche dentro il server di sviluppo: basta "npm run dev"
const rooms = {
  name: 'bwt-rooms',
  configureServer(server) { if (server.httpServer) attachRooms(server.httpServer); },
  configurePreviewServer(server) { if (server.httpServer) attachRooms(server.httpServer); },
};

// base relativa: il gioco funziona sia su un sottodominio sia sotto un percorso del reverse proxy
export default defineConfig({
  base: './',
  plugins: [rooms],
  server: {
    watch: { usePolling: true, interval: 300 }, // il disco /dati non notifica le modifiche
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
