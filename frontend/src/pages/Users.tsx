import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersAPI } from '../services/api'
import toast from 'react-hot-toast'
import { 
  PlusIcon, 
  MagnifyingGlassIcon,
  FunnelIcon,
  TrashIcon,
  UserIcon,
  ShieldCheckIcon,
  UserGroupIcon,
  DocumentTextIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  UsersIcon,
  EyeIcon,
  ShareIcon,
  CheckCircleIcon,
  XCircleIcon,
  BellIcon,
  PencilIcon
} from '@heroicons/react/24/outline'
import { useAuth } from '../hooks/useAuth'
import { useNavigate } from 'react-router-dom'

// Pending Permission Requests Component
interface PendingPermissionRequestsProps {
  onApprove: (adminId: string) => void
  sharingPermissionMutation: any
}

const PendingPermissionRequests: React.FC<PendingPermissionRequestsProps> = ({ sharingPermissionMutation }) => {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  
  const { data: requestsData, isLoading } = useQuery({
    queryKey: ['sharing-permission-requests'],
    queryFn: () => usersAPI.getSharingPermissionRequests(),
    enabled: (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'),
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const requests = requestsData?.data?.data || []
  const pendingRequests = requests.filter((r: any) => r.isPending)

  const handleApprove = (adminId: string, adminName: string) => {
    if (window.confirm(`Are you sure you want to approve file sharing permission for ${adminName}?`)) {
      sharingPermissionMutation.mutate({ 
        userId: adminId, 
        canShareFiles: true 
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['sharing-permission-requests'] })
          queryClient.invalidateQueries({ queryKey: ['users'] })
        }
      })
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    )
  }

  if (pendingRequests.length === 0) {
    return null
  }

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-yellow-500">
      <div className="p-4 border-b-2 border-gray-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <BellIcon className="h-5 w-5 mr-2 text-yellow-600" />
            <h3 className="text-lg font-medium text-gray-900">Pending Permission Requests</h3>
            <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              {pendingRequests.length} {pendingRequests.length === 1 ? 'Request' : 'Requests'}
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Admins have requested permission to share files with other admins. Review and approve or manage from the list below.
        </p>
      </div>
      <div className="p-4">
        <div className="space-y-3">
          {pendingRequests.map((request: any) => (
            <div key={request._id} className="flex items-center justify-between p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <div className="flex items-center">
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center">
                  <UserIcon className="h-5 w-5 text-yellow-600" />
                </div>
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-900">{request.admin.name}</div>
                  <div className="text-xs text-gray-500">{request.admin.email}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Requested {new Date(request.requestedAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleApprove(request.admin._id, request.admin.name)}
                  disabled={sharingPermissionMutation.isPending}
                  className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircleIcon className="h-4 w-4 mr-1" />
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Admins With Permission Requests Component (shows only those who requested)
interface AdminsWithPermissionRequestsProps {
  sharingPermissionMutation: any
  handleSharingPermissionToggle: (user: User) => void
  handleOpenAllowedAdminsModal: (admin: User) => void
}

const AdminsWithPermissionRequests: React.FC<AdminsWithPermissionRequestsProps> = ({ 
  sharingPermissionMutation, 
  handleSharingPermissionToggle,
  handleOpenAllowedAdminsModal
}) => {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  
  const { data: requestsData, isLoading } = useQuery({
    queryKey: ['sharing-permission-requests'],
    queryFn: () => usersAPI.getSharingPermissionRequests(),
    enabled: (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'),
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const requests = requestsData?.data?.data || []

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    )
  }

  if (requests.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b-2 border-gray-400">
          <div className="flex items-center">
            <ShareIcon className="h-5 w-5 mr-2 text-blue-600" />
            <h3 className="text-lg font-medium text-gray-900">File Sharing Permissions</h3>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Only admins who have requested permission will appear here.
          </p>
        </div>
        <div className="p-4">
          <p className="text-gray-500 text-center py-8">
            No admins have requested file sharing permission yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b-2 border-gray-400">
        <div className="flex items-center">
          <ShareIcon className="h-5 w-5 mr-2 text-blue-600" />
          <h3 className="text-lg font-medium text-gray-900">File Sharing Permissions</h3>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Manage permissions for admins who have requested file sharing. Click the checkmark/X icon to approve/revoke their permission.
        </p>
      </div>
      <div className="p-4">
        <div className="space-y-2">
          {requests.map((request: any) => {
            const admin = request.admin
            return (
              <div key={admin._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center">
                  <UserIcon className="h-5 w-5 text-blue-600 mr-3" />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{admin.name}</div>
                    <div className="text-xs text-gray-500">{admin.email}</div>
                    {admin.sharingPermissionApprovedBy && (
                      <div className="text-xs text-gray-400 mt-1">
                        Approved by {admin.sharingPermissionApprovedBy.name}
                        {admin.sharingPermissionApprovedAt && 
                          ` on ${new Date(admin.sharingPermissionApprovedAt).toLocaleDateString()}`
                        }
                      </div>
                    )}
                    {!admin.canShareFiles && (
                      <div className="text-xs text-gray-400 mt-1">
                        Requested {new Date(request.requestedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                    admin.canShareFiles 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {admin.canShareFiles ? (
                      <>
                        <CheckCircleIcon className="h-3 w-3 mr-1" />
                        Approved
                      </>
                    ) : (
                      <>
                        <XCircleIcon className="h-3 w-3 mr-1" />
                        Pending
                      </>
                    )}
                  </span>
                  {admin.canShareFiles && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        console.log('Edit button clicked for admin:', admin)
                        handleOpenAllowedAdminsModal({
                          _id: admin._id,
                          name: admin.name,
                          email: admin.email,
                          role: 'admin',
                          canShareFiles: admin.canShareFiles,
                          allowedSharingAdmins: admin.allowedSharingAdmins || []
                        } as User)
                      }}
                      className="p-2 rounded text-blue-600 hover:bg-blue-50"
                      title="Select which admins this admin can share with"
                    >
                      <PencilIcon className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleSharingPermissionToggle({
                      _id: admin._id,
                      name: admin.name,
                      email: admin.email,
                      role: 'admin',
                      canShareFiles: admin.canShareFiles
                    } as User)}
                    disabled={sharingPermissionMutation.isPending}
                    className={`p-2 rounded ${
                      admin.canShareFiles 
                        ? 'text-red-600 hover:bg-red-50' 
                        : 'text-green-600 hover:bg-green-50'
                    } disabled:opacity-50`}
                    title={admin.canShareFiles ? 'Revoke permission' : 'Approve permission'}
                  >
                    {admin.canShareFiles ? (
                      <XCircleIcon className="h-5 w-5" />
                    ) : (
                      <CheckCircleIcon className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface User {
  _id: string
  name: string
  email: string
  phone: string
  role: 'superSuperAdmin' | 'superAdmin' | 'admin' | 'fieldAgent' | 'auditor'
  isActive: boolean
  isOnline: boolean
  lastSeen: string
  location: {
    city: string
    state: string
  }
  createdBy?: {
    _id: string
    name: string
    email: string
  }
  createdAt: string
  canShareFiles?: boolean
  sharingPermissionApprovedBy?: {
    _id: string
    name: string
    email: string
  }
  sharingPermissionApprovedAt?: string
  allowedSharingAdmins?: Array<{
    _id: string
    name: string
    email: string
  }>
}

interface CreateUserForm {
  name: string
  email: string
  phone: string
  password: string
  role: 'superSuperAdmin' | 'superAdmin' | 'admin' | 'fieldAgent' | 'auditor'
  assignedTo?: string // Admin ID for field agents and auditors
  location: {
    city: string
    state: string
  }
}



export default function Users() {
  const { user: currentUser, logout, refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  
  // State for filters and pagination
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('') // Show all users by default (including inactive)
  const [city, setCity] = useState('')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  
  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to first page when search changes
    }, 500) // 500ms delay

    return () => clearTimeout(timer)
  }, [search])
  
  // Reset page when other filters change
  useEffect(() => {
    setPage(1)
  }, [role, status, city])
  
  // State for modal and form
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [expandedAdmins, setExpandedAdmins] = useState<Set<string>>(new Set())
  
  // State for allowed sharing admins modal
  const [showAllowedAdminsModal, setShowAllowedAdminsModal] = useState(false)
  const [selectedAdminForSharing, setSelectedAdminForSharing] = useState<User | null>(null)
  const [selectedAllowedAdmins, setSelectedAllowedAdmins] = useState<string[]>([])
  const [createForm, setCreateForm] = useState<CreateUserForm>({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'fieldAgent',
    assignedTo: '',
    location: {
      city: '',
      state: ''
    }
  })

  // Fetch users with filters
  const { data, isLoading, error } = useQuery({
    queryKey: ['users', { search: debouncedSearch, role, status, city, page, currentUser: currentUser?.role, currentUserId: currentUser?._id, currentUserCreatedBy: currentUser?.createdBy?._id }],
    queryFn: () => usersAPI.getAll({ search: debouncedSearch, role, status, city, page, limit: 50 }),
    staleTime: 30000, // 30 seconds
    cacheTime: 300000, // 5 minutes
  })

  // Fetch admins for assignment (only for super admin and super super admin)
  const { data: adminsData, isLoading: isLoadingAdmins } = useQuery({
    queryKey: ['admins'],
    queryFn: () => usersAPI.getAll({ role: 'admin', status: 'active' }),
    enabled: (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'),
  })

  // Mutations
  const deleteMutation = useMutation({
    mutationFn: (userId: string) => usersAPI.delete(userId)
  })

  const createMutation = useMutation({
    mutationFn: (userData: CreateUserForm) => {
      // Only send assignedTo if super admin or super super admin is creating field agent or auditor
      if ((currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && (userData.role === 'fieldAgent' || userData.role === 'auditor')) {
        return usersAPI.create({
          ...userData,
          assignedTo: userData.assignedTo
        })
      }
      // For admin users, don't send assignedTo - it will be automatically set
      return usersAPI.create(userData)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User created successfully')
      setShowCreateModal(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create user')
    }
  })

  const statusUpdateMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) => 
      usersAPI.updateStatus(userId, { isActive }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(data.data.message)
      
      // Check if force logout is required (user was deactivated)
      if (data.data.forceLogout) {
        toast.success('User has been logged out from all active sessions due to deactivation.')
      }
      
      // Check if current user was deactivated
      if (!variables.isActive && currentUser && variables.userId === currentUser._id) {
        toast.error('Your account has been deactivated. You will be logged out.')
        setTimeout(() => {
          logout()
          navigate('/login')
        }, 2000)
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update user status')
    }
  })

  const sharingPermissionMutation = useMutation({
    mutationFn: ({ userId, canShareFiles, allowedSharingAdmins }: { userId: string; canShareFiles: boolean; allowedSharingAdmins?: string[] }) => 
      usersAPI.updateSharingPermission(userId, { canShareFiles, allowedSharingAdmins }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['sharing-permission-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admins'] })
      toast.success(data.data.message)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update sharing permission')
    }
  })

  const requestPermissionMutation = useMutation({
    mutationFn: () => usersAPI.requestSharingPermission(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success(data.data.message)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to send permission request')
    }
  })

  const handleRequestPermission = () => {
    if (window.confirm('Are you sure you want to request file sharing permission? Super Admins will be notified.')) {
      requestPermissionMutation.mutate()
    }
  }

  const handleSharingPermissionToggle = (user: User, allowedAdmins?: string[]) => {
    if (user.role !== 'admin') {
      toast.error('Only admins can have file sharing permission')
      return
    }
    
    const confirmMessage = `Are you sure you want to ${user.canShareFiles ? 'revoke' : 'approve'} file sharing permission for ${user.name}?`
    
    if (window.confirm(confirmMessage)) {
      sharingPermissionMutation.mutate({ 
        userId: user._id, 
        canShareFiles: !user.canShareFiles,
        allowedSharingAdmins: allowedAdmins
      })
    }
  }

  const handleOpenAllowedAdminsModal = async (admin: User) => {
    try {
      console.log('Opening modal for admin:', admin)
      console.log('Admin allowedSharingAdmins from list:', admin.allowedSharingAdmins)
      
      // Fetch fresh admin data to ensure we have the latest allowedSharingAdmins
      try {
        const freshAdminData = await usersAPI.getById(admin._id)
        const freshAdmin = freshAdminData.data.data
        console.log('Fresh admin data:', freshAdmin)
        console.log('Fresh allowedSharingAdmins:', freshAdmin.allowedSharingAdmins)
        
        // Use fresh data if available, otherwise fall back to passed admin
        const adminToUse = freshAdmin || admin
        
        // Handle both object and string ID formats
        let allowedIds: string[] = []
        if (adminToUse.allowedSharingAdmins && Array.isArray(adminToUse.allowedSharingAdmins)) {
          allowedIds = adminToUse.allowedSharingAdmins.map((a: any) => {
            if (typeof a === 'string') return a
            if (typeof a === 'object' && a._id) return a._id
            return String(a)
          })
        }
        
        console.log('Extracted allowed IDs:', allowedIds)
        
        setSelectedAdminForSharing(adminToUse as User)
        setSelectedAllowedAdmins(allowedIds)
        setShowAllowedAdminsModal(true)
        console.log('Modal state set to true')
      } catch (fetchError) {
        console.warn('Failed to fetch fresh admin data, using passed data:', fetchError)
        // Fallback to using the passed admin data
        let allowedIds: string[] = []
        if (admin.allowedSharingAdmins && Array.isArray(admin.allowedSharingAdmins)) {
          allowedIds = admin.allowedSharingAdmins.map((a: any) => {
            if (typeof a === 'string') return a
            if (typeof a === 'object' && a._id) return a._id
            return String(a)
          })
        }
        setSelectedAdminForSharing(admin)
        setSelectedAllowedAdmins(allowedIds)
        setShowAllowedAdminsModal(true)
      }
    } catch (error) {
      console.error('Error opening modal:', error)
      toast.error('Failed to open admin selection modal')
    }
  }

  const handleSaveAllowedAdmins = () => {
    if (!selectedAdminForSharing) return
    
    console.log('Saving allowed admins:', selectedAllowedAdmins)
    console.log('For admin:', selectedAdminForSharing._id)
    
    sharingPermissionMutation.mutate({
      userId: selectedAdminForSharing._id,
      canShareFiles: true, // Keep it approved
      allowedSharingAdmins: selectedAllowedAdmins
    }, {
      onSuccess: async (data) => {
        console.log('Save success response:', data)
        console.log('Saved allowedSharingAdmins:', data?.data?.data?.allowedSharingAdmins)
        
        // Update the admin object in state with the saved data
        const updatedAdmin = {
          ...selectedAdminForSharing,
          allowedSharingAdmins: data?.data?.data?.allowedSharingAdmins || []
        }
        
        setShowAllowedAdminsModal(false)
        setSelectedAdminForSharing(null)
        setSelectedAllowedAdmins([])
        
        // Invalidate and refetch to get updated data
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['sharing-permission-requests'] }),
          queryClient.invalidateQueries({ queryKey: ['users'] }),
          queryClient.invalidateQueries({ queryKey: ['admins'] })
        ])
        
        // Note: refetchRequests will be called by the component's own query invalidation
        
        // If the updated admin is the current user, refresh their profile
        if (currentUser?._id === selectedAdminForSharing._id) {
          await refreshUser()
        }
        
        toast.success('Allowed admins updated successfully')
      },
      onError: (error: any) => {
        console.error('Save error:', error)
        console.error('Error response:', error.response?.data)
        toast.error(error.response?.data?.message || 'Failed to save allowed admins')
      }
    })
  }

  // Check if current admin has file sharing permission
  const currentAdminHasPermission = currentUser?.role === 'admin' && currentUser?.canShareFiles === true

  const users = data?.data?.data || []
  const admins = adminsData?.data?.data || []
  
  // Check if search is in progress (debounced search differs from current search)
  const isSearching = search !== debouncedSearch
  


  const handleDelete = (userId: string) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      console.log('Deleting user:', userId)
      deleteMutation.mutate(userId, {
        onSuccess: (data) => {
          console.log('Delete success:', data)
          queryClient.invalidateQueries({ queryKey: ['users'] })
          toast.success('User deleted successfully')
        },
        onError: (error: any) => {
          console.error('Delete error:', error)
          toast.error(error.response?.data?.message || 'Failed to delete user')
        }
      })
    }
  }

  const handleViewDetails = (user: User) => {
    setSelectedUser(user)
    setShowViewModal(true)
  }

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate admin assignment for field agents and auditors (only for super admin and super super admin)
    if ((createForm.role === 'fieldAgent' || createForm.role === 'auditor') && (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin')) {
      if (!createForm.assignedTo) {
        toast.error('Please select an admin to assign this user to')
        return
      }
      if (admins.length === 0) {
        toast.error('No active admins available. Please create an admin first.')
        return
      }
    }
    
    createMutation.mutate(createForm)
  }

  const resetForm = () => {
    setCreateForm({
      name: '',
      email: '',
      phone: '',
      password: '',
      role: 'fieldAgent',
      assignedTo: '',
      location: {
        city: '',
        state: ''
      }
    })
  }

  const toggleAdminExpansion = (adminId: string) => {
    const newExpanded = new Set(expandedAdmins)
    if (newExpanded.has(adminId)) {
      newExpanded.delete(adminId)
    } else {
      newExpanded.add(adminId)
    }
    setExpandedAdmins(newExpanded)
  }

  const handleStatusToggle = (user: User) => {
    if (user.role === 'superSuperAdmin') {
      toast.error('SuperSuperAdmin cannot be deactivated')
      return
    }
    
    let cascadeMessage = '';
    if (user.isActive) {
      // Deactivation messages
      if (user.role === 'superAdmin') {
        cascadeMessage = 'This will also deactivate all Admins, Field Agents, and Auditors under them.';
      } else if (user.role === 'admin') {
        cascadeMessage = 'This will also deactivate all Field Agents and Auditors under them.';
      }
    } else {
      // Activation messages
      if (user.role === 'superAdmin') {
        cascadeMessage = 'This will also activate all Admins, Field Agents, and Auditors under them.';
      } else if (user.role === 'admin') {
        cascadeMessage = 'This will also activate all Field Agents and Auditors under them.';
      }
    }
    
    const confirmMessage = `Are you sure you want to ${user.isActive ? 'deactivate' : 'activate'} ${user.name}? ${cascadeMessage}`
    
    if (window.confirm(confirmMessage)) {
      statusUpdateMutation.mutate({ 
        userId: user._id, 
        isActive: !user.isActive 
      })
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'superSuperAdmin': return 'bg-orange-100 text-orange-800'
      case 'superAdmin': return 'bg-red-100 text-red-800'
      case 'admin': return 'bg-blue-100 text-blue-800'
      case 'fieldAgent': return 'bg-green-100 text-green-800'
      case 'auditor': return 'bg-purple-100 text-purple-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'superSuperAdmin': return ShieldCheckIcon
      case 'superAdmin': return ShieldCheckIcon
      case 'admin': return UserIcon
      case 'fieldAgent': return UserGroupIcon
      case 'auditor': return DocumentTextIcon
      default: return UserIcon
    }
  }

  const canManageUsers = currentUser?.role === 'admin' || currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'
  
  // Check if current user can manage a specific user
  const canManageUser = (user: User) => {
    if (!currentUser) return false
    
    // SuperSuperAdmin can manage everyone except themselves
    if (currentUser.role === 'superSuperAdmin') {
      return user.role !== 'superSuperAdmin' || user._id !== currentUser._id
    }
    
    // SuperAdmin can manage admins, field agents, and auditors in their hierarchy
    if (currentUser.role === 'superAdmin') {
      if (user.role === 'superSuperAdmin' || user.role === 'superAdmin') {
        return false
      }
      // Can manage users they created or users created by their admins
      return user.createdBy?._id === currentUser._id || 
             (user.createdBy && user.createdBy._id !== currentUser._id && 
              // This would need to be checked on the backend for proper hierarchy validation
              (user.role === 'admin' || user.role === 'fieldAgent' || user.role === 'auditor'))
    }
    
    // Admin can only manage field agents and auditors they created
    if (currentUser.role === 'admin') {
      return (user.role === 'fieldAgent' || user.role === 'auditor') && 
             user.createdBy?._id === currentUser._id
    }
    
    return false
  }
  
  // Admin can delete their own field agents and auditors, super admins can delete anyone except protected roles
  const canDelete = (user: User) => {
    // Never allow deletion of superSuperAdmin or superAdmin
    if (user.role === 'superSuperAdmin' || user.role === 'superAdmin') {
      return false
    }
    
    if (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') {
      return true // Can delete anyone except superSuperAdmin and superAdmin
    }
    if (currentUser?.role === 'admin') {
      // Can only delete field agents and auditors they created
      return (user.role === 'fieldAgent' || user.role === 'auditor') && 
             user.createdBy && user.createdBy._id === currentUser._id
    }
    return false
  }
  const canCreateAdmins = currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'

  // Filter users based on current user role
  const getFilteredUsers = () => {
    if (!currentUser) return { superSuperAdmins: [], superAdmins: [], adminUsers: [], fieldAgents: [], auditors: [] }
    
    switch (currentUser.role) {
      case 'superSuperAdmin':
        return {
          superSuperAdmins: users.filter((user: User) => user.role === 'superSuperAdmin'),
          superAdmins: users.filter((user: User) => user.role === 'superAdmin'),
          adminUsers: users.filter((user: User) => user.role === 'admin'),
          fieldAgents: users.filter((user: User) => user.role === 'fieldAgent'),
          auditors: users.filter((user: User) => user.role === 'auditor')
        }
      case 'superAdmin':
        return {
          superSuperAdmins: [],
          superAdmins: users.filter((user: User) => user.role === 'superAdmin'),
          adminUsers: users.filter((user: User) => user.role === 'admin'),
          fieldAgents: users.filter((user: User) => user.role === 'fieldAgent'),
          auditors: users.filter((user: User) => user.role === 'auditor')
        }
      case 'admin':
        return {
          superSuperAdmins: [],
          superAdmins: [],
          adminUsers: [],
          fieldAgents: users.filter((user: User) => user.role === 'fieldAgent' && user.createdBy && user.createdBy._id === currentUser._id),
          auditors: users.filter((user: User) => user.role === 'auditor' && user.createdBy && user.createdBy._id === currentUser._id)
        }
      case 'auditor':
        return {
          superSuperAdmins: [],
          superAdmins: [],
          adminUsers: [],
          fieldAgents: users.filter((user: User) => user.role === 'fieldAgent'),
          auditors: []
        }
      default:
        return { superSuperAdmins: [], superAdmins: [], adminUsers: [], fieldAgents: [], auditors: [] }
    }
  }

  const { superSuperAdmins, superAdmins, adminUsers, fieldAgents, auditors } = getFilteredUsers()

  // Group field agents and auditors by their admin
  const getUsersByAdmin = (adminId: string) => {
    return {
      fieldAgents: fieldAgents.filter((user: User) => user.createdBy && user.createdBy._id === adminId),
      auditors: auditors.filter((user: User) => user.createdBy && user.createdBy._id === adminId)
    }
  }

  // UserCard component for displaying user information
  interface UserCardProps {
    user: User
    compact?: boolean
  }

  const UserCard: React.FC<UserCardProps> = ({ user, compact = false }) => {
    const RoleIcon = getRoleIcon(user.role)
    
    if (compact) {
      return (
        <div className="flex items-center justify-between p-2 bg-white rounded border">
          <div className="flex items-center">
            <div className="flex-shrink-0 h-8 w-8 relative">
              <div className="h-8 w-8 rounded-full bg-gray-300 flex items-center justify-center">
                <RoleIcon className="h-4 w-4 text-gray-600" />
              </div>
              {/* Online status indicator */}
              <div className={`absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${
                user.isOnline ? 'bg-green-500' : 'bg-red-500'
              }`} title={user.isOnline ? 'Online' : 'Offline'} />
            </div>
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900">{user.name}</div>
              <div className="text-xs text-gray-500">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(user.role)}`}>
              {user.role.replace(/([A-Z])/g, ' $1').trim()}
            </span>
            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
              user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {user.isActive ? 'Active' : 'Deactive'}
            </span>
            {/* File Sharing Permission Badge (for admins) */}
            {user.role === 'admin' && (
              <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                user.canShareFiles 
                  ? 'bg-blue-100 text-blue-800' 
                  : 'bg-gray-100 text-gray-600'
              }`} title={user.canShareFiles ? 'Can share files with other admins' : 'Cannot share files with other admins'}>
                <ShareIcon className="h-3 w-3 mr-1" />
                {user.canShareFiles ? 'Can Share' : 'No Share'}
              </span>
            )}
                      {/* Status toggle for authorized users */}
          {canManageUser(user) && (
            <button
              onClick={() => handleStatusToggle(user)}
              disabled={statusUpdateMutation.isPending}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                user.isActive 
                  ? 'bg-green-600' 
                  : 'bg-gray-200'
              } disabled:opacity-50`}
              title={user.isActive ? 'Deactivate user' : 'Activate user'}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                user.isActive ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          )}
            {/* File Sharing Permission Toggle (for SuperSuperAdmin only, on admin users) */}
            {currentUser?.role === 'superSuperAdmin' && user.role === 'admin' && (
              <button
                onClick={() => handleSharingPermissionToggle(user)}
                disabled={sharingPermissionMutation.isPending}
                className={`p-1 ${
                  user.canShareFiles 
                    ? 'text-green-600 hover:text-green-800' 
                    : 'text-gray-400 hover:text-gray-600'
                } disabled:opacity-50`}
                title={user.canShareFiles ? 'Revoke file sharing permission' : 'Approve file sharing permission'}
              >
                {user.canShareFiles ? (
                  <CheckCircleIcon className="h-4 w-4" />
                ) : (
                  <XCircleIcon className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              onClick={() => handleViewDetails(user)}
              className="text-blue-600 hover:text-blue-800 p-1"
              title="View user details"
            >
              <EyeIcon className="h-4 w-4" />
            </button>
            {canDelete(user) && (
              <button
                onClick={() => handleDelete(user._id)}
                className="text-red-600 hover:text-red-800 p-1"
                title="Delete user"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center">
          <div className="flex-shrink-0 h-10 w-10 relative">
            <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
              <RoleIcon className="h-5 w-5 text-gray-600" />
            </div>
            {/* Online status indicator */}
            <div className={`absolute -top-1 -right-1 h-4 w-4 rounded-full border-2 border-white ${
              user.isOnline ? 'bg-green-500' : 'bg-red-500'
            }`} title={user.isOnline ? 'Online' : 'Offline'} />
          </div>
          <div className="ml-4">
            <div className="text-sm font-medium text-gray-900">{user.name}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
            <div className="text-sm text-gray-500">{user.location.city}, {user.location.state}</div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(user.role)}`}>
            {user.role.replace(/([A-Z])/g, ' $1').trim()}
          </span>
          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
            user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {user.isActive ? 'Active' : 'Deactive'}
          </span>
          {/* File Sharing Permission Badge (for admins) */}
          {user.role === 'admin' && (
            <span className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
              user.canShareFiles 
                ? 'bg-blue-100 text-blue-800' 
                : 'bg-gray-100 text-gray-600'
            }`} title={user.canShareFiles ? 'Can share files with other admins' : 'Cannot share files with other admins'}>
              <ShareIcon className="h-3 w-3 mr-1" />
              {user.canShareFiles ? 'Can Share' : 'No Share'}
            </span>
          )}
          {/* Status toggle for authorized users */}
          {canManageUser(user) && (
            <button
              onClick={() => handleStatusToggle(user)}
              disabled={statusUpdateMutation.isPending}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                user.isActive 
                  ? 'bg-green-600' 
                  : 'bg-gray-200'
              } disabled:opacity-50`}
              title={user.isActive ? 'Deactivate user' : 'Activate user'}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                user.isActive ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          )}
          {/* File Sharing Permission Toggle (for SuperSuperAdmin only, on admin users) */}
          {currentUser?.role === 'superSuperAdmin' && user.role === 'admin' && (
            <button
              onClick={() => handleSharingPermissionToggle(user)}
              disabled={sharingPermissionMutation.isPending}
              className={`p-1 ${
                user.canShareFiles 
                  ? 'text-green-600 hover:text-green-800' 
                  : 'text-gray-400 hover:text-gray-600'
              } disabled:opacity-50`}
              title={user.canShareFiles ? 'Revoke file sharing permission' : 'Approve file sharing permission'}
            >
              {user.canShareFiles ? (
                <CheckCircleIcon className="h-5 w-5" />
              ) : (
                <XCircleIcon className="h-5 w-5" />
              )}
            </button>
          )}
          <button
            onClick={() => handleViewDetails(user)}
            className="text-blue-600 hover:text-blue-800 p-1"
            title="View user details"
          >
            <EyeIcon className="h-5 w-5" />
          </button>
          {canDelete(user) && (
            <button
              onClick={() => handleDelete(user._id)}
              className="text-red-600 hover:text-red-800 p-1"
              title="Delete user"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Failed to load users</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-600">Manage system users and their roles</p>
        </div>
        {canManageUsers && (
          <button 
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon className="h-5 w-5" />
            Add User
          </button>
        )}
      </div>

      {/* File Sharing Permission Status Banner (for Admins) */}
      {currentUser?.role === 'admin' && (
        <div className={`bg-white rounded-lg shadow p-4 border-l-4 ${
          currentAdminHasPermission 
            ? 'border-green-500' 
            : 'border-yellow-500'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <ShareIcon className={`h-5 w-5 mr-2 ${
                currentAdminHasPermission ? 'text-green-600' : 'text-yellow-600'
              }`} />
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  File Sharing Permission
                </h3>
                <p className="text-sm text-gray-600">
                  {currentAdminHasPermission 
                    ? 'You have permission to share files with other admins. You can select admins to share with when uploading files.'
                    : 'You do not have permission to share files with other admins. Please contact a Super Admin to request this permission.'}
                </p>
                {currentUser?.sharingPermissionApprovedBy && (
                  <p className="text-xs text-gray-500 mt-1">
                    Approved by: {currentUser.sharingPermissionApprovedBy.name} 
                    {currentUser.sharingPermissionApprovedAt && 
                      ` on ${new Date(currentUser.sharingPermissionApprovedAt).toLocaleDateString()}`
                    }
                  </p>
                )}
              </div>
            </div>
            {!currentAdminHasPermission && (
              <div className="flex items-center space-x-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                  Permission Required
                </span>
                <button
                  onClick={() => handleRequestPermission()}
                  disabled={requestPermissionMutation.isPending}
                  className="inline-flex items-center px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {requestPermissionMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2"></div>
                      Requesting...
                    </>
                  ) : (
                    <>
                      <ShareIcon className="h-3 w-3 mr-1" />
                      Request Permission
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File Sharing Permission Management Section (for Super Admins) */}
      {(currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && (
        <>
          {/* Pending Requests Section */}
          <PendingPermissionRequests 
            sharingPermissionMutation={sharingPermissionMutation}
          />
          
          {/* Admins Who Requested Permission Management */}
          <AdminsWithPermissionRequests 
            sharingPermissionMutation={sharingPermissionMutation}
            handleSharingPermissionToggle={handleSharingPermissionToggle}
            handleOpenAllowedAdminsModal={handleOpenAllowedAdminsModal}
          />
        </>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow">
                  <div className="p-4 border-b-2 border-gray-400">
            <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Filters</h3>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center text-sm text-gray-600 hover:text-gray-900"
            >
              <FunnelIcon className="h-4 w-4 mr-1" />
              {showFilters ? 'Hide' : 'Show'} Filters
            </button>
          </div>
        </div>
        
        {showFilters && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input pl-10"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="input"
                >
                  <option value="">All Roles</option>
                  <option value="superSuperAdmin">Super Super Admin</option>
                  <option value="superAdmin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="fieldAgent">Field Agent</option>
                  <option value="auditor">Auditor</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="input"
                >
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Deactive</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                <input
                  type="text"
                  placeholder="Enter city..."
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Role-Based User View */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-4 border-b-2 border-gray-400">
          <h3 className="text-lg font-medium text-gray-900">
            {(currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && 'All Users'}
            {currentUser?.role === 'admin' && 'My Team'}
            {currentUser?.role === 'auditor' && 'Field Agents'}
          </h3>
        </div>
        
        <div className="divide-y divide-gray-200">
          {/* Super Admin and Super Super Admin View - Show all users */}
          {(currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && (
            <>
              {/* Super Super Admins */}
              {superSuperAdmins.length > 0 && (
                <div className="p-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <ShieldCheckIcon className="h-5 w-5 mr-2 text-orange-600" />
                    Super Super Admins ({superSuperAdmins.length})
                  </h4>
                  <div className="space-y-2">
                    {superSuperAdmins.map((user: User) => (
                      <UserCard key={user._id} user={user} />
                    ))}
                  </div>
                </div>
              )}

              {/* Super Admins */}
              {superAdmins.length > 0 && (
                <div className="p-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <ShieldCheckIcon className="h-5 w-5 mr-2 text-red-600" />
                    Super Admins ({superAdmins.length})
                  </h4>
                  <div className="space-y-2">
                    {superAdmins.map((user: User) => (
                      <UserCard key={user._id} user={user} />
                    ))}
                  </div>
                </div>
              )}

              {/* Admins with their field agents and auditors */}
              {adminUsers.length > 0 && (
                <div className="p-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <UserIcon className="h-5 w-5 mr-2 text-blue-600" />
                    Admins ({adminUsers.length})
                  </h4>
                  <div className="space-y-4">
                    {adminUsers.map((admin: User) => {
                      const adminUsers = getUsersByAdmin(admin._id)
                      const isExpanded = expandedAdmins.has(admin._id)
                      
                      return (
                        <div key={admin._id} className="border-2 border-gray-400 rounded-lg">
                          <div className="flex items-center justify-between p-3 bg-blue-50">
                            <div className="flex items-center">
                              <button
                                onClick={() => toggleAdminExpansion(admin._id)}
                                className="mr-2 text-gray-500 hover:text-gray-700"
                              >
                                {isExpanded ? (
                                  <ChevronDownIcon className="h-4 w-4" />
                                ) : (
                                  <ChevronRightIcon className="h-4 w-4" />
                                )}
                              </button>
                              <UserCard user={admin} />
                            </div>
                            <div className="text-xs text-gray-500">
                              {adminUsers.fieldAgents.length} Field Agents, {adminUsers.auditors.length} Auditors
                            </div>
                          </div>
                          
                          {isExpanded && (
                            <div className="p-4 bg-gray-50">
                              {/* Field Agents */}
                              {adminUsers.fieldAgents.length > 0 && (
                                <div className="mb-4">
                                  <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
                                    <UserGroupIcon className="h-4 w-4 mr-1 text-green-600" />
                                    Field Agents ({adminUsers.fieldAgents.length})
                                  </h5>
                                  <div className="space-y-2">
                                    {adminUsers.fieldAgents.map((user: User) => (
                                      <UserCard key={user._id} user={user} compact />
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Auditors */}
                              {adminUsers.auditors.length > 0 && (
                                <div>
                                  <h5 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
                                    <DocumentTextIcon className="h-4 w-4 mr-1 text-purple-600" />
                                    Auditors ({adminUsers.auditors.length})
                                  </h5>
                                  <div className="space-y-2">
                                    {adminUsers.auditors.map((user: User) => (
                                      <UserCard key={user._id} user={user} compact />
                                    ))}
                                  </div>
                                </div>
                              )}

                              {adminUsers.fieldAgents.length === 0 && adminUsers.auditors.length === 0 && (
                                <div className="text-center py-4 text-gray-500">
                                  No field agents or auditors assigned to this admin yet.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Orphaned Field Agents and Auditors */}
              {fieldAgents.filter((user: User) => !user.createdBy).length > 0 && (
                <div className="p-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <UserGroupIcon className="h-5 w-5 mr-2 text-green-600" />
                    Field Agents (Unassigned) ({fieldAgents.filter((user: User) => !user.createdBy).length})
                  </h4>
                  <div className="space-y-2">
                    {fieldAgents.filter((user: User) => !user.createdBy).map((user: User) => (
                      <UserCard key={user._id} user={user} />
                    ))}
                  </div>
                </div>
              )}

              {auditors.filter((user: User) => !user.createdBy).length > 0 && (
                <div className="p-4">
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <DocumentTextIcon className="h-5 w-5 mr-2 text-purple-600" />
                    Auditors (Unassigned) ({auditors.filter((user: User) => !user.createdBy).length})
                  </h4>
                  <div className="space-y-2">
                    {auditors.filter((user: User) => !user.createdBy).map((user: User) => (
                      <UserCard key={user._id} user={user} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Admin View - Show their team */}
          {currentUser?.role === 'admin' && (
            <div className="p-4">
              <div className="space-y-4">
                {/* Field Agents */}
                {fieldAgents.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                      <UserGroupIcon className="h-5 w-5 mr-2 text-green-600" />
                      Field Agents ({fieldAgents.length})
                    </h4>
                    <div className="space-y-2">
                      {fieldAgents.map((user: User) => (
                        <UserCard key={user._id} user={user} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Auditors */}
                {auditors.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                      <DocumentTextIcon className="h-5 w-5 mr-2 text-purple-600" />
                      Auditors ({auditors.length})
                    </h4>
                    <div className="space-y-2">
                      {auditors.map((user: User) => (
                        <UserCard key={user._id} user={user} />
                      ))}
                    </div>
                  </div>
                )}

                {fieldAgents.length === 0 && auditors.length === 0 && (
                  <div className="text-center py-8">
                    <UsersIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No team members yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Start building your team by adding field agents and auditors.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Auditor View - Show field agents */}
          {currentUser?.role === 'auditor' && (
            <div className="p-4">
              {fieldAgents.length > 0 ? (
                <div>
                  <h4 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                    <UserGroupIcon className="h-5 w-5 mr-2 text-green-600" />
                    Field Agents ({fieldAgents.length})
                  </h4>
                  <div className="space-y-2">
                    {fieldAgents.map((user: User) => (
                      <UserCard key={user._id} user={user} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <UsersIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No field agents found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    No field agents are currently assigned to your admin.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Create New User</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
              
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({...createForm, name: e.target.value})}
                    className="input w-full"
                    placeholder="Enter full name"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={(e) => setCreateForm({...createForm, email: e.target.value})}
                    className="input w-full"
                    placeholder="Enter email address"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    required
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({...createForm, phone: e.target.value})}
                    className="input w-full"
                    placeholder="Enter 10-digit phone number"
                    pattern="[0-9]{10}"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={createForm.password}
                    onChange={(e) => setCreateForm({...createForm, password: e.target.value})}
                    className="input w-full"
                    placeholder="Enter password (min 6 characters)"
                    minLength={6}
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    required
                    value={createForm.role}
                    onChange={(e) => {
                      const newRole = e.target.value as any
                      setCreateForm({
                        ...createForm, 
                        role: newRole,
                        // Reset assignedTo when role changes
                        assignedTo: newRole === 'admin' ? '' : createForm.assignedTo
                      })
                    }}
                    className="input w-full"
                  >
                    {currentUser?.role === 'superSuperAdmin' && <option value="superSuperAdmin">Super Super Admin</option>}
                    {currentUser?.role === 'superSuperAdmin' && <option value="superAdmin">Super Admin</option>}
                    {canCreateAdmins && <option value="admin">Admin</option>}
                    <option value="fieldAgent">Field Agent</option>
                    <option value="auditor">Auditor</option>
                  </select>
                </div>

                {/* Admin Assignment for Field Agents and Auditors */}
                {(createForm.role === 'fieldAgent' || createForm.role === 'auditor') && (currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && (
                  <div>
                    {admins.length > 0 ? (
                      <>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Assign to Admin *
                        </label>
                        <select
                          required
                          value={createForm.assignedTo}
                          onChange={(e) => setCreateForm({...createForm, assignedTo: e.target.value})}
                          className="input w-full"
                          disabled={isLoadingAdmins}
                        >
                          <option value="">
                            {isLoadingAdmins ? 'Loading admins...' : 'Select an admin'}
                          </option>
                          {admins.map((admin: User) => (
                            <option key={admin._id} value={admin._id}>
                              {admin.name} ({admin.email})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          This user will be assigned to the selected admin
                        </p>
                      </>
                    ) : (
                      <div className="p-3 bg-red-50 rounded-md">
                        <p className="text-sm text-red-700">
                          No active admins available. Please create an admin first before creating field agents or auditors.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Info message for regular admins */}
                {(createForm.role === 'fieldAgent' || createForm.role === 'auditor') && currentUser?.role === 'admin' && (
                  <div className="p-3 bg-blue-50 rounded-md">
                    <p className="text-sm text-blue-700">
                      This user will be automatically assigned to you (your admin account).
                    </p>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={createForm.location.city}
                      onChange={(e) => setCreateForm({
                        ...createForm, 
                        location: {...createForm.location, city: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter city"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <input
                      type="text"
                      required
                      value={createForm.location.state}
                      onChange={(e) => setCreateForm({
                        ...createForm, 
                        location: {...createForm.location, state: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter state"
                    />
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="btn-primary"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View User Details Modal */}
      {showViewModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">User Details</h3>
              <button
                onClick={() => setShowViewModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* User Avatar and Basic Info */}
              <div className="flex items-center space-x-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex-shrink-0 h-16 w-16 relative">
                  <div className="h-16 w-16 rounded-full bg-gray-300 flex items-center justify-center">
                    <UserIcon className="h-8 w-8 text-gray-600" />
                  </div>
                  <div className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white ${
                    selectedUser.isOnline ? 'bg-green-400' : 'bg-gray-400'
                  }`}></div>
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{selectedUser.name}</h4>
                  <p className="text-sm text-gray-600 capitalize">{selectedUser.role}</p>
                  <p className="text-xs text-gray-500">
                    {selectedUser.isOnline ? 'Online' : `Last seen: ${new Date(selectedUser.lastSeen).toLocaleString()}`}
                  </p>
                </div>
              </div>

              {/* File Sharing Permission (for admins) */}
              {selectedUser.role === 'admin' && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <ShareIcon className="h-5 w-5 text-blue-600 mr-2" />
                      <div>
                        <h5 className="text-sm font-medium text-gray-900">File Sharing Permission</h5>
                        <p className="text-xs text-gray-600">
                          {selectedUser.canShareFiles 
                            ? 'This admin can share files with other admins'
                            : 'This admin cannot share files with other admins'}
                        </p>
                        {selectedUser.sharingPermissionApprovedBy && (
                          <p className="text-xs text-gray-500 mt-1">
                            Approved by: {selectedUser.sharingPermissionApprovedBy.name}
                            {selectedUser.sharingPermissionApprovedAt && 
                              ` on ${new Date(selectedUser.sharingPermissionApprovedAt).toLocaleDateString()}`
                            }
                          </p>
                        )}
                      </div>
                    </div>
                    {(currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin') && (
                      <button
                        onClick={() => {
                          handleSharingPermissionToggle(selectedUser)
                          setShowViewModal(false)
                        }}
                        disabled={sharingPermissionMutation.isPending}
                        className={`px-3 py-1 text-xs font-medium rounded ${
                          selectedUser.canShareFiles
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        } disabled:opacity-50`}
                      >
                        {selectedUser.canShareFiles ? 'Revoke' : 'Approve'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Information */}
              <div className="space-y-3">
                <h5 className="font-medium text-gray-900">Contact Information</h5>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <p className="text-sm text-gray-900">{selectedUser.email}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Phone</label>
                    <p className="text-sm text-gray-900">{selectedUser.phone}</p>
                  </div>
                </div>
              </div>

              {/* Location Information */}
              <div className="space-y-3">
                <h5 className="font-medium text-gray-900">Location</h5>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">City</label>
                    <p className="text-sm text-gray-900">{selectedUser.location.city}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">State</label>
                    <p className="text-sm text-gray-900">{selectedUser.location.state}</p>
                  </div>
                </div>
              </div>

              {/* Account Status */}
              <div className="space-y-3">
                <h5 className="font-medium text-gray-900">Account Status</h5>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-700 mr-2">Status:</span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedUser.isActive 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedUser.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-700 mr-2">Online:</span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedUser.isOnline 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedUser.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Created By Information */}
              {selectedUser.createdBy && (
                <div className="space-y-3">
                  <h5 className="font-medium text-gray-900">Created By</h5>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <p className="text-sm font-medium text-gray-900">{selectedUser.createdBy.name}</p>
                    <p className="text-sm text-gray-600">{selectedUser.createdBy.email}</p>
                  </div>
                </div>
              )}

              {/* Account Creation Date */}
              <div className="space-y-3">
                <h5 className="font-medium text-gray-900">Account Information</h5>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Created At</label>
                  <p className="text-sm text-gray-900">{new Date(selectedUser.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 mt-6 border-t">
              <button
                onClick={() => setShowViewModal(false)}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Allowed Sharing Admins Modal */}
      {showAllowedAdminsModal && selectedAdminForSharing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                Select Admins {selectedAdminForSharing.name} Can Share With
              </h3>
              <button
                onClick={() => {
                  setShowAllowedAdminsModal(false);
                  setSelectedAdminForSharing(null);
                  setSelectedAllowedAdmins([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  Select which admins <strong>{selectedAdminForSharing.name}</strong> can share files with.
                  Only selected admins will appear in their sharing list.
                </p>
              </div>
              
              {isLoadingAdmins ? (
                <div className="text-center py-4">Loading admins...</div>
              ) : admins.length === 0 ? (
                <div className="text-center py-4 text-gray-500">No admins available</div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select allowed admins:
                  </label>
                  <div className="border border-gray-300 rounded-lg p-3 max-h-60 overflow-y-auto">
                    {admins
                      .filter((admin: User) => admin._id !== selectedAdminForSharing._id && admin.isActive)
                      .map((admin: User) => (
                        <label key={admin._id} className="flex items-center space-x-2 py-1">
                          <input
                            type="checkbox"
                            checked={selectedAllowedAdmins.includes(admin._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAllowedAdmins([...selectedAllowedAdmins, admin._id]);
                              } else {
                                setSelectedAllowedAdmins(selectedAllowedAdmins.filter(id => id !== admin._id));
                              }
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-900">{admin.name}</span>
                          <span className="text-xs text-gray-500">({admin.email})</span>
                        </label>
                      ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Selected: {selectedAllowedAdmins.length} admin(s)
                  </p>
                  {selectedAllowedAdmins.length === 0 && (
                    <p className="text-xs text-yellow-600 mt-1">
                      ⚠️ If no admins are selected, {selectedAdminForSharing.name} won't be able to share files with anyone.
                    </p>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => {
                  setShowAllowedAdminsModal(false);
                  setSelectedAdminForSharing(null);
                  setSelectedAllowedAdmins([]);
                }}
                className="btn-secondary"
                disabled={sharingPermissionMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAllowedAdmins}
                className="btn-primary"
                disabled={sharingPermissionMutation.isPending || isLoadingAdmins}
              >
                {sharingPermissionMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 