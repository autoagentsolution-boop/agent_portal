import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/app-layout';
import { ProtectedRoute } from './components/protected-route';
import { LoginPage } from './pages/auth/login-page';
import { RegisterPage } from './pages/auth/register-page';
import { AgentsPage } from './pages/agents/agents-page';
import { AgentDetailPage } from './pages/agents/agent-detail-page';
import { CreateAgentPage } from './pages/agents/create-agent-page';
import { DashboardPage } from './pages/dashboard/dashboard-page';
import { ExecutionDetailPage } from './pages/executions/execution-detail-page';
import { ExecutionsPage } from './pages/executions/executions-page';
import { IntegrationsPage } from './pages/integrations/integrations-page';
import { NotificationsPage } from './pages/notifications/notifications-page';
import { PlaceholderPage } from './pages/placeholder-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/agents', element: <AgentsPage /> },
      { path: '/agents/new', element: <CreateAgentPage /> },
      { path: '/agents/:id', element: <AgentDetailPage /> },
      { path: '/executions', element: <ExecutionsPage /> },
      { path: '/executions/:id', element: <ExecutionDetailPage /> },
      { path: '/integrations', element: <IntegrationsPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/analytics', element: <PlaceholderPage title="Analytics" phase="Phase 11" /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
