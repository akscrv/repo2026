import axios from 'axios'

// Get API URL dynamically based on environment
const getApiBaseUrl = () => {
  // Check if we're running through ngrok
  const currentHost = window.location.hostname;
  
  if (currentHost.includes('ngrok-free.app') || 
      currentHost.includes('ngrok.io') || 
      currentHost.includes('ngrok.app')) {
    // Use the same host for API calls when running through ngrok
    return `${window.location.protocol}//${currentHost}/api`;
  }
  
  // In production, use the same host as the frontend
  if (process.env.NODE_ENV === 'production' || window.location.hostname !== 'localhost') {
    return `${window.location.protocol}//${window.location.host}/api`;
  }
  
  // Use environment variable or default for development
  return (import.meta as any).env?.VITE_API_URL || 'http://localhost:5000/api';
};

const API_BASE_URL = getApiBaseUrl();
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})



// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle auth errors and storage quota errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle storage quota exceeded (507)
    if (error.response?.status === 507) {
      const errorMessage = error.response?.data?.message || 'Storage quota exceeded'
      // This will be handled by individual components, but we can add a global handler here if needed
      console.error('Storage quota exceeded:', errorMessage)
    }
    
    if (error.response?.status === 401) {
      const errorMessage = error.response?.data?.message
      
      // Handle session invalidation specifically
      if (errorMessage?.includes('Session invalidated') || 
          errorMessage?.includes('Session expired')) {
        // Clear auth data
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        
        // Show user-friendly message
        if (typeof window !== 'undefined') {
          // Only show alert if we're in browser environment
          alert('You have been logged out because you logged in from another device.')
          window.location.href = '/login'
        }
      } else {
        // For login errors, don't redirect - let the component handle the error
        // Only redirect for authenticated requests that fail
        const isLoginRequest = error.config?.url?.includes('/auth/login')
        if (!isLoginRequest && typeof window !== 'undefined') {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: (data: { emailOrPhone: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: any) => api.post('/auth/register', data),
  getProfile: () => api.get('/auth/me'),
  getProfileDetails: () => api.get('/auth/profile-details'),
  updateProfile: (data: any) => api.put('/auth/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/auth/change-password', data),
  uploadProfileImage: (formData: FormData) => api.post('/auth/upload-profile-image', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),
  removeProfileImage: () => api.delete('/auth/remove-profile-image'),
  logout: () => api.post('/auth/logout'),
  validateSession: () => api.get('/auth/validate-session'),
  updateOnlineStatus: () => api.post('/auth/update-online-status'),
  updateOfflineStatus: () => api.post('/auth/update-offline-status'),
  checkOnlineStatus: () => api.post('/auth/check-online-status'),
  forceLogout: () => api.post('/auth/force-logout'),
}

// Users API
export const usersAPI = {
  getAll: (params?: any) => api.get('/users', { params }),
  getById: (id: string) => api.get(`/users/${id}`),
  create: (data: any) => api.post('/users', data),
  update: (id: string, data: any) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  updatePassword: (id: string, data: { newPassword: string }) => api.put(`/users/${id}/password`, data),
  updateStatus: (id: string, data: { isActive: boolean }) => api.put(`/users/${id}/status`, data),
  updateSharingPermission: (id: string, data: { canShareFiles: boolean; allowedSharingAdmins?: string[] }) => api.put(`/users/${id}/sharing-permission`, data),
  requestSharingPermission: () => api.post('/users/request-sharing-permission'),
  getSharingPermissionRequests: () => api.get('/users/sharing-permission-requests'),
  getFieldAgents: () => api.get('/users/field-agents/list'),
  getAdmins: () => api.get('/users/admins/list'),
  getByAdmin: (adminId: string) => api.get(`/users/by-admin/${adminId}`),
  getStats: () => api.get('/users/stats/overview'),
}



// Excel API
export const excelAPI = {
  upload: (formData: FormData) => api.post('/excel/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),
  getFiles: (params?: any) => api.get('/excel/files', { params }),
  getFileById: (id: string) => api.get(`/excel/files/${id}`),
  deleteFile: (id: string) => api.delete(`/excel/files/${id}`),
  reassignFile: (id: string, data: { assignedTo: string }) => api.put(`/excel/files/${id}/reassign`, data),
  updateAssignments: (id: string, data: { assignedAdmins: string[] }) => api.put(`/excel/files/${id}/update-assignments`, data),
  updateSharedAdmins: (id: string, data: { sharedAdmins: string[] }) => api.put(`/excel/files/${id}/update-shared-admins`, data),
  downloadTemplate: () => api.get('/excel/template', { responseType: 'blob' }),
  searchVehicles: (params?: any) => api.get('/excel/vehicles', { params }),
  getVehicleDetails: (id: string) => api.get(`/excel/vehicles/${id}/details`),
  preCacheFiles: () => api.post('/excel/pre-cache-files'),
  getCacheDetails: () => api.get('/excel/cache-details'),
}

// OTP API
export const otpAPI = {
  generate: (userId: string) => api.post('/otp/generate', { userId }),
  verify: (emailOrPhone: string, otp: string) => api.post('/otp/verify', { emailOrPhone, otp }),
  view: (userId: string) => api.get(`/otp/view/${userId}`),
  list: () => api.get('/otp/list'),
  invalidate: (userId: string) => api.delete(`/otp/invalidate/${userId}`),
}

// Notifications API
export const notificationsAPI = {
  logAction: (data: { vehicleNumber: string; action: 'viewed' | 'verified' | 'searched'; vehicleId?: string; excelFileId?: string }) => 
    api.post('/notifications/log-action', data),
  getAll: (params?: any) => api.get('/notifications', { params }),
  markAsRead: (id: string) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/mark-all-read'),
  getStats: () => api.get('/notifications/stats'),
}

// Payments API
export const paymentsAPI = {
  // Admin payment management
  getRates: () => api.get('/payments/rates'),
  updateRates: (data: { auditorRate: number; fieldAgentRate: number }) => 
    api.put('/payments/rates', data),
  getAdminSummary: (params?: any) => api.get('/payments/admin-summary', { params }),
  getAdminDetails: (params?: any) => api.get('/payments/admin-details', { params }),
  markPaymentAsPaid: (paymentId: string, data: { paidAmount: number; notes?: string }) =>
    api.put(`/payments/${paymentId}/mark-paid`, data),
  generateMonthlyPayments: (data: { month: number; year: number }) =>
    api.post('/payments/generate-monthly', data),
  
  // User payment dues
  getUserDues: (params?: any) => api.get('/payments/user-dues', { params }),
}

// Money Management API
export const moneyAPI = {
  // CRUD operations
  getAll: (params?: any) => api.get('/money', { params }),
  getById: (id: string) => api.get(`/money/${id}`),
  create: (data: any) => api.post('/money', data),
  update: (id: string, data: any) => api.put(`/money/${id}`, data),
  delete: (id: string) => api.delete(`/money/${id}`),
  deleteAll: () => api.delete('/money/delete-all'),
  
  // Import/Export
  import: (formData: FormData) => api.post('/money/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  export: (params?: any) => api.get('/money/export', { 
    params,
    responseType: 'blob'
  }),
  
  // Vehicle lookup helper
  getVehicleByReg: (registrationNumber: string) => 
    api.get(`/excel/vehicles/by-reg/${registrationNumber}`)
}

// File Storage API
export const fileStorageAPI = {
  getSettings: () => api.get('/file-storage/settings'),
  getSettingByRole: (role: string) => api.get(`/file-storage/settings/${role}`),
  updateSetting: (role: string, data: any) => api.put(`/file-storage/settings/${role}`, data),
  getMyLimits: () => api.get('/file-storage/my-limits'),
  getManagementData: () => api.get('/file-storage/management'),
  getAdminLimits: () => api.get('/file-storage/admin-limits'),
  setUserLimit: (data: { userId: string; totalRecordLimit: number; description?: string }) => 
    api.post('/file-storage/user-limit', data),
  updateUserLimit: (userId: string, data: { totalRecordLimit: number; description?: string }) => 
    api.put(`/file-storage/user-limit/${userId}`, data),
  deleteUserLimit: (userId: string) => api.delete(`/file-storage/user-limit/${userId}`),
}

// Payment QR API
export const paymentQRAPI = {
  // Get QR codes
  getQR: () => api.get('/payment-qr/qr'),
  getAdminQR: () => api.get('/payment-qr/admin/qr'),
  getSuperAdminQR: () => api.get('/payment-qr/super-admin/qr'),
  
  // Upload QR codes
  uploadQR: (formData: FormData) => api.post('/payment-qr/qr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  uploadAdminQR: (formData: FormData) => api.post('/payment-qr/admin/qr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  uploadSuperAdminQR: (formData: FormData) => api.post('/payment-qr/super-admin/qr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  
  // Toggle QR status
  toggleActive: (qrId: string) => api.put(`/payment-qr/admin/qr/${qrId}/toggle-active`),
  toggleSuperAdminActive: (qrId: string) => api.put(`/payment-qr/super-admin/qr/${qrId}/toggle-active`),
  
  // Delete QR codes
  deleteQR: (qrId: string) => api.delete(`/payment-qr/admin/qr/${qrId}`),
  deleteSuperAdminQR: (qrId: string) => api.delete(`/payment-qr/super-admin/qr/${qrId}`),
  
  // Payment proof management
  uploadProof: (formData: FormData) => api.post('/payment-qr/proof', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getPendingProofs: () => api.get('/payment-qr/admin/pending-proofs'),
  reviewProof: (proofId: string, data: { status: string; notes?: string }) => 
    api.put(`/payment-qr/proof/${proofId}/review`, data),
}

// Admin Payments API
export const adminPaymentsAPI = {
  getMyPayments: (params?: any) => api.get('/admin-payments/my-payments', { params }),
  getPaymentDetails: (paymentId: string) => api.get(`/admin-payments/payment-details/${paymentId}`),
  getPaymentStats: () => api.get('/admin-payments/stats'),
}

// Super Super Admin Payments API
export const superSuperAdminPaymentsAPI = {
  getMyPayments: (params?: any) => api.get('/super-super-admin-payments/my-payments', { params }),
  getPaymentDetails: (paymentId: string) => api.get(`/super-super-admin-payments/payment-details/${paymentId}`),
  getPaymentStats: () => api.get('/super-super-admin-payments/stats'),
}

// Back Office Numbers API
export const backOfficeNumbersAPI = {
  // Admin management
  getAdminNumbers: () => api.get('/back-office-numbers/admin'),
  createNumber: (data: { name: string; mobileNumber: string }) => 
    api.post('/back-office-numbers', data),
  updateNumber: (id: string, data: { name?: string; mobileNumber?: string; isActive?: boolean; order?: number }) => 
    api.put(`/back-office-numbers/${id}`, data),
  deleteNumber: (id: string) => api.delete(`/back-office-numbers/${id}`),
  toggleActive: (id: string) => api.put(`/back-office-numbers/${id}/toggle`),
  
  // Field agent access
  getFieldAgentNumbers: () => api.get('/back-office-numbers/field-agent'),
}

// Inventory API
export const inventoryAPI = {
  getFieldAgentInventories: () => api.get('/inventory/field-agent'),
  getAdminInventories: () => api.get('/inventory/admin'),
  getAuditorInventories: () => api.get('/inventory/auditor'),
  createInventory: (data: any) => api.post('/inventory', data),
  getInventory: (id: string) => api.get(`/inventory/${id}`),
  downloadInventory: (id: string) => api.get(`/inventory/${id}/download`, {
    responseType: 'arraybuffer'
  })
}

export default api 