import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import { 
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  SignalIcon
} from '@heroicons/react/24/outline';

interface SessionStatusProps {
  className?: string;
}

export default function SessionStatus({ className = '' }: SessionStatusProps) {
  const { user } = useAuth();
  const [sessionStatus, setSessionStatus] = useState<'valid' | 'checking' | 'invalid'>('checking');
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  const checkSession = async () => {
    if (!user) return;
    
    try {
      setSessionStatus('checking');
      const response = await authAPI.validateSession();
      setSessionStatus('valid');
      setLastChecked(new Date());
    } catch (error: any) {
      if (error.response?.status === 401) {
        setSessionStatus('invalid');
        setIsOnline(false);
      }
    }
  };

  // Check and update online status based on activity
  const checkOnlineStatus = async () => {
    if (!user) return;
    
    try {
      const response = await authAPI.checkOnlineStatus();
      setIsOnline(response.data?.data?.user?.isOnline || false);
    } catch (error) {
      console.error('Failed to check online status:', error);
    }
  };

  // Update online status when user becomes active
  const updateOnlineStatus = async () => {
    if (!user) return;
    
    try {
      await authAPI.updateOnlineStatus();
      setIsOnline(true);
    } catch (error) {
      console.error('Failed to update online status:', error);
    }
  };

  useEffect(() => {
    if (user) {
      checkSession();
      checkOnlineStatus(); // Initial online status check
      
      // Check session every 5 minutes (300000ms)
      const sessionInterval = setInterval(checkSession, 300000);
      
      // Check online status every 5 minutes
      const onlineStatusInterval = setInterval(checkOnlineStatus, 300000);
      
      // Update online status when user is active (debounced)
      let activityTimeout: NodeJS.Timeout;
      const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
      const handleActivity = () => {
        clearTimeout(activityTimeout);
        activityTimeout = setTimeout(() => {
          updateOnlineStatus();
        }, 1000); // Debounce activity updates to 1 second
      };
      
      activityEvents.forEach(event => {
        document.addEventListener(event, handleActivity, { passive: true });
      });
      
      // Set user as online initially
      updateOnlineStatus();
      
      return () => {
        clearInterval(sessionInterval);
        clearInterval(onlineStatusInterval);
        clearTimeout(activityTimeout);
        activityEvents.forEach(event => {
          document.removeEventListener(event, handleActivity);
        });
      };
    }
  }, [user]);

  // Set user as offline when page is hidden or closed
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && user) {
        // User switched tabs or minimized browser - don't immediately set offline
        // Let the 5-minute check handle this
      } else if (!document.hidden && user) {
        // User returned to tab - update online status
        updateOnlineStatus();
      }
    };

    const handleBeforeUnload = () => {
      if (user) {
        // User is closing the page - set offline immediately
        const getApiUrl = () => {
          const currentHost = window.location.hostname;
          
          // Check if we're running through ngrok
          if (currentHost.includes('ngrok-free.app') || 
              currentHost.includes('ngrok.io') || 
              currentHost.includes('ngrok.app')) {
            return `${window.location.protocol}//${currentHost}/api`;
          }
          
          // In production, use the same host as the frontend
          if (process.env.NODE_ENV === 'production' || window.location.hostname !== 'localhost') {
            return `${window.location.protocol}//${window.location.host}/api`;
          }
          
          // Use environment variable or default for development
          return (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';
        };
        
        navigator.sendBeacon(`${getApiUrl()}/auth/update-offline-status`, JSON.stringify({}));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className={`flex items-center space-x-2 text-sm ${className}`}>
      {sessionStatus === 'checking' && (
        <>
          <ClockIcon className="h-4 w-4 text-yellow-500 animate-spin" />
          <span className="text-yellow-600">Checking...</span>
        </>
      )}
      
      {sessionStatus === 'valid' && (
        <>
          <div className="flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></div>
            <span className={isOnline ? 'text-green-600' : 'text-gray-600'}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </>
      )}
      
      {sessionStatus === 'invalid' && (
        <>
          <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
          <span className="text-red-600">Session expired</span>
        </>
      )}
      
      <span className="text-gray-400 text-xs">
        Last checked: {lastChecked.toLocaleTimeString()}
      </span>
      <span className="text-gray-400 text-xs">
        Next check: {new Date(lastChecked.getTime() + 300000).toLocaleTimeString()}
      </span>
    </div>
  );
}
