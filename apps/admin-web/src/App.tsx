import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StoreProvider } from './lib/store';
import { DashboardPage } from './pages/DashboardPage';
import { TopologyPage } from './pages/TopologyPage';
import { MachinesPage } from './pages/MachinesPage';
import { ArtifactsPage } from './pages/ArtifactsPage';
import { VendorPage } from './pages/VendorPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { ConsolePage } from './pages/ConsolePage';

export function App() {
  return (
    <StoreProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/topology" element={<TopologyPage />} />
          <Route path="/machines" element={<MachinesPage />} />
          <Route path="/machines/:id" element={<MachinesPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/vendor" element={<VendorPage />} />
          <Route path="/procurement" element={<ProcurementPage />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </StoreProvider>
  );
}
