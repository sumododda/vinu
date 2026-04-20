import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/public-sans';
import '@fontsource/libre-bodoni/400.css';
import '@fontsource/libre-bodoni/500.css';
import '@fontsource/libre-bodoni/600.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
