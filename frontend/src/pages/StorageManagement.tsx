import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fileStorageAPI } from '../services/api';
import {
  ServerIcon,
  DocumentArrowUpIcon,
  UserGroupIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  PencilIcon,
  XMarkIcon,
  CheckCircleIcon,
  FolderIcon,
  TrashIcon
} from '@heroicons/react/24/outline';

interface StoragePlan {
  role: string;
  totalRecordLimit: number;
  description: string;
  updatedBy?: {
    name: string;
    email: string;
  };
  updatedAt: string;
}

interface RoleStatistic {
  role: string;
  totalRecords: number;
  totalFileSize: number;
  fileCount: number;
}

interface AdminUsage {
  adminId: string;
  adminName: string;
  adminEmail: string;
  adminRole: string;
  usedRecords: number;
  usedFileSize: number;
  fileCount: number;
  recordLimit: number;
  limitType: 'individual' | 'role';
  remainingRecords: number;
  usagePercent: number;
  hasCustomLimit: boolean;
}

interface FileDetail {
  fileId: string;
  filename: string;
  originalName: string;
  fileSize: number;
  fileSizeMB: string;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  skippedRows: number;
  status: string;
  uploadedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  assignedTo: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface CollectionStats {
  count: number;
  size: number;
  sizeMB: string;
  sizeGB: string;
  storageSize: number;
  storageSizeMB: string;
  storageSizeGB: string;
  totalIndexSize: number;
  totalIndexSizeMB: string;
  avgObjSize: number;
  nindexes: number;
  error?: string;
}

interface DbStats {
  dataSize: number;
  dataSizeMB: string;
  dataSizeGB: string;
  storageSize: number;
  storageSizeMB: string;
  storageSizeGB: string;
  indexSize: number;
  indexSizeMB: string;
  indexSizeGB: string;
  collections: number;
  objects: number;
  avgObjSize: number;
  error?: string;
}

interface StorageManagementData {
  summary: {
    totalFiles: number;
    totalFileSize: number;
    totalFileSizeMB: string;
    totalFileSizeGB: string;
    totalRecords: number;
    activeFiles: number;
    failedFiles: number;
    processingFiles: number;
  };
  storagePlans: StoragePlan[];
  roleStatistics: RoleStatistic[];
  adminUsage: AdminUsage[];
  fileDetails: FileDetail[];
  collectionStatistics?: Record<string, CollectionStats>;
  dbStats?: DbStats;
}

interface EditFormData {
  totalRecordLimit: number;
  description: string;
}

export default function StorageManagement() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StorageManagementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'plans' | 'admins' | 'files' | 'mongodb'>('overview');
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({
    totalRecordLimit: 0,
    description: ''
  });
  const [roleEditForm, setRoleEditForm] = useState<EditFormData>({
    totalRecordLimit: 0,
    description: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fileStorageAPI.getManagementData();
      setData(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch storage data');
      console.error('Error fetching storage management data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Set/Update user limit mutation
  const setLimitMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: EditFormData }) =>
      fileStorageAPI.setUserLimit({ userId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-limits'] });
      fetchData(); // Refresh data
      toast.success('Individual limit set successfully');
      setEditingAdminId(null);
      setEditForm({ totalRecordLimit: 0, description: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to set limit');
    }
  });

  // Update user limit mutation
  const updateLimitMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: EditFormData }) =>
      fileStorageAPI.updateUserLimit(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-limits'] });
      fetchData(); // Refresh data
      toast.success('Individual limit updated successfully');
      setEditingAdminId(null);
      setEditForm({ totalRecordLimit: 0, description: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update limit');
    }
  });

  // Delete user limit mutation
  const deleteLimitMutation = useMutation({
    mutationFn: (userId: string) => fileStorageAPI.deleteUserLimit(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-limits'] });
      fetchData(); // Refresh data
      toast.success('Individual limit removed. User will use role-based limit.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to remove limit');
    }
  });

  // Update role limit mutation
  const updateRoleLimitMutation = useMutation({
    mutationFn: ({ role, data }: { role: string; data: EditFormData }) =>
      fileStorageAPI.updateSetting(role, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-storage-settings'] });
      fetchData(); // Refresh data
      toast.success('Default role limit updated successfully');
      setEditingRole(null);
      setRoleEditForm({ totalRecordLimit: 0, description: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update role limit');
    }
  });

  const handleEditRole = (plan: StoragePlan) => {
    setRoleEditForm({
      totalRecordLimit: plan.totalRecordLimit,
      description: plan.description
    });
    setEditingRole(plan.role);
  };

  const handleCancelRoleEdit = () => {
    setEditingRole(null);
    setRoleEditForm({ totalRecordLimit: 0, description: '' });
  };

  const handleSaveRole = (role: string) => {
    updateRoleLimitMutation.mutate({ role, data: roleEditForm });
  };

  const handleEdit = (admin: AdminUsage) => {
    setEditForm({
      totalRecordLimit: admin.recordLimit,
      description: `Individual limit for ${admin.adminName}`
    });
    setEditingAdminId(admin.adminId);
  };

  const handleCancel = () => {
    setEditingAdminId(null);
    setEditForm({ totalRecordLimit: 0, description: '' });
  };

  const handleSave = (adminId: string) => {
    const admin = data?.adminUsage.find(a => a.adminId === adminId);
    if (admin?.hasCustomLimit) {
      updateLimitMutation.mutate({ userId: adminId, data: editForm });
    } else {
      setLimitMutation.mutate({ userId: adminId, data: editForm });
    }
  };

  const handleDelete = (adminId: string) => {
    if (window.confirm('Are you sure you want to remove this individual limit? The user will revert to their role-based limit.')) {
      deleteLimitMutation.mutate(adminId);
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-IN');
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Completed</span>;
      case 'partial':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">Partial</span>;
      case 'failed':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Failed</span>;
      case 'processing':
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Processing</span>;
      default:
        return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      superSuperAdmin: 'bg-orange-100 text-orange-800',
      superAdmin: 'bg-red-100 text-red-800',
      admin: 'bg-blue-100 text-blue-800',
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colors[role] || 'bg-gray-100 text-gray-800'}`}>
        {role.replace(/([A-Z])/g, ' $1').trim()}
      </span>
    );
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 80) return 'bg-red-500';
    if (percent >= 60) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center">
          <XMarkIcon className="h-5 w-5 text-red-600 mr-2" />
          <p className="text-red-800">{error}</p>
        </div>
        <button
          onClick={fetchData}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div>No data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Storage Management</h1>
            <p className="text-gray-600 mt-1">Monitor and manage individual storage limits for all admins</p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center"
          >
            <ArrowTrendingUpIcon className="h-5 w-5 mr-2" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Files</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatNumber(data.summary.totalFiles)}</p>
            </div>
            <FolderIcon className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Storage</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{data.summary.totalFileSizeGB} GB</p>
              <p className="text-xs text-gray-500 mt-1">{data.summary.totalFileSizeMB} MB</p>
            </div>
            <ServerIcon className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Records</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatNumber(data.summary.totalRecords)}</p>
            </div>
            <DocumentArrowUpIcon className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Files</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatNumber(data.summary.activeFiles)}</p>
              <p className="text-xs text-gray-500 mt-1">
                {data.summary.failedFiles} failed, {data.summary.processingFiles} processing
              </p>
            </div>
            <CheckCircleIcon className="h-8 w-8 text-green-500" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {[
              { id: 'overview', name: 'Overview', icon: ChartBarIcon },
              { id: 'plans', name: 'Default Role Limits', icon: ServerIcon },
              { id: 'admins', name: 'Individual Admin Limits', icon: UserGroupIcon },
              { id: 'files', name: 'All Files', icon: DocumentArrowUpIcon },
              { id: 'mongodb', name: 'MongoDB Statistics', icon: ServerIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center px-6 py-4 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="h-5 w-5 mr-2" />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Default Role Limits Overview */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Default Role Limits (Reference)</h3>
                <p className="text-sm text-gray-600 mb-4">
                  These are default limits for each role. Admins with individual limits use their custom limits instead.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {data.storagePlans.map((plan) => {
                    const roleStat = data.roleStatistics.find(s => s.role === plan.role);
                    const usage = roleStat ? (roleStat.totalRecords / plan.totalRecordLimit) * 100 : 0;
                    return (
                      <div key={plan.role} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-900">{getRoleBadge(plan.role)}</h4>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{plan.description}</p>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Total Individual Limit:</span>
                            <span className="font-semibold">{formatNumber(plan.totalRecordLimit)} records</span>
                          </div>
                          {roleStat && (
                            <>
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Used:</span>
                                <span className="font-semibold">{formatNumber(roleStat.totalRecords)} records</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${
                                    usage > 80 ? 'bg-red-500' : usage > 60 ? 'bg-yellow-500' : 'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(usage, 100)}%` }}
                                />
                              </div>
                              <div className="text-xs text-gray-500 text-right">
                                {usage.toFixed(1)}% used
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Individual Limits Summary */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Individual Limits Summary</h3>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Individual limits take priority over default role limits. 
                    Admins with custom limits are not affected by changes to default role limits.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Limit Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Individual Limit</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Used</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usage %</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {data.adminUsage.map((admin) => (
                        <tr key={admin.adminId}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{admin.adminName}</div>
                              <div className="text-xs text-gray-500">{admin.adminEmail}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">{getRoleBadge(admin.adminRole)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {admin.hasCustomLimit ? (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                                Individual
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                                Role Default
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatNumber(admin.recordLimit)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatNumber(admin.usedRecords)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                            {formatNumber(admin.remainingRecords)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className={`h-2 rounded-full ${getUsageColor(admin.usagePercent)}`}
                                  style={{ width: `${Math.min(admin.usagePercent, 100)}%` }}
                                />
                              </div>
                              <span className="text-sm text-gray-900">{admin.usagePercent.toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Default Role Limits Tab */}
          {activeTab === 'plans' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Default Role Limits:</strong> These are total individual limits per role. 
                  Admins without custom limits will use these defaults. Admins with custom limits are not affected by changes to these defaults.
                </p>
              </div>
              {data.storagePlans.map((plan) => {
                const roleStat = data.roleStatistics.find(s => s.role === plan.role);
                const usage = roleStat ? (roleStat.totalRecords / plan.totalRecordLimit) * 100 : 0;
                const isEditing = editingRole === plan.role;
                return (
                  <div key={plan.role} className={`bg-gray-50 rounded-lg p-6 border border-gray-200 ${isEditing ? 'ring-2 ring-primary-500' : ''}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        {getRoleBadge(plan.role)}
                        <h3 className="text-lg font-semibold text-gray-900">{plan.role.replace(/([A-Z])/g, ' $1').trim()}</h3>
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => handleEditRole(plan)}
                          className="btn btn-outline-primary btn-sm"
                          title="Edit default role limit"
                        >
                          <PencilIcon className="h-4 w-4 mr-2" />
                          Edit
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-4 bg-white p-4 rounded-lg border border-gray-300">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Total Individual Record Limit
                          </label>
                          <input
                            type="number"
                            value={roleEditForm.totalRecordLimit}
                            onChange={(e) => setRoleEditForm(prev => ({
                              ...prev,
                              totalRecordLimit: parseInt(e.target.value) || 0
                            }))}
                            className="input"
                            min="1000"
                            max="10000000"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Minimum: 1,000 | Maximum: 10,000,000
                          </p>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Description
                          </label>
                          <textarea
                            value={roleEditForm.description}
                            onChange={(e) => setRoleEditForm(prev => ({
                              ...prev,
                              description: e.target.value
                            }))}
                            className="input"
                            rows={3}
                            maxLength={500}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            {roleEditForm.description.length}/500 characters
                          </p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleSaveRole(plan.role)}
                            disabled={updateRoleLimitMutation.isPending}
                            className="btn btn-primary btn-sm"
                          >
                            {updateRoleLimitMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={handleCancelRoleEdit}
                            className="btn btn-outline btn-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-gray-600 mb-4">{plan.description}</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div>
                            <p className="text-sm text-gray-600">Total Individual Limit</p>
                            <p className="text-xl font-bold text-gray-900">{formatNumber(plan.totalRecordLimit)}</p>
                          </div>
                          {roleStat && (
                            <>
                              <div>
                                <p className="text-sm text-gray-600">Used Records</p>
                                <p className="text-xl font-bold text-gray-900">{formatNumber(roleStat.totalRecords)}</p>
                              </div>
                              <div>
                                <p className="text-sm text-gray-600">Remaining</p>
                                <p className="text-xl font-bold text-green-600">
                                  {formatNumber(plan.totalRecordLimit - roleStat.totalRecords)}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-gray-600">Usage</p>
                                <p className="text-xl font-bold text-gray-900">{usage.toFixed(1)}%</p>
                              </div>
                            </>
                          )}
                        </div>
                        {roleStat && (
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div
                              className={`h-3 rounded-full ${
                                usage > 80 ? 'bg-red-500' : usage > 60 ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(usage, 100)}%` }}
                            />
                          </div>
                        )}
                        {plan.updatedBy && (
                          <p className="text-xs text-gray-500 mt-4">
                            Updated by {plan.updatedBy.name} ({plan.updatedBy.email}) on{' '}
                            {new Date(plan.updatedAt).toLocaleDateString()}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Individual Admin Limits Tab */}
          {activeTab === 'admins' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Individual Admin Limits:</strong> Set custom limits for each admin. These limits take priority over default role limits.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Admin</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Files</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Records Used</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Individual Limit</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usage %</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Storage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.adminUsage.map((admin) => {
                      const isEditing = editingAdminId === admin.adminId;
                      return (
                        <tr key={admin.adminId} className={isEditing ? 'bg-blue-50' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{admin.adminName}</div>
                              <div className="text-sm text-gray-500">{admin.adminEmail}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">{getRoleBadge(admin.adminRole)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatNumber(admin.fileCount)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatNumber(admin.usedRecords)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="number"
                                  value={editForm.totalRecordLimit}
                                  onChange={(e) => setEditForm(prev => ({
                                    ...prev,
                                    totalRecordLimit: parseInt(e.target.value) || 0
                                  }))}
                                  className="input text-sm w-32"
                                  min="1000"
                                  max="10000000"
                                />
                                <div className="flex items-center space-x-1">
                                  {admin.hasCustomLimit ? (
                                    <span className="text-xs text-purple-600 font-semibold">Custom</span>
                                  ) : (
                                    <span className="text-xs text-gray-500">Will set custom</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="text-sm font-semibold text-gray-900">{formatNumber(admin.recordLimit)}</div>
                                {admin.hasCustomLimit ? (
                                  <span className="text-xs text-purple-600 font-semibold">Custom Limit</span>
                                ) : (
                                  <span className="text-xs text-gray-500">Role Default</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">{formatNumber(admin.remainingRecords)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                                <div
                                  className={`h-2 rounded-full ${getUsageColor(admin.usagePercent)}`}
                                  style={{ width: `${Math.min(admin.usagePercent, 100)}%` }}
                                />
                              </div>
                              <span className="text-sm text-gray-900">{admin.usagePercent.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatBytes(admin.usedFileSize)}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {isEditing ? (
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleSave(admin.adminId)}
                                  disabled={setLimitMutation.isPending || updateLimitMutation.isPending}
                                  className="btn btn-primary btn-xs"
                                >
                                  {setLimitMutation.isPending || updateLimitMutation.isPending ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={handleCancel}
                                  className="btn btn-outline btn-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleEdit(admin)}
                                  className="btn btn-outline-primary btn-xs"
                                  title="Edit individual limit"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                {admin.hasCustomLimit && (
                                  <button
                                    onClick={() => handleDelete(admin.adminId)}
                                    disabled={deleteLimitMutation.isPending}
                                    className="btn btn-outline-danger btn-xs"
                                    title="Remove custom limit"
                                  >
                                    <TrashIcon className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Files Tab */}
          {activeTab === 'files' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded By</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Records</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Upload Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.fileDetails.map((file) => (
                    <tr key={file.fileId}>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{file.originalName}</div>
                        <div className="text-xs text-gray-500">{file.filename}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm text-gray-900">{file.uploadedBy.name}</div>
                          <div className="text-xs text-gray-500">{file.uploadedBy.email}</div>
                          {getRoleBadge(file.uploadedBy.role)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{file.fileSizeMB} MB</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          <div>Total: {formatNumber(file.totalRows)}</div>
                          {file.processedRows > 0 && (
                            <div className="text-xs text-gray-500">
                              Processed: {formatNumber(file.processedRows)}
                            </div>
                          )}
                          {file.failedRows > 0 && (
                            <div className="text-xs text-red-500">
                              Failed: {formatNumber(file.failedRows)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(file.status)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(file.createdAt).toLocaleDateString()}
                        <div className="text-xs">{new Date(file.createdAt).toLocaleTimeString()}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* MongoDB Statistics Tab */}
          {activeTab === 'mongodb' && (
            <div className="space-y-6">
              {/* Database Level Statistics */}
              {data.dbStats && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Database Statistics</h3>
                  {data.dbStats.error ? (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-red-800">Error fetching database stats: {data.dbStats.error}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-gray-600 mb-1">Uncompressed Data Size</p>
                        <p className="text-xl font-bold text-gray-900">{data.dbStats.dataSizeGB} GB</p>
                        <p className="text-xs text-gray-500 mt-1">{data.dbStats.dataSizeMB} MB</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                        <p className="text-sm text-gray-600 mb-1">Compressed Storage Size</p>
                        <p className="text-xl font-bold text-gray-900">{data.dbStats.storageSizeGB} GB</p>
                        <p className="text-xs text-gray-500 mt-1">{data.dbStats.storageSizeMB} MB</p>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                        <p className="text-sm text-gray-600 mb-1">Index Size</p>
                        <p className="text-xl font-bold text-gray-900">{data.dbStats.indexSizeGB} GB</p>
                        <p className="text-xs text-gray-500 mt-1">{data.dbStats.indexSizeMB} MB</p>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
                        <p className="text-sm text-gray-600 mb-1">Total Collections</p>
                        <p className="text-xl font-bold text-gray-900">{formatNumber(data.dbStats.collections)}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatNumber(data.dbStats.objects)} documents</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Collection Level Statistics */}
              {data.collectionStatistics && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Collection Statistics</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Collection</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Documents</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uncompressed Size</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Compressed Storage</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Index Size</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Doc Size</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Indexes</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {Object.entries(data.collectionStatistics)
                          .sort(([, a], [, b]) => {
                            // Sort by compressed storage size (descending)
                            const sizeA = parseFloat(a.storageSizeMB) || 0;
                            const sizeB = parseFloat(b.storageSizeMB) || 0;
                            return sizeB - sizeA;
                          })
                          .map(([collectionName, stats]) => {
                            // Format uncompressed size - show MB if GB is too small
                            const uncompressedGB = parseFloat(stats.sizeGB);
                            const uncompressedDisplay = uncompressedGB >= 0.01 
                              ? `${stats.sizeGB} GB` 
                              : `${stats.sizeMB} MB`;
                            
                            // Format compressed size - show MB if GB is too small
                            const compressedGB = parseFloat(stats.storageSizeGB);
                            const compressedDisplay = compressedGB >= 0.01 
                              ? `${stats.storageSizeGB} GB` 
                              : `${stats.storageSizeMB} MB`;
                            
                            return (
                              <tr key={collectionName}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="text-sm font-medium text-gray-900 capitalize">{collectionName}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {formatNumber(stats.count)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="text-sm text-gray-900">{uncompressedDisplay}</div>
                                  {uncompressedGB >= 0.01 && (
                                    <div className="text-xs text-gray-500">{stats.sizeMB} MB</div>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="text-sm font-semibold text-green-700">{compressedDisplay}</div>
                                  {compressedGB >= 0.01 && (
                                    <div className="text-xs text-gray-500">{stats.storageSizeMB} MB</div>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {parseFloat(stats.totalIndexSizeMB) >= 0.01 
                                    ? `${stats.totalIndexSizeMB} MB` 
                                    : `${(parseFloat(stats.totalIndexSizeMB) * 1024).toFixed(2)} KB`}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {stats.avgObjSize > 0 ? formatBytes(stats.avgObjSize) : 'N/A'}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {stats.nindexes}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(!data.collectionStatistics && !data.dbStats) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-yellow-800">MongoDB statistics are not available. Please refresh the page.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
