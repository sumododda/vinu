import { useEffect, useState } from 'react';

export default function App() {
  const [pong, setPong] = useState<string>('…');

  useEffect(() => {
    window.api.ping().then(setPong).catch((e) => setPong(`error: ${e.message}`));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>vinu</h1>
      <p>IPC ping: {pong}</p>
    </main>
  );
}
