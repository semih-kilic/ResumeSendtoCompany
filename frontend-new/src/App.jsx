import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import EmailsPage from './pages/EmailsPage';
import ApplicationsPage from './pages/ApplicationsPage';
import ScanPage from './pages/ScanPage';
import CampaignPage from './pages/CampaignPage';
import SaasCampaignPage from './pages/SaasCampaignPage';
import RepliesPage from './pages/RepliesPage';
import SettingsPage from './pages/SettingsPage';
import TemplatePage from './pages/TemplatePage';
import ProviderHealthPage from './pages/ProviderHealthPage';
import NotificationsPage from './pages/NotificationsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/emails" element={<EmailsPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/campaign" element={<CampaignPage />} />
        <Route path="/saas" element={<SaasCampaignPage />} />
        <Route path="/replies" element={<RepliesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/template" element={<TemplatePage />} />
        <Route path="/providers" element={<ProviderHealthPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>
    </Routes>
  );
}
