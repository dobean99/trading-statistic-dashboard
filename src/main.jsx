import React from 'react';
import { createRoot } from 'react-dom/client';
import TradingDashboardApp from '../trading-dashboard.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TradingDashboardApp />
  </React.StrictMode>
);
