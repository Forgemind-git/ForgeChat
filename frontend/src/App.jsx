import { useState, useEffect } from 'react';
import { api } from './api.js';
import { C, FONT } from './constants.js';
import { useHashRoute } from './hooks/useHashRoute.js';
import LoginGate from './components/LoginGate.jsx';
import Topbar from './components/Topbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatsPage from './components/ChatsPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ChatbotBuilderPage from './pages/ChatbotBuilderPage.jsx';
import TemplateBuilderPage from './pages/TemplateBuilderPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import BulkMessagePage from './pages/BulkMessagePage.jsx';
import AdminSettingsPage from './pages/AdminSettingsPage.jsx';
import MediaLibraryPage from './pages/MediaLibraryPage.jsx';
import AboutUsPage from './pages/AboutUsPage.jsx';
import PipelinesPage from './pages/PipelinesPage.jsx';

const VALID_PAGES = new Set([
  'home', 'chatbot-builder', 'template-builder', 'chats',
  'contacts', 'pipelines', 'bulk-message', 'admin-settings', 'media-library', 'about',
]);

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [routeParts, navigate, replaceRoute] = useHashRoute();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const page = VALID_PAGES.has(routeParts[0]) ? routeParts[0] : 'home';
  const subParts = routeParts.slice(1);
  const setPage = (p) => navigate(p);

  // Normalize empty hash to #/home so reload always shows a valid URL
  useEffect(() => {
    if (!routeParts[0]) replaceRoute('home');
  }, [routeParts, replaceRoute]);

  // Page guard: non-admins can only reach pages granted to them (user.pages).
  // admin-settings is allowed if they have any admin-settings:* sub-page.
  useEffect(() => {
    if (!user || user.role === 'admin' || !Array.isArray(user.pages)) return;
    const allowed = page === 'admin-settings'
      ? user.pages.some(p => p.startsWith('admin-settings'))
      : user.pages.includes(page);
    if (!allowed) setPage('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user]);

  useEffect(() => {
    // Collapse main sidebar by default on automation builder page
    if (page === 'chatbot-builder') {
      setSidebarCollapsed(true);
    }
  }, [page]);

  useEffect(() => {
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
    setPage('home');
  };

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        background: C.pageBg,
      }}>
        <div style={{ fontSize: 13, color: C.textMuted, fontWeight: 500 }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginGate onLogin={setUser} />;
  }

  const renderPage = () => {
    switch (page) {
      case 'home': return <HomePage user={user} onPageChange={setPage} />;
      case 'chats': return <ChatsPage subParts={subParts} navigate={navigate} user={user} />;
      case 'contacts': return <ContactsPage user={user} />;
      case 'pipelines': return <PipelinesPage user={user} />;
      case 'template-builder': return <TemplateBuilderPage />;
      case 'media-library': return <MediaLibraryPage />;
      case 'bulk-message': return <BulkMessagePage />;
      case 'chatbot-builder': return <ChatbotBuilderPage subParts={subParts} navigate={navigate} />;
      case 'about': return <AboutUsPage />;
      case 'admin-settings': return <AdminSettingsPage onLogout={handleLogout} onNavigate={setPage} subParts={subParts} navigate={navigate} user={user} />;
      default: return <HomePage user={user} onPageChange={setPage} />;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: FONT,
      background: C.pageBg,
    }}>
      <Topbar user={user} onLogout={handleLogout} onNavigate={setPage} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {page !== 'admin-settings' && (
          <Sidebar
            activePage={page}
            onPageChange={setPage}
            collapsed={sidebarCollapsed}
            setCollapsed={setSidebarCollapsed}
            user={user}
          />
        )}
        <div style={{ flex: 1, overflow: 'auto', background: C.pageBg, display: 'flex', flexDirection: 'column' }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
