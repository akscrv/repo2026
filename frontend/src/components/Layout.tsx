import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import SessionStatus from './SessionStatus';
import ProfileImage from './ProfileImage';
import { notificationsAPI } from '../services/api';
import {
  HomeIcon,
  UsersIcon,
  UserCircleIcon,
  Bars3Icon,
  XMarkIcon,
  DocumentArrowUpIcon,
  MagnifyingGlassIcon,
  KeyIcon,
  BellIcon,
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
  CurrencyDollarIcon,
  QrCodeIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  ChartBarIcon,
  PhoneIcon,
  ClipboardDocumentListIcon,
  ServerIcon
} from '@heroicons/react/24/outline';
import { 
  ChartBarIcon as ChartBarSolid 
} from '@heroicons/react/24/solid';

interface LayoutProps {
  children: React.ReactNode;
}

const getNavigation = (userRole?: string) => {
  const baseNavigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  ];

  // Add role-specific navigation items
  if (userRole === 'superSuperAdmin' || userRole === 'superAdmin' || userRole === 'admin') {
    baseNavigation.push({ 
      name: 'Users', 
      href: '/users', 
      icon: UsersIcon
    });
    baseNavigation.push({ 
      name: 'Excel Files', 
      href: '/excel-files', 
      icon: DocumentArrowUpIcon
    });
  }

  // Add App Management for SuperSuperAdmin only
  if (userRole === 'superSuperAdmin') {
    baseNavigation.push({ 
      name: 'App Management', 
      href: '/app-management', 
      icon: Cog6ToothIcon
    });
    baseNavigation.push({ 
      name: 'File Storage Handling', 
      href: '/file-storage-handling', 
      icon: DocumentArrowUpIcon
    });
    baseNavigation.push({ 
      name: 'Storage Management', 
      href: '/storage-management', 
      icon: ServerIcon
    });
  }

  // Add admin-specific features (non-payment related)
  if (userRole === 'admin' || userRole === 'superAdmin' || userRole === 'superSuperAdmin') {
    baseNavigation.push({ 
      name: 'Money Management', 
      href: '/money', 
      icon: CurrencyDollarIcon
    });
    baseNavigation.push({ 
      name: 'OTP Management', 
      href: '/otp-management', 
      icon: KeyIcon
    });
    baseNavigation.push({ 
      name: 'Notifications', 
      href: '/notifications', 
      icon: BellIcon
    });
  }

  // Add Notifications for auditors (see same notifications as their admin)
  if (userRole === 'auditor') {
    baseNavigation.push({ 
      name: 'Notifications', 
      href: '/notifications', 
      icon: BellIcon
    });
  }

  // Add Back Office Numbers only for Admin role
  if (userRole === 'admin') {
    baseNavigation.push({ 
      name: 'Back Office Numbers', 
      href: '/back-office-numbers', 
      icon: PhoneIcon
    });
  }

  // Add Inventory for Admin, Auditor, and Field Agent
  if (userRole === 'admin' || userRole === 'auditor' || userRole === 'fieldAgent') {
    baseNavigation.push({ 
      name: 'Inventory', 
      href: '/inventory', 
      icon: ClipboardDocumentListIcon
    });
  }

  if (userRole === 'auditor') {
    baseNavigation.push({ 
      name: 'Money Management', 
      href: '/money', 
      icon: CurrencyDollarIcon
    });
    baseNavigation.push({ 
      name: 'Field Agents', 
      href: '/users', 
      icon: UsersIcon
    });
  }

  if (userRole === 'fieldAgent') {
    baseNavigation.push({ 
      name: 'Money Management', 
      href: '/money', 
      icon: CurrencyDollarIcon
    });
  }

  // Add common navigation items
  baseNavigation.push({
    name: 'Vehicle Search', 
    href: '/vehicle-search', 
    icon: MagnifyingGlassIcon
  });

  return baseNavigation;
};

