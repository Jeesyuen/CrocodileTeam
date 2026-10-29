import { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { Logo } from "./components/Illustrations";
import { AuthProvider, homeFor, useAuth } from "./context/AuthContext";
import { NavigationProvider } from "./context/NavigationContext";
import { RealtimeProvider } from "./context/RealtimeContext";
import type { Role } from "./lib/types";
import AdminDashboard from "./pages/admin/AdminDashboard";
import Analytics from "./pages/admin/Analytics";
import HazardManagement from "./pages/admin/HazardManagement";
import MaintenanceAssignment from "./pages/admin/MaintenanceAssignment";
import Verification from "./pages/admin/Verification";
import HazardMap from "./pages/HazardMap";
import Login from "./pages/Login";
import TaskDetail from "./pages/maintenance/TaskDetail";
import Tasks from "./pages/maintenance/Tasks";
import MyReports from "./pages/MyReports";
import NavigatePage from "./pages/Navigate";
import Notifications from "./pages/Notifications";
import Overview from "./pages/Overview";
import Profile from "./pages/Profile";
import ReportHazard from "./pages/ReportHazard";
import TrafficForecast from "./pages/TrafficForecast";

function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) {
    return <div className="grid h-full place-items-center"><Logo className="h-12 w-12 animate-pulse" /></div>;
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

const COMMUNITY: Role[] = ["student", "driver"];
const ALL: Role[] = ["student", "driver", "operator", "maintenance"];

export default function App() {
  return (
    <AuthProvider>
      <RealtimeProvider>
        <NavigationProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Guard><AppLayout /></Guard>}>
              <Route index element={<Guard roles={COMMUNITY}><Overview /></Guard>} />
              <Route path="navigate" element={<Guard roles={["student", "driver", "operator"]}><NavigatePage /></Guard>} />
              <Route path="traffic" element={<Guard roles={["student", "driver", "operator"]}><TrafficForecast /></Guard>} />
              <Route path="hazards" element={<Guard roles={ALL}><HazardMap /></Guard>} />
              <Route path="report" element={<Guard roles={COMMUNITY}><ReportHazard /></Guard>} />
              <Route path="my-reports" element={<Guard roles={COMMUNITY}><MyReports /></Guard>} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="profile" element={<Profile />} />
              <Route path="admin" element={<Guard roles={["operator"]}><AdminDashboard /></Guard>} />
              <Route path="admin/verify" element={<Guard roles={["operator"]}><Verification /></Guard>} />
              <Route path="admin/hazards" element={<Guard roles={["operator"]}><HazardManagement /></Guard>} />
              <Route path="admin/maintenance" element={<Guard roles={["operator"]}><MaintenanceAssignment /></Guard>} />
              <Route path="admin/analytics" element={<Guard roles={["operator"]}><Analytics /></Guard>} />
              <Route path="tasks" element={<Guard roles={["maintenance"]}><Tasks /></Guard>} />
              <Route path="tasks/:id" element={<Guard roles={["maintenance"]}><TaskDetail /></Guard>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </NavigationProvider>
      </RealtimeProvider>
    </AuthProvider>
  );
}
