import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { toast } from 'react-hot-toast';
import {
  CurrencyDollarIcon,
  UsersIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  PencilIcon,
  EyeIcon,
  FunnelIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';

interface PaymentSummary {
  month: number;
  year: number;
  period: string;
  rates: {
    auditorRate: number;
    fieldAgentRate: number;
  };
  userCounts: {
    auditors: number;
    fieldAgents: number;
  };
  expectedAmounts: {
    auditors: number;
    fieldAgents: number;
    total: number;
  };
  actualPayments: {
    auditors: {
      totalAmount: number;
      paidAmount: number;
      pendingAmount: number;
      overdueAmount: number;
      count: number;
      paidCount: number;
      pendingCount: number;
      overdueCount: number;
    };
    fieldAgents: {
      totalAmount: number;
      paidAmount: number;
      pendingAmount: number;
      overdueAmount: number;
      count: number;
      paidCount: number;
      pendingCount: number;
      overdueCount: number;
    };
  };
}

interface PaymentDetail {
  _id: string;
  userId: string;
  userRole: string;
  monthlyAmount: number;
  paymentMonth: number;
  paymentYear: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  paidAmount: number;
  paidDate: string | null;
  user: {
    _id: string;
    name: string;
    displayName?: string;
    email: string;
    phone: string;
    role: string;
    isActive: boolean;
    isDeleted?: boolean;
    createdAt: string;
  };
  paymentPeriod: string;
  daysOverdue: number;
}

interface PaymentRates {
  auditorRate: number;
  fieldAgentRate: number;
}

export default function AdminPayments() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentDetail | null>(null);
  const [filters, setFilters] = useState({ status: '', role: '' });
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // Get payment summary
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['admin-payment-summary', selectedMonth, selectedYear],
    queryFn: async () => {
      const response = await fetch(`/api/payments/admin-summary?month=${selectedMonth}&year=${selectedYear}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Failed to fetch payment summary');
      const data = await response.json();
      return data.data as PaymentSummary;
    }
  });

  // Get payment rates
  const { data: ratesData, isLoading: ratesLoading } = useQuery({
    queryKey: ['payment-rates'],
    queryFn: async () => {
      const response = await fetch('/api/payments/rates', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Failed to fetch payment rates');
      const data = await response.json();
      return data.data as PaymentRates;
    }
  });

  // Get payment details
  const { data: detailsData, isLoading: detailsLoading } = useQuery({
    queryKey: ['admin-payment-details', selectedMonth, selectedYear, filters, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        month: selectedMonth.toString(),
        year: selectedYear.toString(),
        page: page.toString(),
        limit: '20',
        ...(filters.status && { status: filters.status }),
        ...(filters.role && { role: filters.role })
      });
      
      const response = await fetch(`/api/payments/admin-details?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Failed to fetch payment details');
      const data = await response.json();
      return data;
    }
  });

  // Update rates mutation
  const updateRatesMutation = useMutation({
    mutationFn: async (rates: { auditorRate: number; fieldAgentRate: number }) => {
      const response = await fetch('/api/payments/rates', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(rates)
      });
      if (!response.ok) throw new Error('Failed to update rates');
      return response.json();
    },
    onSuccess: () => {
      toast.success('Payment rates updated successfully');
      queryClient.invalidateQueries({ queryKey: ['payment-rates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-payment-summary'] });
      setShowRatesModal(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update rates');
    }
  });

  // Generate monthly payments mutation
  const generatePaymentsMutation = useMutation({
    mutationFn: async (data: { month: number; year: number }) => {
      const response = await fetch('/api/payments/generate-monthly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Failed to generate payments');
      return response.json();
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Payments generated successfully');
      queryClient.invalidateQueries({ queryKey: ['admin-payment-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin-payment-details'] });
      setShowGenerateModal(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to generate payments');
    }
  });

  // Mark payment as paid mutation
  const markPaidMutation = useMutation({
    mutationFn: async (data: { paymentId: string; paidAmount: number; notes?: string }) => {
      const response = await fetch(`/api/payments/${data.paymentId}/mark-paid`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          paidAmount: data.paidAmount,
          notes: data.notes
        })
      });
      if (!response.ok) throw new Error('Failed to mark payment as paid');
      return response.json();
    },
    onSuccess: () => {
      toast.success('Payment marked as paid successfully');
      queryClient.invalidateQueries({ queryKey: ['admin-payment-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin-payment-details'] });
      setShowMarkPaidModal(false);
      setSelectedPayment(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to mark payment as paid');
    }
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    // Use UTC methods to avoid timezone conversion issues
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = date.toLocaleDateString('en-IN', { month: 'short' });
    const year = date.getUTCFullYear();
    return `${day} ${month} ${year}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircleIcon className="h-3 w-3 mr-1" />
            Paid
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <ClockIcon className="h-3 w-3 mr-1" />
            Pending
          </span>
        );
      case 'overdue':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <ExclamationTriangleIcon className="h-3 w-3 mr-1" />
            Overdue
          </span>
        );
      default:
        return null;
    }
  };

  const handleUpdateRates = (rates: { auditorRate: number; fieldAgentRate: number }) => {
    updateRatesMutation.mutate(rates);
  };

  const handleGeneratePayments = (data: { month: number; year: number }) => {
    if (!ratesData) {
      toast.error('Please set payment rates first before generating payments');
      setShowGenerateModal(false);
      setShowRateModal(true);
      return;
    }
    generatePaymentsMutation.mutate(data);
  };

  const handleMarkPaid = (paymentId: string, paidAmount: number, notes?: string) => {
    markPaidMutation.mutate({ paymentId, paidAmount, notes });
  };

  const clearFilters = () => {
    setFilters({ status: '', role: '' });
    setPage(1);
  };

  if (summaryLoading || ratesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Management</h1>
          <p className="text-gray-600">Manage payments from auditors and field agents</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowRatesModal(true)}
            className="btn btn-primary"
          >
            <PencilIcon className="h-4 w-4 mr-2" />
            Update Rates
          </button>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn btn-secondary"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Generate Payments
          </button>
        </div>
      </div>

      {/* Month/Year Selector */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="h-5 w-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Period:</span>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
          className="form-select"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
            <option key={month} value={month}>
              {new Date(2024, month - 1).toLocaleDateString('en-US', { month: 'long' })}
            </option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(parseInt(e.target.value))}
          className="form-select"
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      {/* Summary Cards */}
      <div className="mb-4">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> Payment amounts are calculated based on ALL users created during each month, including those who were added and deleted within the same month. 
            If users are added or removed, the amounts will automatically update to reflect the correct billing.
          </p>
        </div>
      </div>
      {summaryData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Expected Amount */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-blue-100 rounded-lg">
                <CurrencyDollarIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Expected Amount</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(summaryData.expectedAmounts.total)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              <p>Auditors: {formatCurrency(summaryData.expectedAmounts.auditors)}</p>
              <p>Field Agents: {formatCurrency(summaryData.expectedAmounts.fieldAgents)}</p>
            </div>
          </div>

          {/* Paid Amount */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircleIcon className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Paid Amount</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(summaryData.actualPayments.auditors.paidAmount + summaryData.actualPayments.fieldAgents.paidAmount)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              <p>Auditors: {formatCurrency(summaryData.actualPayments.auditors.paidAmount)}</p>
              <p>Field Agents: {formatCurrency(summaryData.actualPayments.fieldAgents.paidAmount)}</p>
            </div>
          </div>

          {/* Pending Amount */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <ClockIcon className="h-6 w-6 text-yellow-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pending Amount</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {formatCurrency(summaryData.actualPayments.auditors.pendingAmount + summaryData.actualPayments.fieldAgents.pendingAmount)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              <p>Auditors: {formatCurrency(summaryData.actualPayments.auditors.pendingAmount)}</p>
              <p>Field Agents: {formatCurrency(summaryData.actualPayments.fieldAgents.pendingAmount)}</p>
            </div>
          </div>

          {/* Overdue Amount */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-red-100 rounded-lg">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Overdue Amount</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatCurrency(summaryData.actualPayments.auditors.overdueAmount + summaryData.actualPayments.fieldAgents.overdueAmount)}
                </p>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              <p>Auditors: {formatCurrency(summaryData.actualPayments.auditors.overdueAmount)}</p>
              <p>Field Agents: {formatCurrency(summaryData.actualPayments.fieldAgents.overdueAmount)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Current Rates */}
      {ratesData && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Payment Rates</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-600">Auditor Rate</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(ratesData.auditorRate)} / month
                </p>
              </div>
              <UsersIcon className="h-8 w-8 text-blue-500" />
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-600">Field Agent Rate</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(ratesData.fieldAgentRate)} / month
                </p>
              </div>
              <UsersIcon className="h-8 w-8 text-green-500" />
            </div>
          </div>
        </div>
      )}

      {/* Payment Details Table */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b-2 border-gray-400">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Payment Details</h3>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="btn btn-outline btn-sm"
              >
                <FunnelIcon className="h-4 w-4 mr-2" />
                Filters
              </button>
            </div>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                    className="form-select"
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={filters.role}
                    onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                    className="form-select"
                  >
                    <option value="">All Roles</option>
                    <option value="auditor">Auditor</option>
                    <option value="fieldAgent">Field Agent</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="btn btn-outline btn-sm"
                  >
                    <XMarkIcon className="h-4 w-4 mr-2" />
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Period
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
                         <tbody className="bg-white divide-y divide-gray-200">
                              {detailsData?.data && detailsData.data.length > 0 ? (
                 detailsData.data.map((payment: PaymentDetail) => (
                   <tr key={payment._id}>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <div>
                         <div className={`text-sm font-medium ${
                           payment.user.isDeleted ? 'text-red-600' : 'text-gray-900'
                         }`}>
                           {payment.user.displayName || payment.user.name}
                         </div>
                         <div className="text-sm text-gray-500">{payment.user.email}</div>
                       </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                         payment.userRole === 'auditor' 
                           ? 'bg-blue-100 text-blue-800' 
                           : 'bg-green-100 text-green-800'
                       }`}>
                         {payment.userRole === 'auditor' ? 'Auditor' : 'Field Agent'}
                       </span>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <div className="text-sm font-medium text-gray-900">
                         {payment.paymentPeriod}
                       </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                       {formatCurrency(payment.monthlyAmount)}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                       {formatDate(payment.dueDate)}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                       {getStatusBadge(payment.status)}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                       <div className="flex space-x-2">
                         <button
                           onClick={() => {
                             setSelectedPayment(payment);
                             setShowMarkPaidModal(true);
                           }}
                           disabled={payment.status === 'paid'}
                           className="text-blue-600 hover:text-blue-900 disabled:text-gray-400"
                         >
                           <EyeIcon className="h-4 w-4" />
                         </button>
                       </div>
                     </td>
                   </tr>
                 ))
               ) : (
                 <tr>
                   <td colSpan={7} className="px-6 py-8 text-center">
                     <div className="text-gray-500">
                       <UsersIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                       <p className="text-lg font-medium">No payment records found</p>
                       <p className="text-sm">Generate payments for this month to see payment details.</p>
                       <button
                         onClick={() => setShowGenerateModal(true)}
                         className="mt-4 btn btn-primary btn-sm"
                       >
                         <PlusIcon className="h-4 w-4 mr-2" />
                         Generate Payments
                       </button>
                     </div>
                   </td>
                 </tr>
               )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {detailsData?.pagination && (
          <div className="px-6 py-4 border-t-2 border-gray-400">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {((detailsData.pagination.page - 1) * detailsData.pagination.limit) + 1} to{' '}
                {Math.min(detailsData.pagination.page * detailsData.pagination.limit, detailsData.pagination.total)} of{' '}
                {detailsData.pagination.total} results
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="btn btn-outline btn-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page >= detailsData.pagination.pages}
                  className="btn btn-outline btn-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Update Rates Modal */}
      {showRatesModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Update Payment Rates</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleUpdateRates({
                  auditorRate: parseFloat(formData.get('auditorRate') as string),
                  fieldAgentRate: parseFloat(formData.get('fieldAgentRate') as string)
                });
              }}>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="auditorRate" className="block text-sm font-medium text-gray-700">
                      Auditor Rate (per month)
                    </label>
                    <input
                      type="number"
                      name="auditorRate"
                      id="auditorRate"
                      defaultValue={ratesData?.auditorRate || 0}
                      step="0.01"
                      min="0"
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="fieldAgentRate" className="block text-sm font-medium text-gray-700">
                      Field Agent Rate (per month)
                    </label>
                    <input
                      type="number"
                      name="fieldAgentRate"
                      id="fieldAgentRate"
                      defaultValue={ratesData?.fieldAgentRate || 0}
                      step="0.01"
                      min="0"
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowRatesModal(false)}
                    className="btn btn-outline"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateRatesMutation.isPending}
                    className="btn btn-primary"
                  >
                    {updateRatesMutation.isPending ? 'Updating...' : 'Update Rates'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Generate Payments Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-6 border w-full max-w-2xl shadow-xl rounded-lg bg-white">
            <div className="mt-3">
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Generate Monthly Payments</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleGeneratePayments({
                  month: parseInt(formData.get('month') as string),
                  year: parseInt(formData.get('year') as string)
                });
              }}>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="month" className="block text-sm font-semibold text-gray-700 mb-2">
                        Month
                      </label>
                      <select
                        name="month"
                        id="month"
                        defaultValue={selectedMonth}
                        className="mt-1 block w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                        required
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                          <option key={month} value={month}>
                            {new Date(2024, month - 1).toLocaleDateString('en-US', { month: 'long' })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="year" className="block text-sm font-semibold text-gray-700 mb-2">
                        Year
                      </label>
                      <select
                        name="year"
                        id="year"
                        defaultValue={selectedYear}
                        className="mt-1 block w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                        required
                      >
                        {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Current Rates Display */}
                  {!ratesData ? (
                    <div className="bg-red-50 border-2 border-red-300 rounded-lg p-5">
                      <div className="flex items-start">
                        <ExclamationTriangleIcon className="h-6 w-6 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-lg font-semibold text-red-800 mb-2">
                            ⚠️ Payment Rates Not Set
                          </h4>
                          <p className="text-sm text-red-700 mb-4">
                            You must set payment rates before generating payments. Payments cannot be generated without rates.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setShowGenerateModal(false);
                              setShowRateModal(true);
                            }}
                            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-md"
                          >
                            Set Payment Rates Now
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-green-900 flex items-center">
                          <CurrencyDollarIcon className="h-5 w-5 mr-2" />
                          Current Payment Rates
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            setShowGenerateModal(false);
                            setShowRateModal(true);
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-green-700 bg-white border-2 border-green-300 rounded-lg hover:bg-green-50 transition-colors"
                        >
                          Change Rates
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-4 rounded-lg border-2 border-blue-200 shadow-sm">
                          <div className="flex items-center mb-2">
                            <UsersIcon className="w-5 h-5 text-blue-600 mr-2" />
                            <span className="text-sm font-semibold text-blue-900">Auditor Rate</span>
                          </div>
                          <p className="text-2xl font-bold text-blue-600">₹{ratesData.auditorRate}</p>
                          <p className="text-xs text-gray-500 mt-1">per auditor / month</p>
                        </div>
                        <div className="bg-white p-4 rounded-lg border-2 border-green-200 shadow-sm">
                          <div className="flex items-center mb-2">
                            <UsersIcon className="w-5 h-5 text-green-600 mr-2" />
                            <span className="text-sm font-semibold text-green-900">Field Agent Rate</span>
                          </div>
                          <p className="text-2xl font-bold text-green-600">₹{ratesData.fieldAgentRate}</p>
                          <p className="text-xs text-gray-500 mt-1">per field agent / month</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      <strong>Note:</strong> This will generate payments for all users based on the selected month and year.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowGenerateModal(false)}
                    className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 border-2 border-gray-300 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={generatePaymentsMutation.isPending || !ratesData}
                    className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-emerald-600 border border-transparent rounded-lg hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
                  >
                    {generatePaymentsMutation.isPending ? 'Generating...' : 'Generate Payments'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Mark Paid Modal */}
      {showMarkPaidModal && selectedPayment && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Mark Payment as Paid</h3>
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                                       <strong className={selectedPayment.user.isDeleted ? 'text-red-600' : ''}>
                       {selectedPayment.user.displayName || selectedPayment.user.name}
                     </strong> ({selectedPayment.userRole})
                </p>
                <p className="text-sm text-gray-600">
                  Amount: {formatCurrency(selectedPayment.monthlyAmount)}
                </p>
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleMarkPaid(
                  selectedPayment._id,
                  parseFloat(formData.get('paidAmount') as string),
                  formData.get('notes') as string || undefined
                );
              }}>
                <div className="space-y-4">
                  <div>
                    <label htmlFor="paidAmount" className="block text-sm font-medium text-gray-700">
                      Paid Amount
                    </label>
                    <input
                      type="number"
                      name="paidAmount"
                      id="paidAmount"
                      defaultValue={selectedPayment.monthlyAmount}
                      step="0.01"
                      min="0"
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                      Notes (optional)
                    </label>
                    <textarea
                      name="notes"
                      id="notes"
                      rows={3}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowMarkPaidModal(false);
                      setSelectedPayment(null);
                    }}
                    className="btn btn-outline"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={markPaidMutation.isPending}
                    className="btn btn-primary"
                  >
                    {markPaidMutation.isPending ? 'Marking...' : 'Mark as Paid'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
