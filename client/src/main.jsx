import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './amplify-config.js';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { StandingsProvider } from './context/StandingsContext.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StandingsProvider>
          <App />
        </StandingsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
