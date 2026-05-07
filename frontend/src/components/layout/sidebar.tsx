import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Bot, Activity, Plug, Bell, BarChart3, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/auth-context';
import { Button } from '../ui/button';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/agents', label: 'Agents', icon: Bot, end: false },
  { to: '/executions', label: 'Executions', icon: Activity, end: false },
  { to: '/integrations', label: 'Integrations', icon: Plug, end: false },
  { to: '/notifications', label: 'Notifications', icon: Bell, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
];

export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 shrink-0 border-r border-gray-200 bg-white flex flex-col">
      <div className="px-4 py-5 border-b border-gray-200">
        <p className="text-sm font-semibold text-gray-900">Agent Operations</p>
        <p className="text-xs text-gray-500">Demo Portal</p>
      </div>
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-200 p-3">
        <div className="flex flex-col gap-1 mb-2">
          <p className="text-sm font-medium text-gray-900 truncate">{user?.name ?? 'Unknown'}</p>
          <p className="text-xs text-gray-500 truncate">{user?.email ?? ''}</p>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => void logout()}>
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
