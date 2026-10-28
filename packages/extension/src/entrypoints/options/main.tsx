import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@/options/App';
import '@/assets/tailwind.css';
import { applyTheme, Themed } from '@/shared/theme';

// Before the first paint, so a dark system never flashes white.
applyTheme('system');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Themed>
      <App />
    </Themed>
  </React.StrictMode>,
);
