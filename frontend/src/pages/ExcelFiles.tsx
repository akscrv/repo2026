import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { excelAPI, usersAPI, fileStorageAPI } from '../services/api'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  DocumentArrowUpIcon,
  DocumentArrowDownIcon,
  TrashIcon,
  EyeIcon,
  UserIcon,
  CalendarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ArrowPathIcon,
  PencilIcon
} from '@heroicons/react/24/outline'
import { useAuth } from '../hooks/useAuth'
import AdminAssignmentModal from '../components/AdminAssignmentModal'

interface ExcelFile {
  _id: string
  filename: string
  originalName: string
  fileSize: number
  uploadedBy: {
    _id: string
    name: string
    email: string
    role?: string
  }
  assignedTo: {
    _id: string
    name: string
    email: string
  }
  assignedAdmins?: Array<{
    _id: string
    name: string
    email: string
  }>
  sharedAdmins?: Array<{
    _id: string
    name: string
    email: string
  }>
  totalRows: number
  processedRows: number
  failedRows: number
  skippedRows: number
  status: 'processing' | 'completed' | 'failed' | 'partial'
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

interface UploadForm {
  file: File | null
  assignedTo: string
  assignedAdmins: string[]
  sharedAdmins: string[] // For admin-to-admin file sharing
}

export default function ExcelFiles() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  
  // State for filters and pagination
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  
  // State for upload modal
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadForm, setUploadForm] = useState<UploadForm>({
    file: null,
    assignedTo: '',
    assignedAdmins: [],
    sharedAdmins: []
  })
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('')

  // State for assignment modal
  const [showAssignmentModal, setShowAssignmentModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<ExcelFile | null>(null)
  
  // State for sharing details modal
  const [showSharingModal, setShowSharingModal] = useState(false)
  const [selectedSharingFile, setSelectedSharingFile] = useState<ExcelFile | null>(null)
  
  // State for edit sharing modal
  const [showEditSharingModal, setShowEditSharingModal] = useState(false)
  const [selectedEditFile, setSelectedEditFile] = useState<ExcelFile | null>(null)
  const [editSharedAdmins, setEditSharedAdmins] = useState<string[]>([])

  // Fetch Excel files
  const { data, isLoading, error } = useQuery({
    queryKey: ['excel-files', { search, status, page, currentUser: currentUser?.role }],
    queryFn: () => excelAPI.getFiles({ search, status, page, limit: 10 }),
    staleTime: 30000,
  })

  // Fetch admins for assignment (for super admin) or sharing (for admin with permission)
  const { data: adminsData, error: adminsError, isLoading: adminsLoading } = useQuery({
    queryKey: ['admins'],
    queryFn: () => usersAPI.getAdmins(),
    enabled: (currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin') || 
             (currentUser?.role === 'admin' && currentUser?.canShareFiles),
    retry: 1,
    onError: (error) => {
      console.error('Failed to fetch admins:', error)
    }
  })

  // Fetch user's file storage limits
  const { data: storageLimitsData } = useQuery({
    queryKey: ['file-storage-my-limits'],
    queryFn: () => fileStorageAPI.getMyLimits(),
    enabled: !!currentUser?.role,
  })

  const storageLimits = storageLimitsData?.data?.data

  // Mutations
  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) => excelAPI.upload(formData),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['excel-files'] })
      queryClient.invalidateQueries({ queryKey: ['excel-vehicles-fast'] })
      
      // Show success message with storage type info if available
      const storageType = response?.data?.data?.storageType
      const message = storageType === 'GCS' 
        ? 'Excel file uploaded to cloud storage successfully' 
        : 'Excel file uploaded successfully'
      toast.success(message)
      
      setShowUploadModal(false)
      resetUploadForm()
    },
    onError: (error: any) => {
      // Handle storage quota exceeded (507)
      if (error.response?.status === 507) {
        toast.error(
          error.response?.data?.message || 
          'Storage quota exceeded. Please contact administrator to upgrade your storage plan.',
          { duration: 6000 }
        )
      } 
      // Handle GCS configuration errors
      else if (error.response?.data?.message?.includes('Google Cloud Storage') || 
               error.response?.data?.message?.includes('GCS')) {
        toast.error(
          error.response?.data?.message || 
          'Cloud storage configuration error. Please contact administrator.',
          { duration: 5000 }
        )
      }
      // Generic error
      else {
        toast.error(error.response?.data?.message || 'Failed to upload file')
      }
    }
  })

  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      setDeletingFileId(fileId)
      
      // Show initial loading toast
      const toastId = toast.loading('Starting deletion...', {
        duration: 5000
      })

      // Simulate progress updates
      const progressSteps = [
        { delay: 300, message: '🗑️ Deleting VehicleLookup records...' },
        { delay: 600, message: '🗑️ Deleting ExcelVehicle records...' },
        { delay: 900, message: '🗑️ Deleting ExcelFile record...' },
        { delay: 1200, message: '🗑️ Deleting GCS file...' },
        { delay: 1500, message: '🧹 Clearing cache...' }
      ]

      // Update progress
      for (const step of progressSteps) {
        await new Promise(resolve => setTimeout(resolve, step.delay))
        toast.loading(step.message, { id: toastId })
      }

      // Make the actual API call
      const response = await excelAPI.deleteFile(fileId)
      
      // Dismiss loading toast
      toast.dismiss(toastId)
      
      return { response, fileId }
    },
    onSuccess: ({ response, fileId }) => {
      setDeletingFileId(null)
      
      // Optimistically remove from UI
      queryClient.setQueryData(['excel-files'], (oldData: any) => {
        if (!oldData?.data?.data) return oldData
        return {
          ...oldData,
          data: {
            ...oldData.data,
            data: oldData.data.data.filter((file: ExcelFile) => file._id !== fileId)
          }
        }
      })
      
      // Invalidate to refresh
      queryClient.invalidateQueries({ queryKey: ['excel-files'] })
      
      // Show success with details
      const deleted = response.data?.deleted || {}
      const vehicleCount = (deleted.vehicleLookup || 0) + (deleted.excelVehicle || 0)
      toast.success(
        `✅ File deleted successfully! Removed ${vehicleCount} vehicle record${vehicleCount !== 1 ? 's' : ''}`,
        { duration: 4000 }
      )
    },
    onError: (error: any) => {
      setDeletingFileId(null)
      toast.error(error.response?.data?.message || 'Failed to delete file', { duration: 4000 })
    }
  })

  const reassignMutation = useMutation({
    mutationFn: ({ fileId, assignedTo }: { fileId: string; assignedTo: string }) => 
      excelAPI.reassignFile(fileId, { assignedTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['excel-files'] })
      toast.success('File reassigned successfully')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reassign file')
    }
  })

  // Mutation for updating shared admins
  const updateSharedAdminsMutation = useMutation({
    mutationFn: ({ fileId, sharedAdmins }: { fileId: string; sharedAdmins: string[] }) => 
      excelAPI.updateSharedAdmins(fileId, { sharedAdmins }),
    onSuccess: (response: any) => {
      console.log('✅ Shared admins updated:', response.data);
      // Invalidate and refetch immediately
      queryClient.invalidateQueries({ queryKey: ['excel-files'] })
      queryClient.refetchQueries({ queryKey: ['excel-files'] })
      setShowEditSharingModal(false)
      setSelectedEditFile(null)
      setEditSharedAdmins([])
      toast.success('Shared admins updated successfully')
    },
    onError: (error: any) => {
      console.error('❌ Failed to update shared admins:', error);
      toast.error(error.response?.data?.message || 'Failed to update shared admins')
    }
  })

  const files = data?.data?.data || []
  const pagination = data?.data?.pagination
  const admins = Array.isArray(adminsData?.data?.data) ? adminsData.data.data : []
  
  // Debug logging
  console.log('Current user role:', currentUser?.role)
  console.log('Show upload modal:', showUploadModal)
  console.log('Admins data:', adminsData)
  console.log('Admins array:', admins)
  console.log('Admins loading:', adminsLoading)
  console.log('Admins error:', adminsError)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      if (!file.name.match(/\.(xlsx|xls)$/)) {
        toast.error('Please select a valid Excel file (.xlsx or .xls)')
        return
      }
      
      // Validate file size (50MB)
      if (file.size > 50 * 1024 * 1024) {
        toast.error('File size must be less than 50MB')
        return
      }

      setUploadForm(prev => ({ ...prev, file }))
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!uploadForm.file) {
      toast.error('Please select a file')
      return
    }

    // Validate admin assignment for super admin
    if ((currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin') && !uploadForm.assignedTo) {
      toast.error('Please select an admin to assign this file to')
      return
    }

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStatus('Starting upload...')
    
    // Start progress simulation
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) return 90 // Cap at 90% until actual completion
        return prev + Math.random() * 10 + 5 // Random increment between 5-15%
      })
    }, 500)

      // Update status messages
      const statusInterval = setInterval(() => {
        setUploadStatus(prev => {
          if (prev.includes('Uploading')) return 'Uploading to cloud storage...'
          if (prev.includes('Processing')) return 'Validating data...'
          if (prev.includes('Validating')) return 'Processing rows...'
          if (prev.includes('Processing rows')) return 'Creating vehicles...'
          return 'Uploading to cloud storage...'
        })
      }, 1500)
    
    try {
      const formData = new FormData()
      formData.append('excelFile', uploadForm.file)
      
      if ((currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin') && uploadForm.assignedTo) {
        formData.append('assignedTo', uploadForm.assignedTo)
        if (uploadForm.assignedAdmins.length > 0) {
          formData.append('assignedAdmins', JSON.stringify(uploadForm.assignedAdmins))
        }
      }
      
      // For admin users with sharing permission, send sharedAdmins
      if (currentUser?.role === 'admin' && currentUser?.canShareFiles && uploadForm.sharedAdmins.length > 0) {
        formData.append('sharedAdmins', JSON.stringify(uploadForm.sharedAdmins))
      }

      await uploadMutation.mutateAsync(formData)
      
      // Complete the progress
      setUploadProgress(100)
      setUploadStatus('Upload completed!')
      
      // Clear intervals
      clearInterval(progressInterval)
      clearInterval(statusInterval)
      
      // Reset after a short delay
      setTimeout(() => {
        setUploadProgress(0)
        setUploadStatus('')
      }, 2000)
      
    } catch (error) {
      // Clear intervals on error
      clearInterval(progressInterval)
      clearInterval(statusInterval)
      setUploadProgress(0)
      setUploadStatus('')
    } finally {
      setIsUploading(false)
    }
  }

  const resetUploadForm = () => {
    setUploadForm({
      file: null,
      assignedTo: '',
      assignedAdmins: [],
      sharedAdmins: []
    })
  }

  const handleDelete = (fileId: string) => {
    if (window.confirm('Are you sure you want to delete this file? This will also delete all related vehicle data.')) {
      deleteMutation.mutate(fileId)
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const response = await excelAPI.downloadTemplate()
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'vehicle_template.xlsx'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      toast.success('Template downloaded successfully')
    } catch (error) {
      toast.error('Failed to download template')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />
      case 'failed':
        return <XCircleIcon className="h-5 w-5 text-red-500" />
      case 'partial':
        return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />
      case 'processing':
        return <ClockIcon className="h-5 w-5 text-blue-500" />
      default:
        return <ClockIcon className="h-5 w-5 text-gray-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'partial':
        return 'bg-yellow-100 text-yellow-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Function to determine if user can see original filename
  // Rules:
  // 1. Super Admin uploads:
  //    - Primary admin (assignedTo): Original filename
  //    - Other assigned admins (assignedAdmins): Masked filename
  // 2. Admin uploads:
  //    - Primary admin (uploadedBy): Original filename
  //    - Shared admins (sharedAdmins): Masked filename (only if file is shared)
  const getDisplayFileName = (file: ExcelFile): string => {
    if (!currentUser) return 'Excel File'
    
    const currentUserId = currentUser._id
    const isSuperAdmin = currentUser?.role === 'superAdmin' || currentUser?.role === 'superSuperAdmin'
    
    // Super Admins always see original filename
    if (isSuperAdmin) {
      return file.originalName
    }
    
    const isSuperAdminUpload = file.uploadedBy.role === 'superAdmin' || file.uploadedBy.role === 'superSuperAdmin'
    const isAdminUpload = file.uploadedBy.role === 'admin'
    
    // ========== SUPER ADMIN UPLOAD ==========
    if (isSuperAdminUpload) {
      if (currentUser?.role === 'admin') {
        // Check if current user is primary admin (assignedTo)
        const isPrimaryAdmin = file.assignedTo._id === currentUserId
        
        if (isPrimaryAdmin) {
          // Primary admin: Original filename
          return file.originalName
        }
        
        // Check if current user is in assignedAdmins (other assigned admins)
        const isInAssignedAdmins = file.assignedAdmins?.some((admin: any) => {
          const adminId = typeof admin === 'string' ? admin : (admin._id || admin)
          return adminId === currentUserId
        })
        
        if (isInAssignedAdmins) {
          // Other assigned admins: Masked filename
          return `FILE_${file._id.substring(0, 8).toUpperCase()}.xlsx`
        }
      } else if (currentUser?.role === 'auditor' && currentUser?.createdBy?._id) {
        // Check if auditor's admin is primary admin (assignedTo)
        const isPrimaryAdminAuditor = file.assignedTo._id === currentUser.createdBy._id
        
        if (isPrimaryAdminAuditor) {
          // Primary admin's auditor: Original filename
          return file.originalName
        }
        
        // Check if auditor's admin is in assignedAdmins (other assigned admins)
        const isAssignedAdminAuditor = file.assignedAdmins?.some((admin: any) => {
          const adminId = typeof admin === 'string' ? admin : (admin._id || admin)
          return adminId === currentUser.createdBy._id
        })
        
        if (isAssignedAdminAuditor) {
          // Assigned admin's auditor: Masked filename
          return `FILE_${file._id.substring(0, 8).toUpperCase()}.xlsx`
        }
      }
    }
    
    // ========== ADMIN UPLOAD ==========
    if (isAdminUpload) {
      if (currentUser?.role === 'admin') {
        // Check if current user is the uploader (primary admin)
        const isUploader = file.uploadedBy._id === currentUserId
        
        if (isUploader) {
          // Primary admin (uploader): Original filename
          return file.originalName
        }
        
        // Check if current user is in sharedAdmins (only if file is shared)
        const isSharedAdmin = file.sharedAdmins?.some((admin: any) => {
          const adminId = typeof admin === 'string' ? admin : (admin._id || admin)
          return adminId === currentUserId
        })
        
        if (isSharedAdmin) {
          // Shared admin: Masked filename
          return `FILE_${file._id.substring(0, 8).toUpperCase()}.xlsx`
        }
        
        // If admin upload and user is not uploader and not in sharedAdmins, they shouldn't see this file
        // But if they do (edge case), show masked name
        return 'Excel File'
      } else if (currentUser?.role === 'auditor' && currentUser?.createdBy?._id) {
        // Check if auditor's admin is the uploader (primary admin)
        const isOwnerAuditor = file.uploadedBy._id === currentUser.createdBy._id
        
        if (isOwnerAuditor) {
          // Primary admin's auditor (owner): Original filename
          return file.originalName
        }
        
        // Check if auditor's admin is in sharedAdmins
        const isSharedAdminAuditor = file.sharedAdmins?.some((admin: any) => {
          const adminId = typeof admin === 'string' ? admin : (admin._id || admin)
          return adminId === currentUser.createdBy._id
        })
        
        if (isSharedAdminAuditor) {
          // Shared admin's auditor: Masked filename
          return `FILE_${file._id.substring(0, 8).toUpperCase()}.xlsx`
        }
        
        // If auditor's admin doesn't have access, they shouldn't see this file
        return 'Excel File'
      }
    }
    
    // For others (field agents, etc.), show masked name
    return 'Excel File'
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
        <p className="text-red-600">Failed to load Excel files</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Excel Files</h1>
          <p className="text-gray-600">Manage uploaded Excel files and vehicle data</p>
        </div>
        <div className="flex space-x-3">
          <button 
            className="btn-secondary"
            onClick={handleDownloadTemplate}
          >
            <DocumentArrowDownIcon className="h-5 w-5" />
            Download Template
          </button>
          {(currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin' || currentUser?.role === 'admin') && (
            <button 
              className="btn-primary"
              onClick={() => setShowUploadModal(true)}
            >
              <DocumentArrowUpIcon className="h-5 w-5" />
              Upload Excel
            </button>
          )}
        </div>
      </div>

      {/* Admin File Sharing Summary */}
      {currentUser?.role === 'admin' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <UserIcon className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-medium text-blue-900">Your File Sharing Overview</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-white rounded-lg p-3 border border-blue-200">
              <div className="text-blue-600 font-medium">
                {files.filter((f: ExcelFile) => f.uploadedBy._id === currentUser._id).length}
              </div>
              <div className="text-blue-700">Files You Uploaded</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-200">
              <div className="text-blue-600 font-medium">
                {files.filter((f: ExcelFile) => f.uploadedBy._id === currentUser._id).reduce((total: number, file: ExcelFile) => 
                  total + (file.assignedAdmins?.length || 0), 0
                )}
              </div>
              <div className="text-blue-700">Total Admin Access</div>
            </div>
            <div className="bg-white rounded-lg p-3 border border-blue-200">
              <div className="text-blue-600 font-medium">
                {files.filter((f: ExcelFile) => f.uploadedBy._id !== currentUser._id && 
                  (f.assignedTo._id === currentUser._id || f.assignedAdmins?.some((a: any) => a._id === currentUser._id))
                ).length}
              </div>
              <div className="text-blue-700">Files Shared With You</div>
            </div>
          </div>
          <div className="mt-3 text-xs text-blue-600">
            💡 You can see who has access to your uploaded files below. This ensures complete transparency of data sharing.
          </div>
        </div>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search files..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input pl-10"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="input"
                >
                  <option value="">All Status</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="partial">Partial</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Files List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          {files.length === 0 ? (
            <div className="text-center py-12">
              <DocumentArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No Excel files</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by uploading an Excel file.
              </p>
              {(currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin' || currentUser?.role === 'admin') && (
                <div className="mt-6">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowUploadModal(true)}
                  >
                    <DocumentArrowUpIcon className="h-5 w-5" />
                    Upload Excel File
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {files.map((file: ExcelFile) => (
                <div key={file._id} className="border-2 border-gray-400 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex-shrink-0">
                        <DocumentArrowUpIcon className="h-8 w-8 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {getDisplayFileName(file)}
                        </p>
                        <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                          <span>{formatFileSize(file.fileSize)}</span>
                          <span>•</span>
                          <span>{file.totalRows} rows</span>
                          <span>•</span>
                          <span className="flex items-center">
                            {getStatusIcon(file.status)}
                            <span className={`ml-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(file.status)}`}>
                              {file.status}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 mt-2 text-xs text-gray-400">
                          <span className="flex items-center">
                            <UserIcon className="h-3 w-3 mr-1" />
                            Uploaded by {file.uploadedBy.name}
                            {file.uploadedBy.role && (
                              <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                                file.uploadedBy.role === 'admin' 
                                  ? 'bg-blue-100 text-blue-700' 
                                  : 'bg-purple-100 text-purple-700'
                              }`}>
                                {file.uploadedBy.role === 'admin' ? 'Admin' : 'Super Admin'}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center">
                            <UserIcon className="h-3 w-3 mr-1" />
                            Primary: {file.assignedTo.name}
                          </span>
                          <span className="flex items-center">
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            {new Date(file.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        
                        {/* Assigned Admins Display */}
                        {/* Always show for admin uploads, or if there are assigned/shared admins */}
                        {((currentUser?.role === 'admin' && file.uploadedBy._id === currentUser._id) || 
                          (file.assignedAdmins && file.assignedAdmins.length > 0) || 
                          (file.sharedAdmins && file.sharedAdmins.length > 0)) && (
                          <div className="mt-2">
                            {/* Show comprehensive access info for admin who uploaded the file */}
                            {currentUser?.role === 'admin' && file.uploadedBy._id === currentUser._id && (() => {
                              // For admin uploads, show sharedAdmins (exclude the uploader/primary admin)
                              const sharedAdminsList = file.sharedAdmins?.filter((admin: any) => {
                                const adminId = typeof admin === 'object' ? admin._id : admin;
                                return adminId !== file.uploadedBy._id;
                              }) || [];
                              
                              // For super admin uploads, show assignedAdmins (exclude the primary admin)
                              const assignedAdminsList = file.assignedAdmins?.filter((admin: any) => {
                                const adminId = typeof admin === 'object' ? admin._id : admin;
                                const primaryAdminId = file.assignedTo?._id || file.assignedTo;
                                return adminId !== primaryAdminId;
                              }) || [];
                              
                              // Use sharedAdmins for admin uploads, assignedAdmins for super admin uploads
                              const adminsToShow = file.sharedAdmins && file.sharedAdmins.length > 0 ? sharedAdminsList : assignedAdminsList;
                              
                              // Always show the section for admin uploads, even if no admins have access
                              return (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 relative">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center space-x-2 text-xs text-blue-700">
                                      <UserIcon className="h-3 w-3" />
                                      <span className="font-medium">Your file is shared with:</span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        const currentSharedAdmins = file.sharedAdmins?.map((admin: any) => 
                                          typeof admin === 'object' ? admin._id : admin
                                        ) || [];
                                        setEditSharedAdmins(currentSharedAdmins);
                                        setSelectedEditFile(file);
                                        setShowEditSharingModal(true);
                                      }}
                                      className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded transition-colors"
                                      title="Edit shared admins"
                                    >
                                      <PencilIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                  {adminsToShow.length > 0 ? (
                                    <>
                                      <div className="flex flex-wrap gap-1">
                                        {adminsToShow.map((admin: any, index: number) => {
                                          const adminName = typeof admin === 'object' ? admin.name : admin;
                                          const adminId = typeof admin === 'object' ? admin._id : admin;
                                          return (
                                            <span key={adminId} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                                              {adminName}
                                              {index < adminsToShow.length - 1 && ','}
                                            </span>
                                          );
                                        })}
                                      </div>
                                      <div className="text-xs text-blue-600 mt-1">
                                        Total: {adminsToShow.length} admin{adminsToShow.length !== 1 ? 's' : ''} have access
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-xs text-gray-500 italic">
                                      No admins have access to this file. Click the edit button to share with other admins.
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            
                            {/* Show "Also assigned to" ONLY for primary admin */}
                            {(() => {
                              // Check if current user is the primary admin
                              const primaryAdminId = file.assignedTo?._id || file.assignedTo;
                              const currentUserId = currentUser?._id;
                              const isPrimaryAdmin = primaryAdminId === currentUserId;
                              
                              // Also check for superSuperAdmin/superAdmin (they can see everything)
                              const isSuperAdmin = currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin';
                              
                              // Only show if user is primary admin or super admin
                              if (!isPrimaryAdmin && !isSuperAdmin) {
                                return null;
                              }
                              
                              // Filter out the primary admin from assignedAdmins
                              const otherAdmins = file.assignedAdmins?.filter((admin: any) => {
                                const adminId = typeof admin === 'object' ? admin._id : admin;
                                return adminId !== primaryAdminId;
                              }) || [];
                              
                              return otherAdmins.length > 0 ? (
                                <div className="flex items-center space-x-2 text-xs text-gray-500">
                                  <UserIcon className="h-3 w-3" />
                                  <span>Also assigned to:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {otherAdmins.map((admin: any, index: number) => (
                                      <span key={typeof admin === 'object' ? admin._id : admin} className="bg-gray-100 px-2 py-1 rounded text-xs">
                                        {typeof admin === 'object' ? admin.name : admin}
                                        {index < otherAdmins.length - 1 && ','}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null;
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {/* Show sharing details button for admin who uploaded the file */}
                      {currentUser?.role === 'admin' && file.uploadedBy._id === currentUser._id && (
                        <button
                          onClick={() => {
                            setSelectedSharingFile(file);
                            setShowSharingModal(true);
                          }}
                          className="text-green-600 hover:text-green-800 p-2"
                          title="View sharing details"
                        >
                          <EyeIcon className="h-5 w-5" />
                        </button>
                      )}
                      {(currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin') && (
                        <button
                          onClick={() => {
                            setSelectedFile(file);
                            setShowAssignmentModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-800 p-2"
                          title="Manage admin assignments"
                        >
                          <UserIcon className="h-5 w-5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(file._id)}
                        disabled={deleteMutation.isPending}
                        className={`p-2 ${
                          deleteMutation.isPending && deletingFileId === file._id
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-red-600 hover:text-red-800'
                        }`}
                        title={deleteMutation.isPending && deletingFileId === file._id ? 'Deleting...' : 'Delete file'}
                      >
                        {deleteMutation.isPending && deletingFileId === file._id ? (
                          <ArrowPathIcon className="h-5 w-5 animate-spin" />
                        ) : (
                          <TrashIcon className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>
                  
                  {/* Processing Results */}
                  {file.status !== 'processing' && (
                    <div className="mt-4 pt-4 border-t-2 border-gray-400">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="text-center">
                          <p className="text-green-600 font-medium">{file.processedRows}</p>
                          <p className="text-gray-500">Processed</p>
                        </div>
                        <div className="text-center">
                          <p className="text-yellow-600 font-medium">{file.skippedRows}</p>
                          <p className="text-gray-500">Skipped</p>
                        </div>
                        <div className="text-center">
                          <p className="text-red-600 font-medium">{file.failedRows}</p>
                          <p className="text-gray-500">Failed</p>
                        </div>
                      </div>
                      {file.errorMessage && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                          {file.errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex justify-center">
          <nav className="flex space-x-2">
            {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((pageNum) => (
              <button
                key={pageNum}
                onClick={() => setPage(pageNum)}
                className={`px-3 py-2 text-sm font-medium rounded-md ${
                  pageNum === page
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 border-2 border-gray-400'
                }`}
              >
                {pageNum}
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Upload Excel File</h3>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Excel File
                  </label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    className="input"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Only .xlsx and .xls files up to 50MB are allowed
                  </p>
                  
                  {/* Storage Limits Info */}
                  {storageLimits && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center space-x-2 mb-2">
                        <DocumentArrowUpIcon className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-900">Your Total Storage Limits</span>
                      </div>
                      <div className="text-xs text-blue-700 space-y-1">
                        <div>Total Limit: {storageLimits.totalRecordLimit.toLocaleString()} records</div>
                        <div>Used: {storageLimits.usedRecords.toLocaleString()} records</div>
                        <div>Remaining: {storageLimits.remainingRecords.toLocaleString()} records</div>
                        <div className="text-blue-600 font-medium">{storageLimits.description}</div>
                      </div>
                    </div>
                  )}
                </div>

                                 {(currentUser?.role === 'superSuperAdmin' || currentUser?.role === 'superAdmin') && (
                   <div>
                     <label className="block text-sm font-medium text-gray-700 mb-2">
                       Assign to Admin(s)
                     </label>
                     {adminsLoading ? (
                       <div className="text-blue-600 text-sm mb-2">
                         Loading admins...
                       </div>
                     ) : adminsError ? (
                       <div className="text-red-600 text-sm mb-2">
                         Failed to load admins. Please try again.
                       </div>
                     ) : (
                       <div className="space-y-3">
                         {/* Primary Admin Selection */}
                         <div>
                           <label className="block text-xs font-medium text-gray-600 mb-1">
                             Primary Admin (Required)
                           </label>
                           <select
                             value={uploadForm.assignedTo}
                             onChange={(e) => {
                               const selectedAdmin = e.target.value;
                               setUploadForm(prev => ({
                                 ...prev,
                                 assignedTo: selectedAdmin,
                                 assignedAdmins: selectedAdmin ? [selectedAdmin] : []
                               }));
                             }}
                             className="input"
                             required
                           >
                             <option value="">Select primary admin</option>
                             {admins.map((admin: any) => (
                               <option key={admin._id} value={admin._id}>
                                 {admin.name} ({admin.email})
                               </option>
                             ))}
                           </select>
                         </div>

                         {/* Additional Admins Selection */}
                         <div>
                           <label className="block text-xs font-medium text-gray-600 mb-1">
                             Additional Admins (Optional)
                           </label>
                           <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2">
                             {admins.map((admin: any) => (
                               <label key={admin._id} className="flex items-center space-x-2 py-1">
                                 <input
                                   type="checkbox"
                                   checked={uploadForm.assignedAdmins.includes(admin._id)}
                                   onChange={(e) => {
                                     if (e.target.checked) {
                                       setUploadForm(prev => ({
                                         ...prev,
                                         assignedAdmins: [...prev.assignedAdmins, admin._id]
                                       }));
                                     } else {
                                       setUploadForm(prev => ({
                                         ...prev,
                                         assignedAdmins: prev.assignedAdmins.filter(id => id !== admin._id)
                                       }));
                                     }
                                   }}
                                   disabled={admin._id === uploadForm.assignedTo}
                                   className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                 />
                                 <span className="text-sm text-gray-700">
                                   {admin.name} ({admin.email})
                                   {admin._id === uploadForm.assignedTo && (
                                     <span className="text-blue-600 text-xs ml-1">(Primary)</span>
                                   )}
                                 </span>
                               </label>
                             ))}
                           </div>
                           <p className="text-xs text-gray-500 mt-1">
                             Selected: {uploadForm.assignedAdmins.length} admin(s)
                           </p>
                         </div>
                       </div>
                     )}
                     {admins.length === 0 && !adminsError && !adminsLoading && (
                       <p className="text-sm text-gray-500 mt-1">
                         No admins available. Please create an admin user first.
                       </p>
                     )}
                   </div>
                 )}

                 {/* Admin File Sharing Section (for admins with permission) */}
                 {currentUser?.role === 'admin' && currentUser?.canShareFiles && (
                   <div>
                     <label className="block text-sm font-medium text-gray-700 mb-2">
                       Share with Other Admins (Optional)
                     </label>
                     {adminsLoading ? (
                       <div className="text-blue-600 text-sm mb-2">
                         Loading admins...
                       </div>
                     ) : adminsError ? (
                       <div className="text-red-600 text-sm mb-2">
                         Failed to load admins. Please try again.
                       </div>
                     ) : (
                       <div className="space-y-2">
                         <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-md p-2">
                           {(() => {
                             // Filter admins based on allowedSharingAdmins if current user is an admin
                             let filteredAdmins = admins.filter((admin: any) => admin._id !== currentUser._id);
                             
                             // If current user is an admin and has allowedSharingAdmins restriction, filter the list
                             // Only filter if allowedSharingAdmins is defined and has items (empty array means no restrictions)
                             if (currentUser?.role === 'admin' && currentUser?.allowedSharingAdmins !== undefined && Array.isArray(currentUser.allowedSharingAdmins) && currentUser.allowedSharingAdmins.length > 0) {
                               const allowedIds = currentUser.allowedSharingAdmins.map((a: any) => {
                                 if (typeof a === 'string') return a
                                 if (typeof a === 'object' && a._id) return a._id
                                 return String(a)
                               });
                               filteredAdmins = filteredAdmins.filter((admin: any) => allowedIds.includes(admin._id));
                             }
                             
                             return filteredAdmins;
                           })().map((admin: any) => (
                             <label key={admin._id} className="flex items-center space-x-2 py-1">
                               <input
                                 type="checkbox"
                                 checked={uploadForm.sharedAdmins.includes(admin._id)}
                                 onChange={(e) => {
                                   if (e.target.checked) {
                                     setUploadForm(prev => ({
                                       ...prev,
                                       sharedAdmins: [...prev.sharedAdmins, admin._id]
                                     }))
                                   } else {
                                     setUploadForm(prev => ({
                                       ...prev,
                                       sharedAdmins: prev.sharedAdmins.filter(id => id !== admin._id)
                                     }))
                                   }
                                 }}
                                 className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                               />
                               <span className="text-sm text-gray-700">
                                 {admin.name} ({admin.email})
                               </span>
                             </label>
                           ))}
                         </div>
                         <p className="text-xs text-gray-500">
                           Selected: {uploadForm.sharedAdmins.length} admin(s)
                         </p>
                         <p className="text-xs text-blue-600">
                           Selected admins will have restricted access with masked file names.
                         </p>
                       </div>
                     )}
                     {admins.filter((admin: any) => admin._id !== currentUser._id).length === 0 && !adminsError && !adminsLoading && (
                       <p className="text-sm text-gray-500 mt-1">
                         No other admins available to share with.
                       </p>
                     )}
                   </div>
                 )}

                                 {/* Progress Indicator */}
                 {isUploading && (
                   <div className="pt-4 border-t-2 border-gray-400">
                     <div className="space-y-3">
                       <div className="flex justify-between text-sm text-gray-600">
                         <span>{uploadStatus}</span>
                         <span>{uploadProgress}%</span>
                       </div>
                       <div className="w-full bg-gray-200 rounded-full h-2">
                         <div 
                           className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                           style={{ width: `${uploadProgress}%` }}
                         ></div>
                       </div>
                       <div className="text-xs text-gray-500 text-center">
                         {uploadProgress < 100 ? 'Please wait while we process your file...' : 'Upload completed successfully!'}
                       </div>
                     </div>
                   </div>
                 )}

                 <div className="flex justify-end space-x-3 pt-4">
                   <button
                     type="button"
                     onClick={() => {
                       setShowUploadModal(false)
                       resetUploadForm()
                     }}
                     className="btn-secondary"
                     disabled={isUploading}
                   >
                     Cancel
                   </button>
                   <button
                     type="submit"
                     className="btn-primary"
                     disabled={isUploading || !uploadForm.file}
                   >
                     {isUploading ? (
                       <>
                         <ArrowPathIcon className="h-5 w-5 animate-spin" />
                         Uploading...
                       </>
                     ) : (
                       <>
                         <DocumentArrowUpIcon className="h-5 w-5" />
                         Upload
                       </>
                     )}
                   </button>
                 </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* File Sharing Details Modal */}
      {showSharingModal && selectedSharingFile && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">File Sharing Details</h3>
                <button
                  onClick={() => {
                    setShowSharingModal(false);
                    setSelectedSharingFile(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircleIcon className="h-6 w-6" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <h4 className="font-medium text-blue-900 mb-2">{getDisplayFileName(selectedSharingFile)}</h4>
                  <div className="text-sm text-blue-700">
                    <p>Uploaded: {new Date(selectedSharingFile.createdAt).toLocaleDateString()}</p>
                    <p>Total Rows: {selectedSharingFile.totalRows}</p>
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Admins with Access</h4>
                  <div className="space-y-2">
                    {selectedSharingFile.assignedAdmins?.map((admin, index) => (
                      <div key={admin._id} className="flex items-center justify-between bg-gray-50 rounded-lg p-2">
                        <div className="flex items-center space-x-2">
                          <UserIcon className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-900">{admin.name}</span>
                          {index === 0 && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Primary</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{admin.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-sm text-green-700">
                    <p className="font-medium">Total Access: {selectedSharingFile.assignedAdmins?.length || 0} admin(s)</p>
                    <p className="text-xs mt-1">
                      💡 Ask Superadmin for access management permission. SuperAdmin can modify these assignments.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end mt-6">
                <button
                  onClick={() => {
                    setShowSharingModal(false);
                    setSelectedSharingFile(null);
                  }}
                  className="btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Sharing Modal */}
      {showEditSharingModal && selectedEditFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Edit Shared Admins</h3>
              <button
                onClick={() => {
                  setShowEditSharingModal(false);
                  setSelectedEditFile(null);
                  setEditSharedAdmins([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircleIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h4 className="font-medium text-blue-900 mb-2">{getDisplayFileName(selectedEditFile)}</h4>
                <div className="text-sm text-blue-700">
                  <p>Update which admins have access to this file</p>
                </div>
              </div>
              
              {adminsLoading ? (
                <div className="text-center py-4">Loading admins...</div>
              ) : adminsError ? (
                <div className="text-center py-4 text-red-600">Failed to load admins</div>
              ) : admins.length === 0 ? (
                <div className="text-center py-4 text-gray-500">No admins available</div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select admins to share with:
                  </label>
                  <div className="border border-gray-300 rounded-lg p-3 max-h-60 overflow-y-auto">
                    {(() => {
                      // Filter admins based on allowedSharingAdmins if current user is an admin
                      let filteredAdmins = admins.filter((admin: any) => admin._id !== currentUser?._id);
                      
                      // If current user is an admin and has allowedSharingAdmins restriction, filter the list
                      // Only filter if allowedSharingAdmins is defined and has items (empty array means no restrictions)
                      if (currentUser?.role === 'admin' && currentUser?.allowedSharingAdmins !== undefined && Array.isArray(currentUser.allowedSharingAdmins) && currentUser.allowedSharingAdmins.length > 0) {
                        const allowedIds = currentUser.allowedSharingAdmins.map((a: any) => {
                          if (typeof a === 'string') return a
                          if (typeof a === 'object' && a._id) return a._id
                          return String(a)
                        });
                        filteredAdmins = filteredAdmins.filter((admin: any) => allowedIds.includes(admin._id));
                      }
                      
                      return filteredAdmins;
                    })().map((admin: any) => (
                        <label key={admin._id} className="flex items-center space-x-2 py-1">
                          <input
                            type="checkbox"
                            checked={editSharedAdmins.includes(admin._id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditSharedAdmins([...editSharedAdmins, admin._id]);
                              } else {
                                setEditSharedAdmins(editSharedAdmins.filter(id => id !== admin._id));
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
                    Selected: {editSharedAdmins.length} admin(s)
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Selected admins will have restricted access with masked file names.
                  </p>
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                onClick={() => {
                  setShowEditSharingModal(false);
                  setSelectedEditFile(null);
                  setEditSharedAdmins([]);
                }}
                className="btn-secondary"
                disabled={updateSharedAdminsMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (selectedEditFile) {
                    updateSharedAdminsMutation.mutate({
                      fileId: selectedEditFile._id,
                      sharedAdmins: editSharedAdmins
                    });
                  }
                }}
                className="btn-primary"
                disabled={updateSharedAdminsMutation.isPending || adminsLoading}
              >
                {updateSharedAdminsMutation.isPending ? 'Updating...' : 'Update Access'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Assignment Modal */}
      <AdminAssignmentModal
        isOpen={showAssignmentModal}
        onClose={() => {
          setShowAssignmentModal(false);
          setSelectedFile(null);
        }}
        file={selectedFile}
        currentUser={currentUser}
      />
    </div>
  )
} 