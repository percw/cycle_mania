/**
 * The privacy note, shared by the in-app dialog (PrivacyNote.tsx) and the static
 * /personvern/ page (scripts/build-seo.mjs). Keep it in step with src/telemetry.ts.
 */
export const privacyTitle = 'Personvern';
export const privacyLead = 'SUMMIT har ingen kontoer og ingen innlogging. Øktene dine blir i nettleseren.';

export const privacySections: { heading: string; paragraphs: string[] }[] = [
  {
    heading: 'Øktene dine blir hos deg',
    paragraphs: [
      'Økter, wattmålinger, puls, FTP og innstillinger lagres i nettleseren på denne enheten. De sendes ikke til oss eller til andre. Sletter du nettstedsdata i nettleseren, forsvinner de.',
      'Bluetooth-forbindelsen går direkte mellom nettleseren og sykkelen eller pulsbeltet.',
    ],
  },
  {
    heading: 'Hva vi måler',
    paragraphs: [
      'For å forstå om SUMMIT er nyttig, teller vi noen få hendelser anonymt med Vercel Web Analytics: sidevisninger, at appen åpnes, hvilken type sensor som kobles til (for eksempel FTMS eller puls), at en økt startes eller lagres, om du deler et øktbilde, og svarene i den frivillige spørsmålsrunden.',
      'For økter sender vi bare grove kategorier: type økt, verden, varighet i intervaller som «30–44 min», og omtrent hvor mange økter som er syklet i denne nettleseren («4–5»).',
    ],
  },
  {
    heading: 'Hva vi ikke måler',
    paragraphs: [
      'Ingen informasjonskapsler, ingen bruker-ID og ingen fingeravtrykk av enheten. Watt, puls, FTP og andre treningsdata sendes aldri. For å skille besøk uten informasjonskapsler bruker Vercel en midlertidig nøkkel som nullstilles hver dag.',
      'Vi måler ingenting når nettleseren ber om å ikke bli sporet («Do Not Track» eller Global Privacy Control), og heller ikke når du slår det av nedenfor.',
    ],
  },
  {
    heading: 'Deling og skrifter',
    paragraphs: [
      'Øktbildet lages på enheten din og sendes bare dit du selv velger å dele det.',
      'Skriftene lastes fra Google Fonts, som da ser IP-adressen din.',
    ],
  },
];

export const privacyOptOutLabel = 'Ikke send bruksstatistikk fra denne nettleseren';
