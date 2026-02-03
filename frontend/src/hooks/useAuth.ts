import React, { useState, useEffect, createContext, useContext } from 'react'
import { authAPI } from '../services/api'

interface User {
  _id: string
  name: string
  email: string
  phone: string
  role: 'superSuperAdmin' | 'superAdmin' | 'admin' | 'fieldAgent' | 'auditor'
  location: {
    city: string
    state: string
  }
  isActive: boolean
  createdAt: string
  lastLogin?: string
  profileImage?: string | null
  createdBy?: {
    _id: string
    name: string
    email: string
  }
  canShareFiles?: boolean
  allowedSharingAdmins?: Array<{
    _id: string
    name: string
    email: string
  }>
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (emailOrPhone: string, password: string) => Promise<void>
  loginWithOTP: (token: string, user: User) => void
  logout: () => Promise<void>
  forceLogout: () => Promise<void>
  updateProfile: (data: any) => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Function to clear auth data
  const clearAuthData = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  // Function to handle session invalidation
  const handleSessionInvalidation = () => {
    clearAuthData()
    // Redirect to login page
    window.location.href = '/login'
  }

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token')
      const savedUser = localStorage.getItem('user')

      if (token && savedUser) {
        try {
          // Validate session with backend
          const response = await authAPI.validateSession()
          setUser(response.data.data.user)
        } catch (error: any) {
          // If session is invalid, clear auth data
          if (error.response?.status === 401) {
            const errorMessage = error.response?.data?.message
            if (errorMessage?.includes('Session invalidated') || 
                errorMessage?.includes('Session expired')) {
              console.log('Session invalidated from another device')
              handleSessionInvalidation()
              return
            }
          }
          clearAuthData()
        }
      }
      setLoading(false)
    }

    initAuth()
  }, [])

  const login = async (emailOrPhone: string, password: string) => {
    const response = await authAPI.login({ emailOrPhone, password })
    const { token, user } = response.data.data
    
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)
  }

  const loginWithOTP = (token: string, user: User) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    setUser(user)
  }

  const logout = async () => {
    try {
      await authAPI.logout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearAuthData()
    }
  }

  const forceLogout = async () => {
    try {
      await authAPI.forceLogout()
    } catch (error) {
      console.error('Force logout error:', error)
    } finally {
      clearAuthData()
    }
  }

  const updateProfile = async (data: any) => {
    const response = await authAPI.updateProfile(data)
    const updatedUser = response.data.data
    setUser(updatedUser)
    localStorage.setItem('user', JSON.stringify(updatedUser))
  }

  const value = {
    user,
    loading,
    login,
    loginWithOTP,
    logout,
    forceLogout,
    updateProfile,
  }

  return React.createElement(AuthContext.Provider, { value }, children)
} 