const getPaymentNavigation = (userRole?: string) => {
  const paymentItems = [];

  // Add payment items for super super admin
  if (userRole === 'superSuperAdmin') {
    paymentItems.push({ 
      name: 'Payment Management', 
      href: '/admin-payments', 
      icon: CurrencyDollarIcon,
      category: 'Team Payments'
    });
    paymentItems.push({ 
      name: 'QR Code Management', 
      href: '/qr-management', 
      icon: QrCodeIcon,
      category: 'QR Management'
    });
    paymentItems.push({ 
      name: 'Payment Approval', 
      href: '/payment-approval', 
      icon: CheckCircleIcon,
      category: 'Approvals'
    });
    paymentItems.push({ 
      name: 'Admin Payment Management', 
      href: '/admin-payment-management', 
      icon: CurrencyDollarIcon,
      category: 'Admin Payments'
    });
    paymentItems.push({ 
      name: 'SuperSuperAdmin Payment Management', 
      href: '/super-super-admin-payments', 
      icon: CurrencyDollarIcon,
      category: 'Super Admin Payments'
    });
  }

  // Add payment items for super admin
  if (userRole === 'superAdmin') {
    // paymentItems.push({ 
    //   name: 'Payment Management', 
    //   href: '/admin-payments', 
    //   icon: CurrencyDollarIcon,
    //   category: 'Team Payments'
    // });
    paymentItems.push({ 
      name: 'QR Code Management', 
      href: '/qr-management', 
      icon: QrCodeIcon,
      category: 'QR Management'
    });
    paymentItems.push({ 
      name: 'Payment Approval', 
      href: '/payment-approval', 
      icon: CheckCircleIcon,
      category: 'Approvals'
    });
    paymentItems.push({ 
      name: 'Admin Payment Management', 
      href: '/admin-payment-management', 
      icon: CurrencyDollarIcon,
      category: 'Admin Payments'
    });
    paymentItems.push({ 
      name: 'My SuperSuperAdmin Payments', 
      href: '/super-admin-my-payments', 
      icon: CurrencyDollarIcon,
      category: 'My Payments'
    });
  }

  // Add payment items for admin
  if (userRole === 'admin') {
    paymentItems.push({ 
      name: 'Payment Management', 
      href: '/admin-payments', 
      icon: CurrencyDollarIcon,
      category: 'Team Payments'
    });
    paymentItems.push({ 
      name: 'QR Code Management', 
      href: '/qr-management', 
      icon: QrCodeIcon,
      category: 'QR Management'
    });
    paymentItems.push({ 
      name: 'Payment Approval', 
      href: '/payment-approval', 
      icon: CheckCircleIcon,
      category: 'Approvals'
    });
    paymentItems.push({ 
      name: 'My Admin Payments', 
      href: '/admin-my-payments', 
      icon: CurrencyDollarIcon,
      category: 'My Payments'
    });
  }

  // Add payment items for auditor
  if (userRole === 'auditor') {
    paymentItems.push({ 
      name: 'My Payments', 
      href: '/user-payments', 
      icon: CurrencyDollarIcon,
      category: 'My Payments'
    });
    paymentItems.push({ 
      name: 'Payment Submission', 
      href: '/payment-submission', 
      icon: QrCodeIcon,
      category: 'Submissions'
    });
  }

  // Add payment items for field agent
  if (userRole === 'fieldAgent') {
    paymentItems.push({ 
      name: 'My Payments', 
      href: '/user-payments', 
      icon: CurrencyDollarIcon,
      category: 'My Payments'
    });
    paymentItems.push({ 
      name: 'Payment Submission', 
      href: '/payment-submission', 
      icon: QrCodeIcon,
      category: 'Submissions'
    });
  }

  return paymentItems;
};

