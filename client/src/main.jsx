import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource-variable/inter';
import './styles/style.css';
import App from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary fullPage>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
