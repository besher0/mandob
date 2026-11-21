import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
import './visual-parity-v2.css';
import './deep-parity-v2.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