const getRoleBadgeColor = (role?: string) => {
  switch (role) {
    case 'superSuperAdmin':
      return 'bg-gradient-to-r from-yellow-400 to-orange-500 text-white';
    case 'superAdmin':
      return 'bg-gradient-to-r from-pink-500 to-red-500 text-white';
    case 'admin':
      return 'bg-gradient-to-r from-blue-500 to-purple-600 text-white';
    case 'fieldAgent':
      return 'bg-gradient-to-r from-green-500 to-emerald-600 text-white';
    case 'auditor':
      return 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getPageTitle = (pathname: string, navigation: any[]) => {
  const currentPage = navigation.find(item => item.href === pathname);
  return currentPage?.name || 'Dashboard';
};

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [paymentsDropdownOpen, setPaymentsDropdownOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Close user menu and payment dropdown when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!target.closest('.user-menu')) {
      setUserMenuOpen(false);
    }
    if (!target.closest('.payment-dropdown') && !target.closest('.payment-dropdown-button')) {
      setPaymentsDropdownOpen(false);
    }
  };

  // Add click outside listener
  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const navigation = getNavigation(user?.role);
  const paymentNavigation = getPaymentNavigation(user?.role);
  const pageTitle = getPageTitle(location.pathname, [...navigation, ...paymentNavigation]);

  // Check if current page is a payment page
  const isPaymentPage = paymentNavigation.some(item => item.href === location.pathname);

  // Check if user has access to notifications
  const hasNotificationAccess = user && ['admin', 'superAdmin', 'superSuperAdmin', 'auditor'].includes(user.role);

  // Fetch notification stats for unread count
  const { data: notificationStats } = useQuery({
    queryKey: ['notification-stats'],
    queryFn: () => notificationsAPI.getStats(),
    enabled: !!hasNotificationAccess,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const unreadCount = notificationStats?.data?.data?.unread || 0;

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // Group payment items by category
  const groupedPayments = paymentNavigation.reduce((acc, item) => {
    const category = item.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, typeof paymentNavigation>);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
            onClick={() => setSidebarOpen(false)} 
          />
          <div className="fixed inset-y-0 left-0 w-80 bg-white shadow-2xl flex flex-col h-screen">
            {/* Mobile sidebar header */}
                         <div className="flex h-16 items-center justify-between px-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center">
                <div className="h-10 w-10 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                  <ChartBarSolid className="h-6 w-6 text-white" />
                </div>
                <span className="ml-3 text-xl font-bold text-gradient">RepoTrack</span>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-200 p-2 rounded-lg hover:bg-gray-100"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Mobile navigation - scrollable */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll min-h-0">
                             <nav className="px-3 py-3 space-y-2">
                {/* Main Navigation */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">Main</h3>
                  {navigation.map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                      <Link
                        key={item.name}
                        to={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                      >
                        <item.icon className="h-5 w-5 flex-shrink-0" />
                        <div className="flex-1">
                          <div className="font-medium">{item.name}</div>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Payments Section */}
                {paymentNavigation.length > 0 && (
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">Payments</h3>
                    <button
                      onClick={() => setPaymentsDropdownOpen(!paymentsDropdownOpen)}
                      className={`nav-item w-full text-left payment-dropdown-button ${isPaymentPage ? 'active' : ''}`}
                    >
                      <CurrencyDollarIcon className="h-5 w-5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium">Payment Center</div>
                      </div>
                      <ChevronDownIcon className={`h-4 w-4 transition-transform ${paymentsDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                                         <div className={`payment-dropdown ${paymentsDropdownOpen ? 'open' : ''}`}>
                       <div className="space-y-1">
                         {paymentNavigation.map((item) => {
                           const isActive = location.pathname === item.href;
                           return (
                             <Link
                               key={item.name}
                               to={item.href}
                               onClick={() => {
                                 setSidebarOpen(false);
                                 setPaymentsDropdownOpen(false);
                               }}
                               className={`nav-item ${isActive ? 'active' : ''}`}
                             >
                               <item.icon className="h-4 w-4 flex-shrink-0" />
                               <div className="flex-1">
                                 <div className="font-medium text-sm">{item.name}</div>
                               </div>
                             </Link>
                           );
                         })}
                       </div>
                     </div>
                  </div>
                )}
              </nav>
            </div>

                         {/* Mobile user section - fixed at bottom */}
                                      <div className="border-t border-gray-200 p-4 flex-shrink-0 bg-gray-50">
                              <div className="flex items-center space-x-3 mb-4">
                 {user && <ProfileImage user={user} />}
                 <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{user?.name}</p>
                  <p className="text-sm text-gray-500 truncate">{user?.email}</p>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-1 ${
                    user?.role === 'superSuperAdmin' ? 'bg-orange-100 text-orange-800' :
                    user?.role === 'superAdmin' ? 'bg-red-100 text-red-800' :
                    user?.role === 'admin' ? 'bg-blue-100 text-blue-800' :
                    user?.role === 'fieldAgent' ? 'bg-green-100 text-green-800' :
                    user?.role === 'auditor' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {user?.role?.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Link
                  to="/profile"
                  onClick={() => setSidebarOpen(false)}
                  className="btn btn-outline-primary btn-sm w-full"
                >
                  <UserCircleIcon className="h-4 w-4 mr-2" />
                  Profile
                </Link>
                <button
                  onClick={handleLogout}
                  className="btn btn-outline btn-sm w-full"
                >
                  <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      {desktopSidebarOpen && (
        <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-80 lg:flex-col lg:h-screen">
                   <div className="flex flex-col h-full bg-white border-r-2 border-gray-300 shadow-sm">
                    {/* Desktop sidebar header */}
                        <div className="flex h-16 items-center px-6 border-b-2 border-gray-300 flex-shrink-0">
            <div className="flex items-center">
              <div className="h-10 w-10 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center">
                <ChartBarSolid className="h-6 w-6 text-white" />
              </div>
              <span className="ml-3 text-xl font-bold text-gray-900">RepoTrack</span>
            </div>
          </div>

          {/* Desktop navigation - scrollable */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll min-h-0">
                         <nav className="px-3 py-3 space-y-3">
              {/* Main Navigation */}
                             <div className="space-y-1">
                 <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">Main</h3>
                {navigation.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                    >
                                           <item.icon className="h-5 w-5 flex-shrink-0" />
                     <div className="flex-1">
                       <div className="font-medium">{item.name}</div>
                     </div>
                    </Link>
                  );
                })}
              </div>

              {/* Payments Section */}
              {paymentNavigation.length > 0 && (
                                 <div className="space-y-1">
                   <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">Payments</h3>
                                     <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-2 border-2 border-blue-300">
                    <button
                      onClick={() => setPaymentsDropdownOpen(!paymentsDropdownOpen)}
                      className={`nav-item w-full text-left payment-dropdown-button ${isPaymentPage ? 'active' : ''} bg-white/80 backdrop-blur-sm`}
                    >
                      <CurrencyDollarIcon className="h-5 w-5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium">Payment Center</div>
                      </div>
                      <ChevronDownIcon className={`h-4 w-4 transition-transform ${paymentsDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                                         <div className={`payment-dropdown ${paymentsDropdownOpen ? 'open' : ''}`}>
                       <div className="mt-2 space-y-1">
                         {paymentNavigation.map((item) => {
                           const isActive = location.pathname === item.href;
                           return (
                             <Link
                               key={item.name}
                               to={item.href}
                               onClick={() => setPaymentsDropdownOpen(false)}
                               className={`nav-item ${isActive ? 'active' : ''} bg-white/60 backdrop-blur-sm`}
                             >
                               <item.icon className="h-4 w-4 flex-shrink-0" />
                               <div className="flex-1">
                                 <div className="font-medium text-sm">{item.name}</div>
                               </div>
                             </Link>
                           );
                         })}
                       </div>
                     </div>
                  </div>
                </div>
              )}
            </nav>
          </div>

                     {/* Desktop user section - fixed at bottom */}
           <div className="border-t border-gray-200 p-4 flex-shrink-0 bg-gray-50">
            <div className="flex items-center space-x-3 mb-3">
              {user && <ProfileImage user={user} />}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{user?.name}</p>
                <p className="text-sm text-gray-500 truncate">{user?.email}</p>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full mt-1 ${
                  user?.role === 'superSuperAdmin' ? 'bg-orange-100 text-orange-800' :
                  user?.role === 'superAdmin' ? 'bg-red-100 text-red-800' :
                  user?.role === 'admin' ? 'bg-blue-100 text-blue-800' :
                  user?.role === 'fieldAgent' ? 'bg-green-100 text-green-800' :
                  user?.role === 'auditor' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {user?.role?.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Link
                to="/profile"
                className="btn btn-outline-primary btn-sm w-full"
              >
                <UserCircleIcon className="h-4 w-4 mr-2" />
                Profile
              </Link>
              <button
                onClick={handleLogout}
                className="btn btn-danger btn-sm w-full"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Main content */}
      <div className={`${desktopSidebarOpen ? 'lg:pl-80' : 'lg:pl-0'}`}>
        {/* Top navigation bar */}
                 <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm backdrop-blur-sm">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-4">
              <button
                type="button"
                className="text-gray-600 hover:text-gray-900 lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200"
                onClick={() => setSidebarOpen(true)}
              >
                <Bars3Icon className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="text-gray-600 hover:text-gray-900 hidden lg:block p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200"
                onClick={() => setDesktopSidebarOpen(!desktopSidebarOpen)}
                title={desktopSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
              >
                {desktopSidebarOpen ? (
                  <XMarkIcon className="h-6 w-6" />
                ) : (
                  <Bars3Icon className="h-6 w-6" />
                )}
              </button>
              
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{pageTitle}</h1>

              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Session Status */}
              <SessionStatus className="hidden md:flex" />
              
              {/* Notification Icon with Badge */}
              {hasNotificationAccess && (
                <Link
                  to="/notifications"
                  className="relative p-2 text-gray-600 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-100"
                  title={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                >
                  <BellIcon className="h-6 w-6" />
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 flex min-w-[20px] h-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white px-1 transform translate-x-1/2 -translate-y-1/2 shadow-lg border-2 border-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Link>
              )}
              
              {/* Weather widget */}
              <div className="hidden md:flex items-center space-x-2 bg-gray-100 rounded-lg px-3 py-2">
                <div className="relative">
                  <div className="w-6 h-6 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                  </div>
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full flex items-center justify-center text-xs text-white font-bold">
                    9+
                  </div>
                </div>
                <div className="text-sm">
                  <div className="font-medium">28°C</div>
                  <div className="text-gray-500 text-xs">Partly cloudy</div>
                </div>
              </div>

              {/* User menu */}
              <div className="relative user-menu">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors"
                >
                  {user && <ProfileImage user={user} />}
                  <span className="hidden md:block font-medium">{user?.name}</span>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50">
                    <Link
                      to="/profile"
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <UserCircleIcon className="h-4 w-4 inline mr-2" />
                      Profile
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <ArrowRightOnRectangleIcon className="h-4 w-4 inline mr-2" />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}

