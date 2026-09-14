import { FormEvent, useEffect, useState } from 'react';
import { CHURCHTOOLS_ORIGIN } from '../api/churchtools';

export type ConnectionValues = {
  loginToken: string;
};

type Props = {
  values: ConnectionValues;
  onConnect: (values: ConnectionValues) => void;
  busy: boolean;
};

export default function ConnectionPanel({ values, onConnect, busy }: Props) {
  const [loginToken, setLoginToken] = useState(values.loginToken);

  useEffect(() => {
    setLoginToken(values.loginToken);
  }, [values.loginToken]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onConnect({ loginToken });
  }

  return (
    <form className="connection-panel" onSubmit={submit}>
      <div className="connection-target" aria-label="ChurchTools target">
        <span>ChurchTools</span>
        <strong>{CHURCHTOOLS_ORIGIN.replace('https://', '')}</strong>
      </div>
      <div className="field grow">
        <label htmlFor="login-token">Login token</label>
        <input
          id="login-token"
          type="password"
          value={loginToken}
          onChange={(event) => setLoginToken(event.target.value)}
          placeholder="ChurchTools login token"
          autoComplete="off"
        />
      </div>
      <button className="primary" type="submit" disabled={busy || !loginToken.trim()}>
        {busy ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
