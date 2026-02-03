import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsAPI } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import {
  BellIcon,
  EyeIcon,
  MapPinIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  XMarkIcon,
  FunnelIcon
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface Notification {
  id: string
  userName: string
  userRole: string
  action: string
  vehicleNumber: string
  timestamp: string
  location: string
  fullLocation?: any
  isRead: boolean
  isOnline: boolean
  ipAddress: string
  fileName?: string | null
  maskedFileName?: string | null // Masked file name (for non-primary admins)
  excelFileId?: string
  primaryAdminId?: string
  primaryAdminName?: string | null // Primary admin name (shown when maskedFileName is used)
  fileUploaderRole?: string
  adminName?: string // Admin name (for field agent/auditor actions)
}

export default function Notifications() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [filter, setFilter] = useState('all') // 'all', 'unread', 'viewed', 'verified'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [hasAutoMarkedAsRead, setHasAutoMarkedAsRead] = useState(false)
  const [isAutoMarking, setIsAutoMarking] = useState(false)

  // Debounce search to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to first page when search changes
    }, 300) // 300ms delay

    return () => clearTimeout(timer)
  }, [search])

  // Fetch notifications
  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['notifications', filter, page, debouncedSearch],
    queryFn: () => {
      const params = { 
        page, 
        limit: 20, 
        unreadOnly: filter === 'unread' ? 'true' : 'false',
        search: debouncedSearch
      };
      console.log('🔍 Frontend search params:', params);
      return notificationsAPI.getAll(params);
    },
    enabled: !!currentUser && ['admin', 'superAdmin', 'superSuperAdmin', 'auditor'].includes(currentUser.role),
    refetchInterval: 30000, // Refetch every 30 seconds for real-time updates
  })

  // Fetch stats
  const { data: statsData } = useQuery({
    queryKey: ['notification-stats'],
    queryFn: () => notificationsAPI.getStats(),
    enabled: !!currentUser && ['admin', 'superAdmin', 'superSuperAdmin', 'auditor'].includes(currentUser.role),
    refetchInterval: 30000,
  })

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: (id: string) => notificationsAPI.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] })
    }
  })

  // Mark all as read mutation
  const markAllAsReadMutation = useMutation({
    mutationFn: () => notificationsAPI.markAllAsRead(),
    onSuccess: (data) => {
      // Only show toast if manually triggered (button click), not auto-mark
      if (!isAutoMarking) {
        toast.success(data.data.message)
      }
      setIsAutoMarking(false)
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] })
    },
    onError: (error: any) => {
      // Reset flags on error so it can retry
      setHasAutoMarkedAsRead(false)
      setIsAutoMarking(false)
      toast.error(error.response?.data?.message || 'Failed to mark notifications as read')
    }
  })

  const notifications = notificationsData?.data?.data || []
  const pagination = notificationsData?.data?.pagination
  const stats = statsData?.data?.data || { total: 0, unread: 0, viewed: 0, verified: 0 }
  
  // Auto-mark all notifications as read when page opens (only once)
  useEffect(() => {
    // Only mark as read once when component mounts and stats are loaded
    if (!hasAutoMarkedAsRead && statsData?.data?.data && statsData.data.data.unread > 0) {
      setHasAutoMarkedAsRead(true)
      setIsAutoMarking(true)
      markAllAsReadMutation.mutate()
    }
  }, [statsData, hasAutoMarkedAsRead, markAllAsReadMutation])
  
  // Debug: Log notifications when they change
  useEffect(() => {
    console.log('📋 Notifications updated:', { 
      count: notifications.length, 
      search: debouncedSearch,
      filter,
      page 
    });
  }, [notifications, debouncedSearch, filter, page])

  const handleMarkAsRead = (notifId: string) => {
    markAsReadMutation.mutate(notifId)
  }

  const handleMarkAllAsRead = () => {
    if (stats.unread > 0) {
      markAllAsReadMutation.mutate()
    }
  }

  const handleViewLocation = (notification: Notification) => {
    // If we have coordinates, open Google Maps
    if (notification.fullLocation?.latitude && notification.fullLocation?.longitude) {
      const { latitude, longitude } = notification.fullLocation
      const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}&z=15`
      window.open(googleMapsUrl, '_blank')
    } 
    // If no coordinates but have IP, try IP-based map search
    else if (notification.ipAddress && notification.ipAddress !== '127.0.0.1') {
      const googleMapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(notification.ipAddress)}`
      window.open(googleMapsUrl, '_blank')
    }
    // Fallback: show location details modal
    else {
      setSelectedNotification(notification)
      setShowLocationModal(true)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  }

  const getActionIcon = (action: string) => {
    return action === 'verified' ? CheckCircleIcon : EyeIcon
  }

  const getActionColor = (action: string) => {
    return action === 'verified' ? 'text-green-600' : 'text-blue-600'
  }

  if (!currentUser || !['admin', 'superAdmin', 'superSuperAdmin', 'auditor'].includes(currentUser.role)) {
    return (
      <div className="card">
        <div className="card-body text-center py-12">
          <BellIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-navy">Access Denied</h3>
          <p className="text-gray-600 mt-2">Only admins can view notifications</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="card-body">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-navy mb-2">Notifications</h1>
              <p className="text-gray-600">Track field agent and auditor activities</p>
            </div>
            <div className="flex items-center space-x-4">
              {stats.unread > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  disabled={markAllAsReadMutation.isPending}
                  className="btn btn-secondary"
                >
                  {markAllAsReadMutation.isPending ? 'Marking...' : `Mark All Read (${stats.unread})`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BellIcon className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Total</p>
                <p className="text-2xl font-bold text-navy">{stats.total}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                  <span className="text-red-600 font-bold text-sm">{stats.unread}</span>
                </div>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Unread</p>
                <p className="text-2xl font-bold text-navy">{stats.unread}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <EyeIcon className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Viewed</p>
                <p className="text-2xl font-bold text-navy">{stats.viewed}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CheckCircleIcon className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-500">Verified</p>
                <p className="text-2xl font-bold text-navy">{stats.verified}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="card">
        <div className="card-body">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 lg:space-x-4">
            {/* Search */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by registration number or name..."
                  className="form-input pl-10 w-full"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center space-x-4">
              <FunnelIcon className="h-5 w-5 text-gray-500" />
              <div className="flex space-x-2">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'unread', label: 'Unread' },
                  { key: 'viewed', label: 'Viewed Only' },
                  { key: 'verified', label: 'Verified Only' }
                ].map((filterOption) => (
                  <button
                    key={filterOption.key}
                    onClick={() => {
                      setFilter(filterOption.key)
                      setPage(1)
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      filter === filterOption.key
                        ? 'bg-yellow text-navy'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {filterOption.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="card">
        <div className="card-body">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow mx-auto mb-4"></div>
              <p className="text-gray-600">Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <BellIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-navy">No notifications</h3>
              <p className="text-gray-600 mt-2">
                {debouncedSearch ? `No notifications found for "${debouncedSearch}" (searches registration number and name)` : 
                 filter === 'unread' ? 'No unread notifications' : 'No activity to show'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification: Notification) => {
                const ActionIcon = getActionIcon(notification.action)
                return (
                  <div
                    key={notification.id}
                    className={`border rounded-lg p-4 transition-all duration-200 ${
                      notification.isRead
                        ? 'border-gray-200 bg-white'
                        : 'border-yellow bg-yellow bg-opacity-5'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4">
                        <div className={`flex-shrink-0 p-2 rounded-full ${
                          notification.action === 'verified' ? 'bg-green-100' : 'bg-blue-100'
                        }`}>
                          <ActionIcon className={`h-5 w-5 ${getActionColor(notification.action)}`} />
                        </div>
                        
                        <div className="flex-1">
                          <div className="mb-1">
                            {/* Show admin name for field agent and auditor actions */}
                            {(notification.userRole === 'fieldAgent' || notification.userRole === 'auditor') && notification.adminName ? (
                              <>
                                <span className="font-semibold text-navy">{notification.userName}</span>
                                <span className="text-gray-500"> from Admin </span>
                                <span className="font-semibold text-blue-600">{notification.adminName}</span>
                                <span className="text-gray-500"> {notification.action} </span>
                              </>
                            ) : (
                              <>
                                <span className="font-semibold text-navy">{notification.userName}</span>
                                <span className="text-gray-500"> {notification.action} </span>
                              </>
                            )}
                            {(notification.fileName || notification.maskedFileName) && (
                              <>
                                <span className="text-gray-500"> vehicle from file </span>
                                <span className="font-semibold text-purple-600">
                                  {notification.fileName || notification.maskedFileName}
                                </span>
                                {notification.maskedFileName && notification.primaryAdminName && (
                                  <>
                                    <span className="text-gray-500"> (Primary Admin: </span>
                                    <span className="font-semibold text-blue-600">{notification.primaryAdminName}</span>
                                    <span className="text-gray-500">)</span>
                                  </>
                                )}
                                <span className="text-gray-500"> (vehicle no. </span>
                              </>
                            )}
                            {!notification.fileName && !notification.maskedFileName && (
                              <span className="text-gray-500"> details of vehicle no. </span>
                            )}
                            <span className="font-mono font-semibold text-orange">{notification.vehicleNumber}</span>
                            {(notification.fileName || notification.maskedFileName) && <span className="text-gray-500">)</span>}
                          </div>
                          
                          <div className="flex items-center space-x-4 text-sm text-gray-600">
                            <div className="flex items-center">
                              <ClockIcon className="h-4 w-4 mr-1" />
                              {formatDate(notification.timestamp)}
                            </div>
                            
                            <button
                              onClick={() => handleViewLocation(notification)}
                              className="flex items-center text-blue-600 hover:text-blue-800"
                            >
                              <MapPinIcon className="h-4 w-4 mr-1" />
                              <span>{notification.location}</span>
                              <span className="ml-2 underline">view location</span>
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        {!notification.isRead && (
                          <button
                            onClick={() => handleMarkAsRead(notification.id)}
                            disabled={markAsReadMutation.isPending}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Mark Read
                          </button>
                        )}
                        
                        <div className={`w-3 h-3 rounded-full ${
                          notification.isOnline ? 'bg-green-500' : 'bg-red-500'
                        }`} title={notification.isOnline ? 'Online' : 'Offline'} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex justify-center">
          <div className="bg-white rounded-lg border-2 border-gray-400 shadow-sm p-2 flex items-center space-x-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                page <= 1 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Previous
            </button>
            
            {Array.from({ length: Math.min(pagination.pages, 5) }, (_, i) => {
              let pageNum;
              if (pagination.pages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= pagination.pages - 2) {
                pageNum = pagination.pages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    pageNum === page
                      ? 'bg-yellow text-navy font-semibold'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            
            <button
              onClick={() => setPage(Math.min(pagination.pages, page + 1))}
              disabled={page >= pagination.pages}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                page >= pagination.pages ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Location Details Modal */}
      {showLocationModal && selectedNotification && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Location Details</h3>
              <button
                onClick={() => setShowLocationModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">User</p>
                <p className="text-sm text-gray-900">{selectedNotification.userName}</p>
              </div>
              
              <div>
                <p className="text-sm font-medium text-gray-700">IP Address</p>
                <p className="text-sm text-gray-900 font-mono">{selectedNotification.ipAddress}</p>
              </div>
              
              {selectedNotification.fullLocation && (
                <>
                  <div>
                    <p className="text-sm font-medium text-gray-700">City</p>
                    <p className="text-sm text-gray-900">{selectedNotification.fullLocation.city || 'Unknown'}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-700">Region</p>
                    <p className="text-sm text-gray-900">{selectedNotification.fullLocation.region || 'Unknown'}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-700">Country</p>
                    <p className="text-sm text-gray-900">{selectedNotification.fullLocation.country || 'Unknown'}</p>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-700">ISP</p>
                    <p className="text-sm text-gray-900">{selectedNotification.fullLocation.isp || 'Unknown'}</p>
                  </div>
                  
                  {selectedNotification.fullLocation.latitude && selectedNotification.fullLocation.longitude && (
                    <div>
                      <p className="text-sm font-medium text-gray-700">Coordinates</p>
                      <p className="text-sm text-gray-900">
                        {selectedNotification.fullLocation.latitude}, {selectedNotification.fullLocation.longitude}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
