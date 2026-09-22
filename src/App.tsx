import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { NotFoundState } from '@/components/feedback/states';
import { SkeletonList } from '@/components/ui/skeleton';
import { AuthLoading, RequireAdmin, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordPages';
import { useAuth } from '@/features/auth/session';

/**
 * Routing.
 *
 * Everything below the shell is code-split. The split points are chosen around
 * *weight*, not tidiness: the face-recognition and OCR screens each pull in a
 * multi-megabyte runtime, and a manager who only ever looks at the dashboard
 * must never download either. See docs/ARCHITECTURE.md ("Performance").
 */

const ManagerHomePage = lazy(() => import('@/features/dashboard/ManagerHomePage'));
const AdminDashboardPage = lazy(() => import('@/features/dashboard/AdminDashboardPage'));

const AttendancePage = lazy(() => import('@/features/attendance/AttendancePage'));
const TakeAttendanceFlow = lazy(() => import('@/features/attendance/TakeAttendanceFlow'));

const TripsPage = lazy(() => import('@/features/trips/TripsPage'));
const StartTripFlow = lazy(() => import('@/features/trips/StartTripFlow'));
const EndTripFlow = lazy(() => import('@/features/trips/EndTripFlow'));
const TripDetailPage = lazy(() => import('@/features/trips/TripDetailPage'));

const FleetHomePage = lazy(() => import('@/features/fleet/FleetHomePage'));
const BusListPage = lazy(() => import('@/features/buses/BusListPage'));
const BusDetailPage = lazy(() => import('@/features/buses/BusDetailPage'));
const BusFormPage = lazy(() => import('@/features/buses/BusFormPage'));

const EmployeeListPage = lazy(() => import('@/features/employees/EmployeeListPage'));
const EmployeeDetailPage = lazy(() => import('@/features/employees/EmployeeDetailPage'));
const EmployeeFormPage = lazy(() => import('@/features/employees/EmployeeFormPage'));
const FaceEnrolmentPage = lazy(() => import('@/features/employees/FaceEnrolmentPage'));
const FacePhotosPage = lazy(() => import('@/features/employees/FacePhotosPage'));

const RouteListPage = lazy(() => import('@/features/routes/RouteListPage'));
const RouteFormPage = lazy(() => import('@/features/routes/RouteFormPage'));

const AlertsPage = lazy(() => import('@/features/anomalies/AlertsPage'));
const AnomalyDetailPage = lazy(() => import('@/features/anomalies/AnomalyDetailPage'));

const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const SearchPage = lazy(() => import('@/features/search/SearchPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const MorePage = lazy(() => import('@/features/settings/MorePage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

const ManagersPage = lazy(() => import('@/features/admin/ManagersPage'));
const DepotsPage = lazy(() => import('@/features/admin/DepotsPage'));
const AuditLogPage = lazy(() => import('@/features/admin/AuditLogPage'));
const ThresholdsPage = lazy(() => import('@/features/admin/ThresholdsPage'));

/** Admins land on the organisation overview; managers on their depot's day. */
function HomeRoute() {
  const { isAdmin, status } = useAuth();
  if (status === 'loading') return <AuthLoading />;
  return isAdmin ? <AdminDashboardPage /> : <ManagerHomePage />;
}

export function App() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireAuth />}>
          {/* Focused flows: no bottom navigation, no wandering off mid-task. */}
          <Route path="/attendance/take" element={<TakeAttendanceFlow />} />
          <Route path="/trips/start" element={<StartTripFlow />} />
          <Route path="/trips/:tripId/end" element={<EndTripFlow />} />
          <Route path="/fleet/drivers/:employeeId/faces" element={<FaceEnrolmentPage />} />

          <Route element={<AppShell />}>
            <Route index element={<HomeRoute />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/:tripId" element={<TripDetailPage />} />

            <Route path="/fleet" element={<FleetHomePage />} />
            <Route element={<RequirePermission permission="bus.view" />}>
              <Route path="/fleet/buses" element={<BusListPage />} />
              <Route path="/fleet/buses/new" element={<BusFormPage />} />
              <Route path="/fleet/buses/:busId" element={<BusDetailPage />} />
              <Route path="/fleet/buses/:busId/edit" element={<BusFormPage />} />
            </Route>
            <Route element={<RequirePermission permission="employee.view" />}>
              <Route path="/fleet/drivers" element={<EmployeeListPage />} />
              <Route path="/fleet/drivers/new" element={<EmployeeFormPage />} />
              <Route path="/fleet/drivers/:employeeId" element={<EmployeeDetailPage />} />
              <Route path="/fleet/drivers/:employeeId/photos" element={<FacePhotosPage />} />
              <Route path="/fleet/drivers/:employeeId/edit" element={<EmployeeFormPage />} />
            </Route>
            <Route element={<RequirePermission permission="route.view" />}>
              <Route path="/fleet/routes" element={<RouteListPage />} />
              <Route path="/fleet/routes/new" element={<RouteFormPage />} />
              <Route path="/fleet/routes/:routeId/edit" element={<RouteFormPage />} />
            </Route>

            <Route element={<RequirePermission permission="anomaly.view" />}>
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/alerts/:anomalyId" element={<AnomalyDetailPage />} />
            </Route>

            <Route element={<RequirePermission permission="report.view" />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route path="/search" element={<SearchPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/settings" element={<SettingsPage />} />

            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/managers" element={<ManagersPage />} />
              <Route path="/admin/depots" element={<DepotsPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
              <Route path="/admin/thresholds" element={<ThresholdsPage />} />
            </Route>

            <Route path="*" element={<NotFoundState />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/** Re-exported for tests that render a page inside the shell's skeleton. */
export { SkeletonList };
