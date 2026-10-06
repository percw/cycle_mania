import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { renderShareCard, shareCardModel, shareOrDownload, type ShareCardInput } from './shareCard';
import { DEFAULT_SITE_URL, siteHost } from './site';
import { isLocalHost, track } from './telemetry';
import './report-extras.css';

function printedSite() {
  return typeof location !== 'undefined' && !isLocalHost(location.hostname) ? location.host : siteHost(DEFAULT_SITE_URL);
}

/** Renders the share card on demand, then opens the share sheet or downloads the PNG. */
export function ShareCardButton({ input, variant }: { input: Omit<ShareCardInput, 'site'>; variant: 'chip' | 'secondary' }) {
  const [state, setState] = useState<'idle' | 'working' | 'saved' | 'failed'>('idle');
  async function share() {
    if (state === 'working') return;
    setState('working');
    try {
      const model = shareCardModel({ ...input, site: printedSite() });
      const result = await shareOrDownload(await renderShareCard(model), model);
      if (result !== 'cancelled') track('share_card', { method: result });
      setState(result === 'download' ? 'saved' : 'idle');
    } catch {
      setState('failed');
    }
  }
  const chip = variant === 'chip';
  const label = state === 'working' ? 'Lager bilde …' : state === 'saved' ? (chip ? 'Lastet ned' : 'Bildet er lastet ned')
    : state === 'failed' ? 'Prøv igjen' : chip ? 'Del' : 'Del økten som bilde';
  return <>
    <button type="button" className={variant === 'chip' ? 'report-chip share-chip' : 'secondary share-button'} onClick={share} aria-busy={state === 'working'}
      title="Lager et bilde av økten på enheten din. Ingenting lastes opp før du selv deler det.">
      {state === 'saved' ? <Check size={16} /> : <Share2 size={16} />}{label}
    </button>
    {state === 'failed' && <span className="share-error" role="status">Bildet kunne ikke lages i denne nettleseren.</span>}
  </>;
}
