import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { readArrival } from './deepLink';
import { initTelemetry, track, workoutCategory } from './telemetry';
import { workouts } from './training';
import './styles.css';
import './polish.css';

const arrival = readArrival();
initTelemetry();
track('app_open', {
  bluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
  installed: typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
});
if (arrival.fromWorkoutPage) track('workout_page_cta', { category: workoutCategory(workouts.find(w => w.id === arrival.workoutId)) });

createRoot(document.getElementById('root')!).render(<React.StrictMode><App linkedWorkoutId={arrival.workoutId} /></React.StrictMode>);
