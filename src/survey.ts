import type { RideRecord } from './storage';
import { countsAsRealRide, realRideCount, type SurveyQuestion } from './telemetry';

/** Two one-tap questions, shown in the ride report from the third real ride until answered or dismissed. */
export const SURVEY_KEY = 'summit-survey';
export const SURVEY_AFTER_RIDES = 3;

export const surveyQuestions: { id: SurveyQuestion; text: string; options: { value: string; label: string }[] }[] = [
  {
    id: 'other_app', text: 'Hva bruker du ellers til innendørssykling?',
    options: [
      { value: 'zwift', label: 'Zwift' }, { value: 'mywhoosh', label: 'MyWhoosh' }, { value: 'rouvy', label: 'Rouvy' },
      { value: 'trainerroad', label: 'TrainerRoad' }, { value: 'annet', label: 'Annet' }, { value: 'ingen', label: 'Ingen' },
    ],
  },
  {
    id: 'switch', text: 'Kunne du tenke deg å bruke SUMMIT i stedet?',
    options: [{ value: 'ja', label: 'Ja' }, { value: 'kanskje', label: 'Kanskje' }, { value: 'nei', label: 'Nei' }],
  },
];

/** Only which questions were answered is stored locally, never the answers. */
export type SurveyState = { answered: SurveyQuestion[]; dismissed: boolean };

export function parseSurveyState(raw: unknown): SurveyState {
  const value = raw && typeof raw === 'object' ? raw as Partial<SurveyState> : {};
  const answered = Array.isArray(value.answered)
    ? surveyQuestions.map(q => q.id).filter(id => value.answered!.includes(id)) : [];
  return { answered, dismissed: value.dismissed === true };
}

export function readSurveyState(): SurveyState {
  try { return parseSurveyState(JSON.parse(localStorage.getItem(SURVEY_KEY) ?? 'null')); } catch { return parseSurveyState(null); }
}
export function writeSurveyState(state: SurveyState) {
  try { localStorage.setItem(SURVEY_KEY, JSON.stringify(state)); } catch { /* storage blocked: the survey simply returns next time */ }
}

export function nextSurveyQuestion(state: SurveyState) {
  return state.dismissed ? null : surveyQuestions.find(q => !state.answered.includes(q.id)) ?? null;
}

export function surveyDue(state: SurveyState, ride: Pick<RideRecord, 'demo' | 'completed' | 'seconds'>, history: Pick<RideRecord, 'demo' | 'completed' | 'seconds'>[]): boolean {
  return nextSurveyQuestion(state) !== null && countsAsRealRide(ride) && realRideCount(history) >= SURVEY_AFTER_RIDES;
}
