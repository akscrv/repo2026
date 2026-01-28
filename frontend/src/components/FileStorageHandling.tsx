import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  Cog6ToothIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PencilIcon,
  XMarkIcon,
  UserGroupIcon,
  PlusIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { fileStorageAPI } from '../services/api';

interface AdminLimit {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  usedRecords: number;
  usedFileSize: number;
  fileCount: number;
  currentLimit: number;
  limitType: 'individual' | 'role';
  limitDescription: string;
  remainingRecords: number;
  usagePercent: number;
  hasCustomLimit: boolean;
  individualLimit: {
    _id: string;
    totalRecordLimit: number;
    description: string;
    updatedBy: {
      name: string;
      email: string;
    };
    updatedAt: string;
  } | null;
  roleLimit: {
    totalRecordLimit: number;
    description: string;
  } | null;
}

interface RoleSetting {
  _id: string;
  role: string;
  totalRecordLimit: number;
  description: string;
}

interface EditFormData {
  totalRecordLimit: number;
  description: string;
}

export default function FileStorageHandling() {
  const queryClient = useQueryClient();
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [creatingLimit, setCreatingLimit] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({
    totalRecordLimit: 0,
    description: ''
  });
  const [roleEditForm, setRoleEditForm] = useState<EditFormData>({
    totalRecordLimit: 0,
    description: ''
  });

  // Fetch admin limits
  const { data: adminLimitsData, isLoading, error } = useQuery({
    queryKey: ['admin-limits'],
    queryFn: () => fileStorageAPI.getAdminLimits(),
  });

  // Fetch role settings for reference
  const { data: roleSettingsData } = useQuery({
    queryKey: ['file-storage-settings'],
    queryFn: () => fileStorageAPI.getSettings(),
  });

  const adminLimits: AdminLimit[] = adminLimitsData?.data?.data || [];
  const roleSettings: RoleSetting[] = roleSettingsData?.data?.data || [];

  // Set/Update user limit mutation
  const setLimitMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: EditFormData }) =>
      fileStorageAPI.setUserLimit({ userId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-limits'] });
      toast.success('User storage limit set successfully');
      setEditingUserId(null);
      setCreatingLimit(null);
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
      toast.success('User storage limit updated successfully');
      setEditingUserId(null);
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
      toast.success('User limit removed. User will now use role-based limit.');
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
      queryClient.invalidateQueries({ queryKey: ['admin-limits'] });
      toast.success('Default role limit updated successfully');
      setEditingRole(null);
      setRoleEditForm({ totalRecordLimit: 0, description: '' });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update role limit');
    }
  });

  const handleEditRole = (setting: RoleSetting) => {
    // Replace cumulative with individual in description
    const cleanDescription = setting.description.replace(/cumulative/gi, 'individual');
    setRoleEditForm({
      totalRecordLimit: setting.totalRecordLimit,
      description: cleanDescription
    });
    setEditingRole(setting.role);
  };

  const handleCancelRoleEdit = () => {
    setEditingRole(null);
    setRoleEditForm({ totalRecordLimit: 0, description: '' });
  };

  const handleSaveRole = (role: string) => {
    updateRoleLimitMutation.mutate({ role, data: roleEditForm });
  };

  const handleEdit = (admin: AdminLimit) => {
    if (admin.hasCustomLimit && admin.individualLimit) {
      setEditForm({
        totalRecordLimit: admin.individualLimit.totalRecordLimit,
        description: admin.individualLimit.description
      });
    } else {
      // Pre-fill with role limit
      const roleLimit = admin.roleLimit;
      setEditForm({
        totalRecordLimit: roleLimit?.totalRecordLimit || 0,
        description: roleLimit?.description || ''
      });
    }
    setEditingUserId(admin.userId);
    setCreatingLimit(null);
  };

  const handleCreate = (admin: AdminLimit) => {
    const roleLimit = admin.roleLimit;
    setEditForm({
      totalRecordLimit: roleLimit?.totalRecordLimit || 0,
      description: `Custom limit for ${admin.userName}`
    });
    setCreatingLimit(admin.userId);
    setEditingUserId(null);
  };

  const handleCancel = () => {
    setEditingUserId(null);
    setCreatingLimit(null);
    setEditForm({ totalRecordLimit: 0, description: '' });
  };

  const handleSave = (userId: string) => {
    if (editingUserId === userId) {
      updateLimitMutation.mutate({ userId, data: editForm });
    } else {
      setLimitMutation.mutate({ userId, data: editForm });
    }
  };

  const handleDelete = (userId: string) => {
    if (window.confirm('Are you sure you want to remove this custom limit? The user will revert to their role-based limit.')) {
      deleteLimitMutation.mutate(userId);
    }
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-IN');
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

  // Group admins by role
  const adminsByRole = adminLimits.reduce((acc, admin) => {
    if (!acc[admin.userRole]) {
      acc[admin.userRole] = [];
    }
    acc[admin.userRole].push(admin);
    return acc;
  }, {} as Record<string, AdminLimit[]>);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Data</h2>
          <p className="text-gray-600">Failed to load admin storage limits. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="h-10 w-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Cog6ToothIcon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">File Storage Handling</h1>
            <p className="text-gray-600">Manage individual storage limits for each admin (Total Individual Limits)</p>
          </div>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <DocumentArrowUpIcon className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-900 mb-1">Total Individual Limits</h3>
              <p className="text-sm text-blue-700">
                Set individual record limits for each admin. Custom limits take priority over role-based defaults. 
                Admins with custom limits are not affected by changes to default role limits. Each admin has their own separate limit.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Default Role Limits (Reference) */}
      {roleSettings.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <UserGroupIcon className="h-5 w-5 mr-2 text-gray-500" />
            Default Role Limits (Total Individual Limits per Role)
          </h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> These are total individual limits per role. Admins without custom limits will use these defaults. 
              Admins with custom limits are not affected by changes to these defaults.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {roleSettings.map((setting) => {
              const isEditing = editingRole === setting.role;
              const displayDescription = setting.description.replace(/cumulative/gi, 'individual');
              return (
                <div key={setting._id} className={`bg-gray-50 rounded-lg p-4 border border-gray-200 ${isEditing ? 'ring-2 ring-primary-500' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      setting.role === 'superSuperAdmin' ? 'bg-orange-100 text-orange-800' :
                      setting.role === 'superAdmin' ? 'bg-red-100 text-red-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {setting.role.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    {!isEditing && (
                      <button
                        onClick={() => handleEditRole(setting)}
                        className="btn btn-outline-primary btn-xs"
                        title="Edit default role limit"
                      >
                        <PencilIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-3 bg-white p-3 rounded-lg border border-gray-300 mt-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Total Individual Record Limit
                        </label>
                        <input
                          type="number"
                          value={roleEditForm.totalRecordLimit}
                          onChange={(e) => setRoleEditForm(prev => ({
                            ...prev,
                            totalRecordLimit: parseInt(e.target.value) || 0
                          }))}
                          className="input text-sm"
                          min="1000"
                          max="10000000"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Min: 1,000 | Max: 10,000,000
                        </p>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Description
                        </label>
                        <textarea
                          value={roleEditForm.description}
                          onChange={(e) => setRoleEditForm(prev => ({
                            ...prev,
                            description: e.target.value
                          }))}
                          className="input text-sm"
                          rows={2}
                          maxLength={500}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {roleEditForm.description.length}/500 characters
                        </p>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleSaveRole(setting.role)}
                          disabled={updateRoleLimitMutation.isPending}
                          className="btn btn-primary btn-xs"
                        >
                          {updateRoleLimitMutation.isPending ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleCancelRoleEdit}
                          className="btn btn-outline btn-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-2">{displayDescription}</p>
                      <p className="text-lg font-bold text-gray-900">{formatNumber(setting.totalRecordLimit)} records</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Individual Admin Limits */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <UserGroupIcon className="h-5 w-5 mr-2 text-gray-500" />
            Individual Admin Limits
          </h2>
          <div className="text-sm text-gray-600">
            Total: {adminLimits.length} admins
          </div>
        </div>

        {Object.entries(adminsByRole).map(([role, admins]) => (
          <div key={role} className="mb-8">
            <h3 className="text-md font-semibold text-gray-700 mb-4 capitalize">
              {role.replace(/([A-Z])/g, ' $1').trim()} ({admins.length})
            </h3>
            <div className="space-y-4">
              {admins.map((admin) => {
                const isEditing = editingUserId === admin.userId;
                const isCreating = creatingLimit === admin.userId;
                const showForm = isEditing || isCreating;

                return (
                  <div key={admin.userId} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h4 className="font-semibold text-gray-900">{admin.userName}</h4>
                          {getRoleBadge(admin.userRole)}
                          {admin.hasCustomLimit && (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                              Custom Limit
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{admin.userEmail}</p>
                      </div>

                      {!showForm && (
                        <div className="flex items-center space-x-2">
                          {admin.hasCustomLimit ? (
                            <>
                              <button
                                onClick={() => handleEdit(admin)}
                                className="btn btn-outline-primary btn-sm"
                              >
                                <PencilIcon className="h-4 w-4 mr-1" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleDelete(admin.userId)}
                                disabled={deleteLimitMutation.isPending}
                                className="btn btn-outline-danger btn-sm"
                              >
                                <TrashIcon className="h-4 w-4 mr-1" />
                                Remove
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleCreate(admin)}
                              className="btn btn-primary btn-sm"
                            >
                              <PlusIcon className="h-4 w-4 mr-1" />
                              Set Custom Limit
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {showForm ? (
                      <div className="space-y-4 bg-white p-4 rounded-lg border border-gray-300">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Record Limit
                          </label>
                          <input
                            type="number"
                            value={editForm.totalRecordLimit}
                            onChange={(e) => setEditForm(prev => ({
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
                            value={editForm.description}
                            onChange={(e) => setEditForm(prev => ({
                              ...prev,
                              description: e.target.value
                            }))}
                            className="input"
                            rows={2}
                            maxLength={500}
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            {editForm.description.length}/500 characters
                          </p>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleSave(admin.userId)}
                            disabled={setLimitMutation.isPending || updateLimitMutation.isPending}
                            className="btn btn-primary btn-sm"
                          >
                            {setLimitMutation.isPending || updateLimitMutation.isPending ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={handleCancel}
                            className="btn btn-outline btn-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Current Limit</p>
                          <p className="text-lg font-bold text-gray-900">
                            {formatNumber(admin.currentLimit)}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {admin.hasCustomLimit ? 'Custom' : 'Role Default'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Used Records</p>
                          <p className="text-lg font-bold text-gray-900">
                            {formatNumber(admin.usedRecords)}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {admin.fileCount} files
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Remaining</p>
                          <p className={`text-lg font-bold ${
                            admin.remainingRecords > 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {formatNumber(admin.remainingRecords)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Usage</p>
                          <div className="flex items-center space-x-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${getUsageColor(admin.usagePercent)}`}
                                style={{ width: `${Math.min(admin.usagePercent, 100)}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-gray-900">
                              {admin.usagePercent.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {admin.hasCustomLimit && admin.individualLimit && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <p className="text-xs text-gray-500">
                          Custom limit set by {admin.individualLimit.updatedBy.name} on{' '}
                          {new Date(admin.individualLimit.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {adminLimits.length === 0 && (
          <div className="text-center py-12">
            <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Admins Found</h3>
            <p className="text-gray-600">No admin users found in the system.</p>
          </div>
        )}
      </div>
    </div>
  );
}
