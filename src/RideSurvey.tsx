import { useState } from 'react';
import { X } from 'lucide-react';
import type { RideRecord } from './storage';
import { nextSurveyQuestion, readSurveyState, surveyDue, surveyQuestions, writeSurveyState, type SurveyState } from './survey';
import { track } from './telemetry';
import './report-extras.css';

/** Calm two-question card inside the ride report. Answers go to anonymous telemetry only. */
export function RideSurvey({ ride, history }: { ride: RideRecord; history: RideRecord[] }) {
  const [state, setState] = useState<SurveyState>(readSurveyState);
  const [visible] = useState(() => surveyDue(state, ride, history));
  if (!visible || state.dismissed) return null;
  const question = nextSurveyQuestion(state);
  const save = (next: SurveyState) => { setState(next); writeSurveyState(next); };

  if (!question) return <section className="ride-survey done" aria-live="polite">
    <p><strong>Takk!</strong> Svarene er anonyme og hjelper oss å avgjøre hva SUMMIT bør bli.</p>
  </section>;

  const step = surveyQuestions.indexOf(question) + 1;
  return <section className="ride-survey" aria-label="To korte spørsmål">
    <header>
      <span>To korte spørsmål · {step} av {surveyQuestions.length}</span>
      <button type="button" className="survey-dismiss" aria-label="Ikke spør igjen" onClick={() => save({ ...state, dismissed: true })}>
        <span>Ikke spør igjen</span><X size={15} />
      </button>
    </header>
    <h3 id={`survey-${question.id}`}>{question.text}</h3>
    <div className="survey-options" role="group" aria-labelledby={`survey-${question.id}`}>
      {question.options.map(option => <button type="button" key={option.value} onClick={() => {
        track('survey_answer', { question: question.id, answer: option.value });
        save({ ...state, answered: [...state.answered, question.id] });
      }}>{option.label}</button>)}
    </div>
    <p className="survey-note">Ett trykk per spørsmål. Anonymt, uten treningsdata.</p>
  </section>;
}
