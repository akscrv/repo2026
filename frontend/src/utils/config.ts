// Backend configuration - dynamically detect production environment
const getBackendBaseUrl = () => {
  // Check if we're running through ngrok
  const currentHost = window.location.hostname;
  
  if (currentHost.includes('ngrok-free.app') || 
      currentHost.includes('ngrok.io') || 
      currentHost.includes('ngrok.app')) {
    // Use the same host for API calls when running through ngrok
    return `${window.location.protocol}//${currentHost}`;
  }
  
  // In production, use the same host as the frontend
  if (process.env.NODE_ENV === 'production' || window.location.hostname !== 'localhost') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  
  // Use environment variable or default for development
  const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';
  return apiUrl.replace('/api', '');
};

export const BACKEND_BASE_URL = getBackendBaseUrl();

// Helper function to get full image URL
export const getImageUrl = (imagePath: string): string => {
  if (!imagePath) return '';
  
  // If the path already starts with http, return as is
  if (imagePath.startsWith('http')) {
    return imagePath;
  }
  
  // If the path starts with /, append to backend base URL
  if (imagePath.startsWith('/')) {
    const fullUrl = `${BACKEND_BASE_URL}${imagePath}`;
    console.log('🔗 Generated image URL:', fullUrl);
    return fullUrl;
  }
  
  // Otherwise, append to backend base URL with /
  const fullUrl = `${BACKEND_BASE_URL}/${imagePath}`;
  console.log('🔗 Generated image URL:', fullUrl);
  return fullUrl;
};

// Helper function to get download URL for app files
export const getAppDownloadUrl = (appId: string): string => {
  return `${BACKEND_BASE_URL}/api/app-management/download/${appId}`;
};
