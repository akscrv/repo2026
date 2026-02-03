import React from 'react';
import { UserIcon } from '@heroicons/react/24/outline';

interface ProfileImageProps {
  user: {
    name: string;
    profileImage?: string | null;
  };
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showBorder?: boolean;
}

export default function ProfileImage({ 
  user, 
  size = 'md', 
  className = '',
  showBorder = false 
}: ProfileImageProps) {
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'h-8 w-8 text-sm';
      case 'md':
        return 'h-10 w-10 text-base';
      case 'lg':
        return 'h-12 w-12 text-lg';
      case 'xl':
        return 'h-16 w-16 text-xl';
      default:
        return 'h-10 w-10 text-base';
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getImageUrl = (imagePath: string) => {
    // If the image path is already a full URL, return it as is
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      return imagePath;
    }
    
    // Get the backend server URL dynamically
    const getBackendUrl = () => {
      const currentHost = window.location.hostname;
      
      // Check if we're running through ngrok
      if (currentHost.includes('ngrok-free.app') || 
          currentHost.includes('ngrok.io') || 
          currentHost.includes('ngrok.app')) {
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
    
    const backendUrl = getBackendUrl();
    
    // Construct the full image URL
    return `${backendUrl}${imagePath}`;
  };

  const sizeClasses = getSizeClasses();
  const borderClasses = showBorder ? 'ring-2 ring-white shadow-lg' : '';

  if (user.profileImage) {
    return (
      <img
        src={getImageUrl(user.profileImage)}
        alt={`${user.name}'s profile`}
        className={`${sizeClasses} rounded-full object-cover ${borderClasses} ${className}`}
        onError={(e) => {
          // Fallback to initials if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          const parent = target.parentElement;
          if (parent) {
            const fallback = parent.querySelector('.profile-fallback') as HTMLElement;
            if (fallback) {
              fallback.style.display = 'flex';
            }
          }
        }}
      />
    );
  }

  return (
    <div className={`${sizeClasses} rounded-full bg-gradient-to-r from-gray-600 to-gray-800 flex items-center justify-center text-white font-medium ${borderClasses} ${className}`}>
      <span className="profile-fallback" style={{ display: 'flex' }}>
        {getInitials(user.name)}
      </span>
    </div>
  );
}
