import { useEffect, useState } from 'react';
import './styles.css';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { DetailPage } from './pages/DetailPage';
import { ListPage } from './pages/ListPage';
import { SettingsPage } from './pages/SettingsPage';

type Route = { name: 'list' } | { name: 'detail'; id: string } | { name: 'settings' };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('/notes/')) return { name: 'detail', id: hash.slice('/notes/'.length) };
  if (hash === '/settings') return { name: 'settings' };
  return { name: 'list' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <Layout sidebar={<Sidebar selectedId={route.name === 'detail' ? route.id : null} />}>
      {route.name === 'list' && <ListPage />}
      {route.name === 'detail' && <DetailPage key={route.id} id={route.id} />}
      {route.name === 'settings' && <SettingsPage />}
    </Layout>
  );
}
