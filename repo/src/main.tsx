import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { seedIfEmpty } from './db/seed';
import { storageService } from './services/storageService';
import './styles.css';

async function bootstrap() {
  await seedIfEmpty();
  storageService.applyTheme();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
