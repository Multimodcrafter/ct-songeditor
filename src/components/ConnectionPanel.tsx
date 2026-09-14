import { CHURCHTOOLS_ORIGIN } from '../api/churchtools';

type Props = {
  authenticated: boolean;
  configured: boolean;
  busy: boolean;
  onLogin: () => void;
  onLogout: () => void;
};

export default function ConnectionPanel({ authenticated, configured, busy, onLogin, onLogout }: Props) {
  return (
    <div className="connection-panel">
      <div className="connection-target" aria-label="ChurchTools-Instanz">
        <span>{authenticated ? 'Angemeldet bei ChurchTools' : 'ChurchTools'}</span>
        <strong>{CHURCHTOOLS_ORIGIN.replace('https://', '')}</strong>
      </div>
      {!configured && !busy ? <span className="connection-status">Die Anmeldung wird noch eingerichtet.</span> : null}
      <button
        className={authenticated ? 'secondary' : 'primary'}
        type="button"
        onClick={authenticated ? onLogout : onLogin}
        disabled={busy || (!authenticated && !configured)}
      >
        {busy ? 'Bitte warten …' : authenticated ? 'Abmelden' : 'Mit ChurchTools anmelden'}
      </button>
    </div>
  );
}
